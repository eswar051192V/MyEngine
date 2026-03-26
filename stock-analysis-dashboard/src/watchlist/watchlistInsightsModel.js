import { rowInstrumentKind } from './watchlistUtils';

export function uniqueSymbols(input) {
    return [...new Set((input || []).map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))];
}

export function symbolsForTab(tab, watchlistSymbols, activeSymbols, macroLabInputSymbols) {
    if (tab === 'saved') return uniqueSymbols(watchlistSymbols);
    if (tab === 'macro') return uniqueSymbols((macroLabInputSymbols || []).length ? macroLabInputSymbols : activeSymbols);
    return uniqueSymbols(activeSymbols);
}

export function deriveCompositionMetrics(rows) {
    const safeRows = rows || [];
    const total = safeRows.length;
    const mfCount = safeRows.filter((r) => rowInstrumentKind(r) === 'mutual_fund').length;
    const otherCount = Math.max(0, total - mfCount);
    const withNewsCount = safeRows.filter((r) => String(r.headline || '').trim() && String(r.headline).trim() !== '-').length;
    const now = Date.now();
    const staleMs = 48 * 60 * 60 * 1000;
    const newsStaleCount = safeRows.filter((r) => {
        const ts = r.updated_at ? new Date(r.updated_at).getTime() : NaN;
        if (!Number.isFinite(ts)) return true;
        return now - ts > staleMs;
    }).length;
    return {
        total,
        mfCount,
        otherCount,
        withNewsCount,
        newsStaleCount,
    };
}

export function deriveMacroRollup(macroRows, symbols) {
    const rows = (macroRows || []).filter((r) => symbols.includes(String(r.symbol || '').toUpperCase()));
    const count = rows.length;
    if (!count) {
        return {
            count: 0,
            avgScore: 0,
            medianScore: 0,
            beneficiary: 0,
            neutral: 0,
            headwind: 0,
        };
    }
    const scores = rows.map((r) => Number(r.totalScore || 0)).sort((a, b) => a - b);
    const avgScore = scores.reduce((acc, x) => acc + x, 0) / count;
    const mid = Math.floor(scores.length / 2);
    const medianScore = scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
    const beneficiary = rows.filter((r) => String(r.stance || '') === 'Beneficiary').length;
    const headwind = rows.filter((r) => String(r.stance || '') === 'Headwind').length;
    const neutral = Math.max(0, count - beneficiary - headwind);
    return {
        count,
        avgScore,
        medianScore,
        beneficiary,
        neutral,
        headwind,
    };
}

export function selectSnapshotSymbols(tab, watchlistSymbols, activeSymbols, macroLabInputSymbols, maxSymbols = 36) {
    return symbolsForTab(tab, watchlistSymbols, activeSymbols, macroLabInputSymbols).slice(0, Math.max(1, maxSymbols));
}
