# System Overview

## Goal

The project provides a local-first stock analysis platform with:

- A FastAPI backend for market data, options data, watchlist operations, and local AI-assisted analysis.
- A React dashboard (`stock-analysis-dashboard`) as the UI layer.
- Local data stores for market parquet files and context datasets.
- Optional external integrations (Yahoo Finance, Upstox, Finnhub, NewsAPI, Reddit public JSON, CourtListener, Ollama).

## Runtime Components

### 1) API Service

- Entry module: `backend/app.py`
- Backward-compatible shim: `main.py`
- Transport:
  - REST endpoints under `/api/*`
  - WebSocket stream under `/ws/live/{symbol}`

### 2) Agent Layer

- Location: `agents/`
- Purpose:
  - Tool-calling orchestration via Ollama (`/api/agents/download`, `/api/agents/context-run`)
  - Controlled tool contracts for downloads and context analysis

### 3) Context Intelligence Layer

- Location: `context/`
- Purpose:
  - Consumer complaint ingest and RAG index
  - Open-context ingest (RSS/Reddit/CourtListener)
  - News fetching and caching
  - Unified context aggregation

### 4) Market Data Utilities

- Core utility: `market_download.py`
- Batch downloader: `bulk_downloader.py`
- Outputs OHLC parquet files under `local_market_data/`

### 5) Frontend UI

- Location: `stock-analysis-dashboard/`
- Talks to backend endpoints for symbol data, chart data, options chain, watchlist, and context APIs.

## Storage and Data Boundaries

### Persistent Local Data

- `all_global_tickers.json`: category to symbols map.
- `user_settings.json`: watchlist and user-level settings.
- `local_market_data/`: OHLC parquet files grouped by timeframe.
- `context_data/news/`: per-symbol news cache.
- `context_data/open_context/ledger.jsonl`: open-context ledger.
- `context_data/india_consumer/`: consumer cases, mapping, and RAG sqlite.

### External Data Sources

- Yahoo Finance: baseline market and news.
- Upstox: index options chain.
- Ollama: chat completion and embeddings (local model runtime).
- Optional: Finnhub, NewsAPI, Reddit public endpoints, CourtListener.

## Design Characteristics

- Local and file-backed data model (low infrastructure overhead).
- Incremental ingestion patterns (append or merge from feeds/files).
- Agent tool abstractions for bounded model actions.
- Pragmatic backward compatibility via `main.py` shim after app extraction.
