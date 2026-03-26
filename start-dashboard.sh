#!/usr/bin/env bash
# Run the React dev server from this repo (same tree as backend + all_global_tickers.json).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/stock-analysis-dashboard"
exec npm start
