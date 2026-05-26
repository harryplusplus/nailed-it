"""Serve subprocesses with rotating-file logging per service."""

import logging
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import IO

from dev_cli.common import REPO_ROOT

HINDSIGHT_API_RETAIN_MISSION = (
    "텍스트에서 중요한 사실만 선택적으로 추출한다."
    " 장기 기억에 가치 있는 사실만 남기고, 인사·잡담·필러·프로세스 잡담·반복 정보는 제외한다."  # noqa: E501
    " 개인정보·선호·중대한 이벤트·계획·전문성·중요한 맥락·감각·정서적 세부 사항·관찰을 포함한다."  # noqa: E501
    " 모든 출력은 입력 텍스트와 동일한 언어(한국어)로 한다."
)

HINDSIGHT_API_OBSERVATIONS_MISSION = (
    "모든 세부 사항을 추적한다: 이름, 숫자, 날짜, 장소, 관계. 추상화보다 구체적인 사실을 선호하며, 절대 일반화하지 않는다."  # noqa: E501
    " 모든 출력은 원본 텍스트의 언어(한국어)를 그대로 보존한다."
)

HINDSIGHT_API_REFLECT_MISSION = (
    "검색된 기억들을 추론하여 질문에 답하는 reflection agent이다."
    " 제공된 기억과 관찰을 사용해 질문에 철저히 답하고, 기억의 구체적인 세부 사항을 인용하며, 여러 출처의 정보를 관련 있을 때 종합한다."  # noqa: E501
    " 마크다운 서식을 사용한다."
    " 모든 출력은 사용자의 질문과 동일한 언어(한국어)로 한다."
)


@dataclass(frozen=True, kw_only=True, slots=True)
class _SvcDef:
    name: str
    run_cmd: str
    run_cwd: Path = REPO_ROOT
    stop_timeout_seconds: float = 30.0

    # Startup probe — poll until the service is ready
    startup_cmd: str
    startup_cwd: Path = REPO_ROOT
    startup_period_seconds: float = 2.0
    startup_timeout_seconds: float = 10.0
    startup_failure_threshold: int = 90

    # Liveness probe — periodic health checks (None = use startup_cmd)
    liveness_cmd: str | None = None
    liveness_cwd: Path = REPO_ROOT
    liveness_period_seconds: float = 10.0
    liveness_timeout_seconds: float = 5.0
    liveness_failure_threshold: int = 3


_SVC_DEFS: list[_SvcDef] = [
    _SvcDef(
        name="phoenix",
        run_cmd="bash scripts/phoenix.sh",
        startup_cmd="curl -sf http://localhost:6006 > /dev/null 2>&1",
    ),
    _SvcDef(
        name="litellm",
        run_cmd="bash scripts/litellm.sh",
        startup_cmd="curl -sf http://localhost:4000 > /dev/null 2>&1",
    ),
    _SvcDef(
        name="mitm",
        run_cmd="bash scripts/mitm.sh",
        startup_cmd="curl -sf http://localhost:8080/v1/models > /dev/null 2>&1",
    ),
    _SvcDef(
        name="hindsight-api",
        run_cmd="HINDSIGHT_API_DATABASE_URL=postgresql://harry@localhost:5432/hindsight"
        " HINDSIGHT_API_LLM_BASE_URL=http://localhost:8080/v1"
        " HINDSIGHT_API_LLM_API_KEY=hindsight"
        " HINDSIGHT_API_LLM_MODEL=mimo-v2.5-pro-precision"
        " HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=BAAI/bge-m3"
        " HINDSIGHT_API_TEXT_SEARCH_EXTENSION=vchord"
        " HINDSIGHT_API_RERANKER_LOCAL_MODEL=bongsoo/albert-small-kor-cross-encoder-v1"
        " HINDSIGHT_API_RECALL_MAX_QUERY_TOKENS=1500"
        f' HINDSIGHT_API_RETAIN_MISSION="{HINDSIGHT_API_RETAIN_MISSION}"'
        f' HINDSIGHT_API_OBSERVATIONS_MISSION="{HINDSIGHT_API_OBSERVATIONS_MISSION}"'
        f' HINDSIGHT_API_REFLECT_MISSION="{HINDSIGHT_API_REFLECT_MISSION}"'
        " uvx"
        " --from=hindsight-api-slim==0.6.2"
        " --with=sentence_transformers==5.5.1"
        " hindsight-api",
        startup_cmd="curl -sf http://localhost:8888/health > /dev/null 2>&1",
    ),
    _SvcDef(
        name="hindsight-control-plane",
        run_cmd="npx -y @vectorize-io/hindsight-control-plane@0.6.2",
        startup_cmd="curl -sf http://localhost:9999 > /dev/null 2>&1",
    ),
]

_LOGS_DIR = Path.home() / ".nailed-it" / "logs"
_LOG_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
_LOG_BACKUP_COUNT = 5


def _setup_service_logger(svc_name: str) -> logging.Logger:
    """Set up a rotating file logger for a service's combined output.

    Logs are written to ``~/.nailed-it/logs/<svc_name>.log``
    with 10 MB rotation and 5 backup files.
    """
    logger = logging.getLogger(svc_name)
    logger.setLevel(logging.INFO)
    logger.propagate = False

    handler = RotatingFileHandler(
        _LOGS_DIR / f"{svc_name}.log",
        maxBytes=_LOG_MAX_BYTES,
        backupCount=_LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    logger.addHandler(handler)

    return logger


def _pipe_reader(
    stream: IO[bytes],
    logger: logging.Logger,
    prefix: str,
) -> None:
    """Read lines from *stream* and forward them to *logger* with a [prefix]."""
    try:
        while True:
            raw_line = stream.readline()
            if raw_line == b"":
                break
            line = raw_line.decode(errors="replace").rstrip()
            logger.info("[%s] %s", prefix, line)
    finally:
        stream.close()


def _await_service(svc_def: _SvcDef) -> None:
    """Block until the service startup check (*startup_cmd*) succeeds.

    Raises RuntimeError if *startup_failure_threshold* consecutive checks
    fail or time out.
    """
    failures = 0
    while True:
        try:
            result = subprocess.run(  # noqa: S602
                svc_def.startup_cmd,
                cwd=svc_def.startup_cwd,
                shell=True,
                capture_output=True,
                timeout=svc_def.startup_timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired:
            failures += 1
            if failures >= svc_def.startup_failure_threshold:
                msg = (
                    f"{svc_def.name} startup check timed out "
                    f"({failures}/{svc_def.startup_failure_threshold})"
                )
                raise RuntimeError(msg) from None
            time.sleep(svc_def.startup_period_seconds)
            continue

        if result.returncode == 0:
            return

        failures += 1
        if failures >= svc_def.startup_failure_threshold:
            msg = (
                f"{svc_def.name} startup check failed "
                f"({failures}/{svc_def.startup_failure_threshold})"
            )
            raise RuntimeError(msg) from None

        time.sleep(svc_def.startup_period_seconds)


def _check_liveness(cmd: str, cwd: Path, timeout: float) -> bool:
    """Run a single liveness check. Returns ``True`` if healthy."""
    try:
        result = subprocess.run(  # noqa: S602
            cmd,
            cwd=cwd,
            shell=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False
    else:
        return result.returncode == 0


def _monitor_servers(
    serve_out: logging.Logger,
) -> None:
    """Periodic liveness checks until interrupted.

    Each service is checked on its own schedule (*liveness_period_seconds*).
    """
    last_checked: dict[str, float] = {}
    liveness_failures: dict[str, int] = {}

    while True:
        now = time.monotonic()
        for svc_def in _SVC_DEFS:
            liveness_cmd = svc_def.liveness_cmd or svc_def.startup_cmd

            period = svc_def.liveness_period_seconds
            last = last_checked.get(svc_def.name, 0.0)
            if now - last < period:
                continue

            last_checked[svc_def.name] = now

            alive = _check_liveness(
                liveness_cmd,
                svc_def.liveness_cwd,
                svc_def.liveness_timeout_seconds,
            )
            if alive:
                liveness_failures.pop(svc_def.name, None)
            else:
                count = liveness_failures.get(svc_def.name, 0) + 1
                liveness_failures[svc_def.name] = count
                serve_out.info(
                    "  %s liveness check failed %d/%d",
                    svc_def.name,
                    count,
                    svc_def.liveness_failure_threshold,
                )
                if count >= svc_def.liveness_failure_threshold:
                    serve_out.info(
                        "%s is down -- shutting down all services",
                        svc_def.name,
                    )
                    raise SystemExit(1)

        time.sleep(1)


def run_serve() -> None:
    """Start all configured services sequentially and block until SIGTERM/SIGINT."""
    signal.signal(signal.SIGTERM, lambda signum, _frame: sys.exit(128 + signum))

    # Pre-create log directory and service working directories
    _LOGS_DIR.mkdir(parents=True, exist_ok=True)
    for svc_def in _SVC_DEFS:
        svc_def.run_cwd.mkdir(parents=True, exist_ok=True)
        svc_def.startup_cwd.mkdir(parents=True, exist_ok=True)
        svc_def.liveness_cwd.mkdir(parents=True, exist_ok=True)

    main_logger = _setup_service_logger("main")

    processes: list[subprocess.Popen] = []

    try:
        for svc_def in _SVC_DEFS:
            main_logger.info("Starting %s...", svc_def.name)

            svc_logger = _setup_service_logger(svc_def.name)

            proc = subprocess.Popen(  # noqa: S602
                svc_def.run_cmd,
                cwd=svc_def.run_cwd,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            processes.append(proc)

            threading.Thread(
                target=_pipe_reader,
                args=(proc.stdout, svc_logger, "stdout"),
                daemon=True,
            ).start()
            threading.Thread(
                target=_pipe_reader,
                args=(proc.stderr, svc_logger, "stderr"),
                daemon=True,
            ).start()

            main_logger.info("  Waiting for %s to be ready...", svc_def.name)
            _await_service(svc_def)
            main_logger.info("  %s is ready", svc_def.name)

        main_logger.info("All services are ready. Press Ctrl+C to stop.")

        _monitor_servers(main_logger)

    except RuntimeError:
        main_logger.exception("Fatal error")
        raise
    except KeyboardInterrupt:
        main_logger.info("Shutting down...")
    finally:
        # Reverse order: last started = first killed (dependency order)
        reversed_procs = list(reversed(processes))
        for proc in reversed_procs:
            proc.terminate()
        for proc, svc_def in zip(reversed_procs, reversed(_SVC_DEFS), strict=True):
            try:
                proc.wait(timeout=svc_def.stop_timeout_seconds)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
