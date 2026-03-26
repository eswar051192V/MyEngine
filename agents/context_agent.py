"""
Ollama tool-use agent: pulls local + open context and produces structured equity analysis.
"""
from __future__ import annotations

import json
import os
from typing import Any

import requests

from agents.context_tools import OLLAMA_TOOLS_SPEC, dispatch_tool

OLLAMA_BASE = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
MAX_TURNS = 14

SYSTEM = """You are a context-aware equity research assistant running locally.

You have tools to refresh/load saved news, ingest open RSS/Reddit/court ledger rows, filter that ledger for a symbol, summarize India consumer cases, and read local OHLC tails.

Workflow:
1) For the user's symbol, call refresh_news unless they only want cached data—then load_saved_news.
2) Optionally run_open_ingest if the user wants fresh forum/legal/social context (rate-conscious).
3) open_context_for_symbol and consumer_preview for narrative risk.
4) ohlc_tail for recent price facts.

Write a concise analysis: (a) key themes from news/social/legal/consumer, (b) conflicts or confirmations vs price action, (c) risks and unknowns. Not investment advice."""


def run_context_agent(
    symbol: str,
    user_message: str | None = None,
    model: str | None = None,
    ollama_base: str | None = None,
) -> dict[str, Any]:
    model = model or os.environ.get("OLLAMA_MODEL", "llama3.1")
    base = (ollama_base or OLLAMA_BASE).rstrip("/")
    url = f"{base}/api/chat"
    msg = user_message or (
        f"Produce an improved stock context analysis for {symbol}. "
        "Use tools to gather news (refresh), open-context matches, consumer preview, and OHLC tail. "
        "Then synthesize."
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"Symbol: {symbol}\n\n{msg}"},
    ]
    tool_log: list[dict[str, Any]] = []

    for turn in range(MAX_TURNS):
        payload = {
            "model": model,
            "messages": messages,
            "tools": OLLAMA_TOOLS_SPEC,
            "stream": False,
        }
        try:
            r = requests.post(url, json=payload, timeout=600)
        except requests.exceptions.ConnectionError:
            return {
                "ok": False,
                "error": f"Cannot reach Ollama at {base}.",
                "tool_log": tool_log,
            }
        if r.status_code != 200:
            return {
                "ok": False,
                "error": f"Ollama HTTP {r.status_code}: {r.text[:500]}",
                "tool_log": tool_log,
            }
        body = r.json()
        msg_out = body.get("message") or {}
        messages.append(msg_out)
        tool_calls = msg_out.get("tool_calls") or []
        if not tool_calls:
            return {
                "ok": True,
                "model": model,
                "turns": turn + 1,
                "final_message": msg_out.get("content") or "",
                "tool_log": tool_log,
            }
        for tc in tool_calls:
            fn = tc.get("function") or {}
            name = fn.get("name")
            if not name:
                continue
            raw_args = fn.get("arguments")
            if isinstance(raw_args, str):
                try:
                    args = json.loads(raw_args) if raw_args.strip() else {}
                except json.JSONDecodeError:
                    args = {}
            elif isinstance(raw_args, dict):
                args = raw_args
            else:
                args = {}
            if name and "symbol" not in args and symbol:
                args = {**args, "symbol": symbol}
            result = dispatch_tool(name, args)
            tool_log.append({"tool": name, "arguments": args, "result": result})
            messages.append({"role": "tool", "content": json.dumps(result)})

    return {
        "ok": False,
        "error": f"Stopped after {MAX_TURNS} turns.",
        "tool_log": tool_log,
        "final_message": "",
    }
