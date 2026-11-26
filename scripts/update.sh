#!/usr/bin/env bash
# Prefer: npm run update  (node scripts/update.js — works on Windows).
# This wrapper keeps older docs/scripts that still call bash.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/update.js" "$@"
