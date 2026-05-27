#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

exec npx -y @vectorize-io/hindsight-control-plane@0.6.2
