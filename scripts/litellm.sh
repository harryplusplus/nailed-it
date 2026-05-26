#!/usr/bin/env bash
set -euo pipefail

exec uvx --from='litellm[proxy]==1.86.0' \
    --with=opentelemetry-api==1.42.1 \
    --with=opentelemetry-sdk==1.42.1 \
    --with=opentelemetry-exporter-otlp==1.42.1 \
    --python=3.13 \
    litellm \
    --config=assets/litellm/config.yaml
