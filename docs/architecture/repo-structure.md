# Repository Structure

## Current Structure

```text
StockAnalysisProject/
  backend/
    __init__.py
    app.py
  agents/
    *.py
  context/
    *.py
  docs/
    architecture/
      README.md
      system-overview.md
      backend-modules.md
      runtime-flows.md
      repo-structure.md
  stock-analysis-dashboard/
    src/
    public/
  context_data/
  local_market_data/          # generated
  main.py                     # compatibility entrypoint
  market_download.py
  bulk_downloader.py
  fetch_*.py / clean_*.py     # maintenance scripts
```

## Conventions

- **API app source**: `backend/app.py`
- **Legacy compatibility**: keep `main.py` as simple re-export shim.
- **Agent orchestration**: `agents/`
- **Context domain logic**: `context/`
- **Documentation**: `docs/architecture/`
- **Data scripts**: top-level scripts (recommended future move to `scripts/`)

## Recommended Next Refactor (Optional)

1. Move top-level maintenance scripts to a `scripts/` folder.
2. Introduce a shared `config.py` for all environment variables.
3. Add `tests/` with API smoke tests and module unit tests.
4. Split `backend/app.py` routes into dedicated routers (`backend/routes/*`).
