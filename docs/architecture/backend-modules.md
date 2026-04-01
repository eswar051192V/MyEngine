# Backend Module Map

## Entry Points

- `backend/app.py`
  - Owns FastAPI app creation, route registration, request models, and websocket manager.
  - Imports domain modules lazily inside route handlers for lower startup coupling.
- `main.py`
  - Backward-compatible re-export shim to avoid breaking existing run commands.

## Agent Modules (`agents/`)

- `download_agent.py`
  - Chat loop with Ollama tool-calling for market downloads.
- `download_tools.py`
  - Tool schema and dispatch for download actions.
  - Depends on `market_download.py`.
- `context_agent.py`
  - Chat loop with Ollama tool-calling for context analysis.
- `context_tools.py`
  - Tool schema and dispatch for news/open-context/consumer/candle snippets.
  - Depends on modules in `context/`.
- `cli.py`
  - CLI adapter for running the download agent in terminal.

## Context Modules (`context/`)

- `news_store.py`
  - Fetches from Yahoo + optional providers.
  - Persists normalized article JSON by symbol.
- `open_context.py`
  - Ingests RSS, Reddit, CourtListener into JSONL ledger.
  - Supports symbol-level filtering.
- `watchlist_store.py`
  - Read/write watchlist entries from `user_settings.json`.
- `unified_context.py`
  - Aggregates saved news + open context + consumer preview.
- `india_consumer_ingest.py`
  - Ingest and normalize consumer data into cases JSONL.
- `consumer_resolve.py`
  - Company-to-ticker resolution logic using maps and fuzzy heuristics.
- `consumer_rag.py`
  - Embeds case chunks and indexes them in sqlite for retrieval.
- `consumer_correlation.py`
  - Builds monthly complaint and market feature series.
  - Produces descriptive correlation metrics.
- `consumer_query.py`
  - Retrieves chunks from RAG + correlation context + OHLC snippets.
  - Calls Ollama for final synthesis.

## Market/Data Utility Modules

- `market_download.py`
  - Shared ticker loading and download primitives.
- `bulk_downloader.py`
  - Batch executor using `market_download` helpers.
- `fetch_all_tickers.py`, `fetch_sp500.py`
  - Symbol universe acquisition/refresh scripts.
- `format_database.py`, `clean_database.py`
  - Symbol normalization and validation scripts.
- `get_token.py`
  - Upstox OAuth code exchange helper.

## Dependency Direction

Expected dependency direction is:

1. API route layer (`backend/app.py`) -> agents/context/services.
2. Agents -> domain tools (`agents/*_tools.py`) -> context/data modules.
3. Context modules -> local storage and optional external APIs.
4. Utilities/scripts -> data files and external APIs.

Avoid reverse coupling (for example, context modules importing API layer).
