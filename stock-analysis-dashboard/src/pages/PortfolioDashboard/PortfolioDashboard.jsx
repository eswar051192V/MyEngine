import React, { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  Tooltip as ReTooltip,
} from 'recharts';
import './PortfolioDashboard.css';
import {
  TRANSACTION_SIDE_CHOICES,
  ADJUSTMENT_SUBTYPE_CHOICES,
  PURCHASE_TYPE_CHOICES,
  SEGMENT_CHOICES,
  PORTFOLIO_PROMPT_LIBRARY_KEY,
  PORTFOLIO_PROMPT_HISTORY_KEY,
  PORTFOLIO_JOURNAL_KEY,
  API_BASE,
} from '../../utils/constants';
import {
  getPortfolioStats,
  buildPortfolioSnapshot,
  normalizePortfolioSnapshots,
  normalizePortfolioSegment,
  ledgerDeriveHoldingsFromTransactions,
  ledgerNormalizePortfolioTransaction,
  downloadTextFile,
  rowsToCsv,
} from '../../utils/portfolio';

const PortfolioDashboard = ({ state, handlers, openAnalysisSymbol }) => {
    const [portfolioCopilotPrompt, setPortfolioCopilotPrompt] = useState('');
    const [portfolioCopilotAnswer, setPortfolioCopilotAnswer] = useState('');
    const [portfolioCopilotLoading, setPortfolioCopilotLoading] = useState(false);
    const [portfolioCopilotError, setPortfolioCopilotError] = useState('');
    const [portfolioCopilotLastPrompt, setPortfolioCopilotLastPrompt] = useState('');
    const [holdingsScope, setHoldingsScope] = useState('selected');
    const [performanceRange, setPerformanceRange] = useState('90D');
    const [transactionFilters, setTransactionFilters] = useState({ symbol: '', side: 'ALL', platform: 'ALL', segment: 'ALL', startDate: '', endDate: '' });
    const [duplicatePortfolioMode, setDuplicatePortfolioMode] = useState('full');
    const [duplicatePortfolioName, setDuplicatePortfolioName] = useState('');
    const [portfolioImportCsv, setPortfolioImportCsv] = useState('');
    const [portfolioImportPreview, setPortfolioImportPreview] = useState(null);
    const [portfolioImportLoading, setPortfolioImportLoading] = useState(false);
    const [portfolioAnalytics, setPortfolioAnalytics] = useState(null);
    const [portfolioAnalyticsLoading, setPortfolioAnalyticsLoading] = useState(false);
    const [portfolioTaxSummary, setPortfolioTaxSummary] = useState(null);
    const [portfolioTaxSummaryAll, setPortfolioTaxSummaryAll] = useState(null);
    const [portfolioTaxLoading, setPortfolioTaxLoading] = useState(false);
    const [portfolioFeeSummary, setPortfolioFeeSummary] = useState(null);
    const [portfolioFeeSummaryLoading, setPortfolioFeeSummaryLoading] = useState(false);
    const [financialYearFilter, setFinancialYearFilter] = useState('All');
    const [savedPrompts, setSavedPrompts] = useState([
        'Summarize diversification and concentration risk in this portfolio.',
        'Which holdings should I review first and why?',
        'Where are fees, taxes, or churn hurting this portfolio most?',
    ]);
    const [promptHistory, setPromptHistory] = useState([]);
    const [portfolioJournalMap, setPortfolioJournalMap] = useState({});
    const [copilotContextPayload, setCopilotContextPayload] = useState(null);

    const portfolioNames = Object.keys(state.portfolios || {});
    const activeTransactions = useMemo(() => state.selectedPortfolioTransactions || [], [state.selectedPortfolioTransactions]);
    const activeStats = useMemo(() => getPortfolioStats(state.selectedPortfolioPositions || [], activeTransactions), [state.selectedPortfolioPositions, activeTransactions]);
    const portfolioRollup = useMemo(
        () => portfolioNames.map((name) => {
            const transactions = state.portfolios?.[name] || [];
            const holdingsRows = ledgerDeriveHoldingsFromTransactions(transactions);
            const stats = getPortfolioStats(holdingsRows, transactions);
            return { name, holdings: stats.holdings, invested: stats.invested, current: stats.current, pnl: stats.grossPnl, net: stats.netAfterCosts };
        }),
        [portfolioNames, state.portfolios]
    );
    const holdings = useMemo(() => state.selectedPortfolioPositions || [], [state.selectedPortfolioPositions]);
    const combinedHoldings = useMemo(
        () => Object.entries(state.portfolios || {}).flatMap(([portfolioName, rows]) => ledgerDeriveHoldingsFromTransactions(rows || []).map((row) => ({ ...row, portfolioName }))),
        [state.portfolios]
    );
    const visibleHoldings = useMemo(
        () => (
            holdingsScope === 'combined'
                ? combinedHoldings
                : holdings.map((row) => ({ ...row, portfolioName: state.selectedPortfolio || 'Main' }))
        ),
        [holdingsScope, combinedHoldings, holdings, state.selectedPortfolio]
    );
    const visibleHoldingsStats = useMemo(() => getPortfolioStats(visibleHoldings), [visibleHoldings]);
    const visibleCurrentValue = visibleHoldingsStats.current;
    const holdingRows = useMemo(
        () => visibleHoldings.map((p) => {
            const invested = Number(p.invested || (Number(p.buyPrice || 0) * Number(p.quantity || 0)));
            const current = Number(p.current || (Number(p.currentPrice || 0) * Number(p.quantity || 0)));
            const pnl = Number(p.netPnl ?? p.pnl ?? (current - invested));
            return { ...p, invested, current, pnl, weightPct: visibleCurrentValue > 0 ? (100 * current) / visibleCurrentValue : 0 };
        }),
        [visibleHoldings, visibleCurrentValue]
    );
    const sortedSegments = useMemo(() => [...(activeStats.bySegment || [])].sort((a, b) => b.current - a.current), [activeStats.bySegment]);
    const sortedCountries = useMemo(() => [...(activeStats.byCountry || [])].sort((a, b) => b.current - a.current), [activeStats.byCountry]);
    const topHoldings = useMemo(() => [...holdingRows].sort((a, b) => b.current - a.current).slice(0, 5), [holdingRows]);
    const recentPurchases = activeStats.recentPurchases || [];
    const transactionRows = useMemo(
        () => (state.selectedPortfolioTransactions || [])
            .map((row) => ledgerNormalizePortfolioTransaction(row))
            .filter(Boolean)
            .sort((a, b) => `${b.tradeDate || b.createdAt}`.localeCompare(`${a.tradeDate || a.createdAt}`)),
        [state.selectedPortfolioTransactions]
    );
    const filteredTransactionRows = useMemo(
        () => transactionRows.filter((txn) => {
            const symbolOk = !transactionFilters.symbol || String(txn.symbol || '').toUpperCase().includes(transactionFilters.symbol.toUpperCase()) || String(txn.assetName || '').toLowerCase().includes(transactionFilters.symbol.toLowerCase());
            const sideOk = transactionFilters.side === 'ALL' || txn.side === transactionFilters.side;
            const platformOk = transactionFilters.platform === 'ALL' || (txn.platform || 'Unspecified') === transactionFilters.platform;
            const segmentOk = transactionFilters.segment === 'ALL' || (txn.segment || 'Other') === transactionFilters.segment;
            const dateKey = String(txn.tradeDate || '').slice(0, 10);
            const startOk = !transactionFilters.startDate || (dateKey && dateKey >= transactionFilters.startDate);
            const endOk = !transactionFilters.endDate || (dateKey && dateKey <= transactionFilters.endDate);
            return symbolOk && sideOk && platformOk && segmentOk && startOk && endOk;
        }),
        [transactionRows, transactionFilters]
    );
    const isEditingPosition = state.portfolioModalMode === 'edit';
    const profitablePct = activeStats.holdings ? Math.round((100 * activeStats.profitable) / activeStats.holdings) : 0;
    const concentrationPct = activeStats.current ? (100 * topHoldings.slice(0, 2).reduce((acc, row) => acc + row.current, 0)) / activeStats.current : 0;
    const primarySegment = sortedSegments[0] || null;
    const primaryCountry = sortedCountries[0] || null;
    const liveSnapshot = useMemo(() => buildPortfolioSnapshot(state.portfolios || {}), [state.portfolios]);
    const historicalSnapshots = useMemo(() => normalizePortfolioSnapshots(state.portfolioSnapshots || []), [state.portfolioSnapshots]);
    const filteredSnapshots = useMemo(() => {
        if (!historicalSnapshots.length) return [];
        if (performanceRange === 'ALL') return historicalSnapshots;
        const days = performanceRange === '30D' ? 30 : performanceRange === '90D' ? 90 : 365;
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const rows = historicalSnapshots.filter((row) => {
            const ts = new Date(row.capturedAt || row.dateKey).getTime();
            return Number.isFinite(ts) && ts >= cutoff;
        });
        return rows.length ? rows : historicalSnapshots.slice(-1);
    }, [historicalSnapshots, performanceRange]);
    const latestPerformanceSnapshot = filteredSnapshots[filteredSnapshots.length - 1] || historicalSnapshots[historicalSnapshots.length - 1] || liveSnapshot;
    const firstPerformanceSnapshot = filteredSnapshots[0] || latestPerformanceSnapshot;
    const asOfLabel = useMemo(
        () => new Date(latestPerformanceSnapshot.capturedAt || latestPerformanceSnapshot.dateKey).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
        [latestPerformanceSnapshot]
    );
    const performanceChartRows = useMemo(() => {
        const source = filteredSnapshots.length ? filteredSnapshots : [latestPerformanceSnapshot];
        return source.map((row) => ({
            date: row.dateKey,
            current: Number(row.overall?.current || 0),
            invested: Number(row.overall?.invested || 0),
            pnl: Number(row.overall?.grossPnl || 0),
        }));
    }, [filteredSnapshots, latestPerformanceSnapshot]);
    const portfolioComparisonRows = useMemo(() => {
        const startMap = new Map((firstPerformanceSnapshot?.portfolios || []).map((row) => [row.name, row]));
        return (latestPerformanceSnapshot?.portfolios || []).map((row) => {
            const start = startMap.get(row.name);
            return {
                ...row,
                currentDelta: Number((row.current - Number(start?.current || 0)).toFixed(2)),
                pnlDelta: Number((row.pnl - Number(start?.pnl || 0)).toFixed(2)),
            };
        }).sort((a, b) => b.current - a.current);
    }, [latestPerformanceSnapshot, firstPerformanceSnapshot]);
    const showPortfolioSearch = state.portfolioSearchOpen && (state.portfolioSearchLoading || state.portfolioSearchResults.length > 0 || state.portfolioForm.symbol || state.portfolioForm.assetName);
    const projectionSymbol = String(state.portfolioForm.symbol || '').trim().toUpperCase();
    const projectionAssetName = String(state.portfolioForm.assetName || '').trim();
    const projectionSegment = normalizePortfolioSegment(state.portfolioForm.segment || 'Equity');
    const macroRegime = state.macroLabSnapshot?.regime || {};
    const heldSymbols = useMemo(() => Array.from(new Set(holdings.map((p) => String(p.symbol || '').trim().toUpperCase()).filter(Boolean))), [holdings]);
    const heldSymbolSet = useMemo(() => new Set(heldSymbols), [heldSymbols]);
    const heldMlSignals = useMemo(
        () => (state.mlResearchRows || []).filter((row) => !row.error && heldSymbolSet.has(String(row.symbol || '').trim().toUpperCase())).sort((a, b) => Math.abs(Number(b.predicted_return_pct || 0)) * Number(b.confidence_pct || 0) - Math.abs(Number(a.predicted_return_pct || 0)) * Number(a.confidence_pct || 0)).slice(0, 4),
        [state.mlResearchRows, heldSymbolSet]
    );
    const heldMacroSignals = useMemo(
        () => (state.macroLabImpactRows || []).filter((row) => heldSymbolSet.has(String(row.symbol || '').trim().toUpperCase())).sort((a, b) => Math.abs(Number(b.totalScore || 0)) - Math.abs(Number(a.totalScore || 0))).slice(0, 4),
        [state.macroLabImpactRows, heldSymbolSet]
    );
    const mlProjection = useMemo(() => {
        if (!projectionSymbol) return null;
        return (state.mlResearchRows || []).find((row) => String(row?.symbol || '').trim().toUpperCase() === projectionSymbol) || null;
    }, [projectionSymbol, state.mlResearchRows]);
    const macroProjection = useMemo(() => {
        if (!projectionSymbol) return null;
        return (state.macroLabImpactRows || []).find((row) => String(row?.symbol || '').trim().toUpperCase() === projectionSymbol) || null;
    }, [projectionSymbol, state.macroLabImpactRows]);
    const macroDriver = useMemo(() => {
        if (!macroProjection?.factors) return null;
        const ranked = Object.entries(macroProjection.factors).sort((a, b) => Math.abs(Number(b[1] || 0)) - Math.abs(Number(a[1] || 0)));
        return ranked[0] || null;
    }, [macroProjection]);
    const projectionHasData = Boolean((mlProjection && !mlProjection.error) || macroProjection);
    const projectionIsCustomOnly = projectionSegment === 'Other' || (!projectionSymbol && !!projectionAssetName);
    const projectionWaitingForSelection = !projectionSymbol && !projectionAssetName;
    const projectionLoading = !projectionHasData && (state.mlResearchLoading || state.macroLabLoading);
    const projectionPromptResearch = Boolean(projectionSymbol) && !projectionHasData && !state.mlResearchLoading && !state.macroLabLoading;
    const portfolioAnalyticsData = portfolioAnalytics?.kpis ? portfolioAnalytics : null;
    const analyticsKpis = portfolioAnalyticsData?.kpis || {
        invested: activeStats.invested,
        current: activeStats.current,
        realizedPnl: activeStats.realizedPnl,
        unrealizedPnl: Number((activeStats.grossPnl - activeStats.realizedPnl).toFixed(2)),
        netAfterCosts: activeStats.netAfterCosts,
        totalFeesPaid: activeStats.totalChargesPaid,
        projectedExitCharges: activeStats.projectedExitCharges,
    };
    const analyticsSeries = portfolioAnalyticsData?.cumulativeSeries?.length
        ? portfolioAnalyticsData.cumulativeSeries
        : performanceChartRows.map((row) => ({ month: row.date, invested: row.invested, current: row.current, realized: 0 }));
    const analyticsHeatmap = portfolioAnalyticsData?.transactionHeatmap || [];
    const analyticsCostLadders = portfolioAnalyticsData?.costLadders || [];
    const analyticsFeeByHolding = portfolioAnalyticsData?.feeDrainByHolding || [];
    const analyticsFeeByPlatform = portfolioAnalyticsData?.feeDrainByPlatform || [];
    const taxBuckets = portfolioTaxSummary?.buckets || [];
    const taxHoldings = portfolioTaxSummary?.holdingLiabilities || [];
    const taxPortfolioBreakdown = portfolioTaxSummaryAll?.perPortfolio || [];
    const taxYears = useMemo(() => {
        const years = new Set((portfolioTaxSummary?.realizedEvents || []).map((row) => row.financialYear).filter(Boolean));
        return ['All', ...Array.from(years)];
    }, [portfolioTaxSummary]);
    const uniquePlatforms = useMemo(() => ['ALL', ...Array.from(new Set(transactionRows.map((row) => row.platform || 'Unspecified')))], [transactionRows]);
    const uniqueSegments = useMemo(() => ['ALL', ...Array.from(new Set(transactionRows.map((row) => row.segment || 'Other')))], [transactionRows]);
    const portfolioCopilotContext = useMemo(() => {
        if (!holdings.length) return `Active portfolio: ${state.selectedPortfolio || 'Main'}\nNo holdings are currently saved.`;
        const lines = [
            `Active portfolio: ${state.selectedPortfolio || 'Main'}`,
            `Current value: ${activeStats.current.toFixed(2)}`,
            `Invested: ${activeStats.invested.toFixed(2)}`,
            `Gross P/L: ${activeStats.grossPnl.toFixed(2)}`,
            `Net after costs: ${activeStats.netAfterCosts.toFixed(2)}`,
            `Holdings: ${activeStats.holdings}`,
            `Profitable holdings: ${activeStats.profitable}`,
            `Top segment: ${primarySegment ? `${primarySegment.label} (${primarySegment.current.toFixed(2)})` : 'N/A'}`,
            `Top country: ${primaryCountry ? `${primaryCountry.label} (${primaryCountry.current.toFixed(2)})` : 'N/A'}`,
            'Top holdings:',
            ...topHoldings.slice(0, 5).map((row) => `- ${row.symbol}: current ${row.current.toFixed(2)}, invested ${row.invested.toFixed(2)}, pnl ${row.pnl.toFixed(2)}, weight ${row.weightPct.toFixed(1)}%, segment ${row.segment || 'N/A'}, country ${row.country || 'N/A'}`),
            'Country exposure:',
            ...sortedCountries.slice(0, 4).map((row) => `- ${row.label}: ${row.current.toFixed(2)}`),
        ];
        if (heldMlSignals.length) {
            lines.push('ML signals:');
            heldMlSignals.forEach((row) => lines.push(`- ${row.symbol}: ${row.label || 'Neutral'}, predicted ${Number(row.predicted_return_pct || 0).toFixed(2)}%, confidence ${Number(row.confidence_pct || 0).toFixed(1)}%, probability up ${Number(row.probability_up_pct || 0).toFixed(1)}%`));
        }
        if (heldMacroSignals.length) {
            lines.push(`Macro scenario: ${state.macroLabConfig?.scenario || 'Base'}`);
            lines.push('Macro impact rows:');
            heldMacroSignals.forEach((row) => lines.push(`- ${row.symbol}: ${row.stance || 'Neutral'}, total score ${Number(row.totalScore || 0).toFixed(2)}, confidence ${Math.round(Number(row.confidence || 0) * 100)}%`));
        }
        if (portfolioAnalyticsData?.feeDrainByHolding?.length) {
            lines.push('Fee drag:');
            portfolioAnalyticsData.feeDrainByHolding.slice(0, 3).forEach((row) => lines.push(`- ${row.symbol}: fees ${Number(row.fees || 0).toFixed(2)}`));
        }
        if (portfolioTaxSummary?.buckets?.length) {
            lines.push('Tax buckets:');
            portfolioTaxSummary.buckets.forEach((row) => lines.push(`- ${row.taxBucket}: pnl ${Number(row.pnl || 0).toFixed(2)} across ${row.events || 0} realized events`));
        }
        if (copilotContextPayload?.context) {
            lines.push('Backend copilot context:');
            lines.push(copilotContextPayload.context);
        }
        return lines.join('\n');
    }, [holdings, state.selectedPortfolio, activeStats, primarySegment, primaryCountry, topHoldings, sortedCountries, heldMlSignals, heldMacroSignals, state.macroLabConfig, portfolioAnalyticsData, portfolioTaxSummary, copilotContextPayload]);

    useEffect(() => {
        setPortfolioCopilotPrompt('');
        setPortfolioCopilotAnswer('');
        setPortfolioCopilotError('');
        setPortfolioCopilotLastPrompt('');
    }, [state.selectedPortfolio]);

    useEffect(() => {
        try {
            const rawLibrary = localStorage.getItem(PORTFOLIO_PROMPT_LIBRARY_KEY);
            if (rawLibrary) {
                const parsed = JSON.parse(rawLibrary);
                if (Array.isArray(parsed) && parsed.length) setSavedPrompts(parsed);
            }
            const rawHistory = localStorage.getItem(PORTFOLIO_PROMPT_HISTORY_KEY);
            if (rawHistory) {
                const parsed = JSON.parse(rawHistory);
                if (Array.isArray(parsed)) setPromptHistory(parsed);
            }
            const rawJournal = localStorage.getItem(PORTFOLIO_JOURNAL_KEY);
            if (rawJournal) {
                const parsed = JSON.parse(rawJournal);
                if (parsed && typeof parsed === 'object') setPortfolioJournalMap(parsed);
            }
        } catch (e) {
            console.error(e);
        }
    }, []);

    useEffect(() => {
        localStorage.setItem(PORTFOLIO_PROMPT_LIBRARY_KEY, JSON.stringify(savedPrompts || []));
    }, [savedPrompts]);

    useEffect(() => {
        localStorage.setItem(PORTFOLIO_PROMPT_HISTORY_KEY, JSON.stringify((promptHistory || []).slice(0, 30)));
    }, [promptHistory]);

    useEffect(() => {
        localStorage.setItem(PORTFOLIO_JOURNAL_KEY, JSON.stringify(portfolioJournalMap || {}));
    }, [portfolioJournalMap]);

    useEffect(() => {
        let cancelled = false;
        const portfolioName = encodeURIComponent(state.selectedPortfolio || 'Main');
        setPortfolioAnalyticsLoading(true);
        setPortfolioTaxLoading(true);
        setPortfolioFeeSummaryLoading(true);
        (async () => {
            try {
                const [analyticsRes, taxRes, taxAllRes, feeRes, copilotRes] = await Promise.all([
                    fetch(`${API_BASE}/api/portfolio/analytics?portfolio_name=${portfolioName}`),
                    fetch(`${API_BASE}/api/portfolio/report/tax-summary?portfolio_name=${portfolioName}${financialYearFilter !== 'All' ? `&financial_year=${encodeURIComponent(financialYearFilter)}` : ''}`),
                    fetch(`${API_BASE}/api/portfolio/report/tax-summary?portfolio_name=__all__${financialYearFilter !== 'All' ? `&financial_year=${encodeURIComponent(financialYearFilter)}` : ''}`),
                    fetch(`${API_BASE}/api/portfolio/report/fee-summary?portfolio_name=${portfolioName}`),
                    fetch(`${API_BASE}/api/portfolio/copilot/context`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ portfolio_name: state.selectedPortfolio || 'Main' }),
                    }),
                ]);
                const [analyticsData, taxData, taxAllData, feeData, copilotData] = await Promise.all([
                    analyticsRes.json(),
                    taxRes.json(),
                    taxAllRes.json(),
                    feeRes.json(),
                    copilotRes.json(),
                ]);
                if (cancelled) return;
                setPortfolioAnalytics(analyticsData?.analytics || null);
                setPortfolioTaxSummary(taxData?.report || null);
                setPortfolioTaxSummaryAll(taxAllData?.report || null);
                setPortfolioFeeSummary(feeData?.report || null);
                setCopilotContextPayload(copilotData?.ok ? copilotData : null);
            } catch (e) {
                console.error(e);
                if (!cancelled) {
                    setPortfolioAnalytics(null);
                    setPortfolioTaxSummary(null);
                    setPortfolioTaxSummaryAll(null);
                    setPortfolioFeeSummary(null);
                    setCopilotContextPayload(null);
                }
            } finally {
                if (!cancelled) {
                    setPortfolioAnalyticsLoading(false);
                    setPortfolioTaxLoading(false);
                    setPortfolioFeeSummaryLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [state.selectedPortfolio, state.portfolios, financialYearFilter]);

    const openHoldingEditor = (row) => {
        if (row?.portfolioName && row.portfolioName !== state.selectedPortfolio) {
            handlers.setSelectedPortfolio(row.portfolioName);
        }
        const latestTxn = Array.isArray(row?.transactions) && row.transactions.length ? row.transactions[row.transactions.length - 1] : null;
        if (latestTxn) handlers.openPortfolioModal('edit', latestTxn);
    };

    const runPortfolioCopilot = async (promptOverride = '') => {
        const nextPrompt = String(promptOverride || portfolioCopilotPrompt || '').trim();
        if (!nextPrompt || portfolioCopilotLoading) return;
        if (!holdings.length) {
            setPortfolioCopilotError('Add holdings to the active portfolio before asking the copilot.');
            setPortfolioCopilotAnswer('');
            return;
        }
        if (!state.localLlmEnabled) {
            setPortfolioCopilotError('Enable the local LLM runtime first, then ask the portfolio copilot.');
            setPortfolioCopilotAnswer('');
            return;
        }
        setPortfolioCopilotLoading(true);
        setPortfolioCopilotError('');
        setPortfolioCopilotLastPrompt(nextPrompt);
        setPromptHistory((prev) => [{ prompt: nextPrompt, portfolio: state.selectedPortfolio || 'Main', askedAt: new Date().toISOString() }, ...prev].slice(0, 30));
        try {
            const out = await handlers.askLocalLlm({
                system: 'You are Market Watcher Portfolio Copilot. Give concise, practical portfolio guidance. Use the provided portfolio context only, avoid making up missing data, and structure the answer with short markdown sections for Summary, Risks, Opportunities, and Next checks.',
                prompt: `Portfolio context:\n${portfolioCopilotContext}\n\nUser question: ${nextPrompt}`,
                temperature: 0.2,
            });
            setPortfolioCopilotAnswer((out || '').trim() || 'No reply returned by the local model.');
        } catch (e) {
            const tip = 'Check Ollama, local LLM settings, and browser access to the configured base URL.';
            setPortfolioCopilotError(`${e?.message || 'Portfolio copilot failed.'} ${tip}`.trim());
            setPortfolioCopilotAnswer('');
        } finally {
            setPortfolioCopilotLoading(false);
        }
    };

    const quickCopilotPrompts = [
        'Summarize diversification and concentration risk in this portfolio.',
        'What are the biggest risks or overexposures in this portfolio?',
        'Which holdings should I review first and why?',
    ];
    const anomalyPrompts = (copilotContextPayload?.anomalies || []).slice(0, 4).map((item) => `Explain this anomaly in my portfolio and what to check next: ${item}`);
    const saveCurrentPrompt = () => {
        const nextPrompt = String(portfolioCopilotPrompt || '').trim();
        if (!nextPrompt || savedPrompts.includes(nextPrompt)) return;
        setSavedPrompts((prev) => [nextPrompt, ...prev].slice(0, 12));
    };
    const explainHolding = (row) => {
        const prompt = `Explain this holding using portfolio context, fees, concentration, and recent activity: ${row.symbol} (${row.assetName || row.symbol}), current ${Number(row.current || 0).toFixed(2)}, invested ${Number(row.invested || 0).toFixed(2)}, net pnl ${Number(row.pnl || row.netPnl || 0).toFixed(2)}, ${Number(row.transactionCount || 0)} transactions, segment ${row.segment || 'Equity'}, platform ${row.platform || 'Unknown'}.`;
        setPortfolioCopilotPrompt(prompt);
        runPortfolioCopilot(prompt);
    };
    const generateJournalSummary = async (scope = 'portfolio', row = null) => {
        if (portfolioCopilotLoading || !state.localLlmEnabled) return;
        const key = scope === 'holding' && row ? row.symbol : `portfolio:${state.selectedPortfolio || 'Main'}`;
        const prompt = scope === 'holding' && row
            ? `Write a compact transaction journal summary for ${row.symbol}. Include accumulation pattern, realized vs unrealized state, fees, and next review points.`
            : `Write a compact transaction journal summary for the full portfolio ${state.selectedPortfolio || 'Main'}. Include activity clusters, fee drag, realized vs unrealized profile, and what changed recently.`;
        setPortfolioCopilotLoading(true);
        try {
            const out = await handlers.askLocalLlm({
                system: 'You are a portfolio journal assistant. Summarize trading behavior in concise markdown with 3 short sections: Activity, Cost/Fee Notes, Next Review.',
                prompt: `${portfolioCopilotContext}\n\n${prompt}`,
                temperature: 0.2,
            });
            setPortfolioJournalMap((prev) => ({
                ...prev,
                [key]: {
                    scope,
                    symbol: row?.symbol || '',
                    text: (out || '').trim(),
                    updatedAt: new Date().toISOString(),
                },
            }));
        } catch (e) {
            setPortfolioCopilotError(e?.message || 'Journal generation failed.');
        } finally {
            setPortfolioCopilotLoading(false);
        }
    };
    const previewPortfolioImport = async () => {
        if (!portfolioImportCsv.trim() || portfolioImportLoading) return;
        setPortfolioImportLoading(true);
        try {
            const response = await fetch(`${API_BASE}/api/portfolio/import/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    csv_text: portfolioImportCsv,
                    portfolio_name: state.selectedPortfolio || 'Main',
                    platform: state.portfolioForm.platform || state.portfolioFeeRegistry?.platforms?.[0]?.label || '',
                    country: state.portfolioForm.country || state.portfolioFeeRegistry?.country || 'India',
                    state: state.portfolioForm.state || '',
                    purchaseType: state.portfolioForm.purchaseType || 'Delivery',
                    segment: state.portfolioForm.segment || 'Equity',
                    side: 'BUY',
                }),
            });
            const data = await response.json();
            setPortfolioImportPreview(data);
        } catch (e) {
            console.error(e);
            setPortfolioImportPreview({ previewRows: [], errorRows: [e?.message || 'Import preview failed.'], summary: { parsedRows: 0, importableRows: 0, errorCount: 1 } });
        } finally {
            setPortfolioImportLoading(false);
        }
    };
    const commitPortfolioImport = async () => {
        const previewRows = portfolioImportPreview?.previewRows || [];
        if (!previewRows.length || portfolioImportLoading) return;
        setPortfolioImportLoading(true);
        try {
            const response = await fetch(`${API_BASE}/api/portfolio/import/commit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ portfolio_name: state.selectedPortfolio || 'Main', preview_rows: previewRows }),
            });
            const data = await response.json();
            if (data?.portfolios) {
                handlers.replacePortfolios(data.portfolios);
                setPortfolioImportPreview(null);
                setPortfolioImportCsv('');
            }
        } catch (e) {
            console.error(e);
        } finally {
            setPortfolioImportLoading(false);
        }
    };
    const exportTaxSummary = () => downloadTextFile(`portfolio-tax-summary-${state.selectedPortfolio || 'main'}.csv`, rowsToCsv(portfolioTaxSummary?.realizedEvents || []), 'text/csv;charset=utf-8');
    const exportFeeSummary = () => downloadTextFile(`portfolio-fee-summary-${state.selectedPortfolio || 'main'}.csv`, rowsToCsv([...(portfolioFeeSummary?.lines || []), ...(portfolioFeeSummary?.platforms || []).map((row) => ({ scope: 'platform', ...row }))]), 'text/csv;charset=utf-8');

    return (
        <div className="md-content mw-content pf-page mdl-page mdl-page--redesign mdl mdl--dense">
            <header className="md-hero wl-hero mdl-hero">
                <p className="md-hero__label">Portfolio</p>
                <h1 className="md-hero__title">Portfolio command center</h1>
                <p className="md-hero__sub">
                    Same dense watchlist design language: books, holdings, ledger analytics, and Ollama copilot in one surface. Segment covers
                    equities, funds, bonds, commodities (including gold/silver/platinum/copper), FX, futures/options via purchase type, and real
                    estate subtypes—plus manual symbols for illiquid assets.
                </p>
                <div className="mdl-hero-strip">
                    <span className="mdl-pill">Book: {state.selectedPortfolio || 'Main'}</span>
                    <span className="mdl-pill">Holdings: {holdings.length}</span>
                    <span className="mdl-pill">Nav: {activeStats.current.toFixed(2)}</span>
                    <span className="mdl-pill">Books: {portfolioNames.length}</span>
                </div>
            </header>

            <div className="pf-dock-layout">
                <div className="pf-main-column">
                    <section className="pf-performance-section">
                        <div className="md-home-panel pf-performance-panel">
                            <div className="md-section-head">
                                <h2>Total holdings performance</h2>
                                <div className="md-home-actions md-home-actions--wrap">
                                    {['30D', '90D', '1Y', 'ALL'].map((range) => (
                                        <button key={range} type="button" className={`md-btn md-btn--small ${performanceRange === range ? 'md-btn--on' : ''}`} onClick={() => setPerformanceRange(range)}>
                                            {range}
                                        </button>
                                    ))}
                                    <span>As of {asOfLabel}</span>
                                </div>
                            </div>
                            <div className="pf-kpi-strip pf-kpi-strip--performance">
                                <div className="pf-kpi-card"><span>Current value</span><strong>{Number(latestPerformanceSnapshot.overall?.current || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Total invested</span><strong>{Number(latestPerformanceSnapshot.overall?.invested || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Gross P/L</span><strong className={Number(latestPerformanceSnapshot.overall?.grossPnl || 0) >= 0 ? 'md-text-up' : 'md-text-down'}>{Number(latestPerformanceSnapshot.overall?.grossPnl || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Net after costs</span><strong className={Number(latestPerformanceSnapshot.overall?.netAfterCosts || 0) >= 0 ? 'md-text-up' : 'md-text-down'}>{Number(latestPerformanceSnapshot.overall?.netAfterCosts || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Window change</span><strong className={Number((latestPerformanceSnapshot.overall?.current || 0) - (firstPerformanceSnapshot.overall?.current || 0)) >= 0 ? 'md-text-up' : 'md-text-down'}>{Number((latestPerformanceSnapshot.overall?.current || 0) - (firstPerformanceSnapshot.overall?.current || 0)).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Snapshot days</span><strong>{filteredSnapshots.length || 1}</strong></div>
                            </div>
                            <div className="pf-performance-grid">
                                <div className="md-mini-chart pf-chart-card pf-performance-chart">
                                    {performanceChartRows.length ? (
                                        <ResponsiveContainer width="100%" height={270}>
                                            <LineChart data={performanceChartRows}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                                                <XAxis dataKey="date" tick={{ fill: '#8b909a', fontSize: 11 }} />
                                                <YAxis tick={{ fill: '#8b909a', fontSize: 11 }} />
                                                <ReTooltip />
                                                <Legend />
                                                <Line type="monotone" dataKey="invested" stroke="#d4af37" strokeWidth={2} dot={false} />
                                                <Line type="monotone" dataKey="current" stroke="#4ade80" strokeWidth={2} dot={false} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    ) : <div className="md-empty">Add holdings over time to build the equity curve.</div>}
                                </div>
                                <div className="pf-performance-list">
                                    <div className="pf-dual-list__label">Per portfolio performance</div>
                                    <div className="md-home-list pf-compact-list">
                                        {portfolioComparisonRows.map((row) => (
                                            <button key={`${row.name}_performance`} type="button" className={`md-list-item md-list-item--col pf-rollup-card ${state.selectedPortfolio === row.name ? 'pf-rollup-card--active' : ''}`} onClick={() => handlers.setSelectedPortfolio(row.name)}>
                                                <div className="pf-rollup-card__row">
                                                    <strong>{row.name}</strong>
                                                    <span>{row.holdings} holdings</span>
                                                </div>
                                                <span className="pf-rollup-card__meta">Invested {row.invested.toFixed(2)} · Current {row.current.toFixed(2)}</span>
                                                <span className={row.pnl >= 0 ? 'md-text-up' : 'md-text-down'}>P/L {row.pnl.toFixed(2)} · Delta {row.currentDelta.toFixed(2)} · As of {asOfLabel}</span>
                                            </button>
                                        ))}
                                        {!portfolioComparisonRows.length && <div className="md-empty">No portfolio performance yet.</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="pf-workspace-full">
                        <div className="md-home-panel pf-workspace-panel pf-workspace-v2">
                            <div className="pf-workspace-v2__hero">
                                <div className="pf-workspace-v2__hero-text">
                                    <p className="md-hero__label">Workspace</p>
                                    <h2 className="pf-workspace-v2__title">Portfolio books</h2>
                                    <p className="pf-workspace-v2__lede">
                                        Switch the active book, refresh marks, and manage named portfolios in the same layout as watchlists.
                                    </p>
                                </div>
                                <span className="mdl-pill">{state.selectedPortfolio || 'Main'} · active</span>
                            </div>
                            <div className="pf-workspace-panel__grid pf-workspace-v2__grid">
                                <article className="mdl-card pf-workspace-v2__card">
                                    <div className="mdl-card__header pf-workspace-v2__card-header">
                                        <div>
                                            <h3>Controls</h3>
                                            <span className="pf-workspace-v2__card-sub">Switch and maintain the active portfolio</span>
                                        </div>
                                    </div>
                                    <div className="pf-workspace-v2__card-body">
                                        <div className="wl-toolbar pf-workspace-v2__toolbar">
                                            <div className="md-input-group pf-workspace-v2__field">
                                                <label className="md-field-label">Switch portfolio</label>
                                                <select className="md-select-inline" value={state.selectedPortfolio} onChange={(e) => handlers.setSelectedPortfolio(e.target.value)}>
                                                    {portfolioNames.map((p) => <option key={p} value={p}>{p}</option>)}
                                                </select>
                                            </div>
                                            <div className="wl-chip-group pf-workspace-v2__actions">
                                                <button type="button" className="wl-chip" onClick={() => handlers.openPortfolioModal('add')}>Add item</button>
                                                <button type="button" className="wl-chip" onClick={() => handlers.refreshPortfolioPrices()}>Refresh prices</button>
                                            </div>
                                        </div>
                                        <div className="mdl-kpi-grid pf-workspace-v2__kpis">
                                            <div className="mdl-metric">
                                                <span>Active value</span>
                                                <strong>{activeStats.current.toFixed(2)}</strong>
                                                <small>Marked book</small>
                                            </div>
                                            <div className="mdl-metric">
                                                <span>Invested</span>
                                                <strong>{activeStats.invested.toFixed(2)}</strong>
                                                <small>Cost basis</small>
                                            </div>
                                            <div className="mdl-metric">
                                                <span>Gross P/L</span>
                                                <strong className={activeStats.grossPnl >= 0 ? 'md-text-up' : 'md-text-down'}>{activeStats.grossPnl.toFixed(2)}</strong>
                                                <small>Unrealized + realized</small>
                                            </div>
                                            <div className="mdl-metric">
                                                <span>Holdings</span>
                                                <strong>{holdings.length}</strong>
                                                <small>Positions</small>
                                            </div>
                                        </div>
                                    </div>
                                </article>

                                <article className="mdl-card pf-workspace-v2__card">
                                    <div className="mdl-card__header pf-workspace-v2__card-header">
                                        <div>
                                            <h3>Manage portfolios</h3>
                                            <span className="pf-workspace-v2__card-sub">Create, rename, duplicate, and review books</span>
                                        </div>
                                    </div>
                                    <div className="pf-workspace-v2__card-body">
                                        <div className="pf-workspace-v2__form-stack">
                                            <div className="pf-workspace-v2__form-row">
                                                <label className="md-field-label">Create portfolio</label>
                                                <div className="pf-workspace-v2__row-inputs">
                                                    <input className="md-input" placeholder="Portfolio name" value={state.newPortfolioName} onChange={(e) => handlers.setNewPortfolioName(e.target.value)} />
                                                    <button type="button" className="md-btn md-btn--small" onClick={() => handlers.createPortfolio()}>Create</button>
                                                </div>
                                            </div>
                                            <div className="pf-workspace-v2__form-row">
                                                <label className="md-field-label">Rename active portfolio</label>
                                                <div className="pf-workspace-v2__row-inputs">
                                                    <input className="md-input" placeholder="Rename active portfolio" value={state.portfolioRenameInput} onChange={(e) => handlers.setPortfolioRenameInput(e.target.value)} />
                                                    <button type="button" className="md-btn md-btn--small" onClick={() => handlers.renamePortfolio()}>Rename</button>
                                                    <button type="button" className="md-btn md-btn--small md-btn--danger" onClick={() => handlers.deletePortfolio(state.selectedPortfolio)}>Delete</button>
                                                </div>
                                            </div>
                                            <div className="pf-workspace-v2__form-row">
                                                <label className="md-field-label">Duplicate active portfolio</label>
                                                <div className="pf-workspace-v2__row-inputs pf-workspace-v2__row-inputs--wrap">
                                                    <input className="md-input" placeholder="Copy name" value={duplicatePortfolioName} onChange={(e) => setDuplicatePortfolioName(e.target.value)} />
                                                    <select className="md-select-inline" value={duplicatePortfolioMode} onChange={(e) => setDuplicatePortfolioMode(e.target.value)}>
                                                        <option value="structure">Structure only</option>
                                                        <option value="transactions">Transactions only</option>
                                                        <option value="full">Full clone</option>
                                                    </select>
                                                    <button type="button" className="md-btn md-btn--small" onClick={() => handlers.duplicatePortfolio(duplicatePortfolioMode, duplicatePortfolioName)}>Duplicate</button>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="pf-workspace-v2__rollup-label">All books</div>
                                        <div className="pf-workspace-v2__rollup">
                                            {portfolioRollup.map((row) => (
                                                <button
                                                    key={`${row.name}_workspace`}
                                                    type="button"
                                                    className={`pf-workspace-v2__rollup-item ${state.selectedPortfolio === row.name ? 'pf-workspace-v2__rollup-item--active' : ''}`}
                                                    onClick={() => handlers.setSelectedPortfolio(row.name)}
                                                >
                                                    <div className="pf-workspace-v2__rollup-top">
                                                        <strong>{row.name}</strong>
                                                        <span>{row.holdings} holdings</span>
                                                    </div>
                                                    <span className="pf-workspace-v2__rollup-meta">
                                                        Current {row.current.toFixed(2)}
                                                        <span className={row.pnl >= 0 ? 'md-text-up' : 'md-text-down'}> · P/L {row.pnl.toFixed(2)}</span>
                                                    </span>
                                                </button>
                                            ))}
                                            {!portfolioRollup.length && <div className="md-empty pf-workspace-v2__rollup-empty">Create your first portfolio to get started.</div>}
                                        </div>
                                    </div>
                                </article>
                            </div>
                            <p className="wl-panel__hint pf-workspace-v2__hint">
                                Search-backed assets autofill when available; custom assets can still be tracked with descriptions and notes.
                            </p>
                        </div>
                    </section>

                    <section className="pf-insights-full">
                        <div className="md-home-panel pf-side-card pf-insights-panel">
                            <div className="pf-side-card__head"><h3>Insights</h3><span>{holdings.length} holdings · as of {asOfLabel}</span></div>
                            <div className="pf-health-grid pf-health-grid--minimal">
                                <div className="pf-health-tile"><span>Profitable</span><strong>{profitablePct}%</strong><em>{activeStats.profitable}/{activeStats.holdings || 0} holdings</em></div>
                                <div className="pf-health-tile"><span>Top 2</span><strong>{concentrationPct.toFixed(1)}%</strong><em>Current concentration</em></div>
                                <div className="pf-health-tile"><span>Lead</span><strong>{primarySegment?.label || '—'}</strong><em>{primaryCountry?.label || 'No country yet'}</em></div>
                            </div>
                            <div className="pf-insights-grid">
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Top holdings</div>
                                    <div className="md-home-list pf-top-holdings">
                                        {topHoldings.slice(0, 3).map((row) => (
                                            <button key={`${row.id}_top`} type="button" className="md-list-item md-list-item--col pf-holding-card" onClick={() => openAnalysisSymbol(row.symbol)}>
                                                <div className="pf-holding-card__top">
                                                    <strong>{row.assetName || row.symbol}</strong>
                                                    <span>{row.weightPct.toFixed(1)}%</span>
                                                </div>
                                                <div className="pf-holding-card__meta">{row.symbol} · {row.segment || 'Equity'} · {row.country || 'Country n/a'}</div>
                                            </button>
                                        ))}
                                        {!topHoldings.length && <div className="md-empty">Add holdings to surface quick insights.</div>}
                                    </div>
                                </div>
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Research signals</div>
                                    <div className="pf-signal-grid">
                                        {heldMlSignals.slice(0, 3).map((row) => <div key={`${row.symbol}_ml`} className="pf-signal-card"><div className="pf-signal-card__head"><strong>{row.symbol}</strong><span className={Number(row.predicted_return_pct || 0) >= 0 ? 'md-text-up' : 'md-text-down'}>{Number(row.predicted_return_pct || 0).toFixed(2)}%</span></div><em>{row.label || 'Neutral'} · Confidence {Number(row.confidence_pct || 0).toFixed(1)}%</em></div>)}
                                        {heldMacroSignals.slice(0, 3).map((row) => <div key={`${row.symbol}_macro`} className="pf-signal-card"><div className="pf-signal-card__head"><strong>{row.symbol}</strong><span className={Number(row.totalScore || 0) >= 0 ? 'md-text-up' : 'md-text-down'}>{Number(row.totalScore || 0).toFixed(2)}</span></div><em>{row.stance || 'Neutral'} · Macro {row.scenario || state.macroLabConfig?.scenario || 'Base'}</em></div>)}
                                        {!heldMlSignals.length && !heldMacroSignals.length && <div className="md-empty">Run Macro Lab or ML Signal Lab in `Research` to surface held-symbol signals here.</div>}
                                    </div>
                                </div>
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Latest activity</div>
                                    <div className="md-home-list pf-compact-list">
                                        {recentPurchases.slice(0, 3).map((p) => (
                                            <div key={`${p.id}_recent`} className="md-list-item md-list-item--col pf-activity-card">
                                                <div className="pf-activity-card__top">
                                                    <strong>{p.symbol}</strong>
                                                    <span>{p.tradeDate || 'No date'}</span>
                                                </div>
                                                <div className="pf-activity-card__meta">{p.assetName || p.symbol} · {p.side || 'BUY'} · {p.purchaseType || 'Delivery'}</div>
                                            </div>
                                        ))}
                                        {!recentPurchases.length && <div className="md-empty">No dated purchases yet.</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="pf-analytics-suite">
                        <div className="md-home-panel pf-analytics-panel">
                            <div className="md-section-head">
                                <h2>Analytics suite</h2>
                                <span>{portfolioAnalyticsLoading ? 'Refreshing derived analytics...' : `${state.selectedPortfolio || 'Main'} derived from backend ledger`}</span>
                            </div>
                            <div className="pf-kpi-strip pf-kpi-strip--performance">
                                <div className="pf-kpi-card"><span>Invested</span><strong>{Number(analyticsKpis.invested || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Current</span><strong>{Number(analyticsKpis.current || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Realized P/L</span><strong className={Number(analyticsKpis.realizedPnl || 0) >= 0 ? 'md-text-up' : 'md-text-down'}>{Number(analyticsKpis.realizedPnl || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Unrealized P/L</span><strong className={Number(analyticsKpis.unrealizedPnl || 0) >= 0 ? 'md-text-up' : 'md-text-down'}>{Number(analyticsKpis.unrealizedPnl || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Total fees</span><strong>{Number(analyticsKpis.totalFeesPaid || 0).toFixed(2)}</strong></div>
                                <div className="pf-kpi-card"><span>Projected exit</span><strong>{Number(analyticsKpis.projectedExitCharges || 0).toFixed(2)}</strong></div>
                            </div>
                            <div className="pf-analytics-grid">
                                <div className="md-mini-chart pf-chart-card">
                                    {analyticsSeries.length ? (
                                        <ResponsiveContainer width="100%" height={260}>
                                            <LineChart data={analyticsSeries}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                                                <XAxis dataKey="month" tick={{ fill: '#8b909a', fontSize: 11 }} />
                                                <YAxis tick={{ fill: '#8b909a', fontSize: 11 }} />
                                                <ReTooltip />
                                                <Legend />
                                                <Line type="monotone" dataKey="invested" stroke="#d4af37" strokeWidth={2} dot={false} />
                                                <Line type="monotone" dataKey="current" stroke="#4ade80" strokeWidth={2} dot={false} />
                                                <Line type="monotone" dataKey="realized" stroke="#60a5fa" strokeWidth={2} dot={false} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    ) : <div className="md-empty">No cumulative series yet.</div>}
                                </div>
                                <div className="pf-analytics-side">
                                    <div className="pf-compact-section">
                                        <div className="pf-dual-list__label">Fee drain by holding</div>
                                        <div className="md-home-list pf-compact-list">
                                            {analyticsFeeByHolding.slice(0, 5).map((row) => (
                                                <div key={`${row.symbol}_fee`} className="md-list-item md-list-item--col">
                                                    <strong>{row.symbol}</strong>
                                                    <span>{Number(row.fees || 0).toFixed(2)}</span>
                                                </div>
                                            ))}
                                            {!analyticsFeeByHolding.length && <div className="md-empty">No fee leaders yet.</div>}
                                        </div>
                                    </div>
                                    <div className="pf-compact-section">
                                        <div className="pf-dual-list__label">Fee drain by platform</div>
                                        <div className="md-home-list pf-compact-list">
                                            {analyticsFeeByPlatform.slice(0, 5).map((row) => (
                                                <div key={`${row.platform}_platform_fee`} className="md-list-item md-list-item--col">
                                                    <strong>{row.platform}</strong>
                                                    <span>{Number(row.fees || 0).toFixed(2)}</span>
                                                </div>
                                            ))}
                                            {!analyticsFeeByPlatform.length && <div className="md-empty">No platform fee data yet.</div>}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="pf-analytics-grid">
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Average cost ladders</div>
                                    <div className="pf-ladder-grid">
                                        {analyticsCostLadders.slice(0, 4).map((row) => (
                                            <div key={`${row.symbol}_ladder`} className="pf-ladder-card">
                                                <strong>{row.symbol}</strong>
                                                {(row.steps || []).slice(-4).map((step) => (
                                                    <div key={`${row.symbol}_${step.tradeDate}_${step.price}`} className="pf-ladder-step">
                                                        <span>{step.tradeDate || 'No date'}</span>
                                                        <em>{Number(step.quantity || 0).toLocaleString()} @ {Number(step.price || 0).toFixed(2)}</em>
                                                        <strong>Avg {Number(step.runningAverage || 0).toFixed(2)}</strong>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                        {!analyticsCostLadders.length && <div className="md-empty">Add multiple buy legs to populate average-cost ladders.</div>}
                                    </div>
                                </div>
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Transaction heatmap</div>
                                    <div className="pf-heatmap-grid">
                                        {analyticsHeatmap.slice(0, 12).map((row) => (
                                            <div key={row.key} className="pf-heatmap-cell">
                                                <strong>{row.month}</strong>
                                                <span>{row.platform}</span>
                                                <em>{row.segment}</em>
                                                <b>{row.count} txns</b>
                                            </div>
                                        ))}
                                        {!analyticsHeatmap.length && <div className="md-empty">Transaction heatmap appears once activity builds up.</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="pf-details-grid">
                        <div className="md-home-panel pf-holdings-panel">
                            <div className="md-section-head">
                                <h2>Holdings</h2>
                                <div className="md-home-actions md-home-actions--wrap pf-holdings-controls">
                                    <div className="wl-regime-pill">{holdingRows.length} rows</div>
                                    <button type="button" className={`md-btn md-btn--small ${holdingsScope === 'selected' ? 'md-btn--on' : ''}`} onClick={() => setHoldingsScope('selected')}>
                                        {state.selectedPortfolio || 'Main'}
                                    </button>
                                    <button type="button" className={`md-btn md-btn--small ${holdingsScope === 'combined' ? 'md-btn--on' : ''}`} onClick={() => setHoldingsScope('combined')}>
                                        Combined
                                    </button>
                                </div>
                            </div>
                            <div className="pf-holdings-grid">
                                {holdingRows.map((p) => (
                                    <div key={`${p.portfolioName || 'Main'}_${p.id}`} className="pf-holding-mini-card">
                                        <div className="pf-holding-mini-card__top">
                                            <div className="pf-holding-mini-card__identity">
                                                <strong>{p.assetName || p.symbol}</strong>
                                                <div className="pf-holding-mini-card__meta">{p.symbol} · {p.purchaseType || 'Delivery'} · {p.segment || 'Equity'}</div>
                                                {holdingsScope === 'combined' && <div className="pf-holding-mini-card__portfolio">{p.portfolioName || 'Main'}</div>}
                                                {!!p.description && <div className="pf-holding-mini-card__meta">{p.description}</div>}
                                            </div>
                                            <div className="md-home-actions pf-holding-mini-card__actions">
                                                <button type="button" className="md-btn md-btn--small" onClick={() => openHoldingEditor(p)}>Edit</button>
                                                <button type="button" className="md-btn md-btn--small" onClick={() => handlers.openPortfolioQuickTransaction('BUY', p.transactions?.[p.transactions.length - 1] || p, p.portfolioName)}>Buy more</button>
                                                <button type="button" className="md-btn md-btn--small" onClick={() => handlers.openPortfolioQuickTransaction('SELL', p.transactions?.[p.transactions.length - 1] || p, p.portfolioName)}>Sell more</button>
                                                <button type="button" className="md-btn md-btn--small" onClick={() => explainHolding(p)}>Explain</button>
                                                <button type="button" className="md-btn md-btn--small" onClick={() => generateJournalSummary('holding', p)}>Journal</button>
                                                <button type="button" className="md-btn md-btn--small" onClick={() => openAnalysisSymbol(p.symbol)}>Open</button>
                                                <button type="button" className="md-watch-card__rm" onClick={() => handlers.removePortfolioPosition(p.id, p.portfolioName)}>×</button>
                                            </div>
                                        </div>
                                        <div className="pf-holding-mini-card__stats">
                                            <div><span>Units</span><strong>{Number(p.quantity || 0).toLocaleString()}</strong></div>
                                            <div><span>Net P/L</span><strong className={p.pnl >= 0 ? 'md-text-up' : 'md-text-down'}>{p.pnl.toFixed(2)}</strong></div>
                                            <div><span>Avg cost</span><strong>{p.currencySymbol || '$'}{Number(p.buyPrice || 0).toFixed(2)}</strong></div>
                                            <div><span>Current</span><strong>{p.currencySymbol || '$'}{Number(p.currentPrice || 0).toFixed(2)}</strong></div>
                                            <div><span>Country</span><strong>{p.country || '—'}</strong></div>
                                            <div><span>Last trade</span><strong>{p.lastTradeDate || '—'}</strong></div>
                                        </div>
                                        <div className="pf-holding-mini-card__footer">
                                            <div className="pf-holding-mini-card__footer-item">
                                                <span>Platform</span>
                                                <strong>{p.platform || '—'}</strong>
                                            </div>
                                            <div className="pf-holding-mini-card__footer-item">
                                                <span>Realized</span>
                                                <strong>{Number(p.realizedPnl || 0).toFixed(2)}</strong>
                                            </div>
                                        </div>
                                        <div className="pf-note-preview">Transactions {Number(p.transactionCount || 0)} · Exit cost est. {Number(p.projectedExitCharges || 0).toFixed(2)}</div>
                                        {!!p.notes && <div className="pf-note-preview">{String(p.notes).slice(0, 220)}</div>}
                                    </div>
                                ))}
                                {!holdingRows.length && <div className="md-empty">No holdings in this portfolio yet.</div>}
                            </div>
                        </div>
                    </section>

                    <section className="pf-transaction-section">
                        <div className="md-home-panel pf-transaction-panel">
                            <div className="md-section-head">
                                <h2>Transaction ledger</h2>
                                <div className="md-home-actions md-home-actions--wrap">
                                    <span>{state.selectedPortfolio || 'Main'} · {filteredTransactionRows.length}/{transactionRows.length} entries</span>
                                    <button type="button" className="md-btn md-btn--small" onClick={() => handlers.openPortfolioModal('add')}>
                                        Add transaction
                                    </button>
                                </div>
                            </div>
                            <div className="pf-filter-toolbar">
                                <input className="md-input" placeholder="Filter by symbol or name" value={transactionFilters.symbol} onChange={(e) => setTransactionFilters((prev) => ({ ...prev, symbol: e.target.value }))} />
                                <select className="md-select-inline" value={transactionFilters.side} onChange={(e) => setTransactionFilters((prev) => ({ ...prev, side: e.target.value }))}>
                                    <option value="ALL">All sides</option>
                                    {TRANSACTION_SIDE_CHOICES.map((side) => <option key={side} value={side}>{side}</option>)}
                                </select>
                                <select className="md-select-inline" value={transactionFilters.platform} onChange={(e) => setTransactionFilters((prev) => ({ ...prev, platform: e.target.value }))}>
                                    {uniquePlatforms.map((row) => <option key={row} value={row}>{row === 'ALL' ? 'All platforms' : row}</option>)}
                                </select>
                                <select className="md-select-inline" value={transactionFilters.segment} onChange={(e) => setTransactionFilters((prev) => ({ ...prev, segment: e.target.value }))}>
                                    {uniqueSegments.map((row) => <option key={row} value={row}>{row === 'ALL' ? 'All segments' : row}</option>)}
                                </select>
                                <input className="md-input" type="date" value={transactionFilters.startDate} onChange={(e) => setTransactionFilters((prev) => ({ ...prev, startDate: e.target.value }))} />
                                <input className="md-input" type="date" value={transactionFilters.endDate} onChange={(e) => setTransactionFilters((prev) => ({ ...prev, endDate: e.target.value }))} />
                            </div>
                            <div className="pf-transaction-list">
                                {filteredTransactionRows.map((txn) => (
                                    <div key={txn.id} className="pf-transaction-row">
                                        <div className="pf-transaction-row__main">
                                            <strong>{txn.symbol}</strong>
                                            <span>{txn.assetName || txn.symbol}</span>
                                            <em>{txn.tradeDate || 'No date'} · {txn.side}{txn.transactionSubtype ? `/${txn.transactionSubtype}` : ''} · {txn.purchaseType || 'Delivery'} · {txn.platform || 'Platform n/a'}</em>
                                            {!!txn.brokerReference && <span>Ref: {txn.brokerReference}</span>}
                                        </div>
                                        <div className="pf-transaction-row__stats">
                                            <div><span>Units</span><strong>{Number(txn.quantity || 0).toLocaleString()}</strong></div>
                                            <div><span>Price</span><strong>{Number(txn.price || 0).toFixed(2)}</strong></div>
                                            <div><span>Charges</span><strong>{Number(txn.chargeSnapshot?.totalCharges || 0).toFixed(2)}</strong></div>
                                        </div>
                                        <div className="md-home-actions pf-transaction-row__actions">
                                            <button type="button" className="md-btn md-btn--small" onClick={() => handlers.openPortfolioQuickTransaction('BUY', txn)}>Buy more</button>
                                            <button type="button" className="md-btn md-btn--small" onClick={() => handlers.openPortfolioQuickTransaction('SELL', txn)}>Sell more</button>
                                            <button type="button" className="md-btn md-btn--small" onClick={() => handlers.openPortfolioModal('edit', txn)}>Edit</button>
                                            <button type="button" className="md-btn md-btn--small" onClick={() => explainHolding(txn)}>Explain</button>
                                            <button type="button" className="md-btn md-btn--small" onClick={() => openAnalysisSymbol(txn.symbol)}>Open</button>
                                            <button type="button" className="md-watch-card__rm" onClick={() => handlers.removePortfolioPosition(txn.id, state.selectedPortfolio)}>×</button>
                                        </div>
                                    </div>
                                ))}
                                {!filteredTransactionRows.length && <div className="md-empty">No transactions match the active filters.</div>}
                            </div>
                        </div>
                    </section>

                    <section className="pf-ideas-section">
                        <div className="md-home-panel pf-ideas-panel">
                            <div className="md-section-head">
                                <h2>Workflow import suite</h2>
                                <span>Preview broker CSV rows before they become transactions</span>
                            </div>
                            <div className="pf-import-suite">
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Paste broker CSV</div>
                                    <textarea className="md-input pf-import-textarea" placeholder="symbol,side,tradeDate,quantity,price,platform&#10;INFY,BUY,2025-03-01,10,1520.5,Zerodha" value={portfolioImportCsv} onChange={(e) => setPortfolioImportCsv(e.target.value)} />
                                    <div className="md-home-actions md-home-actions--wrap">
                                        <button type="button" className="md-btn md-btn--small" disabled={portfolioImportLoading} onClick={() => previewPortfolioImport()}>{portfolioImportLoading ? 'Previewing...' : 'Preview import'}</button>
                                        <button type="button" className="md-btn md-btn--small" disabled={portfolioImportLoading || !(portfolioImportPreview?.previewRows || []).length} onClick={() => commitPortfolioImport()}>Commit rows</button>
                                    </div>
                                </div>
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Preview results</div>
                                    <div className="md-home-list pf-compact-list">
                                        <div className="md-list-item md-list-item--col">
                                            <strong>Parsed rows</strong>
                                            <span>{portfolioImportPreview?.summary?.parsedRows || 0}</span>
                                        </div>
                                        <div className="md-list-item md-list-item--col">
                                            <strong>Importable rows</strong>
                                            <span>{portfolioImportPreview?.summary?.importableRows || 0}</span>
                                        </div>
                                        <div className="md-list-item md-list-item--col">
                                            <strong>Errors</strong>
                                            <span>{portfolioImportPreview?.summary?.errorCount || 0}</span>
                                        </div>
                                        {(portfolioImportPreview?.errorRows || []).slice(0, 4).map((row) => (
                                            <div key={row} className="md-list-item md-list-item--col">
                                                <strong>Issue</strong>
                                                <span>{row}</span>
                                            </div>
                                        ))}
                                        {(portfolioImportPreview?.previewRows || []).slice(0, 4).map((row) => (
                                            <div key={row.id} className="md-list-item md-list-item--col">
                                                <strong>{row.symbol}</strong>
                                                <span>{row.side} · {row.tradeDate || 'No date'} · Qty {Number(row.quantity || 0).toFixed(2)} @ {Number(row.price || 0).toFixed(2)}</span>
                                            </div>
                                        ))}
                                        {!portfolioImportPreview && <div className="md-empty">Preview validates rows, shows mapping issues, and only then lets you commit.</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="pf-reports-section">
                        <div className="md-home-panel pf-reports-panel">
                            <div className="md-section-head">
                                <h2>India tax and fee reports</h2>
                                <div className="md-home-actions md-home-actions--wrap">
                                    <select className="md-select-inline" value={financialYearFilter} onChange={(e) => setFinancialYearFilter(e.target.value)}>
                                        {taxYears.map((row) => <option key={row} value={row}>{row}</option>)}
                                    </select>
                                    <button type="button" className="md-btn md-btn--small" onClick={() => exportTaxSummary()}>Export tax CSV</button>
                                    <button type="button" className="md-btn md-btn--small" onClick={() => exportFeeSummary()}>Export fee CSV</button>
                                </div>
                            </div>
                            <div className="pf-report-grid">
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Current-year tax liability</div>
                                    <div className="pf-report-metrics">
                                        <div><span>{state.selectedPortfolio || 'Main'} realized FY tax estimate</span><strong>{Number(portfolioTaxSummary?.currentYearRealizedTax || 0).toFixed(2)}</strong></div>
                                        <div><span>{state.selectedPortfolio || 'Main'} sell-now holding tax estimate</span><strong>{Number(portfolioTaxSummary?.sellNowTaxLiability || 0).toFixed(2)}</strong></div>
                                        <div><span>{state.selectedPortfolio || 'Main'} net FY tax liability</span><strong>{Number(portfolioTaxSummary?.netTaxLiabilityCurrentYear || 0).toFixed(2)}</strong></div>
                                        <div><span>All holdings net FY tax liability</span><strong>{Number(portfolioTaxSummaryAll?.netTaxLiabilityCurrentYear || 0).toFixed(2)}</strong></div>
                                        <div><span>Suggested cover for {state.selectedPortfolio || 'Main'} (2x net FY liability)</span><strong>{Number((portfolioTaxSummary?.netTaxLiabilityCurrentYear || 0) * 2).toFixed(2)}</strong></div>
                                        <div><span>Suggested cover for all holdings (2x net FY liability)</span><strong>{Number((portfolioTaxSummaryAll?.netTaxLiabilityCurrentYear || 0) * 2).toFixed(2)}</strong></div>
                                    </div>
                                </div>
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Per portfolio tax view</div>
                                    <div className="md-home-list pf-compact-list">
                                        {taxPortfolioBreakdown.map((row) => (
                                            <div key={row.portfolioName} className="md-list-item md-list-item--col">
                                                <strong>{row.portfolioName}</strong>
                                                <span>Realized FY {Number(row.currentYearRealizedTax || 0).toFixed(2)} · Sell now {Number(row.sellNowTaxLiability || 0).toFixed(2)} · Net FY {Number(row.netTaxLiabilityCurrentYear || 0).toFixed(2)}</span>
                                            </div>
                                        ))}
                                        {!taxPortfolioBreakdown.length && <div className="md-empty">{portfolioTaxLoading ? 'Refreshing tax estimates...' : 'No portfolio tax rows yet.'}</div>}
                                    </div>
                                </div>
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Sell-now holding liabilities</div>
                                    <div className="md-home-list pf-compact-list">
                                        {taxHoldings.slice(0, 8).map((row) => (
                                            <div key={row.symbol} className="md-list-item md-list-item--col">
                                                <strong>{row.symbol} · {row.taxProfileLabel}</strong>
                                                <span>Gain {Number(row.sellNowGain || 0).toFixed(2)} · Tax {Number(row.estimatedTaxLiability || 0).toFixed(2)} · LT gain {Number(row.longTermGain || 0).toFixed(2)} · ST gain {Number(row.shortTermGain || 0).toFixed(2)}</span>
                                                <span>{row.rateNote || `ST ${Number(row.shortTermRatePct || 0).toFixed(1)}% · LT ${Number(row.longTermRatePct || 0).toFixed(1)}%`} {Number(row.equityExemptionUsed || 0) > 0 ? `· Equity exemption used ${Number(row.equityExemptionUsed || 0).toFixed(2)}` : ''}</span>
                                            </div>
                                        ))}
                                        {!taxHoldings.length && <div className="md-empty">{portfolioTaxLoading ? 'Refreshing sell-now holding taxes...' : 'No open holding liabilities yet.'}</div>}
                                    </div>
                                </div>
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Realized tax buckets</div>
                                    <div className="md-home-list pf-compact-list">
                                        {taxBuckets.map((row) => (
                                            <div key={`${row.taxProfile}_${row.taxBucket}`} className="md-list-item md-list-item--col">
                                                <strong>{row.taxProfileLabel} · {row.taxBucket}</strong>
                                                <span>P/L {Number(row.pnl || 0).toFixed(2)} · Est. tax {Number(row.estimatedTax || 0).toFixed(2)} · {row.events || 0} events · Qty {Number(row.quantity || 0).toFixed(2)}</span>
                                                <span>{row.rateNote || `ST ${Number(row.shortTermRatePct || 0).toFixed(1)}% · LT ${Number(row.longTermRatePct || 0).toFixed(1)}%`}</span>
                                            </div>
                                        ))}
                                        {!taxBuckets.length && <div className="md-empty">{portfolioTaxLoading ? 'Refreshing tax estimates...' : 'No realized tax events yet.'}</div>}
                                    </div>
                                </div>
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Portfolio exit estimate</div>
                                    <div className="pf-report-metrics">
                                        <div><span>Sell-all exit charges</span><strong>{Number(portfolioTaxSummary?.sellAllExitEstimate || 0).toFixed(2)}</strong></div>
                                        <div><span>Fees already paid</span><strong>{Number(portfolioTaxSummary?.estimatedFeeBurden || 0).toFixed(2)}</strong></div>
                                        <div><span>Equity LTCG exemption used</span><strong>{Number(portfolioTaxSummary?.equityLtcgExemptionUsed || 0).toFixed(2)}</strong></div>
                                        <div><span>Equity LTCG exemption left</span><strong>{Number(portfolioTaxSummary?.equityLtcgExemptionRemaining || 0).toFixed(2)}</strong></div>
                                    </div>
                                </div>
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">Fee line summary</div>
                                    <div className="md-home-list pf-compact-list">
                                        {(portfolioFeeSummary?.lines || []).slice(0, 6).map((row) => (
                                            <div key={row.label} className="md-list-item md-list-item--col">
                                                <strong>{row.label}</strong>
                                                <span>{Number(row.amount || 0).toFixed(2)}</span>
                                            </div>
                                        ))}
                                        {!portfolioFeeSummary?.lines?.length && <div className="md-empty">{portfolioFeeSummaryLoading ? 'Refreshing fee summary...' : 'No fee lines available yet.'}</div>}
                                    </div>
                                </div>
                                <div className="pf-idea-card">
                                    <div className="pf-dual-list__label">India tax assumptions</div>
                                    <div className="md-home-list pf-compact-list">
                                        <div className="md-list-item md-list-item--col">
                                            <strong>Financial year</strong>
                                            <span>{portfolioTaxSummary?.financialYear || financialYearFilter}</span>
                                        </div>
                                        <div className="md-list-item md-list-item--col">
                                            <strong>Cash cover suggestion</strong>
                                            <span>Keep at least 2x of the displayed net FY tax liability as a reserve cover for the selected portfolio and the combined book.</span>
                                        </div>
                                        {(portfolioTaxSummary?.assumptions || []).map((row) => (
                                            <div key={row} className="md-list-item md-list-item--col">
                                                <span>{row}</span>
                                            </div>
                                        ))}
                                        {!(portfolioTaxSummary?.assumptions || []).length && <div className="md-empty">Tax estimation assumptions will appear here.</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                <aside className="pf-dock-column">
                    <section className="pf-ai-shell pf-ai-shell--dock">
                        <div className="md-home-panel pf-ai-hero pf-ai-hero--dock">
                            <div className="pf-ai-hero__head">
                                <div>
                                    <div className="pf-eyebrow">Ollama Portfolio Copilot</div>
                                    <h2 className="pf-hero-card__title">Ask first, review second</h2>
                                    <p className="pf-hero-card__sub">
                                        Keep the copilot visible while you review performance, workspace controls, insights, and holdings.
                                    </p>
                                </div>
                                <div className="pf-ai-hero__status">
                                    <div className={`pf-sync-badge ${state.portfolioSyncing ? 'pf-sync-badge--live' : ''}`}>{state.portfolioSyncing ? 'Syncing' : state.portfolioHydrated ? 'Synced' : 'Loading'}</div>
                                    <div className="wl-regime-pill">LLM: {state.localLlmEnabled ? 'On' : 'Off'}</div>
                                    <div className="wl-regime-pill">Model: {state.localLlmModel || 'llama3.1'}</div>
                                </div>
                            </div>
                            <div className="pf-ai-hero__grid">
                                <div className="pf-ai-hero__ask">
                                    <div className="pf-copilot-head">
                                        <div>
                                            <h3>Portfolio copilot</h3>
                                            <p className="md-rail__muted">Ask about diversification, overexposure, weak holdings, or what deserves action next.</p>
                                        </div>
                                        <div className="wl-regime-pill">{state.selectedPortfolio || 'Main'} active</div>
                                    </div>
                                    <textarea className="md-input pf-copilot-textarea pf-copilot-textarea--hero" placeholder="Ask about diversification, risk, weakest holdings, or portfolio next steps..." value={portfolioCopilotPrompt} onChange={(e) => setPortfolioCopilotPrompt(e.target.value)} />
                                    <div className="pf-copilot-actions">
                                        <button type="button" className="md-btn md-btn--small" disabled={portfolioCopilotLoading || !holdings.length} onClick={() => runPortfolioCopilot()}>{portfolioCopilotLoading ? 'Thinking...' : 'Ask copilot'}</button>
                                        <button type="button" className="md-btn md-btn--small" disabled={!portfolioCopilotPrompt.trim()} onClick={() => saveCurrentPrompt()}>Save prompt</button>
                                        <button type="button" className="md-btn md-btn--small" disabled={portfolioCopilotLoading || !holdings.length} onClick={() => generateJournalSummary('portfolio')}>Journal</button>
                                        {quickCopilotPrompts.map((prompt) => (
                                            <button key={prompt} type="button" className="md-btn md-btn--small" disabled={portfolioCopilotLoading || !holdings.length} onClick={() => { setPortfolioCopilotPrompt(prompt); runPortfolioCopilot(prompt); }}>
                                                {prompt.length > 28 ? `${prompt.slice(0, 28)}...` : prompt}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="pf-copilot-meta">{portfolioCopilotLastPrompt ? `Last question: ${portfolioCopilotLastPrompt}` : state.localLlmLastStatus || 'Local runtime status appears in Settings.'}</div>
                                </div>
                                <div className={`pf-copilot-answer pf-copilot-answer--hero ${portfolioCopilotError ? 'pf-copilot-answer--error' : ''}`}>
                                    {portfolioCopilotError ? <div>{portfolioCopilotError}</div> : portfolioCopilotAnswer ? <div>{portfolioCopilotAnswer}</div> : <div className="pf-copilot-answer--empty">{holdings.length ? 'Try a quick prompt or ask your own question to get a concise portfolio readout from the local model.' : 'Add holdings to the active portfolio before using the copilot.'}</div>}
                                </div>
                            </div>
                            <div className="pf-ai-context-grid">
                                <div className="pf-context-card"><span>Active value</span><strong>{activeStats.current.toFixed(2)}</strong><em>{holdings.length} holdings</em></div>
                                <div className="pf-context-card"><span>Top 2 concentration</span><strong>{concentrationPct.toFixed(1)}%</strong><em>Share of current book</em></div>
                                <div className="pf-context-card"><span>Lead segment</span><strong>{primarySegment?.label || '—'}</strong><em>{primarySegment ? primarySegment.current.toFixed(2) : 'No allocation yet'}</em></div>
                            </div>
                            <div className="pf-dock-stacks">
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Saved prompts</div>
                                    <div className="pf-chip-list">
                                        {savedPrompts.map((prompt) => (
                                            <button key={prompt} type="button" className="md-btn md-btn--small" onClick={() => { setPortfolioCopilotPrompt(prompt); runPortfolioCopilot(prompt); }}>
                                                {prompt.length > 32 ? `${prompt.slice(0, 32)}...` : prompt}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Anomaly prompts</div>
                                    <div className="pf-chip-list">
                                        {anomalyPrompts.map((prompt) => (
                                            <button key={prompt} type="button" className="md-btn md-btn--small" onClick={() => { setPortfolioCopilotPrompt(prompt); runPortfolioCopilot(prompt); }}>
                                                {prompt.length > 32 ? `${prompt.slice(0, 32)}...` : prompt}
                                            </button>
                                        ))}
                                        {!anomalyPrompts.length && <div className="md-empty">Anomaly prompts appear once backend portfolio context detects notable fee or tax flags.</div>}
                                    </div>
                                </div>
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Prompt history</div>
                                    <div className="md-home-list pf-compact-list">
                                        {promptHistory.slice(0, 5).map((row) => (
                                            <button key={`${row.askedAt}_${row.prompt}`} type="button" className="md-list-item md-list-item--col" onClick={() => { setPortfolioCopilotPrompt(row.prompt); runPortfolioCopilot(row.prompt); }}>
                                                <strong>{row.portfolio}</strong>
                                                <span>{row.prompt}</span>
                                            </button>
                                        ))}
                                        {!promptHistory.length && <div className="md-empty">Your recent portfolio prompts will appear here.</div>}
                                    </div>
                                </div>
                                <div className="pf-compact-section">
                                    <div className="pf-dual-list__label">Saved journals</div>
                                    <div className="md-home-list pf-compact-list">
                                        {Object.entries(portfolioJournalMap).slice(0, 4).map(([key, row]) => (
                                            <div key={key} className="md-list-item md-list-item--col">
                                                <strong>{row.symbol || row.scope}</strong>
                                                <span>{String(row.text || '').slice(0, 180)}</span>
                                            </div>
                                        ))}
                                        {!Object.keys(portfolioJournalMap).length && <div className="md-empty">Generate a portfolio or holding journal to save a reusable narrative.</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                </aside>
            </div>


            {state.portfolioModalOpen && (
                <div className="pf-modal-backdrop" role="presentation" onClick={() => handlers.closePortfolioModal()}>
                    <div className="pf-modal" role="dialog" aria-modal="true" aria-label={isEditingPosition ? 'Edit transaction' : 'Add transaction'} onClick={(e) => e.stopPropagation()}>
                        <div className="pf-modal__head">
                            <div>
                                <div className="pf-eyebrow">Portfolio Transaction</div>
                                <h2 className="pf-modal__title">{isEditingPosition ? 'Edit transaction' : 'Add transaction'}</h2>
                                <p className="pf-modal__sub">
                                    Record buys, sells, dividends, fees, taxes, and corporate-action adjustments so average cost, realized P/L, and broker charges stay accurate.
                                </p>
                            </div>
                            <button type="button" className="pf-modal__close" onClick={() => handlers.closePortfolioModal()}>
                                Close
                            </button>
                        </div>

                        <div className="pf-modal__top">
                            <div className="pf-form-search">
                            <div className="md-input-group">
                                <label className="md-field-label">Asset name</label>
                                <input
                                    className="md-input"
                                    placeholder="Apple Inc. or custom asset"
                                    value={state.portfolioForm.assetName}
                                    onChange={(e) => handlers.setPortfolioFormValue('assetName', e.target.value)}
                                    onFocus={() => handlers.setPortfolioFormValue('assetName', state.portfolioForm.assetName || '')}
                                />
                            </div>
                            <div className="md-input-group">
                                <label className="md-field-label">Ticker name</label>
                                <div className="md-autocomplete pf-autocomplete">
                                    <input
                                        className="md-input"
                                        placeholder="AAPL or custom ticker"
                                        value={state.portfolioForm.symbol}
                                        onChange={(e) => handlers.setPortfolioFormValue('symbol', e.target.value.toUpperCase())}
                                        onFocus={() => handlers.setPortfolioFormValue('symbol', state.portfolioForm.symbol || '')}
                                    />
                                    {showPortfolioSearch && (
                                        <div className="md-autocomplete__menu">
                                            {state.portfolioSearchLoading ? (
                                                <div className="md-autocomplete__item">Searching instruments...</div>
                                            ) : state.portfolioSearchResults.length > 0 ? (
                                                state.portfolioSearchResults.map((r) => (
                                                    <button
                                                        key={`${r.symbol}_${r.exchange}_${r.source}_portfolio`}
                                                        type="button"
                                                        className="md-autocomplete__item"
                                                        onClick={() => handlers.selectPortfolioSearchResult(r)}
                                                    >
                                                        <strong>{r.symbol}</strong>
                                                        <span>{r.name}</span>
                                                        <em>
                                                            {r.assetType}
                                                            {r.assetFamily ? ` · ${r.assetFamily}` : ''}
                                                            {r.exchange ? ` · ${r.exchange}` : ''}
                                                            {r.isProxy ? ' · proxy' : ''}
                                                        </em>
                                                    </button>
                                                ))
                                            ) : (
                                                <div className="md-autocomplete__item">No searchable match. You can still add this asset manually.</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <section className="pf-projection-panel">
                            <div className="pf-projection-panel__head">
                                <div>
                                    <div className="pf-eyebrow">Projection Snapshot</div>
                                    <h3 className="pf-projection-panel__title">
                                        {projectionSymbol || projectionAssetName || 'Current portfolio item'}
                                    </h3>
                                    <p className="pf-projection-panel__sub">
                                        Compact Macro Lab and ML Signal Lab context for the holding you are editing.
                                    </p>
                                </div>
                                <div className="md-home-actions md-home-actions--wrap">
                                    <div className="wl-regime-pill">Macro: {state.macroLabConfig?.scenario || 'Base'}</div>
                                    <div className="wl-regime-pill">ML: {state.mlResearchConfig?.forecastHorizon || 5}d</div>
                                    <div className="wl-regime-pill">Segment: {projectionSegment}</div>
                                </div>
                            </div>

                            {projectionWaitingForSelection && (
                                <div className="pf-projection-empty">
                                    Pick a searchable symbol or enter a custom asset to see linked projections here.
                                </div>
                            )}

                            {projectionIsCustomOnly && !projectionWaitingForSelection && (
                                <div className="pf-projection-empty">
                                    No linked lab projection yet for this custom asset. Save it manually, or use a market-linked symbol to pull in Macro and ML context.
                                </div>
                            )}

                            {projectionLoading && (
                                <div className="pf-projection-empty">
                                    Loading research context from the current Macro Lab and ML Signal Lab runs...
                                </div>
                            )}

                            {projectionPromptResearch && (
                                <div className="pf-projection-empty">
                                    No projection is loaded for this symbol yet. Run Macro Lab or ML Signal Lab in `Research` to populate this panel.
                                </div>
                            )}

                            {!projectionWaitingForSelection && !projectionIsCustomOnly && !projectionLoading && !projectionPromptResearch && (
                                <div className="pf-projection-grid">
                                    <div className="pf-projection-card">
                                        <span>ML direction</span>
                                        {mlProjection && !mlProjection.error ? (
                                            <>
                                                <strong className={Number(mlProjection.predicted_return_pct || 0) >= 0 ? 'md-text-up' : 'md-text-down'}>
                                                    {mlProjection.label || 'Neutral'} · {Number(mlProjection.predicted_return_pct || 0).toFixed(2)}%
                                                </strong>
                                                <em>Forecast over {state.mlResearchConfig?.forecastHorizon || 5} trading days</em>
                                            </>
                                        ) : (
                                            <>
                                                <strong>No ML signal yet</strong>
                                                <em>Run ML Signal Lab for this symbol.</em>
                                            </>
                                        )}
                                    </div>
                                    <div className="pf-projection-card">
                                        <span>ML conviction</span>
                                        {mlProjection && !mlProjection.error ? (
                                            <>
                                                <strong>{Number(mlProjection.probability_up_pct || 0).toFixed(1)}% up probability</strong>
                                                <em>Confidence {Number(mlProjection.confidence_pct || 0).toFixed(1)}%</em>
                                            </>
                                        ) : (
                                            <>
                                                <strong>Awaiting ML coverage</strong>
                                                <em>Probability and confidence appear after an ML run.</em>
                                            </>
                                        )}
                                    </div>
                                    <div className="pf-projection-card">
                                        <span>Macro stance</span>
                                        {macroProjection ? (
                                            <>
                                                <strong className={Number(macroProjection.totalScore || 0) >= 0 ? 'md-text-up' : 'md-text-down'}>
                                                    {macroProjection.stance || 'Neutral'} · {Number(macroProjection.totalScore || 0).toFixed(2)}
                                                </strong>
                                                <em>
                                                    {macroDriver
                                                        ? `${String(macroDriver[0]).toUpperCase()} is the strongest driver (${Number(macroDriver[1] || 0).toFixed(2)})`
                                                        : `Confidence ${Math.round(Number(macroProjection.confidence || 0) * 100)}%`}
                                                </em>
                                            </>
                                        ) : (
                                            <>
                                                <strong>No macro stance yet</strong>
                                                <em>Refresh Macro Lab with this symbol in scope.</em>
                                            </>
                                        )}
                                    </div>
                                    <div className="pf-projection-card">
                                        <span>Scenario context</span>
                                        <strong>{state.macroLabConfig?.scenario || 'Base'} scenario</strong>
                                        <em>
                                            Risk {Number(macroRegime.riskOn || 0).toFixed(2)} · Rates {Number(macroRegime.ratesPressure || 0).toFixed(2)} · FX {Number(macroRegime.usdPressure || 0).toFixed(2)}
                                        </em>
                                    </div>
                                </div>
                            )}
                        </section>
                        </div>

                        <div className="md-form-grid portfolio-form-grid pf-form-grid">
                            <div className="md-input-group">
                                <label className="md-field-label">Transaction side</label>
                                <select className="md-select-inline" value={state.portfolioForm.side} onChange={(e) => handlers.setPortfolioFormValue('side', e.target.value)}>
                                    {TRANSACTION_SIDE_CHOICES.map((row) => (
                                        <option key={row} value={row}>{row}</option>
                                    ))}
                                </select>
                            </div>
                            {state.portfolioForm.side === 'ADJUSTMENT' && (
                                <div className="md-input-group">
                                    <label className="md-field-label">Adjustment subtype</label>
                                    <select className="md-select-inline" value={state.portfolioForm.transactionSubtype || 'Manual'} onChange={(e) => handlers.setPortfolioFormValue('transactionSubtype', e.target.value)}>
                                        {ADJUSTMENT_SUBTYPE_CHOICES.map((row) => <option key={row} value={row}>{row}</option>)}
                                    </select>
                                </div>
                            )}
                            <div className="md-input-group">
                                <label className="md-field-label">Purchase type</label>
                                <select className="md-select-inline" value={state.portfolioForm.purchaseType} onChange={(e) => handlers.setPortfolioFormValue('purchaseType', e.target.value)}>
                                    {PURCHASE_TYPE_CHOICES.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="md-input-group">
                                <label className="md-field-label">Asset family</label>
                                <select className="md-select-inline" value={state.portfolioForm.segment} onChange={(e) => handlers.setPortfolioFormValue('segment', e.target.value)}>
                                    {SEGMENT_CHOICES.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="md-input-group">
                                <label className="md-field-label">Trade date</label>
                                <input className="md-input" type="date" value={state.portfolioForm.tradeDate} onChange={(e) => handlers.setPortfolioFormValue('tradeDate', e.target.value)} />
                            </div>
                            <div className="md-input-group">
                                <label className="md-field-label">Country</label>
                                <input className="md-input" list="pf-country-options" placeholder="India" value={state.portfolioForm.country} onChange={(e) => handlers.setPortfolioFormValue('country', e.target.value)} />
                            </div>
                            <div className="md-input-group">
                                <label className="md-field-label">State / UT</label>
                                <input className="md-input" list="pf-state-options" placeholder="Maharashtra" value={state.portfolioForm.state || ''} onChange={(e) => handlers.setPortfolioFormValue('state', e.target.value)} />
                            </div>
                            <div className="md-input-group">
                                <label className="md-field-label">Platform</label>
                                <input className="md-input" list="pf-platform-options" placeholder="Zerodha" value={state.portfolioForm.platform} onChange={(e) => handlers.setPortfolioFormValue('platform', e.target.value)} />
                            </div>
                            <div className="md-input-group">
                                <label className="md-field-label">Broker reference</label>
                                <input className="md-input" placeholder="Order ID / contract note ref" value={state.portfolioForm.brokerReference || ''} onChange={(e) => handlers.setPortfolioFormValue('brokerReference', e.target.value)} />
                            </div>
                            <div className="md-input-group">
                                <label className="md-field-label">Trade price / unit</label>
                                <input className="md-input" placeholder="125.50" type="number" min="0" step="0.01" value={state.portfolioForm.price} onChange={(e) => handlers.setPortfolioFormValue('price', e.target.value)} />
                            </div>
                            <div className="md-input-group">
                                <label className="md-field-label">Units</label>
                                <input className="md-input" placeholder="10" type="number" min="0" value={state.portfolioForm.quantity} onChange={(e) => handlers.setPortfolioFormValue('quantity', e.target.value)} />
                            </div>
                            <div className="md-input-group">
                                <label className="md-field-label">Manual charge override</label>
                                <input className="md-input" placeholder="0" type="number" min="0" step="0.01" value={state.portfolioForm.manualCharge} onChange={(e) => handlers.setPortfolioFormValue('manualCharge', e.target.value)} />
                            </div>
                            <div className="md-input-group">
                                <label className="md-field-label">Manual tax override</label>
                                <input className="md-input" placeholder="0" type="number" min="0" step="0.01" value={state.portfolioForm.manualTax} onChange={(e) => handlers.setPortfolioFormValue('manualTax', e.target.value)} />
                            </div>
                        </div>

                        <datalist id="pf-platform-options">
                            {(state.portfolioFeeRegistry?.platforms || []).map((row) => (
                                <option key={row.id} value={row.label} />
                            ))}
                        </datalist>
                        <datalist id="pf-country-options">
                            {(state.portfolioFeeRegistry?.countryOptions || ['India']).map((row) => (
                                <option key={row} value={row} />
                            ))}
                        </datalist>
                        <datalist id="pf-state-options">
                            {(state.portfolioFeeRegistry?.stateOptions || []).map((row) => (
                                <option key={row} value={row} />
                            ))}
                        </datalist>

                        <section className="pf-projection-panel pf-fee-preview-panel">
                            <div className="pf-projection-panel__head">
                                <div>
                                    <div className="pf-eyebrow">True P/L Preview</div>
                                    <h3 className="pf-projection-panel__title">Estimated broker fees and taxes</h3>
                                    <p className="pf-projection-panel__sub">
                                        Uses the India-first platform registry and adds manual overrides when you specify them.
                                    </p>
                                </div>
                                <div className="md-home-actions md-home-actions--wrap">
                                    <div className="wl-regime-pill">{state.portfolioForm.side || 'BUY'}</div>
                                    <div className="wl-regime-pill">{state.portfolioFeePreview?.segmentLabel || 'Awaiting values'}</div>
                                </div>
                            </div>
                            {state.portfolioFeePreviewLoading ? (
                                <div className="pf-projection-empty">Refreshing fee preview...</div>
                            ) : state.portfolioFeePreview ? (
                                <div className="pf-fee-preview-grid">
                                    <div className="pf-projection-card">
                                        <span>Turnover</span>
                                        <strong>{Number(state.portfolioFeePreview.turnover || 0).toFixed(2)}</strong>
                                        <em>{state.portfolioFeePreview.platformLabel || state.portfolioForm.platform || 'Platform default'}{state.portfolioFeePreview.state ? ` · ${state.portfolioFeePreview.state}` : ''}</em>
                                    </div>
                                    <div className="pf-projection-card">
                                        <span>Total charges</span>
                                        <strong>{Number(state.portfolioFeePreview.totalCharges || 0).toFixed(2)}</strong>
                                        <em>{state.portfolioFeePreview.exactness || 'template_estimate'}</em>
                                    </div>
                                    <div className="pf-projection-card">
                                        <span>Registry version</span>
                                        <strong>{state.portfolioFeePreview.registryVersion || 'n/a'}</strong>
                                        <em>{state.portfolioFeePreview.sourceTitle || 'Broker template'}</em>
                                    </div>
                                    <div className="pf-fee-lines">
                                        {(state.portfolioFeePreview.lines || []).map((line) => (
                                            <div key={`${line.key}_${line.label}`} className="pf-fee-line">
                                                <span>{line.label}</span>
                                                <strong>{Number(line.amount || 0).toFixed(2)}</strong>
                                            </div>
                                        ))}
                                        {!!state.portfolioFeePreview.stampDutyNote && (
                                            <div className="pf-fee-line">
                                                <span>Stamp duty note</span>
                                                <strong>{state.portfolioFeePreview.stampDutyNote}</strong>
                                            </div>
                                        )}
                                        {!(state.portfolioFeePreview.lines || []).length && <div className="md-empty">No fee lines for this transaction yet.</div>}
                                    </div>
                                </div>
                            ) : (
                                <div className="pf-projection-empty">
                                    Enter symbol, units, and price to preview broker charges and taxes for this transaction.
                                </div>
                            )}
                        </section>

                        <div className="pf-modal__notes">
                            <div className="md-input-group">
                                <label className="md-field-label">Short description</label>
                                <input className="md-input" placeholder="Large-cap growth mutual fund, gold ETF, private debt note..." value={state.portfolioForm.description} onChange={(e) => handlers.setPortfolioFormValue('description', e.target.value)} />
                            </div>
                            <div className="md-input-group">
                                <label className="md-field-label">Tracking notes</label>
                                <textarea className="md-input pf-modal__textarea" placeholder="Write your thesis, SIP note, exit criteria, or manual tracking memo..." value={state.portfolioForm.notes} onChange={(e) => handlers.setPortfolioFormValue('notes', e.target.value)} />
                            </div>
                        </div>

                        <div className="md-home-actions pf-modal__actions">
                            <button type="button" className="md-btn md-btn--small" onClick={() => handlers.submitPortfolioPosition()}>
                                {isEditingPosition ? 'Save transaction' : 'Add transaction'}
                            </button>
                            <button type="button" className="md-btn md-btn--small" onClick={() => handlers.closePortfolioModal()}>
                                Cancel
                            </button>
                        </div>
                        {state.portfolioAutoFillHint && (
                            <div className="pf-autofill-banner">
                                {state.portfolioAutoFillHint}
                            </div>
                        )}
                        <div className="md-rail__muted pf-form-note">
                            Search by ticker or asset name to autofill tradable instruments. Save each buy or sell as its own transaction so average cost and realized P/L stay accurate.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PortfolioDashboard;
