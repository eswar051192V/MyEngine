const CUSTOM_WATCHLISTS_KEY = 'qe_custom_watchlists_v1';
const PORTFOLIOS_KEY = 'qe_portfolios_v2';
const LEGACY_PORTFOLIO_KEY = 'qe_portfolio_positions_v1';
const PORTFOLIO_SNAPSHOTS_KEY = 'qe_portfolio_snapshots_v1';
const SEGMENT_CHOICES = [
    'Equity',
    'ETF',
    'Index',
    'Mutual Fund',
    'Bond',
    'Fixed Income',
    'Commodity',
    'Gold',
    'Silver',
    'Platinum',
    'Copper',
    'FX',
    'Crypto',
    'Cash',
    'Real Estate',
    'Real Estate - Land',
    'Real Estate - Residential',
    'Real Estate - Rental',
    'Private Asset',
    'Insurance / Pension',
    'Other',
];
const PURCHASE_TYPE_CHOICES = ['Delivery', 'Intraday', 'Futures', 'Options', 'ETF', 'Mutual Fund', 'Crypto', 'FX', 'Commodity'];
const API_BASE = process.env.REACT_APP_API_BASE || 'http://127.0.0.1:8000';
const THEME_KEY = 'qe_theme_v1';
/** light = traditional dashboard; dark = midnight; ocean = cool slate; sand = warm paper */
const THEME_OPTIONS = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Midnight' },
    { id: 'ocean', label: 'Ocean' },
    { id: 'sand', label: 'Sand' },
];
const THEME_IDS = new Set(THEME_OPTIONS.map((t) => t.id));
const chartUsesLightPalette = (t) => t === 'light' || t === 'sand';
const FORK_SCAN_STORAGE_KEY = 'qe_fork_scan_results_v1';
const LOCAL_LLM_CONFIG_KEY = 'qe_local_llm_config_v1';
const WATCHLIST_LABS_KEY = 'qe_watchlist_labs_v1';
const WATCHLIST_CRON_KEY = 'qe_watchlist_cron_v1';
const MACRO_LAB_CONFIG_KEY = 'qe_macro_lab_config_v1';
const MACRO_LAB_NOTES_KEY = 'qe_macro_lab_notes_v1';
const PORTFOLIO_PROMPT_LIBRARY_KEY = 'qe_portfolio_prompt_library_v1';
const PORTFOLIO_PROMPT_HISTORY_KEY = 'qe_portfolio_prompt_history_v1';
const PORTFOLIO_JOURNAL_KEY = 'qe_portfolio_journal_v1';
const DEFAULT_PORTFOLIOS = { Main: [] };
const TRANSACTION_SIDE_CHOICES = ['BUY', 'SELL', 'DIVIDEND', 'FEE', 'TAX', 'ADJUSTMENT'];
const ADJUSTMENT_SUBTYPE_CHOICES = ['Manual', 'Split', 'Bonus', 'Merger'];
const DEFAULT_PORTFOLIO_FORM = {
    side: 'BUY',
    transactionSubtype: '',
    assetName: '',
    symbol: '',
    description: '',
    notes: '',
    purchaseType: 'Delivery',
    tradeDate: '',
    price: '',
    quantity: '',
    platform: '',
    country: '',
    state: '',
    segment: 'Equity',
    brokerReference: '',
    manualCharge: '',
    manualTax: '',
};

const REGION_TO_COUNTRY = {
    us: 'United States',
    usa: 'United States',
    india: 'India',
    uk: 'United Kingdom',
    europe: 'Europe',
    japan: 'Japan',
    asia: 'Asia',
    australia: 'Australia',
    canada: 'Canada',
    china: 'China',
    singapore: 'Singapore',
    hongkong: 'Hong Kong',
    'hong kong': 'Hong Kong',
    global: 'Global',
};

export {
  CUSTOM_WATCHLISTS_KEY,
  PORTFOLIOS_KEY,
  LEGACY_PORTFOLIO_KEY,
  PORTFOLIO_SNAPSHOTS_KEY,
  SEGMENT_CHOICES,
  PURCHASE_TYPE_CHOICES,
  API_BASE,
  THEME_KEY,
  THEME_OPTIONS,
  THEME_IDS,
  chartUsesLightPalette,
  FORK_SCAN_STORAGE_KEY,
  LOCAL_LLM_CONFIG_KEY,
  WATCHLIST_LABS_KEY,
  WATCHLIST_CRON_KEY,
  MACRO_LAB_CONFIG_KEY,
  MACRO_LAB_NOTES_KEY,
  PORTFOLIO_PROMPT_LIBRARY_KEY,
  PORTFOLIO_PROMPT_HISTORY_KEY,
  PORTFOLIO_JOURNAL_KEY,
  DEFAULT_PORTFOLIOS,
  TRANSACTION_SIDE_CHOICES,
  ADJUSTMENT_SUBTYPE_CHOICES,
  DEFAULT_PORTFOLIO_FORM,
  REGION_TO_COUNTRY,
};
