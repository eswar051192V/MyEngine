"""
Tools exposed to the download agent (JSON-serializable results for Ollama).
"""
from __future__ import annotations

import os
import sys

# Project root on path when running as script or from uvicorn cwd
_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import market_download as md

MAX_BATCH_DEFAULT = 100
MAX_BATCH_HARD = 200


def tool_prepare_data_folders(**_) -> dict:
    md.setup_directories()
    return {"ok": True, "data_dir": os.path.abspath(md.DATA_DIR)}


def tool_list_categories(**_) -> dict:
    cats = md.list_categories()
    if not cats:
        return {"ok": False, "error": f"No categories found. Expected {md.TICKERS_JSON} in project root.", "categories": []}
    return {"ok": True, "categories": cats, "count": len(cats)}


def tool_get_category_symbols(category: str, limit: int = 50, **_) -> dict:
    syms = md.symbols_in_category(category)
    total = len(syms)
    if limit is not None and limit > 0 and len(syms) > limit:
        syms = syms[:limit]
    return {
        "ok": True,
        "category": category,
        "symbols": syms,
        "returned": len(syms),
        "total_in_category": total,
        "truncated": total > len(syms),
    }


def tool_download_symbols(symbols: list[str], sleep_seconds: float = 1.5, **_) -> dict:
    if not symbols:
        return {"ok": False, "error": "symbols list is empty"}
    clean = [s.strip() for s in symbols if s and str(s).strip()]
    if len(clean) > MAX_BATCH_HARD:
        return {
            "ok": False,
            "error": f"Refusing to download more than {MAX_BATCH_HARD} symbols in one call. Split the job.",
            "requested": len(clean),
        }
    stats = md.download_symbols(clean, sleep_seconds=sleep_seconds)
    return {"ok": True, **stats}


def tool_download_category(
    category: str,
    limit: int | None = None,
    sleep_seconds: float = 1.5,
    **_,
) -> dict:
    lim = MAX_BATCH_DEFAULT if limit is None else int(limit)
    syms = md.symbols_in_category(category)
    if not syms:
        return {"ok": False, "error": f"Unknown or empty category: {category!r}"}
    if lim > 0:
        syms = syms[: min(lim, MAX_BATCH_HARD)]
    if len(syms) > MAX_BATCH_HARD:
        syms = syms[:MAX_BATCH_HARD]
    stats = md.download_symbols(syms, sleep_seconds=float(sleep_seconds))
    return {"ok": True, "category": category, "symbols_attempted": len(syms), **stats}


TOOL_FUNCTIONS = {
    "prepare_data_folders": tool_prepare_data_folders,
    "list_categories": tool_list_categories,
    "get_category_symbols": tool_get_category_symbols,
    "download_symbols": tool_download_symbols,
    "download_category": tool_download_category,
}

OLLAMA_TOOLS_SPEC = [
    {
        "type": "function",
        "function": {
            "name": "prepare_data_folders",
            "description": "Create local_market_data subfolders (15m, 1h, 1d, 1wk, etc.) before downloading.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_categories",
            "description": "List all ticker categories from all_global_tickers.json (e.g. SP_500, NSE_Equity).",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_category_symbols",
            "description": "Return ticker symbols for one category. Use a small limit to inspect before bulk download.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "description": "Exact category key from list_categories"},
                    "limit": {"type": "integer", "description": "Max symbols to return (default 50)"},
                },
                "required": ["category"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "download_symbols",
            "description": "Download OHLCV parquet files for explicit symbol list. Respects rate limit sleep between tickers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbols": {"type": "array", "items": {"type": "string"}},
                    "sleep_seconds": {"type": "number", "description": "Delay between tickers (default 1.5)"},
                },
                "required": ["symbols"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "download_category",
            "description": "Download all symbols in a category up to limit (default 100, cap 200). Prefer explicit limits for testing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string"},
                    "limit": {"type": "integer", "description": "Max symbols to download (cap 200)"},
                    "sleep_seconds": {"type": "number"},
                },
                "required": ["category"],
            },
        },
    },
]


def dispatch_tool(name: str, arguments: dict | None) -> dict:
    args = arguments if isinstance(arguments, dict) else {}
    fn = TOOL_FUNCTIONS.get(name)
    if not fn:
        return {"ok": False, "error": f"unknown tool: {name}"}
    try:
        return fn(**args)
    except TypeError as e:
        return {"ok": False, "error": f"bad arguments for {name}: {e}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
