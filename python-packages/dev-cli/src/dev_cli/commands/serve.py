import signal
import sys


def run_serve() -> None:
    signal.signal(signal.SIGTERM, lambda signum, _frame: sys.exit(128 + signum))
    try:
        pass
    # uvx --from arize-phoenix@16.0.0 phoenix serve
    finally:
        pass
