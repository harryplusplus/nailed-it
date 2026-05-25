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

    # Liveness probe — periodic health checks (None = skip)
    liveness_cmd: str | None = None
    liveness_cwd: Path = REPO_ROOT
    liveness_period_seconds: float = 10.0
    liveness_timeout_seconds: float = 5.0
    liveness_failure_threshold: int = 3


_SVC_DEFS: list[_SvcDef] = [
    _SvcDef(
        name="phoenix",
        run_cmd="uvx --from=arize-phoenix==16.0.0 phoenix serve",
        startup_cmd="curl -sf http://localhost:6006 > /dev/null 2>&1",
        liveness_cmd="curl -sf http://localhost:6006 > /dev/null 2>&1",
    ),
    _SvcDef(
        name="litellm-hindsight",
        run_cmd="uvx"
        " --from='litellm[proxy]==1.86.0'"
        " --with=opentelemetry-api==1.42.1"
        " --with=opentelemetry-sdk==1.42.1"
        " --with=opentelemetry-exporter-otlp==1.42.1"
        " --python=3.13"
        " litellm"
        f" --config={REPO_ROOT / 'assets' / 'litellm-hindsight' / 'config.yaml'}"
        " --port=8001",
        run_cwd=Path.home() / ".nailed-it" / "litellm-hindsight",
        startup_cmd="curl -sf http://localhost:8001 > /dev/null 2>&1",
        liveness_cmd="curl -sf http://localhost:8001 > /dev/null 2>&1",
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
            if svc_def.liveness_cmd is None:
                continue

            period = svc_def.liveness_period_seconds
            last = last_checked.get(svc_def.name, 0.0)
            if now - last < period:
                continue

            last_checked[svc_def.name] = now

            alive = _check_liveness(
                svc_def.liveness_cmd,
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
