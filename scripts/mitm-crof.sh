#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

exec uvx \
    --from=mitmproxy==12.2.3 \
    mitmweb \
    --mode=reverse:https://crof.ai \
    --no-web-open-browser \
    -s python-packages/mitm-crof/src/mitm_crof/main.py
