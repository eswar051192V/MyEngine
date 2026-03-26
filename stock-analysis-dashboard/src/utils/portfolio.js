import {
  buildPortfolioSnapshot as ledgerBuildPortfolioSnapshot,
  deriveHoldingsFromTransactions as ledgerDeriveHoldingsFromTransactions,
  getPortfolioStats as ledgerGetPortfolioStats,
  normalizeLegacyPortfolioRows as ledgerNormalizeLegacyPortfolioRows,
  normalizePortfolioMap as ledgerNormalizePortfolioMap,
  normalizePortfolioSnapshots as ledgerNormalizePortfolioSnapshots,
  normalizePortfolioTransaction as ledgerNormalizePortfolioTransaction,
} from '../portfolioLedger';
import { DEFAULT_PORTFOLIOS, PURCHASE_TYPE_CHOICES, REGION_TO_COUNTRY, SEGMENT_CHOICES } from './constants';

const normalizePortfolioSegment = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return 'Equity';
    const lower = raw.toLowerCase();
    if (lower === 'stock' || lower === 'stocks' || lower === 'equities') return 'Equity';
    if (lower === 'etf') return 'ETF';
    if (lower === 'index' || lower === 'indices') return 'Index';
    if (lower === 'mutual fund' || lower === 'mutualfund') return 'Mutual Fund';
    if (lower === 'bond') return 'Bond';
    if (lower === 'fixed income' || lower === 'fixedincome') return 'Fixed Income';
    if (lower === 'commodity' || lower === 'commodities') return 'Commodity';
    if (lower === 'gold' || lower === 'bullion' || lower === 'xau') return 'Gold';
    if (lower === 'silver' || lower === 'xag') return 'Silver';
    if (lower === 'platinum' || lower === 'xpt') return 'Platinum';
    if (lower === 'copper' || lower === 'cooper') return 'Copper';
    if (lower === 'precious metals' || lower === 'preciousmetals') return 'Commodity';
    if (lower === 'fx' || lower === 'forex') return 'FX';
    if (lower === 'crypto' || lower === 'cryptocurrency') return 'Crypto';
    if (lower === 'cash') return 'Cash';
    if (lower === 'real estate' || lower === 'realestate') return 'Real Estate';
    if (lower === 'real estate - land' || lower === 'land' || lower === 'plot') return 'Real Estate - Land';
    if (lower === 'real estate - residential' || lower === 'residential' || lower === 'house' || lower === 'houses' || lower === 'home') {
        return 'Real Estate - Residential';
    }
    if (lower === 'real estate - rental' || lower === 'rental' || lower === 'rentals' || lower === 'rental property' || lower === 'rental income') {
        return 'Real Estate - Rental';
    }
    if (lower.startsWith('real estate')) {
        if (lower.includes('land')) return 'Real Estate - Land';
        if (lower.includes('rental') || lower.includes('rent')) return 'Real Estate - Rental';
        if (lower.includes('residential') || lower.includes('house')) return 'Real Estate - Residential';
    }
    if (lower === 'private asset' || lower === 'privateasset') return 'Private Asset';
    if (lower === 'insurance / pension' || lower === 'insurance' || lower === 'pension') return 'Insurance / Pension';
    if (lower === 'other') return 'Other';
    return SEGMENT_CHOICES.includes(raw) ? raw : 'Equity';
};

const derivePurchaseTypeForSegment = (segment) => {
    const normalized = normalizePortfolioSegment(segment);
    if (PURCHASE_TYPE_CHOICES.includes(normalized)) return normalized;
    if (normalized === 'Index') return 'Delivery';
    if (normalized === 'Bond' || normalized === 'Fixed Income') return 'Delivery';
    if (
        normalized === 'Cash' ||
        normalized === 'Real Estate' ||
        normalized === 'Private Asset' ||
        normalized === 'Insurance / Pension' ||
        normalized === 'Other' ||
        normalized === 'Gold' ||
        normalized === 'Silver' ||
        normalized === 'Platinum' ||
        normalized === 'Copper' ||
        normalized === 'Real Estate - Land' ||
        normalized === 'Real Estate - Residential' ||
        normalized === 'Real Estate - Rental'
    ) {
        return 'Delivery';
    }
    return 'Delivery';
};

const deriveCountryFromInstrument = (row) => {
    const region = String(row?.region || '').trim().toLowerCase();
    if (REGION_TO_COUNTRY[region]) return REGION_TO_COUNTRY[region];
    const exchange = String(row?.exchange || '').trim().toLowerCase();
    if (exchange.includes('nse') || exchange.includes('bse') || exchange.includes('india')) return 'India';
    if (exchange.includes('nasdaq') || exchange.includes('nyse') || exchange.includes('amex') || exchange.includes('arca')) return 'United States';
    if (exchange.includes('lse')) return 'United Kingdom';
    if (exchange.includes('tsx')) return 'Canada';
    if (exchange.includes('asx')) return 'Australia';
    if (exchange.includes('hkex') || exchange.includes('hong kong')) return 'Hong Kong';
    if (exchange.includes('sgx')) return 'Singapore';
    return '';
};

const deriveCountryFromSegment = (segment, fallbackSymbol = '') => {
    const normalized = normalizePortfolioSegment(segment);
    const sym = String(fallbackSymbol || '').toUpperCase();
    if (sym.endsWith('.NS') || sym.endsWith('.BO')) return 'India';
    if (normalized === 'Cash' || normalized === 'Other') return '';
    if (normalized === 'Mutual Fund' || normalized === 'Bond' || normalized === 'Fixed Income' || normalized === 'Insurance / Pension') return 'India';
    if (
        normalized === 'Real Estate' ||
        normalized === 'Real Estate - Land' ||
        normalized === 'Real Estate - Residential' ||
        normalized === 'Real Estate - Rental' ||
        normalized === 'Private Asset'
    ) {
        return 'Global';
    }
    return '';
};

const normalizePortfolioMap = (input) => {
    const next = ledgerNormalizePortfolioMap(input);
    return Object.keys(next).length ? next : { ...DEFAULT_PORTFOLIOS };
};

const normalizeLegacyPortfolioRows = (rows) => ledgerNormalizeLegacyPortfolioRows(rows);

const getPortfolioStats = (positions, transactions = []) => {
    const rows = Array.isArray(positions) ? positions : [];
    const looksLikeTransactions = rows.some((row) => row && typeof row === 'object' && (row.entryType || row.side || row.transactionType));
    if (looksLikeTransactions) {
        const holdings = ledgerDeriveHoldingsFromTransactions(rows);
        return ledgerGetPortfolioStats(holdings, rows);
    }
    return ledgerGetPortfolioStats(positions, transactions);
};

const normalizePortfolioSnapshots = (raw) => ledgerNormalizePortfolioSnapshots(raw);

const buildPortfolioSnapshot = (portfolioMap, capturedAt = new Date().toISOString()) => ledgerBuildPortfolioSnapshot(portfolioMap, capturedAt);

const buildForkLink = (symbol) => {
    const base = `${window.location.origin}${window.location.pathname}`;
    const p = new URLSearchParams({
        module: 'analysis',
        symbol: String(symbol || '').toUpperCase(),
        fork: '1',
    });
    return `${base}?${p.toString()}`;
};

const downloadTextFile = (filename, text, mimeType = 'text/plain;charset=utf-8') => {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};

const rowsToCsv = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return '';
    const keys = Array.from(new Set(list.flatMap((row) => Object.keys(row || {}))));
    const escape = (value) => {
        const text = String(value ?? '');
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [keys.join(','), ...list.map((row) => keys.map((key) => escape(row?.[key])).join(','))].join('\n');
};


export {
  normalizePortfolioSegment,
  derivePurchaseTypeForSegment,
  deriveCountryFromInstrument,
  deriveCountryFromSegment,
  normalizePortfolioMap,
  normalizeLegacyPortfolioRows,
  getPortfolioStats,
  normalizePortfolioSnapshots,
  buildPortfolioSnapshot,
  buildForkLink,
  downloadTextFile,
  rowsToCsv,
  ledgerDeriveHoldingsFromTransactions,
  ledgerNormalizePortfolioTransaction,
};
