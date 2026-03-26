# Runtime Flows

## 1) Symbol Detail Flow

1. Frontend requests `/api/ticker/{symbol}`.
2. Backend (`backend/app.py`) queries Yahoo Finance (`yf.Ticker(symbol)`).
3. Backend maps fields into response payload:
   - current and previous prices
   - change and change percentage
   - profile metadata
   - top news entries
4. Frontend renders summary card and ticker details.

## 2) OHLC and Options Flow

### OHLC

1. Frontend requests `/api/ticker/{symbol}/ohlc?timeframe=...`.
2. Backend maps timeframe to Yahoo `period/interval`.
3. Backend transforms dataframe rows into chart candle format.
4. Frontend renders chart.

### Options

1. Frontend requests `/api/ticker/{symbol}/options`.
2. Backend chooses source:
   - Upstox for mapped NSE indices.
   - Yahoo options chain for other symbols.
3. Backend normalizes call/put payload.
4. Frontend renders option chain table.

## 3) Download Agent Flow

1. Client calls `/api/agents/download` with natural-language instruction.
2. `agents/download_agent.py` starts Ollama chat loop with tool schema.
3. Model selects tools from `agents/download_tools.py`.
4. Tools call into `market_download.py` for folder prep and parquet download.
5. Agent returns final message + tool log.

## 4) Context Agent Flow

1. Client calls `/api/agents/context-run`.
2. `agents/context_agent.py` starts chat loop with context tool schema.
3. Model can trigger:
   - news refresh/load,
   - open-context ingest/filter,
   - consumer preview,
   - OHLC tail.
4. Tool responses are fed back to model until final synthesis.
5. API returns final narrative and tool execution trace.

## 5) Consumer RAG Flow

1. Ingest endpoint writes normalized cases (`cases.jsonl`).
2. Reindex endpoint embeds chunks and writes to sqlite (`rag.sqlite`).
3. Query endpoint:
   - embeds user question,
   - retrieves nearest chunks,
   - enriches with case metadata,
   - computes complaint-vs-return correlation,
   - adds local OHLC tail snippet,
   - asks Ollama to synthesize final answer.

## 6) Watchlist Flow

1. PUT `/api/watchlist` stores symbols in `user_settings.json`.
2. GET `/api/watchlist` reads normalized symbols.
3. GET `/api/watchlist/summary` joins watchlist with cached news headlines.
