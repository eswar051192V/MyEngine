/** @param {string} s */
export function isMutualFundSymbol(s) {
    return String(s || '').toUpperCase().startsWith('MF:');
}

/** @param {object} row */
export function rowInstrumentKind(row) {
    if (row?.instrumentKind === 'mutual_fund') return 'mutual_fund';
    if (row?.instrumentKind === 'other') return 'other';
    return isMutualFundSymbol(row?.symbol) ? 'mutual_fund' : 'other';
}

/**
 * @param {object[]} rows
 * @param {'all'|'mf'|'other'} filter
 */
export function filterWatchlistRows(rows, filter) {
    if (filter === 'all') return [...(rows || [])];
    return (rows || []).filter((r) => {
        const k = rowInstrumentKind(r);
        if (filter === 'mf') return k === 'mutual_fund';
        return k === 'other';
    });
}

/**
 * @param {object[]} rows
 * @param {'symbol'|'displayName'|'updated'} sortKey
 */
export function sortWatchlistRows(rows, sortKey) {
    const out = [...(rows || [])];
    return out.sort((a, b) => {
        if (sortKey === 'displayName') {
            const an = String(a.displayName || a.symbol || '').toLowerCase();
            const bn = String(b.displayName || b.symbol || '').toLowerCase();
            return an.localeCompare(bn);
        }
        if (sortKey === 'updated') {
            const at = String(a.updated_at || '');
            const bt = String(b.updated_at || '');
            return bt.localeCompare(at);
        }
        return String(a.symbol || '').localeCompare(String(b.symbol || ''));
    });
}

/** Display label for search result row */
export function formatSearchResultLabel(r) {
    if (!r) return '';
    const name = r.name || r.symbol || '';
    if (r.schemeCode || r.fundHouse) {
        const bits = [r.assetType, r.assetFamily, r.fundHouse ? `AMC: ${r.fundHouse}` : '', r.exchange].filter(Boolean);
        return { title: name, meta: bits.join(' · ') };
    }
    const meta = [r.assetType, r.assetFamily, r.exchange, r.isProxy ? 'proxy' : ''].filter(Boolean);
    return { title: r.symbol || name, meta: meta.join(' · ') };
}
