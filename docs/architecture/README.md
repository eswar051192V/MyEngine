# Architecture Documentation

This folder contains the current architecture reference for the project after the backend extraction into `backend/app.py`.

## Documents

- `system-overview.md`  
  End-to-end architecture, boundaries, and runtime components.
- `backend-modules.md`  
  Backend module map with responsibilities and dependencies.
- `runtime-flows.md`  
  Main request and data processing flows.
- `repo-structure.md`  
  Recommended project layout and ownership.

## Quick Start

Run backend API:

```bash
uvicorn backend.app:app --reload
```

Legacy command still works:

```bash
uvicorn main:app --reload
```
