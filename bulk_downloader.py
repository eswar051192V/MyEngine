import os
import time
from tqdm import tqdm

import market_download as md

# Configuration
# Set BULK_DOWNLOAD_LIMIT to a positive number for a small dry run.
TEST_LIMIT = int(os.environ.get("BULK_DOWNLOAD_LIMIT", "0") or "0") or None


def main():
    md.setup_directories()
    data = md.load_tickers()
    if not data:
        print(f"❌ Error: {md.TICKERS_JSON} not found or empty. Run fetch_all_tickers.py first.")
        return

    symbols = md.all_symbols_flat()
    if not symbols:
        return

    if TEST_LIMIT:
        print(f"⚠️ TEST MODE ACTIVE: Only downloading the first {TEST_LIMIT} tickers.")
        symbols = symbols[:TEST_LIMIT]

    print(f"🚀 Starting bulk download for {len(symbols)} tickers...")
    print(f"📁 Data → {os.path.abspath(md.DATA_DIR)} (Parquet)")

    successful = 0
    failed = 0

    for symbol in tqdm(symbols, desc="Downloading Market Data"):
        if md.download_ticker_data(symbol):
            successful += 1
        else:
            failed += 1
        time.sleep(1.5)

    print("\n✅ Bulk Download Complete!")
    print(f"📈 Successfully downloaded: {successful}")
    print(f"❌ Failed/No Data: {failed}")


if __name__ == "__main__":
    main()
