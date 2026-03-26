#!/usr/bin/env bash
# Install/start Ollama (if needed), pull chat + embed models, then run the FastAPI server.
# Usage: ./dev_with_ollama.sh
# Optional: SKIP_PULL=1 ./dev_with_ollama.sh
# Optional: LEAVE_OLLAMA_RUNNING=1 ./dev_with_ollama.sh   (do not stop Ollama when API exits)
# Load .env for OLLAMA_MODEL, OLLAMA_EMBED_MODEL, OLLAMA_HOST (defaults match .env.example).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.1}"
OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-nomic-embed-text}"
# Lets the React app call Ollama from the browser (see App.js CORS tip).
export OLLAMA_ORIGINS="${OLLAMA_ORIGINS:-*}"

BREW="${HOMEBREW_PREFIX:-/opt/homebrew}/bin/brew"

ensure_ollama_cli() {
  if command -v ollama >/dev/null 2>&1; then
    return 0
  fi
  if [[ -x "$BREW" ]]; then
    echo "Installing Ollama via Homebrew..."
    "$BREW" install ollama
  else
    echo "Ollama is not installed and Homebrew was not found at $BREW." >&2
    echo "Install from https://ollama.com/download and re-run this script." >&2
    exit 1
  fi
}

wait_for_ollama() {
  local i
  for i in $(seq 1 45); do
    if curl -sf "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

STARTED_OLLAMA=0
OLLAMA_PID=""

ensure_ollama_running() {
  if wait_for_ollama; then
    echo "Ollama is already responding on http://127.0.0.1:11434"
    return 0
  fi
  echo "Starting Ollama in the background..."
  ollama serve &
  OLLAMA_PID=$!
  STARTED_OLLAMA=1
  if ! wait_for_ollama; then
    echo "Ollama did not become ready in time." >&2
    exit 1
  fi
  echo "Ollama is up (pid $OLLAMA_PID)."
}

cleanup() {
  if [[ "${LEAVE_OLLAMA_RUNNING:-0}" == "1" ]]; then
    return 0
  fi
  if [[ "$STARTED_OLLAMA" -eq 1 && -n "$OLLAMA_PID" ]] && kill -0 "$OLLAMA_PID" 2>/dev/null; then
    echo "Stopping Ollama (pid $OLLAMA_PID)..."
    kill "$OLLAMA_PID" 2>/dev/null || true
    wait "$OLLAMA_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

pull_models() {
  if [[ "${SKIP_PULL:-0}" == "1" ]]; then
    echo "SKIP_PULL=1 — skipping ollama pull."
    return 0
  fi
  echo "Pulling models (first run can take a while): $OLLAMA_MODEL + $OLLAMA_EMBED_MODEL"
  ollama pull "$OLLAMA_MODEL"
  ollama pull "$OLLAMA_EMBED_MODEL"
}

ensure_ollama_cli
ensure_ollama_running
pull_models

if [[ ! -x "$ROOT/.venv/bin/python" ]]; then
  echo "Missing venv. Run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

echo "Starting API at http://127.0.0.1:8000 (docs: /docs). Ctrl+C stops the API; Ollama is stopped only if this script started it."
"$ROOT/.venv/bin/python" -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000

</think>
Fixing shutdown: use a foreground `uvicorn` (not `exec`) so we can stop Ollama only if this script started it.

<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>
StrReplace