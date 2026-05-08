#!/usr/bin/env bash
set -euo pipefail

: "${LF_HINDSIGHT_PUBLIC_KEY:?}"
: "${LF_HINDSIGHT_SECRET_KEY:?}"
: "${CROF_API_KEY:?}"

cd ~/.ll-hs
tmux new-session -s ll-hs \
  env LANGFUSE_PUBLIC_KEY="$LF_HINDSIGHT_PUBLIC_KEY" \
      LANGFUSE_SECRET_KEY="$LF_HINDSIGHT_SECRET_KEY" \
      LANGFUSE_OTEL_HOST="${LANGFUSE_OTEL_HOST:-http://localhost:3000}" \
      CROF_API_KEY="$CROF_API_KEY" \
  uvx --python 3.13 litellm --config config.yaml --port 8100 --host 127.0.0.1
