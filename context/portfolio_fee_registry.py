from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path


REGISTRY_PATH = Path(__file__).resolve().parent.parent / "context_data" / "portfolio" / "india_fee_registry.json"


def _as_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


@lru_cache(maxsize=1)
def load_fee_registry() -> dict:
    with REGISTRY_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def get_fee_registry_summary() -> dict:
    registry = load_fee_registry()
    platforms = registry.get("platforms") or {}
    return {
        "version": registry.get("version"),
        "country": registry.get("country", "India"),
        "updatedAt": registry.get("updatedAt"),
        "currency": registry.get("currency", "INR"),
        "countryOptions": registry.get("countryOptions") or ["India"],
        "stateOptions": registry.get("stateOptions") or [],
        "stampDutyMeta": registry.get("stampDutyMeta") or {},
        "segmentMappings": registry.get("segmentMappings") or {},
        "segmentLabels": registry.get("segmentLabels") or {},
        "defaultPlatformId": registry.get("defaultPlatformId"),
        "platforms": [
            {
                "id": platform_id,
                "label": row.get("label", platform_id),
                "aliases": row.get("aliases") or [],
                "sourceTitle": row.get("sourceTitle", ""),
                "sourceUrl": row.get("sourceUrl", ""),
                "exactness": row.get("exactness", "template_estimate"),
            }
            for platform_id, row in platforms.items()
        ],
    }


def resolve_platform_id(platform: str | None) -> str:
    registry = load_fee_registry()
    raw = str(platform or "").strip().lower()
    platforms = registry.get("platforms") or {}
    if not raw:
        return str(registry.get("defaultPlatformId") or next(iter(platforms.keys()), ""))
    for platform_id, row in platforms.items():
        names = [platform_id, row.get("label", ""), *(row.get("aliases") or [])]
        if raw in {str(name).strip().lower() for name in names if str(name).strip()}:
            return platform_id
    return str(registry.get("defaultPlatformId") or next(iter(platforms.keys()), ""))


def resolve_segment_key(purchase_type: str | None = None, segment: str | None = None) -> str:
    registry = load_fee_registry()
    mappings = registry.get("segmentMappings") or {}
    purchase = str(purchase_type or "").strip()
    if purchase in mappings:
        return mappings[purchase]
    normalized_segment = str(segment or "").strip().lower()
    if normalized_segment == "etf":
        return "etf_delivery"
    if normalized_segment == "mutual fund":
        return "mutual_fund"
    if normalized_segment == "commodity":
        return "commodity_futures"
    if normalized_segment == "fx":
        return "currency"
    return "equity_delivery"


def resolve_stamp_duty_rate(segment_key: str, state: str | None, default_rate: float) -> float:
    registry = load_fee_registry()
    overrides = registry.get("stateStampDutyOverrides") or {}
    state_key = str(state or "").strip()
    if not state_key:
        return default_rate
    state_row = overrides.get(state_key) or overrides.get(state_key.lower()) or {}
    rate = ((state_row.get(segment_key) or {}).get("stampDutyRate")) if isinstance(state_row, dict) else None
    return _as_float(rate, default_rate) if rate is not None else default_rate


def _evaluate_rule(rule: dict | None, turnover: float) -> float:
    row = rule if isinstance(rule, dict) else {}
    kind = str(row.get("kind") or "flat").strip()
    amount = _as_float(row.get("amount"), 0.0)
    rate = _as_float(row.get("rate"), 0.0)
    cap = row.get("cap")
    min_amount = row.get("min")
    if kind == "flat":
        return amount
    if kind == "percentage":
        return turnover * rate
    if kind == "capped_percentage":
        cap_value = _as_float(cap, 0.0)
        return min(turnover * rate, cap_value) if cap_value > 0 else turnover * rate
    if kind == "cap_min_percentage":
        fee = turnover * rate
        if min_amount is not None:
            fee = max(fee, _as_float(min_amount, 0.0))
        if cap is not None:
            fee = min(fee, _as_float(cap, fee))
        return fee
    return amount


def estimate_transaction_charges(payload: dict | None) -> dict:
    data = payload if isinstance(payload, dict) else {}
    registry = load_fee_registry()
    quantity = max(_as_float(data.get("quantity"), 0.0), 0.0)
    price = max(_as_float(data.get("price"), 0.0), 0.0)
    turnover = quantity * price
    side = str(data.get("side") or "BUY").strip().lower()
    purchase_type = str(data.get("purchaseType") or "Delivery").strip()
    segment = str(data.get("segment") or "Equity").strip()
    state = str(data.get("state") or "").strip()
    segment_key = resolve_segment_key(purchase_type, segment)
    platform_id = resolve_platform_id(data.get("platform"))
    platform_row = (registry.get("platforms") or {}).get(platform_id) or {}
    segment_rules = (registry.get("statutoryCharges") or {}).get(segment_key) or {}
    statutory_side_rules = segment_rules.get(side) or []
    brokerage_rule = ((platform_row.get("brokerage") or {}).get(segment_key) or {}).get(side) or {}
    brokerage = _evaluate_rule(brokerage_rule, turnover)

    lines = []
    totals_by_key: dict[str, float] = {
        "brokerage": brokerage,
        "other_charge": max(_as_float(data.get("manualCharge"), 0.0), 0.0),
    }
    if brokerage > 0:
        lines.append({"key": "brokerage", "label": "Brokerage", "amount": round(brokerage, 2)})

    dp_rule = ((platform_row.get("dpCharges") or {}).get(segment_key) or {}).get(side) or {}
    dp_charge = _evaluate_rule(dp_rule, turnover)
    if dp_charge > 0:
        totals_by_key["dp_charge"] = dp_charge
        lines.append({"key": "dp_charge", "label": "DP Charge", "amount": round(dp_charge, 2)})

    for rule in statutory_side_rules:
        rule_copy = dict(rule)
        if str(rule_copy.get("key") or "") == "stamp_duty":
            rule_copy["rate"] = resolve_stamp_duty_rate(segment_key, state, _as_float(rule_copy.get("rate"), 0.0))
        amount = _evaluate_rule(rule_copy, turnover)
        key = str(rule_copy.get("key") or "charge")
        totals_by_key[key] = totals_by_key.get(key, 0.0) + amount
        if amount > 0:
            lines.append({"key": key, "label": str(rule_copy.get("label") or key), "amount": round(amount, 2)})

    gst_meta = segment_rules.get("gst") or {}
    gst_rate = _as_float(gst_meta.get("rate"), 0.0)
    gst_basis = sum(totals_by_key.get(key, 0.0) for key in (gst_meta.get("appliesTo") or []))
    gst = gst_basis * gst_rate
    if gst > 0:
        totals_by_key["gst"] = gst
        lines.append({"key": "gst", "label": "GST", "amount": round(gst, 2)})

    manual_tax = max(_as_float(data.get("manualTax"), 0.0), 0.0)
    if manual_tax > 0:
        totals_by_key["manual_tax"] = manual_tax
        lines.append({"key": "manual_tax", "label": "Manual Tax", "amount": round(manual_tax, 2)})

    if totals_by_key.get("other_charge", 0.0) > 0:
        lines.append({"key": "other_charge", "label": "Other Charges", "amount": round(totals_by_key["other_charge"], 2)})

    total = sum(totals_by_key.values())
    return {
        "country": registry.get("country", "India"),
        "state": state,
        "currency": registry.get("currency", "INR"),
        "platformId": platform_id,
        "platformLabel": platform_row.get("label", platform_id),
        "segmentKey": segment_key,
        "segmentLabel": (registry.get("segmentLabels") or {}).get(segment_key, segment_key),
        "side": side.upper(),
        "quantity": quantity,
        "price": price,
        "turnover": round(turnover, 2),
        "lines": lines,
        "totals": {key: round(value, 2) for key, value in totals_by_key.items() if value > 0},
        "totalCharges": round(total, 2),
        "sourceTitle": platform_row.get("sourceTitle", ""),
        "sourceUrl": platform_row.get("sourceUrl", ""),
        "exactness": platform_row.get("exactness", "template_estimate"),
        "registryVersion": registry.get("version"),
        "stampDutyNote": ((registry.get("stampDutyMeta") or {}).get("note") or ""),
    }
