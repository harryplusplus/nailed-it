#!/usr/bin/env bash
set -euo pipefail

exec uvx --from=arize-phoenix==16.0.0 phoenix serve
