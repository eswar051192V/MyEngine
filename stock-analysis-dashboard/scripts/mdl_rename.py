#!/usr/bin/env python3
"""One-off renames for Market Design Language (qe→md, wl-v2→mdl). Run from repo: python3 scripts/mdl_rename.py"""
from __future__ import annotations

import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1] / "src"
SKIP = {"constants.js"}


def transform(text: str) -> str:
    # wl-v2 / wl-page (order: longest first)
    text = text.replace("wl-v2--dense", "mdl--dense")
    text = text.replace("wl-v2-", "mdl-")
    text = text.replace("wl-page--redesign", "mdl-page--redesign")
    text = text.replace("wl-page", "mdl-page")
    text = text.replace("wl-v2", "mdl")
    # CSS variables
    text = text.replace("--wl-v2-", "--mdl-")
    # Quant Engine → Market Design
    text = text.replace("--qe-", "--md-")
    text = text.replace(".qe-", ".md-")
    text = text.replace("qe-", "md-")
    return text


def main() -> None:
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix not in {".css", ".jsx", ".js"}:
            continue
        if path.name in SKIP:
            continue
        raw = path.read_text(encoding="utf-8")
        new = transform(raw)
        if new != raw:
            path.write_text(new, encoding="utf-8")
            print("updated", path.relative_to(ROOT.parent.parent))


if __name__ == "__main__":
    main()
