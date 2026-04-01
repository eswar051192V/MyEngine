"""CLI: python -m agents.cli \"download 5 symbols from US Equity S&P 500\""""
from __future__ import annotations

import argparse
import json
import sys

from agents.download_agent import run_download_agent


def main() -> None:
    p = argparse.ArgumentParser(description="Ollama download agent (tool-use)")
    p.add_argument("instruction", nargs="?", help="Natural language instruction")
    p.add_argument("-m", "--model", default=None, help="Ollama model (default OLLAMA_MODEL or llama3.1)")
    p.add_argument("--json", action="store_true", help="Print full JSON result")
    args = p.parse_args()
    text = args.instruction or (sys.stdin.read().strip() if not sys.stdin.isatty() else "")
    if not text:
        p.print_help()
        sys.exit(1)
    out = run_download_agent(text, model=args.model)
    if args.json:
        print(json.dumps(out, indent=2))
    else:
        if not out.get("ok"):
            print("Error:", out.get("error", out))
            sys.exit(1)
        print(out.get("final_message") or "(no text reply)")
        if out.get("tool_log"):
            print("\n--- tool calls ---")
            for row in out["tool_log"]:
                print(row["tool"], "→", "ok" if row["result"].get("ok") else row["result"])


if __name__ == "__main__":
    main()
