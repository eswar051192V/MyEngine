from __future__ import annotations

import os
from typing import Any

import numpy as np
import pandas as pd

from market_download import DATA_DIR, parquet_symbol_key

from context.india_consumer_ingest import iter_cases


def _pearson(a: np.ndarray, b: np.ndarray) -> float | None:
    mask = np.isfinite(a) & np.isfinite(b)
    if mask.sum() < 3:
        return None
    x = a[mask]
    y = b[mask]
    sx = float(x.std())
    sy = float(y.std())
    if sx <= 0 or sy <= 0:
        return None
    return float(np.corrcoef(x, y)[0, 1])


def _spearman(a: np.ndarray, b: np.ndarray) -> float | None:
    mask = np.isfinite(a) & np.isfinite(b)
    if mask.sum() < 3:
        return None
    sa = pd.Series(a[mask]).rank(method="average").to_numpy(dtype=float)
    sb = pd.Series(b[mask]).rank(method="average").to_numpy(dtype=float)
    return _pearson(sa, sb)


def monthly_complaint_counts(symbol: str, cases: list[dict[str, Any]] | None = None) -> pd.DataFrame:
    cases = cases if cases is not None else iter_cases()
    rows: list[tuple[str, int]] = []
    for c in cases:
        tickers = c.get("tickers") or []
        if symbol not in tickers:
            continue
        pub = c.get("published_at") or ""
        if len(pub) >= 7:
            ym = pub[:7]
            rows.append((ym, 1))
    if not rows:
        return pd.DataFrame(columns=["complaint_count"]).rename_axis("year_month")
    df = pd.DataFrame(rows, columns=["year_month", "n"])
    g = df.groupby("year_month", as_index=True)["n"].sum().rename("complaint_count")
    return g.to_frame()


def load_ohlc_daily(symbol: str) -> pd.DataFrame | None:
    raw = str(symbol).strip().upper()
    safe = parquet_symbol_key(symbol)
    parquet_paths = [os.path.join(DATA_DIR, "1d", f"{safe}.parquet")]
    if safe != raw:
        parquet_paths.append(os.path.join(DATA_DIR, "1d", f"{raw}.parquet"))
    path = next((p for p in parquet_paths if os.path.exists(p)), None)
    if not path:
        return None
    df = pd.read_parquet(path)
    if df.empty:
        return None
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index)
    df = df.sort_index()
    cols = set(df.columns)
    if not {"Close", "Volume"} <= cols:
        return None
    return df[["Close", "Volume"]].copy()


def monthly_market_features(symbol: str) -> pd.DataFrame | None:
    df = load_ohlc_daily(symbol)
    if df is None or len(df) < 40:
        return None
    df = df.copy()
    df["year_month"] = df.index.to_period("M").astype(str)
    g = df.groupby("year_month", sort=True)
    agg = pd.DataFrame({"Close": g["Close"].last(), "Volume": g["Volume"].sum()})
    agg["log_ret"] = np.log(agg["Close"]).diff()
    agg["vol_rolling"] = agg["log_ret"].rolling(3).std()
    agg["vol_chg"] = agg["Volume"].pct_change()
    return agg


def correlation_report(symbol: str, cases: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    cases = cases if cases is not None else iter_cases()
    cc = monthly_complaint_counts(symbol, cases)
    mf = monthly_market_features(symbol)
    out: dict[str, Any] = {
        "symbol": symbol,
        "enough_cases": len(cc) > 0,
        "enough_ohlc": mf is not None and len(mf.dropna(how="all")) > 3,
        "monthly_table": [],
        "pearson_complaints_vs_log_ret": None,
        "spearman_complaints_vs_log_ret": None,
        "sample_months": 0,
        "note": "Descriptive co-movement only; not causal. Not investment advice.",
    }
    if mf is None or cc.empty:
        return out

    joined = mf.join(cc, how="outer").sort_index()
    joined["complaint_count"] = joined["complaint_count"].fillna(0.0)
    joined = joined.dropna(subset=["log_ret"])
    if len(joined) < 3:
        return out

    x = joined["complaint_count"].to_numpy(dtype=float)
    y = joined["log_ret"].to_numpy(dtype=float)
    out["pearson_complaints_vs_log_ret"] = _pearson(x, y)
    out["spearman_complaints_vs_log_ret"] = _spearman(x, y)
    out["sample_months"] = int(len(joined))
    table = joined.reset_index().tail(24)
    for _, row in table.iterrows():
        out["monthly_table"].append(
            {
                "year_month": str(row["year_month"]),
                "complaint_count": int(row["complaint_count"]) if pd.notna(row["complaint_count"]) else 0,
                "log_ret": float(row["log_ret"]) if pd.notna(row["log_ret"]) else None,
                "vol_rolling": float(row["vol_rolling"]) if pd.notna(row["vol_rolling"]) else None,
            }
        )
    return out
