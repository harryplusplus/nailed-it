#!/usr/bin/env bash
set -euo pipefail

cd ~/.ll-hs
tmux new-session -s ll-hs 'litellm --config config.yaml --port 4000'
