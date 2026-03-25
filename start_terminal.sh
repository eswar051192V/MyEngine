#!/bin/bash

# ==========================================
# QUANTITATIVE AI TERMINAL ORCHESTRATOR
# ==========================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}==========================================${NC}"
echo -e "${CYAN}    STARTING ALGORITHMIC AI TERMINAL      ${NC}"
echo -e "${CYAN}==========================================${NC}\n"

# ------------------------------------------
# 1. RESTART LOGIC (Kill existing ports)
# ------------------------------------------
if [ "$1" == "restart" ]; then
    echo -e "${YELLOW}⚡ Restart flag detected. Clearing ports 8000 and 3000...${NC}"
    lsof -ti:8000 | xargs kill -9 2>/dev/null
    lsof -ti:3000 | xargs kill -9 2>/dev/null
    echo -e "${GREEN}✓ Ports cleared.${NC}\n"
fi

# ------------------------------------------
# 2. OLLAMA LOCAL AI SERVER SETUP
# ------------------------------------------
echo -e "${YELLOW}Checking Ollama Local AI Engine...${NC}"

if ! command -v ollama &> /dev/null; then
    echo -e "${RED}❌ Ollama is not installed! Download from https://ollama.com/download${NC}"
    exit 1
fi

if ! curl -s http://localhost:11434/ > /dev/null; then
    echo -e "${YELLOW}Booting Ollama background server...${NC}"
    ollama serve > /dev/null 2>&1 &
    sleep 3 
else
    echo -e "${GREEN}✓ Ollama server is already running.${NC}"
fi

if ! ollama list | grep -q 'llama3'; then
    echo -e "${YELLOW}Downloading llama3 quant model (this only happens once)...${NC}"
    ollama pull llama3
else
    echo -e "${GREEN}✓ Llama3 model loaded and ready.${NC}\n"
fi

# ------------------------------------------
# 3. PYTHON BACKEND (FASTAPI)
# ------------------------------------------
echo -e "${YELLOW}Booting Python Quantitative Engine...${NC}"

if [ -d "venv" ]; then
    source venv/bin/activate
    echo -e "${GREEN}✓ Virtual environment (venv) activated.${NC}"
else
    echo -e "${RED}⚠ Warning: No 'venv' folder found. Running on global Python.${NC}"
fi

uvicorn main:app --reload --port 8000 > backend_server.log 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}✓ FastAPI running on http://localhost:8000${NC}\n"

# ------------------------------------------
# 4. REACT FRONTEND (AUTO-DISCOVERY)
# ------------------------------------------
echo -e "${YELLOW}Booting React Interface...${NC}"

# Automatically hunt for the React folder (ignores venv and node_modules)
FRONTEND_DIR=$(find . -maxdepth 2 -name "package.json" -not -path "*/node_modules/*" -not -path "*/venv/*" -exec dirname {} \; | head -n 1)

if [ -n "$FRONTEND_DIR" ]; then
    echo -e "${GREEN}✓ Found React app in: ${FRONTEND_DIR}${NC}"
    cd "$FRONTEND_DIR"
    BROWSER=none npm start > ../frontend_server.log 2>&1 &
    FRONTEND_PID=$!
    cd - > /dev/null
    echo -e "${GREEN}✓ React running on http://localhost:3000${NC}\n"
else
    echo -e "${RED}❌ Could not find package.json in this directory or subdirectories. Frontend not started.${NC}\n"
fi

# ------------------------------------------
# 5. SYSTEM MONITORING & SHUTDOWN
# ------------------------------------------
echo -e "${CYAN}==========================================${NC}"
echo -e "${GREEN}ALL SYSTEMS ONLINE.${NC}"
echo -e "Open your browser to: ${CYAN}http://localhost:3000${NC}"
echo -e "${CYAN}==========================================${NC}"
echo -e "${YELLOW}Press [CTRL+C] to gracefully shut down all servers.${NC}\n"

trap "echo -e '\n${RED}Shutting down Terminal, Backend, and Frontend...${NC}'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT
wait