from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone

from context.portfolio_fee_registry import estimate_transaction_charges


DEFAULT_CURRENCY = "INR"


def _as_string(value, default: str = "") -> str:
    if value is None:
        return default
    return str(value).strip()


def _as_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_charge_snapshot(value) -> dict:
    row = value if isinstance(value, dict) else {}
    totals = row.get("totals") if isinstance(row.get("totals"), dict) else {}
    return {
        "platformId": _as_string(row.get("platformId")),
        "platformLabel": _as_string(row.get("platformLabel")),
        "segmentKey": _as_string(row.get("segmentKey")),
        "segmentLabel": _as_string(row.get("segmentLabel")),
        "side": _as_string(row.get("side")).upper() or "BUY",
        "turnover": _as_float(row.get("turnover"), 0.0),
        "lines": [
            {
                "key": _as_string(line.get("key")),
                "label": _as_string(line.get("label")),
                "amount": _as_float(line.get("amount"), 0.0),
            }
            for line in (row.get("lines") or [])
            if isinstance(line, dict)
        ],
        "totals": {str(key): _as_float(val, 0.0) for key, val in totals.items()},
        "totalCharges": _as_float(row.get("totalCharges"), 0.0),
        "sourceTitle": _as_string(row.get("sourceTitle")),
        "sourceUrl": _as_string(row.get("sourceUrl")),
        "exactness": _as_string(row.get("exactness")),
        "registryVersion": _as_string(row.get("registryVersion")),
    }


def normalize_portfolio_transaction(row: dict) -> dict | None:
    if not isinstance(row, dict):
        return None
    symbol = _as_string(row.get("symbol")).upper()
    if not symbol:
        return None
    side = _as_string(row.get("side") or row.get("transactionType") or "BUY").upper()
    if side not in {"BUY", "SELL", "DIVIDEND", "FEE", "TAX", "ADJUSTMENT"}:
        side = "BUY"
    price = _as_float(row.get("price"), _as_float(row.get("buyPrice"), 0.0))
    quantity = _as_float(row.get("quantity"), 0.0)
    trade_date = _as_string(row.get("tradeDate") or row.get("purchaseDate"))
    charge_snapshot = _normalize_charge_snapshot(row.get("chargeSnapshot"))
    if not charge_snapshot.get("lines") and side in {"BUY", "SELL"} and quantity > 0 and price > 0:
        charge_snapshot = estimate_transaction_charges(
            {
                "platform": row.get("platform"),
                "segment": row.get("segment"),
                "purchaseType": row.get("purchaseType"),
                "state": row.get("state"),
                "side": side,
                "quantity": quantity,
                "price": price,
                "manualCharge": row.get("manualCharge"),
                "manualTax": row.get("manualTax"),
            }
        )
    current_price = _as_float(row.get("currentPrice"), price)
    return {
        "id": _as_string(row.get("id")) or f"{symbol}_{int(datetime.now(timezone.utc).timestamp() * 1000)}",
        "entryType": "transaction",
        "side": side,
        "transactionSubtype": _as_string(row.get("transactionSubtype")),
        "symbol": symbol,
        "assetName": _as_string(row.get("assetName")) or symbol,
        "description": _as_string(row.get("description")),
        "notes": _as_string(row.get("notes")),
        "brokerReference": _as_string(row.get("brokerReference")),
        "importSource": _as_string(row.get("importSource")),
        "importBatchId": _as_string(row.get("importBatchId")),
        "purchaseType": _as_string(row.get("purchaseType")) or "Delivery",
        "segment": _as_string(row.get("segment")) or "Equity",
        "tradeDate": trade_date,
        "platform": _as_string(row.get("platform")),
        "country": _as_string(row.get("country")) or "India",
        "state": _as_string(row.get("state")),
        "quantity": quantity,
        "price": price,
        "currentPrice": current_price,
        "currencySymbol": _as_string(row.get("currencySymbol")) or DEFAULT_CURRENCY,
        "manualCharge": _as_float(row.get("manualCharge"), 0.0),
        "manualTax": _as_float(row.get("manualTax"), 0.0),
        "chargeSnapshot": charge_snapshot,
        "createdAt": _as_string(row.get("createdAt")) or datetime.now(timezone.utc).isoformat(),
        "legacyImported": bool(row.get("legacyImported")),
    }


def migrate_legacy_position(row: dict) -> dict | None:
    if not isinstance(row, dict):
        return None
    symbol = _as_string(row.get("symbol")).upper()
    if not symbol:
        return None
    quantity = _as_float(row.get("quantity"), 0.0)
    price = _as_float(row.get("buyPrice"), 0.0)
    if quantity <= 0 or price <= 0:
        return None
    return normalize_portfolio_transaction(
        {
            "id": _as_string(row.get("id")) or f"legacy_{symbol}",
            "symbol": symbol,
            "assetName": _as_string(row.get("assetName")) or symbol,
            "description": row.get("description"),
            "notes": row.get("notes"),
            "purchaseType": row.get("purchaseType") or "Delivery",
            "segment": row.get("segment") or "Equity",
            "tradeDate": row.get("purchaseDate"),
            "platform": row.get("platform"),
            "country": row.get("country") or "India",
            "state": row.get("state"),
            "quantity": quantity,
            "price": price,
            "currentPrice": _as_float(row.get("currentPrice"), price),
            "currencySymbol": row.get("currencySymbol") or DEFAULT_CURRENCY,
            "manualCharge": 0.0,
            "manualTax": 0.0,
            "chargeSnapshot": {
                "platformId": "",
                "platformLabel": _as_string(row.get("platform")),
                "segmentKey": "",
                "segmentLabel": "",
                "side": "BUY",
                "turnover": round(quantity * price, 2),
                "lines": [],
                "totals": {},
                "totalCharges": 0.0,
                "sourceTitle": "Legacy migrated holding",
                "sourceUrl": "",
                "exactness": "legacy_import",
                "registryVersion": "",
            },
            "legacyImported": True,
        }
    )


def clean_portfolio_entries(rows: list | None) -> list[dict]:
    cleaned: list[dict] = []
    seen_ids: set[str] = set()
    for row in rows or []:
        candidate = normalize_portfolio_transaction(row) if isinstance(row, dict) and str(row.get("entryType") or row.get("side") or row.get("transactionType")).strip() else migrate_legacy_position(row)
        if not candidate:
            continue
        row_id = candidate["id"]
        if row_id in seen_ids:
            candidate["id"] = f"{row_id}_{len(cleaned) + 1}"
        seen_ids.add(candidate["id"])
        cleaned.append(candidate)
    return cleaned


def clean_portfolios(portfolios: dict | None) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    if isinstance(portfolios, dict):
        for name, rows in portfolios.items():
            portfolio_name = _as_string(name)
            if not portfolio_name:
                continue
            out[portfolio_name] = clean_portfolio_entries(rows if isinstance(rows, list) else [])
    if not out:
        out["Main"] = []
    return out


def _charge_total(txn: dict) -> float:
    return _as_float(((txn.get("chargeSnapshot") or {}).get("totalCharges")), 0.0)


def derive_holdings_from_transactions(transactions: list[dict] | None) -> list[dict]:
    by_symbol: dict[str, dict] = {}
    ordered = sorted(
        [txn for txn in (transactions or []) if isinstance(txn, dict)],
        key=lambda row: (_as_string(row.get("tradeDate") or row.get("createdAt")), _as_string(row.get("createdAt")), _as_string(row.get("id"))),
    )
    for txn in ordered:
        side = _as_string(txn.get("side")).upper()
        symbol = _as_string(txn.get("symbol")).upper()
        if not symbol:
            continue
        bucket = by_symbol.setdefault(
            symbol,
            {
                "symbol": symbol,
                "assetName": _as_string(txn.get("assetName")) or symbol,
                "description": _as_string(txn.get("description")),
                "notes": _as_string(txn.get("notes")),
                "purchaseType": _as_string(txn.get("purchaseType")) or "Delivery",
                "segment": _as_string(txn.get("segment")) or "Equity",
                "platform": _as_string(txn.get("platform")),
                "country": _as_string(txn.get("country")) or "India",
                "currencySymbol": _as_string(txn.get("currencySymbol")) or DEFAULT_CURRENCY,
                "currentPrice": _as_float(txn.get("currentPrice"), _as_float(txn.get("price"), 0.0)),
                "quantity": 0.0,
                "costBasis": 0.0,
                "realizedPnl": 0.0,
                "buyCharges": 0.0,
                "sellCharges": 0.0,
                "totalChargesPaid": 0.0,
                "transactionCount": 0,
                "lastTradeDate": "",
            },
        )
        bucket["assetName"] = _as_string(txn.get("assetName")) or bucket["assetName"]
        bucket["description"] = _as_string(txn.get("description")) or bucket["description"]
        bucket["notes"] = _as_string(txn.get("notes")) or bucket["notes"]
        bucket["purchaseType"] = _as_string(txn.get("purchaseType")) or bucket["purchaseType"]
        bucket["segment"] = _as_string(txn.get("segment")) or bucket["segment"]
        bucket["platform"] = _as_string(txn.get("platform")) or bucket["platform"]
        bucket["country"] = _as_string(txn.get("country")) or bucket["country"]
        bucket["currencySymbol"] = _as_string(txn.get("currencySymbol")) or bucket["currencySymbol"]
        bucket["currentPrice"] = _as_float(txn.get("currentPrice"), bucket["currentPrice"])
        bucket["lastTradeDate"] = _as_string(txn.get("tradeDate") or txn.get("createdAt")) or bucket["lastTradeDate"]
        bucket["transactionCount"] += 1
        quantity = _as_float(txn.get("quantity"), 0.0)
        price = _as_float(txn.get("price"), 0.0)
        charges = _charge_total(txn)
        bucket["totalChargesPaid"] += charges
        if side == "BUY":
            bucket["quantity"] += quantity
            bucket["costBasis"] += (quantity * price) + charges
            bucket["buyCharges"] += charges
        elif side == "SELL":
            sell_qty = min(quantity, bucket["quantity"])
            avg_cost = bucket["costBasis"] / bucket["quantity"] if bucket["quantity"] > 0 else 0.0
            cost_removed = avg_cost * sell_qty
            net_proceeds = (sell_qty * price) - charges
            bucket["realizedPnl"] += net_proceeds - cost_removed
            bucket["quantity"] = max(bucket["quantity"] - sell_qty, 0.0)
            bucket["costBasis"] = max(bucket["costBasis"] - cost_removed, 0.0)
            bucket["sellCharges"] += charges
        elif side == "DIVIDEND":
            bucket["realizedPnl"] += (quantity * price) - charges
        elif side in {"FEE", "TAX"}:
            bucket["realizedPnl"] -= charges if charges > 0 else quantity * price
        elif side == "ADJUSTMENT":
            subtype = _as_string(txn.get("transactionSubtype")).lower()
            if subtype == "split" and quantity > 0:
                bucket["quantity"] += quantity
            elif subtype == "bonus" and quantity > 0:
                bucket["quantity"] += quantity
            else:
                bucket["costBasis"] += quantity * price

    holdings: list[dict] = []
    for symbol, bucket in by_symbol.items():
        quantity = bucket["quantity"]
        avg_cost = bucket["costBasis"] / quantity if quantity > 0 else 0.0
        market_value = quantity * bucket["currentPrice"]
        exit_preview = estimate_transaction_charges(
            {
                "platform": bucket["platform"],
                "segment": bucket["segment"],
                "purchaseType": bucket["purchaseType"],
                "side": "SELL",
                "quantity": quantity,
                "price": bucket["currentPrice"],
            }
        ) if quantity > 0 and bucket["currentPrice"] > 0 else {"totalCharges": 0.0, "totals": {}, "lines": []}
        projected_exit = _as_float(exit_preview.get("totalCharges"), 0.0)
        gross_pnl = market_value - bucket["costBasis"]
        net_pnl = gross_pnl - projected_exit
        holdings.append(
            {
                "id": symbol,
                "symbol": symbol,
                "assetName": bucket["assetName"],
                "description": bucket["description"],
                "notes": bucket["notes"],
                "purchaseType": bucket["purchaseType"],
                "segment": bucket["segment"],
                "platform": bucket["platform"],
                "country": bucket["country"],
                "currencySymbol": bucket["currencySymbol"],
                "quantity": round(quantity, 6),
                "buyPrice": round(avg_cost, 4),
                "averageCost": round(avg_cost, 4),
                "invested": round(bucket["costBasis"], 2),
                "currentPrice": round(bucket["currentPrice"], 4),
                "current": round(market_value, 2),
                "grossPnl": round(gross_pnl, 2),
                "netPnl": round(net_pnl, 2),
                "projectedExitCharges": round(projected_exit, 2),
                "realizedPnl": round(bucket["realizedPnl"], 2),
                "totalChargesPaid": round(bucket["totalChargesPaid"], 2),
                "transactionCount": bucket["transactionCount"],
                "lastTradeDate": bucket["lastTradeDate"],
                "exitChargePreview": deepcopy(exit_preview),
            }
        )
    holdings.sort(key=lambda row: (-row["current"], row["symbol"]))
    return holdings


def derive_portfolio_stats(transactions: list[dict] | None) -> dict:
    rows = derive_holdings_from_transactions(transactions)
    by_segment: dict[str, dict] = defaultdict(lambda: {"invested": 0.0, "current": 0.0, "net": 0.0})
    by_platform: dict[str, dict] = defaultdict(lambda: {"invested": 0.0, "current": 0.0, "net": 0.0})
    by_country: dict[str, dict] = defaultdict(lambda: {"invested": 0.0, "current": 0.0, "net": 0.0})
    invested = current = realized = gross = net = projected_exit = charges_paid = 0.0
    profitable = 0
    for row in rows:
        invested += row["invested"]
        current += row["current"]
        realized += row["realizedPnl"]
        gross += row["grossPnl"]
        net += row["netPnl"]
        projected_exit += row["projectedExitCharges"]
        charges_paid += row["totalChargesPaid"]
        profitable += 1 if row["netPnl"] >= 0 else 0
        segment = row["segment"] or "Other"
        platform = row["platform"] or "Unspecified"
        country = row["country"] or "Unspecified"
        by_segment[segment]["invested"] += row["invested"]
        by_segment[segment]["current"] += row["current"]
        by_segment[segment]["net"] += row["netPnl"]
        by_platform[platform]["invested"] += row["invested"]
        by_platform[platform]["current"] += row["current"]
        by_platform[platform]["net"] += row["netPnl"]
        by_country[country]["invested"] += row["invested"]
        by_country[country]["current"] += row["current"]
        by_country[country]["net"] += row["netPnl"]
    recent_transactions = sorted(
        [normalize_portfolio_transaction(txn) for txn in transactions or [] if normalize_portfolio_transaction(txn)],
        key=lambda row: (_as_string(row.get("tradeDate") or row.get("createdAt")), _as_string(row.get("createdAt"))),
        reverse=True,
    )[:10]

    def _map_rows(grouped: dict[str, dict]) -> list[dict]:
        return [
            {
                "label": label,
                "invested": round(values["invested"], 2),
                "current": round(values["current"], 2),
                "pnl": round(values["current"] - values["invested"], 2),
                "net": round(values["net"], 2),
            }
            for label, values in grouped.items()
        ]

    return {
        "holdings": len(rows),
        "profitable": profitable,
        "invested": round(invested, 2),
        "current": round(current, 2),
        "realizedPnl": round(realized, 2),
        "grossPnl": round(gross, 2),
        "netAfterCosts": round(net, 2),
        "projectedExitCharges": round(projected_exit, 2),
        "totalChargesPaid": round(charges_paid, 2),
        "bySegment": _map_rows(by_segment),
        "byPlatform": _map_rows(by_platform),
        "byCountry": _map_rows(by_country),
        "recentPurchases": recent_transactions,
        "holdingsRows": rows,
    }
