import logging
import sys

from hindsight_api.main import main

if __name__ == "__main__":
    logging.getLogger("httpcore.http11").setLevel(logging.INFO)
    sys.exit(main())
