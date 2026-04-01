"""
Custom learning model that improves from user evaluation feedback.

This module implements a feedback-driven learning system:
1. Every AI response can be rated by the user (thumbs up/down, score 1-5, corrections)
2. Feedback is stored in a SQLite database
3. High-rated responses become "few-shot examples" for future prompts
4. Low-rated responses become "negative examples" to avoid
5. The system builds a per-topic knowledge base from corrections
6. Over time, the system prompt evolves based on accumulated feedback patterns

This is NOT fine-tuning the LLM weights — it's a retrieval-augmented learning
system that improves prompts and context selection based on your corrections.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
import hashlib
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import requests

from agents.model_registry import resolve_model, _ollama_base

DB_PATH = Path(os.environ.get("LEARNING_DB", "context_data/learning_model.sqlite"))


def _ensure_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS evaluations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id      TEXT,
            message_hash    TEXT NOT NULL,
            user_query      TEXT NOT NULL,
            ai_response     TEXT NOT NULL,
            rating          INTEGER NOT NULL DEFAULT 0,
            feedback_text   TEXT,
            correction       TEXT,
            tags            TEXT DEFAULT '[]',
            symbol          TEXT,
            topic           TEXT,
            created_at      REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_eval_rating ON evaluations(rating);
        CREATE INDEX IF NOT EXISTS idx_eval_topic ON evaluations(topic);
        CREATE INDEX IF NOT EXISTS idx_eval_symbol ON evaluations(symbol);

        CREATE TABLE IF NOT EXISTS learned_patterns (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern_type    TEXT NOT NULL,
            topic           TEXT,
            content         TEXT NOT NULL,
            source_eval_ids TEXT DEFAULT '[]',
            weight          REAL DEFAULT 1.0,
            created_at      REAL NOT NULL,
            updated_at      REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_patterns_type ON learned_patterns(pattern_type);
        CREATE INDEX IF NOT EXISTS idx_patterns_topic ON learned_patterns(topic);

        CREATE TABLE IF NOT EXISTS prompt_evolution (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            version         INTEGER NOT NULL,
            base_prompt     TEXT NOT NULL,
            additions       TEXT DEFAULT '[]',
            eval_summary    TEXT,
            created_at      REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS preference_signals (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            dimension       TEXT NOT NULL,
            preference      TEXT NOT NULL,
            strength        REAL DEFAULT 1.0,
            evidence_count  INTEGER DEFAULT 1,
            created_at      REAL NOT NULL,
            updated_at      REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pref_dim ON preference_signals(dimension);
    """)
    conn.close()


@contextmanager
def _connect():
    _ensure_db()
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Evaluation submission
# ---------------------------------------------------------------------------
def submit_evaluation(
    user_query: str,
    ai_response: str,
    rating: int,
    feedback_text: str | None = None,
    correction: str | None = None,
    tags: list[str] | None = None,
    symbol: str | None = None,
    topic: str | None = None,
    session_id: str | None = None,
) -> dict:
    """
    Submit user evaluation of an AI response.

    rating: 1 (terrible) to 5 (excellent)
    feedback_text: Free text about what was good/bad
    correction: The "correct" answer the AI should have given
    tags: Categorization tags (e.g. ["technical_analysis", "sentiment"])
    """
    if rating < 1 or rating > 5:
        return {"ok": False, "error": "Rating must be 1-5"}

    msg_hash = hashlib.sha256(f"{user_query}|{ai_response}".encode()).hexdigest()[:16]
    now = time.time()

    # Auto-detect topic if not provided
    if not topic:
        topic = _detect_topic(user_query)

    with _connect() as conn:
        conn.execute(
            """INSERT INTO evaluations
               (session_id, message_hash, user_query, ai_response, rating, feedback_text, correction, tags, symbol, topic, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (session_id, msg_hash, user_query, ai_response, rating, feedback_text, correction,
             json.dumps(tags or []), symbol, topic, now),
        )
        eval_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    # Process the evaluation for learning
    _process_evaluation(eval_id, user_query, ai_response, rating, correction, topic)

    return {"ok": True, "eval_id": eval_id, "topic": topic}


def _detect_topic(query: str) -> str:
    """Simple rule-based topic detection."""
    q = query.lower()
    if any(w in q for w in ["rsi", "macd", "bollinger", "sma", "ema", "technical", "indicator", "chart"]):
        return "technical_analysis"
    if any(w in q for w in ["portfolio", "holding", "position", "allocation", "p&l"]):
        return "portfolio"
    if any(w in q for w in ["news", "headline", "sentiment", "bullish", "bearish"]):
        return "sentiment"
    if any(w in q for w in ["macro", "gdp", "inflation", "rates", "fed", "rbi"]):
        return "macro"
    if any(w in q for w in ["earnings", "revenue", "eps", "profit", "margin"]):
        return "fundamentals"
    if any(w in q for w in ["tax", "stcg", "ltcg", "capital gain"]):
        return "tax"
    if any(w in q for w in ["compare", "vs", "versus", "which is better"]):
        return "comparison"
    if any(w in q for w in ["forecast", "predict", "price target", "will", "future"]):
        return "forecasting"
    if any(w in q for w in ["strategy", "trade", "entry", "exit", "stop loss"]):
        return "strategy"
    return "general"


def _process_evaluation(eval_id: int, query: str, response: str, rating: int, correction: str | None, topic: str):
    """Process an evaluation to extract learnable patterns."""
    now = time.time()

    with _connect() as conn:
        if rating >= 4:
            # Good response → store as positive example
            conn.execute(
                """INSERT INTO learned_patterns (pattern_type, topic, content, source_eval_ids, weight, created_at, updated_at)
                   VALUES ('positive_example', ?, ?, ?, ?, ?, ?)""",
                (topic, json.dumps({"query": query[:500], "response": response[:2000]}),
                 json.dumps([eval_id]), float(rating) / 5.0, now, now),
            )

        elif rating <= 2:
            # Bad response → store as negative example
            content = {"query": query[:500], "bad_response": response[:1000]}
            if correction:
                content["correction"] = correction[:2000]
                # Also store correction as positive example with lower weight
                conn.execute(
                    """INSERT INTO learned_patterns (pattern_type, topic, content, source_eval_ids, weight, created_at, updated_at)
                       VALUES ('correction', ?, ?, ?, 0.8, ?, ?)""",
                    (topic, json.dumps({"query": query[:500], "corrected_response": correction[:2000]}),
                     json.dumps([eval_id]), now, now),
                )

            conn.execute(
                """INSERT INTO learned_patterns (pattern_type, topic, content, source_eval_ids, weight, created_at, updated_at)
                   VALUES ('negative_example', ?, ?, ?, ?, ?, ?)""",
                (topic, json.dumps(content), json.dumps([eval_id]), (5 - float(rating)) / 5.0, now, now),
            )

        # Extract preference signals
        if correction:
            _extract_preferences(conn, query, response, correction, now)


def _extract_preferences(conn, query: str, bad_response: str, correction: str, now: float):
    """Extract user preferences by comparing bad response vs correction."""
    # Length preference
    if len(correction) > len(bad_response) * 1.5:
        _upsert_preference(conn, "detail_level", "more_detailed", now)
    elif len(correction) < len(bad_response) * 0.6:
        _upsert_preference(conn, "detail_level", "more_concise", now)

    # Check for numeric preference
    import re
    bad_nums = len(re.findall(r'\d+\.?\d*', bad_response))
    corr_nums = len(re.findall(r'\d+\.?\d*', correction))
    if corr_nums > bad_nums + 2:
        _upsert_preference(conn, "data_density", "more_numbers", now)

    # Check for bullet/list preference
    bad_bullets = bad_response.count("- ") + bad_response.count("• ")
    corr_bullets = correction.count("- ") + correction.count("• ")
    if corr_bullets > bad_bullets + 2:
        _upsert_preference(conn, "format", "prefer_lists", now)
    elif bad_bullets > corr_bullets + 2:
        _upsert_preference(conn, "format", "prefer_prose", now)


def _upsert_preference(conn, dimension: str, preference: str, now: float):
    """Insert or update a preference signal."""
    existing = conn.execute(
        "SELECT id, evidence_count, strength FROM preference_signals WHERE dimension = ? AND preference = ?",
        (dimension, preference),
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE preference_signals SET strength = MIN(strength + 0.1, 2.0), evidence_count = evidence_count + 1, updated_at = ? WHERE id = ?",
            (now, existing["id"]),
        )
    else:
        conn.execute(
            "INSERT INTO preference_signals (dimension, preference, strength, evidence_count, created_at, updated_at) VALUES (?, ?, 1.0, 1, ?, ?)",
            (dimension, preference, now, now),
        )


# ---------------------------------------------------------------------------
# Learning-enhanced prompt builder
# ---------------------------------------------------------------------------
def build_enhanced_prompt(
    base_system_prompt: str,
    user_query: str,
    topic: str | None = None,
    symbol: str | None = None,
    max_examples: int = 3,
) -> str:
    """
    Build an enhanced system prompt that incorporates learned patterns.
    Adds few-shot examples, negative examples, and preference-based instructions.
    """
    if not topic:
        topic = _detect_topic(user_query)

    enhanced = base_system_prompt

    with _connect() as conn:
        # 1. Add preference-based instructions
        prefs = conn.execute(
            "SELECT dimension, preference, strength FROM preference_signals WHERE strength >= 1.0 ORDER BY strength DESC LIMIT 5"
        ).fetchall()
        if prefs:
            pref_instructions = []
            for p in prefs:
                dim = p["dimension"]
                pref = p["preference"]
                if dim == "detail_level" and pref == "more_detailed":
                    pref_instructions.append("Provide detailed analysis with supporting data points.")
                elif dim == "detail_level" and pref == "more_concise":
                    pref_instructions.append("Keep responses concise and to the point.")
                elif dim == "data_density" and pref == "more_numbers":
                    pref_instructions.append("Include specific numbers, percentages, and price levels.")
                elif dim == "format" and pref == "prefer_lists":
                    pref_instructions.append("Use bullet points for clarity when listing multiple items.")
                elif dim == "format" and pref == "prefer_prose":
                    pref_instructions.append("Write in flowing prose rather than bullet points.")
            if pref_instructions:
                enhanced += "\n\nUser preferences (learned):\n" + "\n".join(f"- {p}" for p in pref_instructions)

        # 2. Add positive examples for this topic
        positive = conn.execute(
            "SELECT content FROM learned_patterns WHERE pattern_type = 'positive_example' AND topic = ? ORDER BY weight DESC, updated_at DESC LIMIT ?",
            (topic, max_examples),
        ).fetchall()
        if positive:
            enhanced += "\n\nHere are examples of responses the user rated highly for this type of question:"
            for i, p in enumerate(positive):
                try:
                    ex = json.loads(p["content"])
                    enhanced += f"\n\nExample {i+1}:\nQ: {ex.get('query', '')[:300]}\nA: {ex.get('response', '')[:800]}"
                except Exception:
                    pass

        # 3. Add corrections (better than what was originally said)
        corrections = conn.execute(
            "SELECT content FROM learned_patterns WHERE pattern_type = 'correction' AND topic = ? ORDER BY updated_at DESC LIMIT 2",
            (topic,),
        ).fetchall()
        if corrections:
            enhanced += "\n\nThe user has corrected similar responses before. Learn from these corrections:"
            for c in corrections:
                try:
                    ex = json.loads(c["content"])
                    enhanced += f"\nBetter answer: {ex.get('corrected_response', '')[:600]}"
                except Exception:
                    pass

        # 4. Add negative examples (what to avoid)
        negative = conn.execute(
            "SELECT content FROM learned_patterns WHERE pattern_type = 'negative_example' AND topic = ? ORDER BY weight DESC LIMIT 2",
            (topic,),
        ).fetchall()
        if negative:
            enhanced += "\n\nAvoid responses like these (user rated them poorly):"
            for n in negative:
                try:
                    ex = json.loads(n["content"])
                    enhanced += f"\nBad: {ex.get('bad_response', '')[:400]}"
                except Exception:
                    pass

    return enhanced


# ---------------------------------------------------------------------------
# Query the learning model for statistics
# ---------------------------------------------------------------------------
def get_learning_stats() -> dict:
    """Get statistics about the learning model's state."""
    with _connect() as conn:
        total_evals = conn.execute("SELECT COUNT(*) FROM evaluations").fetchone()[0]
        avg_rating = conn.execute("SELECT AVG(rating) FROM evaluations").fetchone()[0]
        positive_patterns = conn.execute("SELECT COUNT(*) FROM learned_patterns WHERE pattern_type = 'positive_example'").fetchone()[0]
        negative_patterns = conn.execute("SELECT COUNT(*) FROM learned_patterns WHERE pattern_type = 'negative_example'").fetchone()[0]
        corrections = conn.execute("SELECT COUNT(*) FROM learned_patterns WHERE pattern_type = 'correction'").fetchone()[0]
        preferences = conn.execute("SELECT COUNT(*) FROM preference_signals").fetchone()[0]

        topic_breakdown = conn.execute(
            "SELECT topic, COUNT(*) as cnt, AVG(rating) as avg_r FROM evaluations GROUP BY topic ORDER BY cnt DESC"
        ).fetchall()

        rating_dist = conn.execute(
            "SELECT rating, COUNT(*) as cnt FROM evaluations GROUP BY rating ORDER BY rating"
        ).fetchall()

        recent_evals = conn.execute(
            "SELECT user_query, rating, topic, created_at FROM evaluations ORDER BY created_at DESC LIMIT 10"
        ).fetchall()

    return {
        "ok": True,
        "total_evaluations": total_evals,
        "average_rating": round(float(avg_rating), 2) if avg_rating else None,
        "patterns": {
            "positive_examples": positive_patterns,
            "negative_examples": negative_patterns,
            "corrections": corrections,
            "preferences": preferences,
        },
        "topic_breakdown": [{"topic": r["topic"], "count": r["cnt"], "avg_rating": round(float(r["avg_r"]), 2)} for r in topic_breakdown],
        "rating_distribution": {str(r["rating"]): r["cnt"] for r in rating_dist},
        "recent_evaluations": [
            {"query": r["user_query"][:100], "rating": r["rating"], "topic": r["topic"], "created_at": r["created_at"]}
            for r in recent_evals
        ],
    }


def get_preferences() -> dict:
    """Get all learned user preferences."""
    with _connect() as conn:
        prefs = conn.execute(
            "SELECT dimension, preference, strength, evidence_count, updated_at FROM preference_signals ORDER BY strength DESC"
        ).fetchall()
    return {
        "ok": True,
        "preferences": [
            {
                "dimension": p["dimension"],
                "preference": p["preference"],
                "strength": round(float(p["strength"]), 2),
                "evidence_count": p["evidence_count"],
                "updated_at": p["updated_at"],
            }
            for p in prefs
        ],
    }


def reset_learning_data() -> dict:
    """Reset all learning data (evaluations, patterns, preferences)."""
    with _connect() as conn:
        conn.execute("DELETE FROM evaluations")
        conn.execute("DELETE FROM learned_patterns")
        conn.execute("DELETE FROM preference_signals")
        conn.execute("DELETE FROM prompt_evolution")
    return {"ok": True, "message": "All learning data has been reset."}


def export_learning_data() -> dict:
    """Export all learning data for backup or analysis."""
    with _connect() as conn:
        evals = conn.execute("SELECT * FROM evaluations ORDER BY created_at DESC").fetchall()
        patterns = conn.execute("SELECT * FROM learned_patterns ORDER BY updated_at DESC").fetchall()
        prefs = conn.execute("SELECT * FROM preference_signals ORDER BY strength DESC").fetchall()
    return {
        "ok": True,
        "evaluations": [dict(r) for r in evals],
        "patterns": [dict(r) for r in patterns],
        "preferences": [dict(r) for r in prefs],
    }
