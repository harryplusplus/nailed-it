#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

exec uvx --from=arize-phoenix==16.0.0 phoenix serve
