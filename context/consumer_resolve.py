from __future__ import annotations

import json
import os
import re
from difflib import get_close_matches
from typing import Any

from market_download import all_symbols_flat, load_tickers
from market_universe import load_instrument_aliases

from context.india_consumer_paths import INSTRUMENT_ALIASES_JSON, SYMBOL_MAP_JSON, ensure_consumer_dirs


def _normalize_company(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def load_symbol_map() -> dict[str, str]:
    ensure_consumer_dirs()
    if not os.path.exists(SYMBOL_MAP_JSON):
        return {}
    with open(SYMBOL_MAP_JSON, encoding="utf-8") as f:
        data = json.load(f)
    # Flat map company_name -> yahoo symbol
    if isinstance(data, dict) and "companies" in data:
        return {str(k): str(v) for k, v in data["companies"].items()}
    if isinstance(data, dict):
        return {str(k): str(v) for k, v in data.items() if not str(k).startswith("_")}
    return {}


def load_instrument_alias_map() -> dict[str, dict[str, Any]]:
    ensure_consumer_dirs()
    if not os.path.exists(INSTRUMENT_ALIASES_JSON):
        return {}
    return load_instrument_aliases()


def _ticker_stems() -> dict[str, str]:
    """Map normalized stem (no .NS/.BO) -> full symbol."""
    out: dict[str, str] = {}
    for sym in all_symbols_flat():
        stem = sym.replace(".NS", "").replace(".BO", "").replace(".ns", "").replace(".bo", "")
        key = stem.lower()
        if key not in out:
            out[key] = sym
    return out


def _category_name_tokens() -> list[tuple[str, str]]:
    """(normalized token blob per category label, arbitrary symbol from category) for fuzzy hint."""
    data = load_tickers()
    rows: list[tuple[str, str]] = []
    for cat, syms in data.items():
        if not syms:
            continue
        t = _normalize_company(cat.replace("_", " "))
        rows.append((t, syms[0]))
    return rows


def resolve_tickers_for_company_guess(
    company_guess: str,
    manual_map: dict[str, str] | None = None,
) -> tuple[list[str], dict[str, Any]]:
    """
    Returns (tickers, meta) where meta has method and confidence in [0,1].
    """
    manual = manual_map if manual_map is not None else load_symbol_map()
    alias_map = load_instrument_alias_map()
    cg_norm = _normalize_company(company_guess)
    if not cg_norm:
        return [], {"method": "none", "confidence": 0.0}

    # Exact manual key (case-insensitive)
    for k, v in manual.items():
        if _normalize_company(k) == cg_norm:
            return [v], {"method": "manual_map", "confidence": 1.0, "matched_key": k}

    # Fuzzy on manual keys
    keys = list(manual.keys())
    if keys:
        normed_keys = { _normalize_company(k): k for k in keys }
        close = get_close_matches(cg_norm, list(normed_keys.keys()), n=1, cutoff=0.72)
        if close:
            orig = normed_keys[close[0]]
            return [manual[orig]], {"method": "fuzzy_map", "confidence": 0.75, "matched_key": orig}

    # Alias map for non-equity instruments (FX, commodities, proxy indices)
    for symbol, payload in alias_map.items():
        alias_terms = [payload.get("name", ""), *(payload.get("aliases") or [])]
        normalized = [_normalize_company(str(term)) for term in alias_terms if str(term).strip()]
        if cg_norm in normalized:
            return [symbol], {"method": "instrument_alias", "confidence": 0.9, "matched_symbol": symbol}

    alias_lookup: dict[str, str] = {}
    for symbol, payload in alias_map.items():
        for term in [payload.get("name", ""), *(payload.get("aliases") or [])]:
            norm_term = _normalize_company(str(term))
            if norm_term:
                alias_lookup[norm_term] = symbol
    if alias_lookup:
        close = get_close_matches(cg_norm, list(alias_lookup.keys()), n=1, cutoff=0.72)
        if close:
            sym = alias_lookup[close[0]]
            return [sym], {"method": "instrument_alias_fuzzy", "confidence": 0.78, "matched_symbol": sym}

    # Ticker stem: company text contains RELIANCE / TATAMOTORS etc.
    stems = _ticker_stems()
    for stem, sym in sorted(stems.items(), key=lambda x: -len(x[0])):
        if len(stem) >= 4 and stem in cg_norm:
            return [sym], {"method": "ticker_stem", "confidence": 0.55, "matched_stem": stem}

    # Fuzzy category names (weak)
    for blob, sym in _category_name_tokens():
        if len(blob) < 6:
            continue
        if blob in cg_norm or cg_norm in blob:
            return [sym], {"method": "category_name", "confidence": 0.35, "matched_category": blob}

    return [], {"method": "none", "confidence": 0.0}
