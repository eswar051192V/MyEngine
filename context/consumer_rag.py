from __future__ import annotations

import os
import sqlite3
from typing import Any

import numpy as np
import requests

from context.india_consumer_ingest import iter_cases
from context.india_consumer_paths import RAG_DB_PATH, ensure_consumer_dirs

OLLAMA_BASE = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_EMBED_MODEL = os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")
CHUNK_SIZE = int(os.environ.get("CONSUMER_CHUNK_CHARS", "480"))
CHUNK_OVERLAP = int(os.environ.get("CONSUMER_CHUNK_OVERLAP", "80"))


def chunk_text(text: str, max_len: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_len:
        return [text]
    chunks: list[str] = []
    i = 0
    while i < len(text):
        chunks.append(text[i : i + max_len])
        i += max_len - overlap
        if i >= len(text):
            break
    return chunks


def ollama_embed_one(text: str, model: str | None = None) -> list[float] | None:
    model = model or DEFAULT_EMBED_MODEL
    url = f"{OLLAMA_BASE}/api/embeddings"
    try:
        r = requests.post(
            url,
            json={"model": model, "prompt": text},
            timeout=120,
        )
    except requests.RequestException:
        return None
    if r.status_code != 200:
        return None
    body = r.json()
    emb = body.get("embedding")
    if emb is None and "embeddings" in body:
        embs = body["embeddings"]
        emb = embs[0] if embs else None
    return emb


def _init_db(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chunks (
          chunk_id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL,
          chunk_idx INTEGER NOT NULL,
          text TEXT NOT NULL,
          symbol TEXT,
          published_at TEXT,
          dim INTEGER NOT NULL,
          embedding BLOB NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_symbol ON chunks(symbol)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_published ON chunks(published_at)")
    conn.commit()


def _blob_from_embedding(emb: list[float]) -> tuple[bytes, int]:
    arr = np.asarray(emb, dtype=np.float32)
    return arr.tobytes(), int(arr.shape[0])


def _embedding_from_blob(blob: bytes, dim: int) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32, count=dim)


def rebuild_index(embed_model: str | None = None) -> dict[str, Any]:
    """Rebuild SQLite RAG index from cases.jsonl using Ollama embeddings."""
    ensure_consumer_dirs()
    embed_model = embed_model or DEFAULT_EMBED_MODEL
    cases = iter_cases()
    conn = sqlite3.connect(RAG_DB_PATH)
    try:
        _init_db(conn)
        conn.execute("DELETE FROM chunks")
        conn.commit()
        ok = fail = 0
        for case in cases:
            case_id = case["id"]
            title = case.get("title") or ""
            summary = case.get("summary") or ""
            body = f"{title}\n\n{summary}".strip()
            sym_list = case.get("tickers") or []
            sym_targets = sym_list if sym_list else [None]
            published = (case.get("published_at") or "")[:10]
            parts = chunk_text(body)
            for idx, chunk in enumerate(parts):
                if not chunk:
                    continue
                emb = ollama_embed_one(chunk, model=embed_model)
                if not emb:
                    fail += 1
                    continue
                blob, dim = _blob_from_embedding(emb)
                for sym in sym_targets:
                    chunk_id = f"{case_id}:{idx}:{sym or '__none__'}"
                    conn.execute(
                        """
                        INSERT INTO chunks (chunk_id, case_id, chunk_idx, text, symbol, published_at, dim, embedding)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (chunk_id, case_id, idx, chunk, sym, published, dim, blob),
                    )
                    ok += 1
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "chunks_indexed": ok, "chunks_failed": fail, "model": embed_model, "db": RAG_DB_PATH}


def _l2_normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    if n <= 0:
        return v
    return v / n


def search(
    query: str,
    k: int = 8,
    symbol: str | None = None,
    months_back: int | None = None,
    embed_model: str | None = None,
) -> list[dict[str, Any]]:
    q_emb = ollama_embed_one(query, model=embed_model or DEFAULT_EMBED_MODEL)
    if not q_emb:
        return []
    qv = _l2_normalize(np.asarray(q_emb, dtype=np.float32))

    conn = sqlite3.connect(RAG_DB_PATH)
    try:
        cur = conn.cursor()
        if symbol and months_back and months_back > 0:
            from datetime import date, timedelta

            cutoff = (date.today() - timedelta(days=30 * months_back)).isoformat()
            cur.execute(
                """
                SELECT chunk_id, case_id, chunk_idx, text, symbol, published_at, dim, embedding
                FROM chunks
                WHERE symbol = ? AND published_at >= ?
                """,
                (symbol, cutoff),
            )
        elif symbol:
            cur.execute(
                """
                SELECT chunk_id, case_id, chunk_idx, text, symbol, published_at, dim, embedding
                FROM chunks WHERE symbol = ?
                """,
                (symbol,),
            )
        else:
            cur.execute(
                "SELECT chunk_id, case_id, chunk_idx, text, symbol, published_at, dim, embedding FROM chunks"
            )
        rows = cur.fetchall()
    finally:
        conn.close()

    scored: list[tuple[float, dict[str, Any]]] = []
    for chunk_id, case_id, chunk_idx, text, sym, pub, dim, blob in rows:
        ev = _embedding_from_blob(blob, dim)
        ev = _l2_normalize(ev)
        sim = float(np.dot(qv, ev))
        scored.append(
            (
                sim,
                {
                    "chunk_id": chunk_id,
                    "case_id": case_id,
                    "chunk_idx": chunk_idx,
                    "text": text,
                    "symbol": sym,
                    "published_at": pub,
                    "score": sim,
                },
            )
        )
    scored.sort(key=lambda x: -x[0])
    return [r[1] for r in scored[:k]]


def index_stats() -> dict[str, Any]:
    if not os.path.exists(RAG_DB_PATH):
        return {"exists": False, "rows": 0}
    conn = sqlite3.connect(RAG_DB_PATH)
    try:
        n = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    finally:
        conn.close()
    return {"exists": True, "rows": n, "path": RAG_DB_PATH}


def enrich_chunks_with_case_meta(chunks: list[dict[str, Any]], cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {c["id"]: c for c in cases}
    out = []
    for ch in chunks:
        c = by_id.get(ch["case_id"], {})
        out.append(
            {
                **ch,
                "title": c.get("title"),
                "raw_url": c.get("raw_url"),
                "source": c.get("source"),
                "tickers": c.get("tickers"),
            }
        )
    return out
