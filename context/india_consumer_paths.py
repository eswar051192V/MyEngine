from __future__ import annotations

import os

CONSUMER_DIR = os.environ.get("CONSUMER_DATA_DIR", "context_data/india_consumer")
CASES_JSONL = os.path.join(CONSUMER_DIR, "cases.jsonl")
FEEDS_JSON = os.path.join(CONSUMER_DIR, "consumer_feeds.json")
SYMBOL_MAP_JSON = os.path.join(CONSUMER_DIR, "symbol_map.json")
INSTRUMENT_ALIASES_JSON = os.path.join(CONSUMER_DIR, "instrument_aliases.json")
INCOMING_DIR = os.path.join(CONSUMER_DIR, "incoming")
RAG_DB_PATH = os.path.join(CONSUMER_DIR, "rag.sqlite")


def ensure_consumer_dirs() -> None:
    os.makedirs(CONSUMER_DIR, exist_ok=True)
    os.makedirs(INCOMING_DIR, exist_ok=True)
