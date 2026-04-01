from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from context.portfolio_ledger import clean_portfolios, normalize_portfolio_transaction


HEADER_ALIASES = {
    "symbol": {"symbol", "ticker", "tickername", "tradingsymbol", "scrip"},
    "assetName": {"assetname", "name", "company", "instrument", "security"},
    "side": {"side", "action", "transaction", "type", "buysell"},
    "purchaseType": {"purchasetype", "product", "ordertype", "producttype"},
    "segment": {"segment", "assetfamily", "instrumenttype"},
    "tradeDate": {"tradedate", "date", "executiondate", "orderdate"},
    "quantity": {"quantity", "qty", "units", "shares"},
    "price": {"price", "tradeprice", "avgprice", "rate"},
    "platform": {"platform", "broker", "source", "brokername"},
    "country": {"country", "market"},
    "state": {"state", "province", "region"},
    "manualCharge": {"manualcharge", "charges", "fee", "brokerage", "totalcharges"},
    "manualTax": {"manualtax", "tax", "taxes"},
    "description": {"description", "memo"},
    "notes": {"notes", "comment", "remarks"},
    "brokerReference": {"brokerreference", "orderno", "orderid", "tradeid", "reference"},
    "transactionSubtype": {"transactionsubtype", "subtype", "event"},
}

SIDE_ALIASES = {
    "BUY": {"buy", "b", "purchase"},
    "SELL": {"sell", "s"},
    "DIVIDEND": {"dividend", "div"},
    "FEE": {"fee", "charge", "charges"},
    "TAX": {"tax", "gst", "stt"},
    "ADJUSTMENT": {"adjustment", "adjust", "bonus", "split", "merger"},
}

PURCHASE_TYPE_ALIASES = {
    "Delivery": {"delivery", "cnc"},
    "Intraday": {"intraday", "mis"},
    "Futures": {"futures", "future", "fno_futures"},
    "Options": {"options", "option", "fno_options"},
    "ETF": {"etf"},
    "Mutual Fund": {"mutual fund", "mf"},
}


def _as_string(value, default: str = "") -> str:
    if value is None:
        return default
    return str(value).strip()


def _infer_delimiter(text: str) -> str:
    sample = "\n".join(text.splitlines()[:5])
    delimiters = {",": sample.count(","), "\t": sample.count("\t"), ";": sample.count(";"), "|": sample.count("|")}
    return max(delimiters, key=delimiters.get) if sample else ","


def _normalize_header(header: str) -> str:
    return "".join(ch for ch in _as_string(header).lower() if ch.isalnum())


def _lookup_canonical(header: str) -> str | None:
    normalized = _normalize_header(header)
    for canonical, aliases in HEADER_ALIASES.items():
        if normalized in {_normalize_header(alias) for alias in aliases}:
            return canonical
    return None


def _resolve_side(raw: str, fallback: str = "BUY") -> str:
    normalized = _as_string(raw).lower()
    for label, aliases in SIDE_ALIASES.items():
        if normalized in aliases:
            return label
    return fallback


def _resolve_purchase_type(raw: str, fallback: str = "Delivery") -> str:
    normalized = _as_string(raw).lower()
    for label, aliases in PURCHASE_TYPE_ALIASES.items():
        if normalized in aliases:
            return label
    return fallback


def _parse_float(raw, default: float = 0.0) -> float:
    try:
        text = _as_string(raw).replace(",", "")
        return float(text) if text else default
    except (TypeError, ValueError):
        return default


def _parse_rows(csv_text: str) -> tuple[list[dict], list[str]]:
    text = _as_string(csv_text)
    if not text:
        return [], ["CSV content is empty."]
    delimiter = _infer_delimiter(text)
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    if not reader.fieldnames:
        return [], ["Unable to detect CSV headers."]
    rows = []
    errors: list[str] = []
    for idx, raw_row in enumerate(reader, start=2):
        if not isinstance(raw_row, dict):
            continue
        mapped: dict[str, str] = {}
        for header, value in raw_row.items():
            canonical = _lookup_canonical(header or "")
            if canonical:
                mapped[canonical] = value
        symbol = _as_string(mapped.get("symbol")).upper()
        if not symbol:
            errors.append(f"Row {idx}: missing symbol/ticker.")
            continue
        rows.append({"rowNumber": idx, "mapped": mapped})
    return rows, errors


def preview_csv_import(
    csv_text: str,
    *,
    platform: str = "",
    country: str = "India",
    state: str = "",
    purchase_type: str = "Delivery",
    segment: str = "Equity",
    side: str = "BUY",
) -> dict:
    parsed_rows, errors = _parse_rows(csv_text)
    preview_rows: list[dict] = []
    import_batch_id = datetime.now(timezone.utc).strftime("import_%Y%m%d%H%M%S")
    for item in parsed_rows[:500]:
        mapped = item["mapped"]
        side_value = _resolve_side(mapped.get("side"), side)
        purchase_type_value = _resolve_purchase_type(mapped.get("purchaseType"), purchase_type)
        candidate = normalize_portfolio_transaction(
            {
                "id": f"{import_batch_id}_{item['rowNumber']}",
                "symbol": _as_string(mapped.get("symbol")).upper(),
                "assetName": _as_string(mapped.get("assetName")) or _as_string(mapped.get("symbol")).upper(),
                "side": side_value,
                "purchaseType": purchase_type_value,
                "segment": _as_string(mapped.get("segment")) or segment,
                "tradeDate": _as_string(mapped.get("tradeDate")),
                "quantity": _parse_float(mapped.get("quantity"), 0.0),
                "price": _parse_float(mapped.get("price"), 0.0),
                "platform": _as_string(mapped.get("platform")) or platform,
                "country": _as_string(mapped.get("country")) or country,
                "state": _as_string(mapped.get("state")) or state,
                "manualCharge": _parse_float(mapped.get("manualCharge"), 0.0),
                "manualTax": _parse_float(mapped.get("manualTax"), 0.0),
                "description": _as_string(mapped.get("description")),
                "notes": _as_string(mapped.get("notes")),
                "brokerReference": _as_string(mapped.get("brokerReference")),
                "transactionSubtype": _as_string(mapped.get("transactionSubtype")),
                "importSource": "csv_import",
                "importBatchId": import_batch_id,
            }
        )
        if not candidate:
            errors.append(f"Row {item['rowNumber']}: could not normalize transaction.")
            continue
        if candidate["quantity"] <= 0 and candidate["side"] in {"BUY", "SELL", "DIVIDEND"}:
            errors.append(f"Row {item['rowNumber']}: quantity must be positive.")
            continue
        if candidate["price"] < 0:
            errors.append(f"Row {item['rowNumber']}: price must be non-negative.")
            continue
        preview_rows.append(candidate)
    return {
        "ok": True,
        "previewRows": preview_rows,
        "errorRows": errors,
        "summary": {
            "parsedRows": len(parsed_rows),
            "importableRows": len(preview_rows),
            "errorCount": len(errors),
            "importBatchId": import_batch_id,
        },
    }


def commit_csv_import(portfolios: dict | None, portfolio_name: str, preview_rows: list[dict] | None) -> dict[str, list[dict]]:
    normalized = clean_portfolios(portfolios)
    target_name = _as_string(portfolio_name) or "Main"
    current_rows = normalized.get(target_name, [])
    merged = {
        **normalized,
        target_name: [*(preview_rows or []), *current_rows],
    }
    return clean_portfolios(merged)
