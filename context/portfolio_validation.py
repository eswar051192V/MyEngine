from __future__ import annotations

from context.portfolio_reports import (
    build_portfolio_copilot_context,
    derive_fee_summary,
    derive_portfolio_analytics,
    derive_tax_summary,
)


SAMPLE_PORTFOLIOS = {
    "Validation": [
        {
            "id": "buy_1",
            "entryType": "transaction",
            "side": "BUY",
            "symbol": "INFY",
            "assetName": "Infosys",
            "purchaseType": "Delivery",
            "segment": "Equity",
            "tradeDate": "2024-01-10",
            "platform": "Zerodha",
            "country": "India",
            "quantity": 10,
            "price": 1500,
            "currentPrice": 1680,
            "manualCharge": 0,
            "manualTax": 0,
        },
        {
            "id": "buy_2",
            "entryType": "transaction",
            "side": "BUY",
            "symbol": "INFY",
            "assetName": "Infosys",
            "purchaseType": "Delivery",
            "segment": "Equity",
            "tradeDate": "2024-08-01",
            "platform": "Zerodha",
            "country": "India",
            "quantity": 5,
            "price": 1620,
            "currentPrice": 1680,
        },
        {
            "id": "sell_1",
            "entryType": "transaction",
            "side": "SELL",
            "symbol": "INFY",
            "assetName": "Infosys",
            "purchaseType": "Delivery",
            "segment": "Equity",
            "tradeDate": "2025-02-10",
            "platform": "Zerodha",
            "country": "India",
            "quantity": 4,
            "price": 1700,
            "currentPrice": 1680,
        },
        {
            "id": "div_1",
            "entryType": "transaction",
            "side": "DIVIDEND",
            "symbol": "INFY",
            "assetName": "Infosys",
            "purchaseType": "Delivery",
            "segment": "Equity",
            "tradeDate": "2025-03-01",
            "platform": "Zerodha",
            "country": "India",
            "quantity": 1,
            "price": 220,
            "currentPrice": 1680,
        },
        {
            "id": "fee_1",
            "entryType": "transaction",
            "side": "FEE",
            "symbol": "INFY",
            "assetName": "Infosys",
            "purchaseType": "Delivery",
            "segment": "Equity",
            "tradeDate": "2025-03-02",
            "platform": "Zerodha",
            "country": "India",
            "quantity": 1,
            "price": 25,
            "currentPrice": 1680,
            "manualCharge": 25,
        },
        {
            "id": "split_1",
            "entryType": "transaction",
            "side": "ADJUSTMENT",
            "transactionSubtype": "Split",
            "symbol": "INFY",
            "assetName": "Infosys",
            "purchaseType": "Delivery",
            "segment": "Equity",
            "tradeDate": "2025-03-05",
            "platform": "Zerodha",
            "country": "India",
            "quantity": 1,
            "price": 0,
            "currentPrice": 1680,
        },
        {
            "id": "mf_buy_1",
            "entryType": "transaction",
            "side": "BUY",
            "symbol": "EQMF1",
            "assetName": "Large Cap Equity Fund",
            "description": "Equity fund direct growth",
            "purchaseType": "Mutual Fund",
            "segment": "Mutual Fund",
            "tradeDate": "2023-05-10",
            "platform": "Groww",
            "country": "India",
            "quantity": 100,
            "price": 120,
            "currentPrice": 154,
        },
        {
            "id": "debt_buy_1",
            "entryType": "transaction",
            "side": "BUY",
            "symbol": "DEBT1",
            "assetName": "Corporate Bond Fund",
            "description": "Debt fund direct growth",
            "purchaseType": "Mutual Fund",
            "segment": "Mutual Fund",
            "tradeDate": "2023-06-15",
            "platform": "Coin",
            "country": "India",
            "quantity": 80,
            "price": 100,
            "currentPrice": 112,
        },
        {
            "id": "gold_buy_1",
            "entryType": "transaction",
            "side": "BUY",
            "symbol": "GOLDBEES",
            "assetName": "Gold ETF",
            "purchaseType": "ETF",
            "segment": "ETF",
            "tradeDate": "2023-07-01",
            "platform": "Zerodha",
            "country": "India",
            "quantity": 20,
            "price": 50,
            "currentPrice": 62,
        },
        {
            "id": "bond_buy_1",
            "entryType": "transaction",
            "side": "BUY",
            "symbol": "BHARATBOND",
            "assetName": "Bharat Bond ETF",
            "purchaseType": "ETF",
            "segment": "ETF",
            "tradeDate": "2023-07-20",
            "platform": "Zerodha",
            "country": "India",
            "quantity": 40,
            "price": 80,
            "currentPrice": 91,
        },
    ],
    "Satellite": [
        {
            "id": "btc_buy_1",
            "entryType": "transaction",
            "side": "BUY",
            "symbol": "BTC",
            "assetName": "Bitcoin",
            "purchaseType": "Crypto",
            "segment": "Crypto",
            "tradeDate": "2024-09-01",
            "platform": "Binance",
            "country": "India",
            "quantity": 0.25,
            "price": 5000000,
            "currentPrice": 6200000,
        },
        {
            "id": "real_buy_1",
            "entryType": "transaction",
            "side": "BUY",
            "symbol": "PROP1",
            "assetName": "Private property SPV",
            "description": "Real estate co-investment",
            "purchaseType": "Delivery",
            "segment": "Real Estate",
            "tradeDate": "2022-04-01",
            "platform": "Offline",
            "country": "India",
            "quantity": 1,
            "price": 1000000,
            "currentPrice": 1180000,
        },
    ],
}


def run_validation_suite() -> dict:
    analytics = derive_portfolio_analytics(SAMPLE_PORTFOLIOS, "Validation")
    tax_summary = derive_tax_summary(SAMPLE_PORTFOLIOS, "Validation", "FY2024-25")
    tax_summary_all = derive_tax_summary(SAMPLE_PORTFOLIOS, "__all__", "FY2024-25")
    fee_summary = derive_fee_summary(SAMPLE_PORTFOLIOS, "Validation")
    copilot_context = build_portfolio_copilot_context(SAMPLE_PORTFOLIOS, "Validation")

    assert analytics["portfolioName"] == "Validation"
    assert analytics["stats"]["holdings"] >= 5
    assert analytics["stats"]["current"] > 0
    assert analytics["kpis"]["realizedPnl"] != 0
    assert analytics["costLadders"], "Expected cost ladder rows"
    assert analytics["transactionHeatmap"], "Expected heatmap rows"
    assert any("LTCG" in row["taxBucket"] or "STCG" in row["taxBucket"] for row in tax_summary["buckets"] or [])
    assert tax_summary["sellAllExitEstimate"] >= 0
    assert tax_summary["sellNowTaxLiability"] >= 0
    assert tax_summary["netTaxLiabilityCurrentYear"] >= tax_summary["currentYearRealizedTax"]
    assert tax_summary["holdingLiabilities"], "Expected holding liability rows"
    tax_profiles = {row["taxProfile"] for row in tax_summary["holdingLiabilities"]}
    assert "listed_equity" in tax_profiles
    assert "equity_mutual_fund" in tax_profiles
    assert "debt_mutual_fund" in tax_profiles
    assert "gold_commodity" in tax_profiles or "bonds_fixed_income" in tax_profiles
    assert tax_summary_all["perPortfolio"], "Expected combined per-portfolio rows"
    all_tax_profiles = {row["taxProfile"] for row in tax_summary_all["holdingLiabilities"]}
    assert "crypto" in all_tax_profiles
    assert "real_asset" in all_tax_profiles
    assert fee_summary["platforms"], "Expected platform fee rows"
    assert "Portfolio:" in copilot_context["context"]

    return {
        "ok": True,
        "analyticsKpis": analytics["kpis"],
        "taxBuckets": tax_summary["buckets"],
        "holdingProfiles": sorted(tax_profiles),
        "feePlatforms": fee_summary["platforms"],
        "anomalies": copilot_context["anomalies"],
    }


if __name__ == "__main__":
    print(run_validation_suite())
