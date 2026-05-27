#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${CROF_API_KEY:?CROF_API_KEY is required}"

exec uvx \
    --from=mitmproxy==12.2.3 \
    --with=opentelemetry-api==1.42.1 \
    --with=opentelemetry-sdk==1.42.1 \
    --with=opentelemetry-exporter-otlp-proto-http==1.42.1 \
    --with=openinference-semantic-conventions==0.1.30 \
    --with=./python-packages/mitm \
    mitmweb \
    --mode=reverse:https://crof.ai \
    --no-web-open-browser \
    -s python-packages/mitm/src/mitm/main.py
