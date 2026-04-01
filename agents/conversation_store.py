"""
SQLite-backed conversation store for persistent AI chat sessions.

Each conversation has:
- session_id (UUID)
- title (auto-generated or user-set)
- messages[] with role, content, tool_calls, timestamps
- metadata (active symbol, model used, etc.)
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any

DB_PATH = Path(os.environ.get("CONVERSATION_DB", "context_data/conversations.sqlite"))


def _ensure_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id   TEXT PRIMARY KEY,
                title        TEXT NOT NULL DEFAULT 'New Chat',
                created_at   REAL NOT NULL,
                updated_at   REAL NOT NULL,
                metadata     TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS messages (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id   TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
                role         TEXT NOT NULL,
                content      TEXT NOT NULL DEFAULT '',
                tool_calls   TEXT,
                tool_result  TEXT,
                created_at   REAL NOT NULL,
                metadata     TEXT NOT NULL DEFAULT '{}'
            );

            CREATE INDEX IF NOT EXISTS idx_messages_session
                ON messages(session_id, created_at);

            CREATE INDEX IF NOT EXISTS idx_sessions_updated
                ON sessions(updated_at DESC);
        """)


@contextmanager
def _connect():
    _ensure_db.__called = getattr(_ensure_db, "__called", False)
    if not _ensure_db.__called:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _ensure_db.__called = True
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Session CRUD
# ---------------------------------------------------------------------------
def create_session(
    title: str = "New Chat",
    metadata: dict | None = None,
) -> dict:
    """Create a new conversation session."""
    _ensure_db()
    sid = uuid.uuid4().hex[:16]
    now = time.time()
    meta_json = json.dumps(metadata or {})
    with _connect() as conn:
        conn.execute(
            "INSERT INTO sessions (session_id, title, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?)",
            (sid, title, now, now, meta_json),
        )
    return {"session_id": sid, "title": title, "created_at": now, "metadata": metadata or {}}


def list_sessions(limit: int = 50, offset: int = 0) -> list[dict]:
    """Return recent sessions ordered by last update."""
    _ensure_db()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT session_id, title, created_at, updated_at, metadata FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        out = []
        for r in rows:
            # Get message count + last message preview
            stats = conn.execute(
                "SELECT COUNT(*) AS cnt, MAX(created_at) AS last_msg FROM messages WHERE session_id = ?",
                (r["session_id"],),
            ).fetchone()
            preview = conn.execute(
                "SELECT content FROM messages WHERE session_id = ? AND role IN ('user', 'assistant') ORDER BY created_at DESC LIMIT 1",
                (r["session_id"],),
            ).fetchone()
            out.append({
                "session_id": r["session_id"],
                "title": r["title"],
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
                "metadata": json.loads(r["metadata"] or "{}"),
                "message_count": stats["cnt"] if stats else 0,
                "last_message_preview": (preview["content"][:120] + "...") if preview and len(preview["content"]) > 120 else (preview["content"] if preview else ""),
            })
        return out


def get_session(session_id: str) -> dict | None:
    """Return session info (without messages)."""
    _ensure_db()
    with _connect() as conn:
        r = conn.execute(
            "SELECT session_id, title, created_at, updated_at, metadata FROM sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        if not r:
            return None
        return {
            "session_id": r["session_id"],
            "title": r["title"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
            "metadata": json.loads(r["metadata"] or "{}"),
        }


def update_session(session_id: str, title: str | None = None, metadata: dict | None = None) -> dict:
    """Update session title and/or metadata."""
    _ensure_db()
    with _connect() as conn:
        existing = conn.execute("SELECT metadata FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
        if not existing:
            return {"ok": False, "error": "Session not found"}
        updates = []
        params = []
        if title is not None:
            updates.append("title = ?")
            params.append(title)
        if metadata is not None:
            merged = {**json.loads(existing["metadata"] or "{}"), **metadata}
            updates.append("metadata = ?")
            params.append(json.dumps(merged))
        updates.append("updated_at = ?")
        params.append(time.time())
        params.append(session_id)
        conn.execute(f"UPDATE sessions SET {', '.join(updates)} WHERE session_id = ?", params)
    return {"ok": True}


def delete_session(session_id: str) -> dict:
    """Delete a session and all its messages."""
    _ensure_db()
    with _connect() as conn:
        conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Message CRUD
# ---------------------------------------------------------------------------
def add_message(
    session_id: str,
    role: str,
    content: str = "",
    tool_calls: list | None = None,
    tool_result: Any = None,
    metadata: dict | None = None,
) -> dict:
    """Append a message to a conversation session."""
    _ensure_db()
    now = time.time()
    with _connect() as conn:
        conn.execute(
            """INSERT INTO messages (session_id, role, content, tool_calls, tool_result, created_at, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                session_id,
                role,
                content,
                json.dumps(tool_calls) if tool_calls else None,
                json.dumps(tool_result) if tool_result is not None else None,
                now,
                json.dumps(metadata or {}),
            ),
        )
        conn.execute("UPDATE sessions SET updated_at = ? WHERE session_id = ?", (now, session_id))
    return {"ok": True, "created_at": now}


def get_messages(
    session_id: str,
    limit: int = 200,
    before: float | None = None,
) -> list[dict]:
    """Return messages for a session, newest last."""
    _ensure_db()
    with _connect() as conn:
        if before:
            rows = conn.execute(
                "SELECT * FROM messages WHERE session_id = ? AND created_at < ? ORDER BY created_at ASC LIMIT ?",
                (session_id, before, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?",
                (session_id, limit),
            ).fetchall()
        return [
            {
                "id": r["id"],
                "role": r["role"],
                "content": r["content"],
                "tool_calls": json.loads(r["tool_calls"]) if r["tool_calls"] else None,
                "tool_result": json.loads(r["tool_result"]) if r["tool_result"] else None,
                "created_at": r["created_at"],
                "metadata": json.loads(r["metadata"] or "{}"),
            }
            for r in rows
        ]


def get_ollama_messages(session_id: str, limit: int = 50) -> list[dict]:
    """
    Build the messages array for Ollama /api/chat from conversation history.
    Maps our stored messages to Ollama's expected format:
    {role: system|user|assistant|tool, content: str}
    """
    raw = get_messages(session_id, limit=limit)
    ollama_msgs: list[dict] = []
    for msg in raw:
        role = msg["role"]
        if role in ("system", "user", "assistant"):
            entry: dict[str, Any] = {"role": role, "content": msg["content"]}
            if msg.get("tool_calls"):
                entry["tool_calls"] = msg["tool_calls"]
            ollama_msgs.append(entry)
        elif role == "tool":
            ollama_msgs.append({"role": "tool", "content": msg["content"]})
    return ollama_msgs


# ---------------------------------------------------------------------------
# Auto-title generation
# ---------------------------------------------------------------------------
def auto_title_from_first_message(content: str) -> str:
    """Generate a short session title from the first user message."""
    clean = content.strip().replace("\n", " ")
    if len(clean) <= 60:
        return clean
    # Try to cut at a word boundary
    truncated = clean[:57]
    last_space = truncated.rfind(" ")
    if last_space > 30:
        return truncated[:last_space] + "..."
    return truncated + "..."


# ---------------------------------------------------------------------------
# Conversation context window management
# ---------------------------------------------------------------------------
def get_context_window(
    session_id: str,
    max_messages: int = 30,
    max_chars: int = 24000,
    system_prompt: str | None = None,
) -> list[dict]:
    """
    Build a context window for Ollama that fits within token limits.
    Returns the most recent messages that fit within max_chars.
    Always includes the system prompt if provided.
    """
    all_msgs = get_ollama_messages(session_id, limit=max_messages * 2)

    # Start with system prompt
    window: list[dict] = []
    char_count = 0
    if system_prompt:
        window.append({"role": "system", "content": system_prompt})
        char_count += len(system_prompt)

    # Take messages from the end, working backwards
    candidates = []
    for msg in reversed(all_msgs):
        if msg.get("role") == "system":
            continue  # Skip stored system messages, we use the fresh one
        msg_chars = len(msg.get("content", ""))
        if char_count + msg_chars > max_chars and candidates:
            break
        candidates.append(msg)
        char_count += msg_chars

    # Reverse back to chronological order
    candidates.reverse()
    window.extend(candidates)
    return window
