#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

exec uvx --from=mitmproxy==12.2.3 mitmdump \
    --mode=reverse:https://crof.ai
