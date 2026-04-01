#!/usr/bin/env bash
# Start FastAPI from repo root (so `backend` imports work). Safe to run from this folder.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/run_backend.sh"
