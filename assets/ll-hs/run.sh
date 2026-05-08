#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

tmux new-session -s ll-hs \
  "cd ~/.ll-hs && set -a && source $REPO_ROOT/.env.ll-hs && set +a && exec uvx --python 3.13 litellm --config config.yaml --port 8100 --host 127.0.0.1"
