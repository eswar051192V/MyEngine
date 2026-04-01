from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from context.portfolio_ledger import (
    clean_portfolios,
    derive_holdings_from_transactions,
    derive_portfolio_stats,
    normalize_portfolio_transaction,
)


def _as_string(value, default: str = "") -> str:
    if value is None:
        return default
    return str(value).strip()


def _as_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _parse_date(raw: str | None) -> datetime | None:
    text = _as_string(raw)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _month_key(raw: str | None) -> str:
    dt = _parse_date(raw)
    return dt.strftime("%Y-%m") if dt else "Unknown"


def _fy_for_date(dt: datetime | None) -> str:
    if not dt:
        return "Unknown"
    year = dt.year if dt.month >= 4 else dt.year - 1
    return f"FY{year}-{str(year + 1)[-2:]}"


INDIA_TAX_RULES = {
    "listed_equity": {
        "label": "Listed equity",
        "stcg_rate": 0.20,
        "ltcg_rate": 0.125,
        "ltcg_days": 365,
        "ltcg_exemption": 125000.0,
        "exemption_group": "equity_like",
        "rate_note": "20% STCG, 12.5% LTCG after 12 months",
    },
    "equity_mutual_fund": {
        "label": "Equity-oriented mutual fund",
        "stcg_rate": 0.20,
        "ltcg_rate": 0.125,
        "ltcg_days": 365,
        "ltcg_exemption": 125000.0,
        "exemption_group": "equity_like",
        "rate_note": "Equity MF estimate: 20% STCG, 12.5% LTCG after 12 months",
    },
    "debt_mutual_fund": {
        "label": "Debt / fixed-income mutual fund",
        "stcg_rate": 0.30,
        "ltcg_rate": 0.30,
        "ltcg_days": 730,
        "ltcg_exemption": 0.0,
        "exemption_group": "",
        "rate_note": "Debt MF estimate using slab-style 30% proxy",
    },
    "bonds_fixed_income": {
        "label": "Bond / fixed income",
        "stcg_rate": 0.30,
        "ltcg_rate": 0.125,
        "ltcg_days": 730,
        "ltcg_exemption": 0.0,
        "exemption_group": "",
        "rate_note": "Bond / fixed-income estimate: 30% short term, 12.5% long term after 24 months",
    },
    "gold_commodity": {
        "label": "Gold / commodity holding",
        "stcg_rate": 0.30,
        "ltcg_rate": 0.125,
        "ltcg_days": 730,
        "ltcg_exemption": 0.0,
        "exemption_group": "",
        "rate_note": "Gold / commodity estimate: 30% short term, 12.5% long term after 24 months",
    },
    "real_asset": {
        "label": "Real estate / private asset",
        "stcg_rate": 0.30,
        "ltcg_rate": 0.125,
        "ltcg_days": 730,
        "ltcg_exemption": 0.0,
        "exemption_group": "",
        "rate_note": "Real-asset estimate: 30% short term, 12.5% long term after 24 months",
    },
    "other_capital": {
        "label": "Other capital holding",
        "stcg_rate": 0.30,
        "ltcg_rate": 0.125,
        "ltcg_days": 730,
        "ltcg_exemption": 0.0,
        "exemption_group": "",
        "rate_note": "Fallback capital-holding estimate",
    },
    "crypto": {
        "label": "Virtual digital asset",
        "stcg_rate": 0.30,
        "ltcg_rate": 0.30,
        "ltcg_days": 0,
        "ltcg_exemption": 0.0,
        "exemption_group": "",
        "rate_note": "Crypto estimate: 30% VDA-style proxy",
    },
}


def current_financial_year(now: datetime | None = None) -> str:
    return _fy_for_date(now or datetime.now())


def _combined_text(*parts) -> str:
    return " ".join(_as_string(part).lower() for part in parts if _as_string(part))


def _tax_profile(key: str) -> dict:
    return {"key": key, **INDIA_TAX_RULES[key]}


def classify_tax_profile(row_or_segment=None, purchase_type: str | None = None, asset_name: str | None = None, description: str | None = None, notes: str | None = None) -> dict:
    if isinstance(row_or_segment, dict):
        row = row_or_segment
        segment = _as_string(row.get("segment"))
        purchase = _as_string(row.get("purchaseType"))
        text = _combined_text(row.get("assetName"), row.get("description"), row.get("notes"), row.get("symbol"), row.get("transactionSubtype"))
    else:
        segment = _as_string(row_or_segment)
        purchase = _as_string(purchase_type)
        text = _combined_text(asset_name, description, notes)
    seg = segment.lower()
    purchase_lower = purchase.lower()
    is_crypto = seg == "crypto" or purchase_lower == "crypto" or any(word in text for word in {"bitcoin", "ethereum", "crypto"})
    if is_crypto:
        return _tax_profile("crypto")

    equity_mf_keywords = {
        "equity fund", "large cap", "mid cap", "small cap", "flexi cap", "multi cap", "index fund", "elss", "focused fund", "value fund",
    }
    debt_mf_keywords = {
        "debt fund", "liquid fund", "overnight fund", "gilt fund", "corporate bond", "money market", "short duration", "ultra short", "credit risk",
        "fixed income fund", "target maturity", "dynamic bond",
    }
    gold_keywords = {"gold", "silver", "commodity", "bullion", "sgb", "goldbees"}
    bond_keywords = {"bond", "debenture", "gsec", "gilt", "t-bill", "treasury", "fixed income"}
    real_asset_keywords = {"real estate", "reit", "invit", "private asset", "pms", "aif", "property"}

    if seg == "mutual fund" or purchase_lower == "mutual fund":
        if any(keyword in text for keyword in equity_mf_keywords):
            return _tax_profile("equity_mutual_fund")
        if any(keyword in text for keyword in debt_mf_keywords):
            return _tax_profile("debt_mutual_fund")
        return _tax_profile("other_capital")

    if seg in {"equity", "index"}:
        return _tax_profile("listed_equity")
    if seg == "etf":
        if any(keyword in text for keyword in gold_keywords):
            return _tax_profile("gold_commodity")
        if any(keyword in text for keyword in bond_keywords):
            return _tax_profile("bonds_fixed_income")
        return _tax_profile("listed_equity")
    if seg in {"bond", "fixed income"} or any(keyword in text for keyword in bond_keywords):
        return _tax_profile("bonds_fixed_income")
    if seg == "commodity" or purchase_lower == "commodity" or any(keyword in text for keyword in gold_keywords):
        return _tax_profile("gold_commodity")
    if seg in {"real estate", "private asset", "insurance / pension"} or any(keyword in text for keyword in real_asset_keywords):
        return _tax_profile("real_asset")
    if purchase_lower in {"delivery", "etf"} and seg in {"", "other", "cash"}:
        return _tax_profile("listed_equity")
    return _tax_profile("other_capital")


def _bucket_key(profile_key: str, tax_bucket: str) -> str:
    bucket = tax_bucket.upper() if tax_bucket else "STCG"
    return f"{profile_key}_{bucket.lower()}"


def _estimate_bucket_tax(net_gain: float, profile: dict, tax_bucket: str, exemption_available: float = 0.0) -> tuple[float, float]:
    taxable_gain = max(net_gain, 0.0)
    if tax_bucket == "LTCG":
        exemption_used = min(max(exemption_available, 0.0), taxable_gain)
        taxable_gain = max(taxable_gain - exemption_used, 0.0)
        return taxable_gain * _as_float(profile.get("ltcg_rate"), 0.0), exemption_used
    return taxable_gain * _as_float(profile.get("stcg_rate"), 0.0), 0.0


def _estimate_holding_lots_tax(transactions: list[dict] | None, holdings: list[dict] | None) -> tuple[list[dict], dict]:
    normalized = [normalize_portfolio_transaction(row) for row in (transactions or [])]
    ordered = sorted([row for row in normalized if row], key=lambda row: (_as_string(row.get("tradeDate") or row.get("createdAt")), _as_string(row.get("id"))))
    open_lots: dict[str, list[dict]] = defaultdict(list)
    meta_by_symbol: dict[str, dict] = {}
    for txn in ordered:
        symbol = _as_string(txn.get("symbol")).upper()
        if not symbol:
            continue
        profile = classify_tax_profile(txn)
        meta_by_symbol[symbol] = {
            "assetName": _as_string(txn.get("assetName")) or symbol,
            "segment": _as_string(txn.get("segment")) or "Equity",
            "purchaseType": _as_string(txn.get("purchaseType")) or "Delivery",
            "platform": _as_string(txn.get("platform")),
            "country": _as_string(txn.get("country")) or "India",
            "taxProfile": profile["key"],
            "taxProfileLabel": profile["label"],
            "shortTermRatePct": round(_as_float(profile.get("stcg_rate"), 0.0) * 100, 2),
            "longTermRatePct": round(_as_float(profile.get("ltcg_rate"), 0.0) * 100, 2),
            "rateNote": _as_string(profile.get("rate_note")),
        }
        side = _as_string(txn.get("side")).upper()
        qty = _as_float(txn.get("quantity"), 0.0)
        charges = _as_float(((txn.get("chargeSnapshot") or {}).get("totalCharges")), 0.0)
        if side == "BUY" and qty > 0:
            open_lots[symbol].append(
                {
                    "quantity": qty,
                    "unitCost": ((_as_float(txn.get("price"), 0.0) * qty) + charges) / qty,
                    "tradeDate": _as_string(txn.get("tradeDate") or txn.get("createdAt")),
                    "profile": profile,
                }
            )
        elif side == "SELL" and qty > 0:
            remaining = qty
            lots = open_lots[symbol]
            while remaining > 1e-9 and lots:
                lot = lots[0]
                used = min(remaining, lot["quantity"])
                lot["quantity"] -= used
                remaining -= used
                if lot["quantity"] <= 1e-9:
                    lots.pop(0)
        elif side == "ADJUSTMENT" and qty > 0:
            subtype = _as_string(txn.get("transactionSubtype")).lower()
            if subtype in {"split", "bonus"}:
                open_lots[symbol].append(
                    {
                        "quantity": qty,
                        "unitCost": 0.0,
                        "tradeDate": _as_string(txn.get("tradeDate") or txn.get("createdAt")),
                        "profile": profile,
                    }
                )

    holdings_by_symbol = {str(row.get("symbol")).upper(): row for row in (holdings or []) if isinstance(row, dict)}
    holding_liabilities: list[dict] = []
    liability_totals = defaultdict(float)
    today = datetime.now()
    total_positive_equity_ltcg = 0.0
    for symbol, lots in open_lots.items():
        holding = holdings_by_symbol.get(symbol)
        if not holding or _as_float(holding.get("quantity"), 0.0) <= 0:
            continue
        current_price = _as_float(holding.get("currentPrice"), 0.0)
        exit_charges = _as_float(holding.get("projectedExitCharges"), 0.0)
        total_qty = sum(_as_float(lot.get("quantity"), 0.0) for lot in lots)
        if total_qty <= 0:
            continue
        short_gain = 0.0
        long_gain = 0.0
        estimated_tax_before_exemption = 0.0
        equity_ltcg_positive = 0.0
        longest_days = 0
        for lot in lots:
            lot_qty = _as_float(lot.get("quantity"), 0.0)
            if lot_qty <= 0:
                continue
            lot_dt = _parse_date(lot.get("tradeDate"))
            holding_days = max((today - lot_dt).days, 0) if lot_dt else 0
            longest_days = max(longest_days, holding_days)
            profile = lot.get("profile") or classify_tax_profile(
                meta_by_symbol[symbol].get("segment"),
                meta_by_symbol[symbol].get("purchaseType"),
                meta_by_symbol[symbol].get("assetName"),
            )
            lot_exit_charge = exit_charges * (lot_qty / max(total_qty, 1e-9))
            gain = ((current_price - _as_float(lot.get("unitCost"), 0.0)) * lot_qty) - lot_exit_charge
            is_long_term = profile["key"] != "crypto" and holding_days >= _as_float(profile.get("ltcg_days"), 0.0)
            tax_bucket = "LTCG" if is_long_term else "STCG"
            if tax_bucket == "LTCG":
                long_gain += gain
            else:
                short_gain += gain
            tax_estimate, _ = _estimate_bucket_tax(gain, profile, tax_bucket, 0.0)
            estimated_tax_before_exemption += tax_estimate
            liability_totals[_bucket_key(profile["key"], tax_bucket)] += gain
            if profile.get("exemption_group") == "equity_like" and tax_bucket == "LTCG" and gain > 0:
                equity_ltcg_positive += gain
                total_positive_equity_ltcg += gain
        row = {
            "symbol": symbol,
            "assetName": meta_by_symbol[symbol]["assetName"],
            "segment": meta_by_symbol[symbol]["segment"],
            "purchaseType": meta_by_symbol[symbol]["purchaseType"],
            "platform": meta_by_symbol[symbol]["platform"],
            "country": meta_by_symbol[symbol]["country"],
            "quantity": round(total_qty, 6),
            "currentValue": round(_as_float(holding.get("current"), current_price * total_qty), 2),
            "invested": round(_as_float(holding.get("invested"), 0.0), 2),
            "projectedExitCharges": round(exit_charges, 2),
            "sellNowGain": round(short_gain + long_gain, 2),
            "shortTermGain": round(short_gain, 2),
            "longTermGain": round(long_gain, 2),
            "holdingPeriodDays": longest_days,
            "taxProfile": meta_by_symbol[symbol]["taxProfile"],
            "taxProfileLabel": meta_by_symbol[symbol]["taxProfileLabel"],
            "shortTermRatePct": meta_by_symbol[symbol]["shortTermRatePct"],
            "longTermRatePct": meta_by_symbol[symbol]["longTermRatePct"],
            "rateNote": meta_by_symbol[symbol]["rateNote"],
            "estimatedTaxBeforeExemption": round(estimated_tax_before_exemption, 2),
            "equityLtcgPositiveGain": round(equity_ltcg_positive, 2),
            "estimatedTaxLiability": round(estimated_tax_before_exemption, 2),
            "equityExemptionUsed": 0.0,
        }
        holding_liabilities.append(row)
    return holding_liabilities, {"totals": dict(liability_totals), "totalPositiveEquityLtcg": total_positive_equity_ltcg}


def _portfolio_transactions(portfolios: dict | None, portfolio_name: str | None = None) -> tuple[str, list[dict]]:
    normalized = clean_portfolios(portfolios)
    if portfolio_name and portfolio_name in normalized:
        return portfolio_name, normalized[portfolio_name]
    if portfolio_name == "__all__":
        return "All Portfolios", [row for rows in normalized.values() for row in rows]
    first_name = next(iter(normalized.keys()), "Main")
    return first_name, normalized.get(first_name, [])


def derive_realized_events(transactions: list[dict] | None) -> list[dict]:
    rows = [normalize_portfolio_transaction(row) for row in (transactions or [])]
    normalized = [row for row in rows if row]
    ordered = sorted(normalized, key=lambda row: (_as_string(row.get("tradeDate") or row.get("createdAt")), _as_string(row.get("id"))))
    by_symbol: dict[str, dict] = {}
    realized_events: list[dict] = []
    for txn in ordered:
        symbol = _as_string(txn.get("symbol")).upper()
        if not symbol:
            continue
        state = by_symbol.setdefault(symbol, {"quantity": 0.0, "costBasis": 0.0, "firstBuyDate": None})
        qty = _as_float(txn.get("quantity"), 0.0)
        price = _as_float(txn.get("price"), 0.0)
        charges = _as_float(((txn.get("chargeSnapshot") or {}).get("totalCharges")), 0.0)
        trade_dt = _parse_date(txn.get("tradeDate") or txn.get("createdAt"))
        side = _as_string(txn.get("side")).upper()
        if side == "BUY":
            if state["quantity"] <= 0:
                state["firstBuyDate"] = trade_dt
            state["quantity"] += qty
            state["costBasis"] += (qty * price) + charges
        elif side == "SELL" and state["quantity"] > 0:
            sell_qty = min(qty, state["quantity"])
            avg_cost = state["costBasis"] / state["quantity"] if state["quantity"] > 0 else 0.0
            cost_removed = avg_cost * sell_qty
            net_proceeds = (sell_qty * price) - charges
            pnl = net_proceeds - cost_removed
            holding_days = (trade_dt - state["firstBuyDate"]).days if trade_dt and state["firstBuyDate"] else 0
            profile = classify_tax_profile(txn)
            tax_bucket = "LTCG" if profile["key"] != "crypto" and holding_days >= _as_float(profile.get("ltcg_days"), 0.0) else "STCG"
            realized_events.append(
                {
                    "id": _as_string(txn.get("id")),
                    "symbol": symbol,
                    "assetName": _as_string(txn.get("assetName")) or symbol,
                    "segment": _as_string(txn.get("segment")) or "Equity",
                    "purchaseType": _as_string(txn.get("purchaseType")) or "Delivery",
                    "tradeDate": _as_string(txn.get("tradeDate")),
                    "portfolioSide": side,
                    "quantity": round(sell_qty, 6),
                    "sellPrice": round(price, 4),
                    "averageCost": round(avg_cost, 4),
                    "pnl": round(pnl, 2),
                    "charges": round(charges, 2),
                    "holdingPeriodDays": holding_days,
                    "taxBucket": tax_bucket,
                    "taxProfile": profile["key"],
                    "taxProfileLabel": profile["label"],
                    "shortTermRatePct": round(_as_float(profile.get("stcg_rate"), 0.0) * 100, 2),
                    "longTermRatePct": round(_as_float(profile.get("ltcg_rate"), 0.0) * 100, 2),
                    "rateNote": _as_string(profile.get("rate_note")),
                    "financialYear": _fy_for_date(trade_dt),
                    "platform": _as_string(txn.get("platform")),
                }
            )
            state["quantity"] = max(state["quantity"] - sell_qty, 0.0)
            state["costBasis"] = max(state["costBasis"] - cost_removed, 0.0)
            if state["quantity"] <= 0:
                state["firstBuyDate"] = None
        elif side == "ADJUSTMENT" and _as_string(txn.get("transactionSubtype")).lower() == "split" and qty > 0:
            state["quantity"] += qty
        elif side == "ADJUSTMENT":
            state["costBasis"] += qty * price
    return realized_events


def derive_portfolio_analytics(portfolios: dict | None, portfolio_name: str | None = None) -> dict:
    resolved_name, transactions = _portfolio_transactions(portfolios, portfolio_name)
    holdings = derive_holdings_from_transactions(transactions)
    stats = derive_portfolio_stats(transactions)
    monthly = defaultdict(lambda: {"buys": 0.0, "sells": 0.0, "fees": 0.0, "taxes": 0.0, "turnover": 0.0, "transactions": 0})
    platform_segment_heatmap = defaultdict(lambda: {"count": 0, "turnover": 0.0})
    fee_by_symbol = defaultdict(float)
    fee_by_platform = defaultdict(float)
    cost_ladders = defaultdict(list)
    cumulative_invested = 0.0
    cumulative_realized = 0.0
    monthly_realized = defaultdict(float)

    for txn in sorted((normalize_portfolio_transaction(row) for row in transactions), key=lambda row: (_as_string(row.get("tradeDate") or row.get("createdAt")), _as_string(row.get("id"))) if row else ("", "")):
        if not txn:
            continue
        month = _month_key(txn.get("tradeDate") or txn.get("createdAt"))
        turnover = _as_float(txn.get("quantity"), 0.0) * _as_float(txn.get("price"), 0.0)
        charges = _as_float(((txn.get("chargeSnapshot") or {}).get("totalCharges")), 0.0)
        month_row = monthly[month]
        month_row["turnover"] += turnover
        month_row["transactions"] += 1
        month_row["fees"] += charges
        if _as_string(txn.get("side")).upper() == "BUY":
            month_row["buys"] += turnover
            cumulative_invested += turnover + charges
            cost_ladders[txn["symbol"]].append(
                {
                    "tradeDate": _as_string(txn.get("tradeDate")),
                    "quantity": _as_float(txn.get("quantity"), 0.0),
                    "price": _as_float(txn.get("price"), 0.0),
                    "charges": round(charges, 2),
                }
            )
        elif _as_string(txn.get("side")).upper() == "SELL":
            month_row["sells"] += turnover
        elif _as_string(txn.get("side")).upper() == "TAX":
            month_row["taxes"] += turnover + charges
        heat_key = f"{month}|{_as_string(txn.get('platform')) or 'Unspecified'}|{_as_string(txn.get('segment')) or 'Other'}"
        platform_segment_heatmap[heat_key]["count"] += 1
        platform_segment_heatmap[heat_key]["turnover"] += turnover
        fee_by_symbol[_as_string(txn.get("symbol"))] += charges
        fee_by_platform[_as_string(txn.get("platform")) or "Unspecified"] += charges

    realized_events = derive_realized_events(transactions)
    for item in realized_events:
        monthly_realized[_month_key(item.get("tradeDate"))] += _as_float(item.get("pnl"), 0.0)

    cumulative_rows = []
    current_total = stats["current"]
    running_invested = 0.0
    for month in sorted(monthly.keys()):
        running_invested += monthly[month]["buys"]
        cumulative_realized += monthly_realized[month]
        cumulative_rows.append(
            {
                "month": month,
                "invested": round(running_invested, 2),
                "current": round(current_total, 2),
                "realized": round(cumulative_realized, 2),
                "fees": round(monthly[month]["fees"], 2),
            }
        )

    cost_ladder_rows = [
        {
            "symbol": symbol,
            "steps": [
                {
                    **step,
                    "runningAverage": round(
                        sum(item["quantity"] * item["price"] + item["charges"] for item in ladder[: idx + 1]) /
                        max(sum(item["quantity"] for item in ladder[: idx + 1]), 1e-9),
                        4,
                    ),
                }
                for idx, step in enumerate(ladder)
            ],
        }
        for symbol, ladder in cost_ladders.items()
    ]

    return {
        "portfolioName": resolved_name,
        "stats": stats,
        "realizedEvents": realized_events,
        "kpis": {
            "invested": stats["invested"],
            "current": stats["current"],
            "realizedPnl": stats["realizedPnl"],
            "unrealizedPnl": round(stats["grossPnl"] - stats["realizedPnl"], 2),
            "netAfterCosts": stats["netAfterCosts"],
            "totalFeesPaid": stats["totalChargesPaid"],
            "projectedExitCharges": stats["projectedExitCharges"],
        },
        "cumulativeSeries": cumulative_rows,
        "monthlyRollups": [
            {
                "month": month,
                "buys": round(values["buys"], 2),
                "sells": round(values["sells"], 2),
                "fees": round(values["fees"], 2),
                "taxes": round(values["taxes"], 2),
                "turnover": round(values["turnover"], 2),
                "transactions": values["transactions"],
            }
            for month, values in sorted(monthly.items())
        ],
        "costLadders": cost_ladder_rows,
        "feeDrainByHolding": [
            {"symbol": symbol, "fees": round(value, 2)}
            for symbol, value in sorted(fee_by_symbol.items(), key=lambda item: item[1], reverse=True)
        ],
        "feeDrainByPlatform": [
            {"platform": platform, "fees": round(value, 2)}
            for platform, value in sorted(fee_by_platform.items(), key=lambda item: item[1], reverse=True)
        ],
        "transactionHeatmap": [
            {
                "key": key,
                "month": key.split("|")[0],
                "platform": key.split("|")[1],
                "segment": key.split("|")[2],
                "count": values["count"],
                "turnover": round(values["turnover"], 2),
            }
            for key, values in sorted(platform_segment_heatmap.items())
        ],
    }


def derive_tax_summary(portfolios: dict | None, portfolio_name: str | None = None, financial_year: str | None = None) -> dict:
    normalized_portfolios = clean_portfolios(portfolios)
    resolved_name, transactions = _portfolio_transactions(normalized_portfolios, portfolio_name)
    stats = derive_portfolio_stats(transactions)
    holdings = derive_holdings_from_transactions(transactions)
    target_financial_year = financial_year or current_financial_year()
    realized_events = derive_realized_events(transactions)
    rows = [row for row in realized_events if row["financialYear"] == target_financial_year]
    holding_liabilities, liability_meta = _estimate_holding_lots_tax(transactions, holdings)

    bucket_rows = defaultdict(
        lambda: {
            "pnl": 0.0,
            "charges": 0.0,
            "quantity": 0.0,
            "events": 0,
            "taxProfile": "",
            "taxProfileLabel": "",
            "rateNote": "",
            "shortTermRatePct": 0.0,
            "longTermRatePct": 0.0,
            "estimatedTax": 0.0,
        }
    )
    realized_bucket_gains = defaultdict(float)
    for row in rows:
        bucket_key = f"{row['taxProfile']} {row['taxBucket']}"
        bucket_rows[bucket_key]["pnl"] += _as_float(row["pnl"], 0.0)
        bucket_rows[bucket_key]["charges"] += _as_float(row["charges"], 0.0)
        bucket_rows[bucket_key]["quantity"] += _as_float(row["quantity"], 0.0)
        bucket_rows[bucket_key]["events"] += 1
        bucket_rows[bucket_key]["taxProfile"] = row["taxProfile"]
        bucket_rows[bucket_key]["taxProfileLabel"] = row["taxProfileLabel"]
        bucket_rows[bucket_key]["rateNote"] = row.get("rateNote", "")
        bucket_rows[bucket_key]["shortTermRatePct"] = _as_float(row.get("shortTermRatePct"), 0.0)
        bucket_rows[bucket_key]["longTermRatePct"] = _as_float(row.get("longTermRatePct"), 0.0)
        realized_bucket_gains[_bucket_key(row["taxProfile"], row["taxBucket"])] += _as_float(row["pnl"], 0.0)

    equity_exemption_pool = _as_float(INDIA_TAX_RULES["listed_equity"].get("ltcg_exemption"), 0.0)
    realized_equity_like_ltcg = 0.0
    for profile_key, rule in INDIA_TAX_RULES.items():
        if _as_string(rule.get("exemption_group")) == "equity_like":
            realized_equity_like_ltcg += max(realized_bucket_gains.get(_bucket_key(profile_key, "LTCG"), 0.0), 0.0)
    realized_equity_exemption_used = min(realized_equity_like_ltcg, equity_exemption_pool)
    realized_tax = 0.0
    remaining_realized_exemption = realized_equity_exemption_used
    for profile_key, rule in INDIA_TAX_RULES.items():
        profile = {"key": profile_key, **rule}
        for tax_bucket in ("STCG", "LTCG"):
            bucket_gain = realized_bucket_gains.get(_bucket_key(profile_key, tax_bucket), 0.0)
            exemption = 0.0
            if profile.get("exemption_group") == "equity_like" and tax_bucket == "LTCG" and bucket_gain > 0 and remaining_realized_exemption > 0:
                exemption = min(bucket_gain, remaining_realized_exemption)
                remaining_realized_exemption -= exemption
            tax_value, _ = _estimate_bucket_tax(bucket_gain, profile, tax_bucket, exemption)
            realized_tax += tax_value
            bucket_row_key = f"{profile_key} {tax_bucket}"
            if bucket_row_key in bucket_rows:
                bucket_rows[bucket_row_key]["estimatedTax"] = round(tax_value, 2)

    remaining_equity_exemption = max(equity_exemption_pool - realized_equity_exemption_used, 0.0)
    positive_equity_ltcg_holdings = max(_as_float(liability_meta["totalPositiveEquityLtcg"], 0.0), 0.0)
    hold_exemption_total = min(remaining_equity_exemption, positive_equity_ltcg_holdings)
    sell_now_tax = 0.0
    for row in holding_liabilities:
        profile = classify_tax_profile(row)
        short_tax, _ = _estimate_bucket_tax(_as_float(row.get("shortTermGain"), 0.0), profile, "STCG", 0.0)
        long_exemption = 0.0
        if profile.get("exemption_group") == "equity_like" and positive_equity_ltcg_holdings > 0 and _as_float(row.get("equityLtcgPositiveGain"), 0.0) > 0:
            long_exemption = hold_exemption_total * (_as_float(row.get("equityLtcgPositiveGain"), 0.0) / positive_equity_ltcg_holdings)
        long_tax, exemption_used = _estimate_bucket_tax(_as_float(row.get("longTermGain"), 0.0), profile, "LTCG", long_exemption)
        row["equityExemptionUsed"] = round(exemption_used, 2)
        row["estimatedShortTermTax"] = round(short_tax, 2)
        row["estimatedLongTermTax"] = round(long_tax, 2)
        row["estimatedTaxLiability"] = round(short_tax + long_tax, 2)
        sell_now_tax += short_tax + long_tax

    per_portfolio_rows = []
    for name in normalized_portfolios.keys():
        if portfolio_name not in {None, "__all__"} and name != portfolio_name:
            continue
        nested = derive_tax_summary(normalized_portfolios, name, target_financial_year) if name != resolved_name else None
        summary = nested or {}
        if name == resolved_name:
            summary = {
                "currentYearRealizedTax": round(realized_tax, 2),
                "sellNowTaxLiability": round(sell_now_tax, 2),
                "netTaxLiabilityCurrentYear": round(realized_tax + sell_now_tax, 2),
                "sellAllExitEstimate": round(stats["projectedExitCharges"], 2),
            }
        per_portfolio_rows.append(
            {
                "portfolioName": name,
                "currentYearRealizedTax": round(_as_float(summary.get("currentYearRealizedTax"), 0.0), 2),
                "sellNowTaxLiability": round(_as_float(summary.get("sellNowTaxLiability"), 0.0), 2),
                "netTaxLiabilityCurrentYear": round(_as_float(summary.get("netTaxLiabilityCurrentYear"), 0.0), 2),
                "sellAllExitEstimate": round(_as_float(summary.get("sellAllExitEstimate"), 0.0), 2),
            }
        )
        if portfolio_name not in {None, "__all__"}:
            break

    return {
        "portfolioName": resolved_name,
        "financialYear": target_financial_year,
        "sellAllExitEstimate": round(stats["projectedExitCharges"], 2),
        "estimatedFeeBurden": round(stats["totalChargesPaid"], 2),
        "currentYearRealizedTax": round(realized_tax, 2),
        "sellNowTaxLiability": round(sell_now_tax, 2),
        "netTaxLiabilityCurrentYear": round(realized_tax + sell_now_tax, 2),
        "equityLtcgExemptionUsed": round(realized_equity_exemption_used + hold_exemption_total, 2),
        "equityLtcgExemptionRemaining": round(max(remaining_equity_exemption - hold_exemption_total, 0.0), 2),
        "buckets": [
            {
                "taxBucket": bucket,
                "taxProfile": values["taxProfile"],
                "taxProfileLabel": values["taxProfileLabel"],
                "rateNote": values["rateNote"],
                "shortTermRatePct": round(values["shortTermRatePct"], 2),
                "longTermRatePct": round(values["longTermRatePct"], 2),
                "estimatedTax": round(values["estimatedTax"], 2),
                "pnl": round(values["pnl"], 2),
                "charges": round(values["charges"], 2),
                "quantity": round(values["quantity"], 6),
                "events": values["events"],
            }
            for bucket, values in bucket_rows.items()
        ],
        "realizedEvents": rows,
        "holdingLiabilities": sorted(holding_liabilities, key=lambda row: row["estimatedTaxLiability"], reverse=True),
        "perPortfolio": sorted(per_portfolio_rows, key=lambda row: row["netTaxLiabilityCurrentYear"], reverse=True),
        "assumptions": [
            "Estimated India capital-gains view for current financial year plus sell-now holdings exposure.",
            "Listed equity and equity-oriented mutual funds share a 1.25L LTCG exemption pool in this estimate.",
            "Debt mutual funds use a slab-style 30% proxy in this pass.",
            "Bonds, gold / commodity holdings, real assets, and fallback capital holdings use simplified India estimate rules.",
            "Crypto is treated with a 30% VDA-style estimate.",
            "Futures, options, intraday, and FX are not modeled as business-income treatment in this pass.",
        ],
    }


def derive_fee_summary(portfolios: dict | None, portfolio_name: str | None = None) -> dict:
    resolved_name, transactions = _portfolio_transactions(portfolios, portfolio_name)
    by_line = defaultdict(float)
    by_platform = defaultdict(float)
    for txn in (normalize_portfolio_transaction(row) for row in transactions):
        if not txn:
            continue
        platform = _as_string(txn.get("platform")) or "Unspecified"
        charge_snapshot = txn.get("chargeSnapshot") or {}
        by_platform[platform] += _as_float(charge_snapshot.get("totalCharges"), 0.0)
        for line in charge_snapshot.get("lines") or []:
            by_line[_as_string(line.get("label")) or _as_string(line.get("key"))] += _as_float(line.get("amount"), 0.0)
    return {
        "portfolioName": resolved_name,
        "lines": [
            {"label": label, "amount": round(amount, 2)}
            for label, amount in sorted(by_line.items(), key=lambda item: item[1], reverse=True)
        ],
        "platforms": [
            {"platform": platform, "amount": round(amount, 2)}
            for platform, amount in sorted(by_platform.items(), key=lambda item: item[1], reverse=True)
        ],
    }


def build_portfolio_copilot_context(portfolios: dict | None, portfolio_name: str | None = None) -> dict:
    analytics = derive_portfolio_analytics(portfolios, portfolio_name)
    tax_summary = derive_tax_summary(portfolios, portfolio_name)
    fee_summary = derive_fee_summary(portfolios, portfolio_name)
    kpis = analytics["kpis"]
    fee_hogs = analytics["feeDrainByHolding"][:3]
    anomalies = []
    if fee_hogs:
        fee_summary_text = ", ".join(f"{row['symbol']} ({row['fees']:.2f})" for row in fee_hogs)
        anomalies.append(f"Highest fee drag: {fee_summary_text}.")
    if kpis["realizedPnl"] < 0:
        anomalies.append(f"Realized P/L is negative at {kpis['realizedPnl']:.2f}.")
    if analytics["stats"]["projectedExitCharges"] > 0:
        anomalies.append(f"Projected exit charges are {analytics['stats']['projectedExitCharges']:.2f}.")
    context_lines = [
        f"Portfolio: {analytics['portfolioName']}",
        f"Invested: {kpis['invested']:.2f}",
        f"Current: {kpis['current']:.2f}",
        f"Realized P/L: {kpis['realizedPnl']:.2f}",
        f"Unrealized P/L: {kpis['unrealizedPnl']:.2f}",
        f"Net after costs: {kpis['netAfterCosts']:.2f}",
        f"Total fees paid: {kpis['totalFeesPaid']:.2f}",
        f"Projected exit charges: {kpis['projectedExitCharges']:.2f}",
        f"Current-year realized tax estimate: {tax_summary['currentYearRealizedTax']:.2f}",
        f"Sell-now tax liability: {tax_summary['sellNowTaxLiability']:.2f}",
        f"Net current-year tax liability: {tax_summary['netTaxLiabilityCurrentYear']:.2f}",
        "Top fee lines:",
        *[f"- {row['label']}: {row['amount']:.2f}" for row in fee_summary["lines"][:5]],
        "Tax buckets:",
        *[f"- {row['taxBucket']}: {row['pnl']:.2f} across {row['events']} events" for row in tax_summary["buckets"]],
        "Anomalies:",
        *([f"- {item}" for item in anomalies] if anomalies else ["- No major anomalies detected."]),
    ]
    return {
        "portfolioName": analytics["portfolioName"],
        "context": "\n".join(context_lines),
        "anomalies": anomalies,
        "analytics": analytics,
        "taxSummary": tax_summary,
        "feeSummary": fee_summary,
    }
