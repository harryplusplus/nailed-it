#!/usr/bin/env bash
set -euo pipefail

exec uvx --from=mitmproxy==12.2.3 \
    mitmweb \
    -m reverse:http://localhost:4000 \
    --no-web-open-browser \
    -s python-packages/mitm-hooks/src/mitm_hooks/main.py
