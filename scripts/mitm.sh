#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

exec uvx --from=mitmproxy==12.2.3 mitmweb \
    --mode=reverse:http://localhost:4000 \
    --no-web-open-browser \
    --scripts=python-packages/mitm-hooks/src/mitm_hooks/main.py
