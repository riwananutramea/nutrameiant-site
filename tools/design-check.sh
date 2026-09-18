#!/usr/bin/env bash
# Entrypoint for the DESIGN_RULES.md checker. Run before calling a change finished.
set -euo pipefail
exec python3 "$(dirname "$0")/design_check.py" "$@"
