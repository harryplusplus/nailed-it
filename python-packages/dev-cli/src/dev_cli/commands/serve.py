import signal
import sys
from dataclasses import dataclass


@dataclass(kw_only=True, frozen=True, slots=True)
class _Service:
    name: str
    run_cmd: str
    check_cmd: str
    check_interval_seconds: float = 5.0


_SERVICES: list[_Service] = [
    _Service(
        name="phoenix",
        run_cmd="uvx --from arize-phoenix@16.0.0 phoenix serve",
        check_cmd="curl -sf http://localhost:6006 > /dev/null 2>&1",
    )
]


def run_serve() -> None:
    signal.signal(signal.SIGTERM, lambda signum, _frame: sys.exit(128 + signum))
    services = []
    try:
        pass
    finally:
        pass
