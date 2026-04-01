const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));

const asString = (value, fallback = '') => (value == null ? fallback : String(value).trim());
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const resolveSegmentKey = (purchaseType = '', segment = '') => {
  const purchase = asString(purchaseType);
  if (purchase === 'Delivery') return 'equity_delivery';
  if (purchase === 'Intraday') return 'equity_intraday';
  if (purchase === 'Futures') return 'futures';
  if (purchase === 'Options') return 'options';
  if (purchase === 'ETF') return 'etf_delivery';
  if (purchase === 'Mutual Fund') return 'mutual_fund';
  const normalizedSegment = asString(segment).toLowerCase();
  if (normalizedSegment === 'etf') return 'etf_delivery';
  if (normalizedSegment === 'mutual fund') return 'mutual_fund';
  if (normalizedSegment === 'commodity') return 'commodity_futures';
  if (normalizedSegment === 'fx') return 'currency';
  return 'equity_delivery';
};

const normalizeChargeSnapshot = (value) => {
  const row = value && typeof value === 'object' ? value : {};
  const totals = row.totals && typeof row.totals === 'object' ? row.totals : {};
  return {
    platformId: asString(row.platformId),
    platformLabel: asString(row.platformLabel),
    segmentKey: asString(row.segmentKey),
    segmentLabel: asString(row.segmentLabel),
    side: asString(row.side || 'BUY').toUpperCase(),
    turnover: asNumber(row.turnover, 0),
    lines: Array.isArray(row.lines)
      ? row.lines.map((line) => ({
        key: asString(line?.key),
        label: asString(line?.label),
        amount: asNumber(line?.amount, 0),
      }))
      : [],
    totals: Object.fromEntries(Object.entries(totals).map(([key, val]) => [key, asNumber(val, 0)])),
    totalCharges: asNumber(row.totalCharges, 0),
    sourceTitle: asString(row.sourceTitle),
    sourceUrl: asString(row.sourceUrl),
    exactness: asString(row.exactness),
    registryVersion: asString(row.registryVersion),
  };
};

export const normalizePortfolioTransaction = (row) => {
  if (!row || typeof row !== 'object') return null;
  const symbol = asString(row.symbol).toUpperCase();
  if (!symbol) return null;
  const price = asNumber(row.price ?? row.buyPrice, 0);
  const quantity = asNumber(row.quantity, 0);
  const side = asString(row.side || row.transactionType || 'BUY').toUpperCase() || 'BUY';
  return {
    id: asString(row.id || `${Date.now()}_${symbol}`),
    entryType: 'transaction',
    side,
    transactionSubtype: asString(row.transactionSubtype),
    symbol,
    assetName: asString(row.assetName || row.name || symbol) || symbol,
    description: asString(row.description),
    notes: asString(row.notes),
    brokerReference: asString(row.brokerReference),
    importSource: asString(row.importSource),
    importBatchId: asString(row.importBatchId),
    purchaseType: asString(row.purchaseType || 'Delivery') || 'Delivery',
    tradeDate: asString(row.tradeDate || row.purchaseDate),
    platform: asString(row.platform),
    country: asString(row.country || 'India') || 'India',
    state: asString(row.state),
    segment: asString(row.segment || 'Equity') || 'Equity',
    quantity,
    price,
    currentPrice: asNumber(row.currentPrice, price),
    currencySymbol: asString(row.currencySymbol || 'INR') || 'INR',
    manualCharge: asNumber(row.manualCharge, 0),
    manualTax: asNumber(row.manualTax, 0),
    chargeSnapshot: normalizeChargeSnapshot(row.chargeSnapshot),
    createdAt: asString(row.createdAt || new Date().toISOString()),
    legacyImported: Boolean(row.legacyImported),
  };
};

export const migrateLegacyPosition = (row) => {
  if (!row || typeof row !== 'object') return null;
  const symbol = asString(row.symbol).toUpperCase();
  if (!symbol) return null;
  const quantity = asNumber(row.quantity, 0);
  const price = asNumber(row.buyPrice, 0);
  if (quantity <= 0 || price <= 0) return null;
  return normalizePortfolioTransaction({
    id: asString(row.id || `legacy_${symbol}`),
    symbol,
    assetName: asString(row.assetName || symbol),
    description: row.description,
    notes: row.notes,
    purchaseType: row.purchaseType || 'Delivery',
    tradeDate: row.purchaseDate,
    platform: row.platform,
    country: row.country || 'India',
    state: row.state,
    segment: row.segment || 'Equity',
    quantity,
    price,
    currentPrice: asNumber(row.currentPrice, price),
    currencySymbol: row.currencySymbol || 'INR',
    chargeSnapshot: {
      platformId: '',
      platformLabel: asString(row.platform),
      segmentKey: '',
      segmentLabel: '',
      side: 'BUY',
      turnover: round(quantity * price),
      lines: [],
      totals: {},
      totalCharges: 0,
      sourceTitle: 'Legacy migrated holding',
      sourceUrl: '',
      exactness: 'legacy_import',
      registryVersion: '',
    },
    legacyImported: true,
  });
};

export const normalizePortfolioMap = (input) => {
  const next = {};
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    Object.entries(input).forEach(([name, rows]) => {
      const portfolioName = asString(name);
      if (!portfolioName) return;
      next[portfolioName] = (Array.isArray(rows) ? rows : [])
        .map((row) => {
          const isTransaction = row && typeof row === 'object' && (row.entryType || row.side || row.transactionType);
          return isTransaction ? normalizePortfolioTransaction(row) : migrateLegacyPosition(row);
        })
        .filter(Boolean);
    });
  }
  return Object.keys(next).length ? next : { Main: [] };
};

export const normalizeLegacyPortfolioRows = (rows) => ({
  Main: Array.isArray(rows) ? rows.map((row) => migrateLegacyPosition(row)).filter(Boolean) : [],
});

export const deriveHoldingsFromTransactions = (transactions) => {
  const rows = Array.isArray(transactions) ? transactions.map((row) => normalizePortfolioTransaction(row)).filter(Boolean) : [];
  const sorted = [...rows].sort((a, b) =>
    `${a.tradeDate || a.createdAt}|${a.createdAt}|${a.id}`.localeCompare(`${b.tradeDate || b.createdAt}|${b.createdAt}|${b.id}`));
  const grouped = new Map();

  sorted.forEach((txn) => {
    const key = txn.symbol;
    const current = grouped.get(key) || {
      id: key,
      symbol: key,
      assetName: txn.assetName || key,
      description: txn.description || '',
      notes: txn.notes || '',
      purchaseType: txn.purchaseType || 'Delivery',
      segment: txn.segment || 'Equity',
      platform: txn.platform || '',
      country: txn.country || 'India',
      currencySymbol: txn.currencySymbol || 'INR',
      currentPrice: txn.currentPrice || txn.price || 0,
      quantity: 0,
      costBasis: 0,
      realizedPnl: 0,
      totalChargesPaid: 0,
      transactionCount: 0,
      lastTradeDate: '',
      transactions: [],
    };
    const charges = asNumber(txn.chargeSnapshot?.totalCharges, 0);
    current.assetName = txn.assetName || current.assetName;
    current.description = txn.description || current.description;
    current.notes = txn.notes || current.notes;
    current.purchaseType = txn.purchaseType || current.purchaseType;
    current.segment = txn.segment || current.segment;
    current.platform = txn.platform || current.platform;
    current.country = txn.country || current.country;
    current.currencySymbol = txn.currencySymbol || current.currencySymbol;
    current.currentPrice = asNumber(txn.currentPrice, current.currentPrice);
    current.lastTradeDate = txn.tradeDate || txn.createdAt || current.lastTradeDate;
    current.totalChargesPaid += charges;
    current.transactionCount += 1;
    current.transactions.push(txn);

    if (txn.side === 'BUY') {
      current.quantity += txn.quantity;
      current.costBasis += (txn.quantity * txn.price) + charges;
    } else if (txn.side === 'SELL') {
      const sellQty = Math.min(txn.quantity, current.quantity);
      const avgCost = current.quantity > 0 ? current.costBasis / current.quantity : 0;
      const costRemoved = avgCost * sellQty;
      const netSaleProceeds = (sellQty * txn.price) - charges;
      current.realizedPnl += netSaleProceeds - costRemoved;
      current.quantity = Math.max(current.quantity - sellQty, 0);
      current.costBasis = Math.max(current.costBasis - costRemoved, 0);
    } else if (txn.side === 'DIVIDEND') {
      current.realizedPnl += (txn.quantity * txn.price) - charges;
    } else if (txn.side === 'FEE' || txn.side === 'TAX') {
      current.realizedPnl -= charges || (txn.quantity * txn.price);
    } else if (txn.side === 'ADJUSTMENT') {
      const subtype = asString(txn.transactionSubtype).toLowerCase();
      if ((subtype === 'split' || subtype === 'bonus') && txn.quantity > 0) {
        current.quantity += txn.quantity;
      } else {
        current.costBasis += txn.quantity * txn.price;
      }
    }

    grouped.set(key, current);
  });

  return [...grouped.values()].map((row) => {
    const averageCost = row.quantity > 0 ? row.costBasis / row.quantity : 0;
    const current = row.currentPrice * row.quantity;
    const projectedExitCharges = row.quantity > 0 ? round(current * 0.0015) : 0;
    const grossPnl = current - row.costBasis;
    const netPnl = grossPnl - projectedExitCharges;
    return {
      id: row.id,
      symbol: row.symbol,
      assetName: row.assetName,
      description: row.description,
      notes: row.notes,
      purchaseType: row.purchaseType,
      segment: row.segment,
      platform: row.platform,
      country: row.country,
      currencySymbol: row.currencySymbol,
      quantity: round(row.quantity, 6),
      buyPrice: round(averageCost, 4),
      averageCost: round(averageCost, 4),
      invested: round(row.costBasis),
      currentPrice: round(row.currentPrice, 4),
      current: round(current),
      grossPnl: round(grossPnl),
      pnl: round(netPnl),
      netPnl: round(netPnl),
      projectedExitCharges: round(projectedExitCharges),
      realizedPnl: round(row.realizedPnl),
      totalChargesPaid: round(row.totalChargesPaid),
      transactionCount: row.transactionCount,
      lastTradeDate: row.lastTradeDate,
      transactions: row.transactions,
    };
  }).sort((a, b) => b.current - a.current);
};

export const getPortfolioStats = (holdingsInput, transactionsInput = []) => {
  const rows = Array.isArray(holdingsInput) ? holdingsInput : deriveHoldingsFromTransactions(transactionsInput);
  const bySegment = {};
  const byPlatform = {};
  const byCountry = {};
  const totals = rows.reduce((acc, row) => {
    const segment = asString(row.segment || 'Other') || 'Other';
    const platform = asString(row.platform || 'Unspecified') || 'Unspecified';
    const country = asString(row.country || 'Unspecified') || 'Unspecified';
    if (!bySegment[segment]) bySegment[segment] = { invested: 0, current: 0, net: 0 };
    if (!byPlatform[platform]) byPlatform[platform] = { invested: 0, current: 0, net: 0 };
    if (!byCountry[country]) byCountry[country] = { invested: 0, current: 0, net: 0 };
    bySegment[segment].invested += asNumber(row.invested, 0);
    bySegment[segment].current += asNumber(row.current, 0);
    bySegment[segment].net += asNumber(row.netPnl ?? row.pnl, 0);
    byPlatform[platform].invested += asNumber(row.invested, 0);
    byPlatform[platform].current += asNumber(row.current, 0);
    byPlatform[platform].net += asNumber(row.netPnl ?? row.pnl, 0);
    byCountry[country].invested += asNumber(row.invested, 0);
    byCountry[country].current += asNumber(row.current, 0);
    byCountry[country].net += asNumber(row.netPnl ?? row.pnl, 0);
    acc.invested += asNumber(row.invested, 0);
    acc.current += asNumber(row.current, 0);
    acc.realizedPnl += asNumber(row.realizedPnl, 0);
    acc.platformFees += asNumber(row.totalChargesPaid, 0);
    acc.tax += asNumber(row.projectedExitCharges, 0);
    acc.profitable += asNumber(row.netPnl ?? row.pnl, 0) >= 0 ? 1 : 0;
    return acc;
  }, { invested: 0, current: 0, tax: 0, platformFees: 0, profitable: 0, realizedPnl: 0 });

  const mapToRows = (grouped) => Object.keys(grouped).map((label) => ({
    label,
    invested: round(grouped[label].invested),
    current: round(grouped[label].current),
    pnl: round(grouped[label].current - grouped[label].invested),
    net: round(grouped[label].net),
  }));

  const recentPurchases = (Array.isArray(transactionsInput) ? transactionsInput : [])
    .map((row) => normalizePortfolioTransaction(row))
    .filter(Boolean)
    .sort((a, b) => `${b.tradeDate || b.createdAt}`.localeCompare(`${a.tradeDate || a.createdAt}`))
    .slice(0, 6);

  const grossPnl = totals.current - totals.invested;
  return {
    holdings: rows.length,
    profitable: totals.profitable,
    invested: round(totals.invested),
    current: round(totals.current),
    tax: round(totals.tax),
    platformFees: round(totals.platformFees),
    realizedPnl: round(totals.realizedPnl),
    grossPnl: round(grossPnl),
    netAfterCosts: round(grossPnl - totals.tax),
    bySegment: mapToRows(bySegment),
    byPlatform: mapToRows(byPlatform),
    byCountry: mapToRows(byCountry),
    recentPurchases,
    holdingsRows: rows,
  };
};

export const normalizePortfolioSnapshots = (raw) => (Array.isArray(raw) ? raw : [])
  .map((row) => {
    if (!row || typeof row !== 'object') return null;
    const dateKey = asString(row.dateKey);
    const capturedAt = asString(row.capturedAt);
    const overall = row.overall && typeof row.overall === 'object' ? row.overall : {};
    const portfolios = Array.isArray(row.portfolios) ? row.portfolios : [];
    return {
      dateKey: dateKey || capturedAt.slice(0, 10),
      capturedAt: capturedAt || `${dateKey}T00:00:00.000Z`,
      overall: {
        holdings: asNumber(overall.holdings, 0),
        invested: asNumber(overall.invested, 0),
        current: asNumber(overall.current, 0),
        grossPnl: asNumber(overall.grossPnl, 0),
        netAfterCosts: asNumber(overall.netAfterCosts, 0),
      },
      portfolios: portfolios
        .map((item) => ({
          name: asString(item?.name),
          holdings: asNumber(item?.holdings, 0),
          invested: asNumber(item?.invested, 0),
          current: asNumber(item?.current, 0),
          pnl: asNumber(item?.pnl, 0),
          net: asNumber(item?.net, 0),
        }))
        .filter((item) => item.name),
    };
  })
  .filter(Boolean)
  .sort((a, b) => `${a.capturedAt || a.dateKey}`.localeCompare(`${b.capturedAt || b.dateKey}`));

export const buildPortfolioSnapshot = (portfolioMap, capturedAt = new Date().toISOString()) => {
  const normalized = normalizePortfolioMap(portfolioMap || {});
  const portfolioRows = Object.keys(normalized).map((name) => {
    const holdings = deriveHoldingsFromTransactions(normalized[name] || []);
    const stats = getPortfolioStats(holdings, normalized[name] || []);
    return {
      name,
      holdings: stats.holdings,
      invested: round(stats.invested),
      current: round(stats.current),
      pnl: round(stats.grossPnl),
      net: round(stats.netAfterCosts),
    };
  });
  const allTransactions = Object.values(normalized).flat();
  const allHoldings = deriveHoldingsFromTransactions(allTransactions);
  const overall = getPortfolioStats(allHoldings, allTransactions);
  return {
    dateKey: capturedAt.slice(0, 10),
    capturedAt,
    overall: {
      holdings: overall.holdings,
      invested: round(overall.invested),
      current: round(overall.current),
      grossPnl: round(overall.grossPnl),
      netAfterCosts: round(overall.netAfterCosts),
    },
    portfolios: portfolioRows,
  };
};
