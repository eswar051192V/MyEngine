"""
Unified AI agent orchestrator.

Single entry point for all chat interactions. Routes to the right tools,
maintains conversation history, supports streaming, and handles
general queries without requiring a ticker to be selected.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any, Generator

import requests

from agents.model_registry import resolve_model, _ollama_base
from agents.conversation_store import (
    add_message,
    create_session,
    get_context_window,
    get_session,
    auto_title_from_first_message,
    update_session,
)
from agents.orchestrator_tools import OLLAMA_TOOLS_SPEC, dispatch_tool
from agents.learning_model import build_enhanced_prompt

MAX_TURNS = 20

SYSTEM_PROMPT = """You are Quant Engine AI, a local-first equity research and portfolio analysis assistant.

You have access to tools for:
- Market data: news, OHLC prices, technical indicators (RSI, MACD, Bollinger, etc.)
- Portfolio: holdings, P&L, analytics, tax summaries
- Comparison: multi-symbol performance comparison
- Context: consumer complaints, open web context (RSS/Reddit/court)
- Watchlist: view and summarize watched symbols
- Macro: index-level snapshots (S&P 500, Nifty, VIX, etc.)
- Search: find any ticker symbol
- Download: fetch fresh market data from Yahoo Finance

Guidelines:
1. Use tools to get real data before answering — don't guess numbers.
2. You can answer general market/finance questions from your knowledge without tools.
3. For portfolio questions, call get_portfolio_holdings or portfolio_analytics.
4. For technical analysis, call technical_indicators with the relevant indicators.
5. For comparisons ("X vs Y"), call compare_symbols.
6. When asked about "my watchlist" or "my portfolio", use the appropriate tool.
7. Keep responses concise and actionable. Use bullet points for multi-item answers.
8. If data is missing, suggest downloading it first.
9. Not investment advice — you are an analysis tool.
10. When the user mentions a symbol, always use the exact ticker format (e.g. RELIANCE.NS for NSE stocks)."""


def run_orchestrator(
    user_message: str,
    session_id: str | None = None,
    symbol: str | None = None,
    model_override: str | None = None,
    ollama_base: str | None = None,
    role: str = "chat",
) -> dict[str, Any]:
    """
    Main non-streaming orchestrator loop.

    Args:
        user_message: The user's input text
        session_id: Existing conversation session (creates new if None)
        symbol: Optional active symbol context
        model_override: Force a specific model
        ollama_base: Ollama base URL override
        role: Model role for registry lookup (chat, analysis, etc.)

    Returns:
        {ok, session_id, model, turns, final_message, tool_log}
    """
    model = resolve_model(role, override=model_override, ollama_base=ollama_base)
    base = (ollama_base or _ollama_base()).rstrip("/")
    url = f"{base}/api/chat"

    # Session management
    if not session_id:
        sess = create_session(title=auto_title_from_first_message(user_message))
        session_id = sess["session_id"]
    elif not get_session(session_id):
        sess = create_session(title=auto_title_from_first_message(user_message))
        session_id = sess["session_id"]

    # Store user message
    add_message(session_id, "user", user_message, metadata={"symbol": symbol} if symbol else {})

    # Build context window with conversation history
    # Enhance system prompt with learned patterns
    system = build_enhanced_prompt(SYSTEM_PROMPT, user_message, symbol=symbol)
    if symbol:
        system += f"\n\nThe user is currently viewing: {symbol}. Default to this symbol for tool calls unless they specify otherwise."

    messages = get_context_window(session_id, system_prompt=system)
    tool_log: list[dict] = []

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
            error_msg = f"Cannot reach Ollama at {base}. Is it running?"
            add_message(session_id, "assistant", error_msg)
            return {"ok": False, "error": error_msg, "session_id": session_id, "tool_log": tool_log}

        if r.status_code != 200:
            error_msg = f"Ollama HTTP {r.status_code}: {r.text[:300]}"
            add_message(session_id, "assistant", error_msg)
            return {"ok": False, "error": error_msg, "session_id": session_id, "tool_log": tool_log}

        body = r.json()
        msg_out = body.get("message") or {}
        messages.append(msg_out)

        tool_calls = msg_out.get("tool_calls") or []
        if not tool_calls:
            # No more tool calls — final response
            final = msg_out.get("content") or ""
            add_message(session_id, "assistant", final)

            # Auto-title on first meaningful exchange
            sess_info = get_session(session_id)
            if sess_info and sess_info.get("title", "").startswith("New Chat"):
                update_session(session_id, title=auto_title_from_first_message(user_message))

            return {
                "ok": True,
                "session_id": session_id,
                "model": model,
                "turns": turn + 1,
                "final_message": final,
                "tool_log": tool_log,
            }

        # Execute tool calls
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

            # Inject active symbol if tool expects it and it's not provided
            if symbol and "symbol" in _get_tool_params(name) and "symbol" not in args:
                args["symbol"] = symbol

            result = dispatch_tool(name, args)
            tool_log.append({"tool": name, "arguments": args, "result": result})

            # Store tool interaction in conversation
            add_message(session_id, "assistant", "", tool_calls=[{"function": {"name": name, "arguments": args}}])
            add_message(session_id, "tool", json.dumps(result), metadata={"tool_name": name})

            messages.append({"role": "tool", "content": json.dumps(result)})

    # Max turns reached
    error_msg = f"Stopped after {MAX_TURNS} turns."
    add_message(session_id, "assistant", error_msg)
    return {
        "ok": False,
        "error": error_msg,
        "session_id": session_id,
        "tool_log": tool_log,
        "final_message": "",
    }


def _get_tool_params(tool_name: str) -> set[str]:
    """Get parameter names for a tool from the spec."""
    for spec in OLLAMA_TOOLS_SPEC:
        if spec.get("function", {}).get("name") == tool_name:
            return set(spec["function"].get("parameters", {}).get("properties", {}).keys())
        fn = spec.get("function") or {}
        if fn.get("name") == tool_name:
            return set(fn.get("parameters", {}).get("properties", {}).keys())
    return set()


# ---------------------------------------------------------------------------
# Streaming orchestrator (SSE)
# ---------------------------------------------------------------------------
def stream_orchestrator(
    user_message: str,
    session_id: str | None = None,
    symbol: str | None = None,
    model_override: str | None = None,
    ollama_base: str | None = None,
    role: str = "chat",
) -> Generator[dict, None, None]:
    """
    Streaming version of the orchestrator.
    Yields SSE-compatible event dicts:
      {"event": "session", "data": {"session_id": ...}}
      {"event": "tool_start", "data": {"tool": name, "arguments": args}}
      {"event": "tool_result", "data": {"tool": name, "result": ...}}
      {"event": "token", "data": {"content": "..."}}
      {"event": "done", "data": {"turns": N, "model": ...}}
      {"event": "error", "data": {"error": "..."}}
    """
    model = resolve_model(role, override=model_override, ollama_base=ollama_base)
    base = (ollama_base or _ollama_base()).rstrip("/")
    url = f"{base}/api/chat"

    # Session management
    if not session_id:
        sess = create_session(title=auto_title_from_first_message(user_message))
        session_id = sess["session_id"]
    elif not get_session(session_id):
        sess = create_session(title=auto_title_from_first_message(user_message))
        session_id = sess["session_id"]

    yield {"event": "session", "data": {"session_id": session_id}}

    add_message(session_id, "user", user_message, metadata={"symbol": symbol} if symbol else {})

    system = build_enhanced_prompt(SYSTEM_PROMPT, user_message, symbol=symbol)
    if symbol:
        system += f"\n\nThe user is currently viewing: {symbol}. Default to this symbol for tool calls unless they specify otherwise."

    messages = get_context_window(session_id, system_prompt=system)
    tool_log: list[dict] = []

    for turn in range(MAX_TURNS):
        # First pass: non-streaming to check for tool calls
        payload = {
            "model": model,
            "messages": messages,
            "tools": OLLAMA_TOOLS_SPEC,
            "stream": False,
        }
        try:
            r = requests.post(url, json=payload, timeout=600)
        except requests.exceptions.ConnectionError:
            yield {"event": "error", "data": {"error": f"Cannot reach Ollama at {base}"}}
            return

        if r.status_code != 200:
            yield {"event": "error", "data": {"error": f"Ollama HTTP {r.status_code}"}}
            return

        body = r.json()
        msg_out = body.get("message") or {}
        tool_calls = msg_out.get("tool_calls") or []

        if not tool_calls:
            # Final response — now stream it
            messages_for_stream = list(messages)
            try:
                stream_payload = {
                    "model": model,
                    "messages": messages_for_stream,
                    "stream": True,
                }
                with requests.post(url, json=stream_payload, timeout=600, stream=True) as sr:
                    full_content = ""
                    for line in sr.iter_lines():
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)
                            token = chunk.get("message", {}).get("content", "")
                            if token:
                                full_content += token
                                yield {"event": "token", "data": {"content": token}}
                            if chunk.get("done"):
                                break
                        except json.JSONDecodeError:
                            continue

                    add_message(session_id, "assistant", full_content)
                    sess_info = get_session(session_id)
                    if sess_info and sess_info.get("title", "").startswith("New Chat"):
                        update_session(session_id, title=auto_title_from_first_message(user_message))

                    yield {"event": "done", "data": {
                        "turns": turn + 1,
                        "model": model,
                        "session_id": session_id,
                        "tool_log": tool_log,
                    }}
            except Exception as e:
                yield {"event": "error", "data": {"error": str(e)}}
            return

        # Execute tool calls
        messages.append(msg_out)
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

            if symbol and "symbol" in _get_tool_params(name) and "symbol" not in args:
                args["symbol"] = symbol

            yield {"event": "tool_start", "data": {"tool": name, "arguments": args}}

            result = dispatch_tool(name, args)
            tool_log.append({"tool": name, "arguments": args, "result": result})

            yield {"event": "tool_result", "data": {"tool": name, "result": result}}

            add_message(session_id, "assistant", "", tool_calls=[{"function": {"name": name, "arguments": args}}])
            add_message(session_id, "tool", json.dumps(result), metadata={"tool_name": name})
            messages.append({"role": "tool", "content": json.dumps(result)})

    yield {"event": "error", "data": {"error": f"Stopped after {MAX_TURNS} turns."}}
