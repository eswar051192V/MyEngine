#!/usr/bin/env bash
# ============================================================
#  Market Watcher — One-Command Launcher
#  Starts: Ollama AI  ·  FastAPI Backend  ·  React Frontend
#
#  Usage:
#    ./start.sh              # normal start
#    ./start.sh restart      # kill ports first, then start
#    ./start.sh --no-ai      # skip Ollama (backend + frontend only)
#
#  Env vars (optional, or put them in .env):
#    OLLAMA_MODEL        chat model       (default: llama3.1)
#    OLLAMA_EMBED_MODEL  embedding model  (default: nomic-embed-text)
#    SKIP_PULL=1         skip model pull
#    PORT_BACKEND=8000
#    PORT_FRONTEND=3000
# ============================================================

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Create logs dir upfront
mkdir -p "$ROOT/logs"

# ── Colours ──────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; B='\033[1m'; NC='\033[0m'

# ── Load .env if present ─────────────────────────────────────
if [ -f "$ROOT/.env" ]; then
  set -a; source "$ROOT/.env"; set +a
fi

OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.1}"
OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-nomic-embed-text}"
export OLLAMA_ORIGINS="${OLLAMA_ORIGINS:-*}"
PORT_BACKEND="${PORT_BACKEND:-8000}"
PORT_FRONTEND="${PORT_FRONTEND:-3000}"
SKIP_AI=0

# ── Track PIDs for cleanup (simple vars, no arrays) ─────────
BACKEND_PID=""
FRONTEND_PID=""
STARTED_OLLAMA=0
OLLAMA_PID=""

cleanup() {
  echo ""
  echo -e "${R}Shutting down all services...${NC}"
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
  if [ "$STARTED_OLLAMA" -eq 1 ] && [ -n "$OLLAMA_PID" ]; then
    kill "$OLLAMA_PID" 2>/dev/null
  fi
  wait 2>/dev/null
  echo -e "${G}All services stopped.${NC}"
  exit 0
}
trap cleanup INT TERM

# ── Parse args ───────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    restart)
      echo -e "${Y}Clearing ports $PORT_BACKEND, $PORT_FRONTEND, 11434...${NC}"
      lsof -ti:"$PORT_BACKEND" | xargs kill -9 2>/dev/null || true
      lsof -ti:"$PORT_FRONTEND" | xargs kill -9 2>/dev/null || true
      lsof -ti:11434 | xargs kill -9 2>/dev/null || true
      sleep 1
      echo -e "${G}Ports cleared.${NC}"
      ;;
    --no-ai|--skip-ai)
      SKIP_AI=1
      ;;
  esac
done

echo ""
echo -e "${C}${B}══════════════════════════════════════════${NC}"
echo -e "${C}${B}      MARKET WATCHER — Starting Up        ${NC}"
echo -e "${C}${B}══════════════════════════════════════════${NC}"
echo ""

# ── 1. OLLAMA AI ENGINE ─────────────────────────────────────
if [ "$SKIP_AI" -eq 0 ]; then
  echo -e "${Y}[1/3] Ollama AI Engine${NC}"

  if ! command -v ollama >/dev/null 2>&1; then
    echo -e "${R}  Ollama not installed. Download from https://ollama.com/download${NC}"
    echo -e "${Y}  Continuing without AI features (use --no-ai to suppress this).${NC}"
    SKIP_AI=1
  else
    if curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      echo -e "${G}  Ollama already running on :11434${NC}"
    else
      echo -e "${Y}  Starting Ollama server...${NC}"
      ollama serve > "$ROOT/logs/ollama.log" 2>&1 &
      OLLAMA_PID=$!
      STARTED_OLLAMA=1
      # Wait up to 30s
      n=0
      while [ $n -lt 30 ]; do
        curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
        sleep 1
        n=$((n + 1))
      done
      if curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
        echo -e "${G}  Ollama started (pid $OLLAMA_PID)${NC}"
      else
        echo -e "${R}  Ollama failed to start. Continuing without AI.${NC}"
        SKIP_AI=1
      fi
    fi

    if [ "$SKIP_AI" -eq 0 ] && [ "${SKIP_PULL:-0}" != "1" ]; then
      if ! ollama list 2>/dev/null | grep -q "$OLLAMA_MODEL"; then
        echo -e "${Y}  Pulling $OLLAMA_MODEL (first time only)...${NC}"
        ollama pull "$OLLAMA_MODEL" || true
      fi
      if ! ollama list 2>/dev/null | grep -q "$OLLAMA_EMBED_MODEL"; then
        echo -e "${Y}  Pulling $OLLAMA_EMBED_MODEL (first time only)...${NC}"
        ollama pull "$OLLAMA_EMBED_MODEL" || true
      fi
      echo -e "${G}  Models ready: $OLLAMA_MODEL, $OLLAMA_EMBED_MODEL${NC}"
    fi
  fi
  echo ""
else
  echo -e "${Y}[1/3] Ollama AI Engine — skipped (--no-ai)${NC}"
  echo ""
fi

# ── 2. PYTHON BACKEND (FastAPI) ──────────────────────────────
echo -e "${Y}[2/3] FastAPI Backend${NC}"

PYTHON=""
if [ -x "$ROOT/.venv/bin/python" ]; then
  PYTHON="$ROOT/.venv/bin/python"
  echo -e "${G}  Using .venv Python${NC}"
elif [ -x "$ROOT/venv/bin/python" ]; then
  PYTHON="$ROOT/venv/bin/python"
  echo -e "${G}  Using venv Python${NC}"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON="python3"
  echo -e "${Y}  Using system python3 (consider creating a venv)${NC}"
else
  echo -e "${R}  python3 not found! Install Python 3.9+ and retry.${NC}"
  exit 1
fi

# Kill any existing backend on the port
lsof -ti:"$PORT_BACKEND" | xargs kill -9 2>/dev/null || true
sleep 0.5

PYTHONPATH="$ROOT" "$PYTHON" -m uvicorn backend.app:app \
  --reload \
  --host 127.0.0.1 \
  --port "$PORT_BACKEND" \
  > "$ROOT/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo -e "${G}  Backend starting on http://127.0.0.1:$PORT_BACKEND  (pid $BACKEND_PID)${NC}"

# Wait for backend to be ready
n=0
while [ $n -lt 15 ]; do
  curl -sf "http://127.0.0.1:$PORT_BACKEND/docs" >/dev/null 2>&1 && break
  sleep 1
  n=$((n + 1))
done
if curl -sf "http://127.0.0.1:$PORT_BACKEND/docs" >/dev/null 2>&1; then
  echo -e "${G}  Backend is ready.${NC}"
else
  echo -e "${Y}  Backend is still starting (check logs/backend.log if issues).${NC}"
fi
echo ""

# ── 3. REACT FRONTEND ───────────────────────────────────────
echo -e "${Y}[3/3] React Frontend${NC}"

FRONTEND_DIR="$ROOT/stock-analysis-dashboard"
if [ ! -d "$FRONTEND_DIR" ]; then
  echo -e "${R}  Frontend directory not found at $FRONTEND_DIR${NC}"
  echo -e "${Y}  Backend is running — access API at http://127.0.0.1:$PORT_BACKEND/docs${NC}"
else
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo -e "${Y}  Installing npm dependencies (first time)...${NC}"
    (cd "$FRONTEND_DIR" && npm install --silent)
  fi

  lsof -ti:"$PORT_FRONTEND" | xargs kill -9 2>/dev/null || true
  sleep 0.5

  BROWSER=none PORT="$PORT_FRONTEND" \
    npm start --prefix "$FRONTEND_DIR" \
    > "$ROOT/logs/frontend.log" 2>&1 &
  FRONTEND_PID=$!
  echo -e "${G}  Frontend starting on http://localhost:$PORT_FRONTEND  (pid $FRONTEND_PID)${NC}"

  n=0
  while [ $n -lt 25 ]; do
    curl -sf "http://localhost:$PORT_FRONTEND" >/dev/null 2>&1 && break
    sleep 1
    n=$((n + 1))
  done
  echo -e "${G}  Frontend is ready.${NC}"
fi
echo ""

# ── Summary ──────────────────────────────────────────────────
echo -e "${C}${B}══════════════════════════════════════════${NC}"
echo -e "${G}${B}  ALL SYSTEMS ONLINE${NC}"
echo ""
echo -e "  ${B}Frontend${NC}   http://localhost:$PORT_FRONTEND"
echo -e "  ${B}Backend${NC}    http://127.0.0.1:$PORT_BACKEND"
echo -e "  ${B}API Docs${NC}   http://127.0.0.1:$PORT_BACKEND/docs"
if [ "$SKIP_AI" -eq 0 ]; then
  echo -e "  ${B}Ollama AI${NC}  http://127.0.0.1:11434"
fi
echo ""
echo -e "  ${B}Logs${NC}       $ROOT/logs/"
echo ""
echo -e "${C}${B}══════════════════════════════════════════${NC}"
echo -e "${Y}  Press Ctrl+C to stop all services.${NC}"
echo ""

# Keep alive — wait for background jobs
wait
