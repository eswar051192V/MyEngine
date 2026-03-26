#!/usr/bin/env bash
# Run from any directory; uses the project venv.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
if [[ ! -x "$ROOT/.venv/bin/python" ]]; then
  echo "Missing venv. From repo root run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi
exec "$ROOT/.venv/bin/python" -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000
