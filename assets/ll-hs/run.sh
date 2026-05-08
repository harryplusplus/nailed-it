#!/usr/bin/env bash
set -euo pipefail

cd ~/.ll-hs
tmux new-session -s ll-hs 'uvx --python 3.13 litellm --config config.yaml --port 4000 --host 127.0.0.1'
