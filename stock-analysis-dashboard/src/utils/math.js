const formatLargeNumber = (num) => {
    if (!num || num === 0 || num === "N/A") return "N/A";
    if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    return num.toLocaleString();
};

const calculateMaxPain = (calls, puts) => {
    if (!calls || !puts || calls.length === 0) return null;
    let strikes = new Set([...calls.map(c => c.strike), ...puts.map(p => p.strike)]);
    strikes = Array.from(strikes).sort((a, b) => a - b);
    let minLoss = Infinity, maxPainStrike = 0;
    strikes.forEach(strike => {
        let loss = 0;
        calls.forEach(c => { if (c.strike < strike) loss += (strike - c.strike) * (c.openInterest || 1); });
        puts.forEach(p => { if (p.strike > strike) loss += (p.strike - strike) * (p.openInterest || 1); });
        if (loss < minLoss) { minLoss = loss; maxPainStrike = strike; }
    });
    return maxPainStrike;
};

const calculateSMA = (data, period) => {
    let sma = []; let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i].y[3]; 
        if (i >= period) sum -= data[i - period].y[3]; 
        if (i >= period - 1) sma.push({ x: data[i].x, y: parseFloat((sum / period).toFixed(2)) });
        else sma.push({ x: data[i].x, y: null });
    }
    return sma;
};

const calculateEMA = (data, period) => {
    let ema = []; const k = 2 / (period + 1); let emaPrev = null;
    for (let i = 0; i < data.length; i++) {
        const close = data[i].y[3];
        if (i < period - 1) ema.push({ x: data[i].x, y: null });
        else if (i === period - 1) {
            let sum = 0; for (let j = 0; j < period; j++) sum += data[i - j].y[3];
            emaPrev = sum / period; ema.push({ x: data[i].x, y: parseFloat(emaPrev.toFixed(2)) });
        } else {
            emaPrev = (close - emaPrev) * k + emaPrev;
            ema.push({ x: data[i].x, y: parseFloat(emaPrev.toFixed(2)) });
        }
    }
    return ema;
};

const ixTime = (data, ix) => new Date(data[ix].x).getTime();

const calcPearson = (a, b) => {
    const n = Math.min(a.length, b.length);
    if (n < 8) return 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
        const x = Number(a[i]);
        const y = Number(b[i]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        sx += x;
        sy += y;
        sxx += x * x;
        syy += y * y;
        sxy += x * y;
    }
    const num = n * sxy - sx * sy;
    const den = Math.sqrt(Math.max(1e-12, (n * sxx - sx * sx) * (n * syy - sy * sy)));
    return den === 0 ? 0 : num / den;
};

const calcZScore = (v, arr) => {
    if (!arr.length) return 0;
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, arr.length - 1);
    const sd = Math.sqrt(Math.max(1e-12, variance));
    return (v - mean) / sd;
};

const toReturnSeries = (ohlcRows) => {
    const closes = (ohlcRows || [])
        .map((d) => Number(d?.y?.[3]))
        .filter((x) => Number.isFinite(x) && x > 0);
    const out = [];
    for (let i = 1; i < closes.length; i++) {
        out.push(Math.log(closes[i] / closes[i - 1]));
    }
    return out;
};

/**
 * Pure Andrews pitchfork:
 * L1–H–L2 (swing high at center): chord H→L2; median from L1 through midpoint(H,L2); parallels through H and L2.
 * H1–L–H2 (swing low at center): chord L→H2; median from H1 through midpoint(L,H2); parallels through L and H2.
 */
const buildPitchforkAtIndex = (data, i, type = 'Standard') => {
    if (!data || i < 1 || i >= data.length - 1) return null;
    const endX = data.length - 1;
    const currentClose = data[endX].y[3];
    const p1 = data[i - 1], p2 = data[i], p3 = data[i + 1];
    const h1 = p1.y[1], h2 = p2.y[1], h3 = p3.y[1];
    const l1 = p1.y[2], l2 = p2.y[2], l3 = p3.y[2];

    const x1 = i - 1, x2 = i, x3 = i + 1;

    let pivotType = null;
    /** Fork pivots P1→P2→P3 in time (prices at bar lows/highs per pattern). */
    let P1, P2, P3, pivotPrice;

    if (h2 > h1 && h2 > h3) {
        pivotType = 'LHL';
        P1 = { ix: x1, py: l1 };
        P2 = { ix: x2, py: h2 };
        P3 = { ix: x3, py: l3 };
        pivotPrice = h2;
    } else if (l2 < l1 && l2 < l3) {
        pivotType = 'HLH';
        P1 = { ix: x1, py: h1 };
        P2 = { ix: x2, py: l2 };
        P3 = { ix: x3, py: h3 };
        pivotPrice = l2;
    }
    if (!pivotType) return null;

    const Mx = (P2.ix + P3.ix) / 2;
    const My = (P2.py + P3.py) / 2;

    let Sx = P1.ix;
    let Sy = P1.py;
    if (type === 'Schiff') {
        Sx = (P1.ix + P2.ix) / 2;
        Sy = (P1.py + P2.py) / 2;
    } else if (type === 'Modified') {
        Sx = P1.ix;
        Sy = (P1.py + P2.py) / 2;
    }

    const denom = Mx - Sx;
    if (Math.abs(denom) < 1e-12) return null;
    const m = (My - Sy) / (Mx - Sx);

    const lineAt = (j, anchorIx, anchorPy) => anchorPy + m * (j - anchorIx);
    const yMedian = (j) => Sy + m * (j - Sx);
    const yThroughP2 = (j) => lineAt(j, P2.ix, P2.py);
    const yThroughP3 = (j) => lineAt(j, P3.ix, P3.py);

    const channelBounds = (j) => {
        const ub = Math.max(yThroughP2(j), yThroughP3(j));
        const lb = Math.min(yThroughP2(j), yThroughP3(j));
        return { ub, lb };
    };

    /** Bars after pivot (x3+1 … end) whose full range stays inside the fork (encompasses all future OHLC). */
    const totalFutureBars = endX - x3;
    let ohlcBarsInsideStreak = 0;
    for (let j = x3 + 1; j < data.length; j++) {
        const { ub, lb } = channelBounds(j);
        const hi = data[j].y[1];
        const low = data[j].y[2];
        if (low >= lb && hi <= ub) ohlcBarsInsideStreak++;
        else break;
    }
    const encompassesAllFutureOhlc =
        totalFutureBars > 0 && ohlcBarsInsideStreak === totalFutureBars;

    /** Every close still inside (weaker — wicks may pierce). */
    let closeBarsInsideStreak = 0;
    for (let j = x3 + 1; j < data.length; j++) {
        const { ub, lb } = channelBounds(j);
        const cl = data[j].y[3];
        if (cl <= ub && cl >= lb) closeBarsInsideStreak++;
        else break;
    }
    const closeContainedFullHistory =
        totalFutureBars > 0 && closeBarsInsideStreak === totalFutureBars;

    const MIN_FUTURE_BARS = 3;
    const isActive =
        encompassesAllFutureOhlc && totalFutureBars >= MIN_FUTURE_BARS;

    const currentUpper = Math.max(yThroughP2(endX), yThroughP3(endX));
    const currentLower = Math.min(yThroughP2(endX), yThroughP3(endX));
    const range = currentUpper - currentLower;
    const positionPct = range !== 0 ? ((currentClose - currentLower) / range) * 100 : 50;

    let zoneLabel = 'Neutral Zone', zoneColor = '#888888';
    if (positionPct <= 20) { zoneLabel = 'Testing Support'; zoneColor = '#10B981'; }
    else if (positionPct >= 80) { zoneLabel = 'Testing Resistance'; zoneColor = '#EF4444'; }
    else if (positionPct >= 45 && positionPct <= 55) { zoneLabel = 'Testing Median'; zoneColor = '#F59E0B'; }

    const nearnessScore = Math.min(positionPct, 100 - positionPct, Math.abs(50 - positionPct));

    const tEnd = ixTime(data, endX);
    const drawStart = Math.max(0, Math.min(Sx, P1.ix, P2.ix) - 1);

    const upperProng = pivotType === 'LHL'
        ? { ix: P2.ix, py: P2.py, yEnd: yThroughP2(endX) }
        : { ix: P3.ix, py: P3.py, yEnd: yThroughP3(endX) };
    const lowerProng = pivotType === 'LHL'
        ? { ix: P3.ix, py: P3.py, yEnd: yThroughP3(endX) }
        : { ix: P2.ix, py: P2.py, yEnd: yThroughP2(endX) };
    const zoneStart = Math.min(P2.ix, P3.ix);
    const zoneData = [];
    for (let j = zoneStart; j <= endX; j++) {
        zoneData.push({
            x: ixTime(data, j),
            y: [Math.min(yThroughP2(j), yThroughP3(j)), Math.max(yThroughP2(j), yThroughP3(j))],
        });
    }

    const series = [
        {
            name: 'PF Zone',
            type: 'rangeArea',
            color: '#d4af37',
            data: zoneData,
        },
        {
            name: 'PF Chord',
            type: 'line',
            data: [
                { x: ixTime(data, P2.ix), y: P2.py },
                { x: ixTime(data, P3.ix), y: P3.py },
            ],
        },
        {
            name: 'PF Median',
            type: 'line',
            data: [
                { x: ixTime(data, drawStart), y: yMedian(drawStart) },
                { x: tEnd, y: yMedian(endX) },
            ],
        },
        {
            name: 'PF Upper',
            type: 'line',
            data: [
                { x: ixTime(data, upperProng.ix), y: upperProng.py },
                { x: tEnd, y: upperProng.yEnd },
            ],
        },
        {
            name: 'PF Lower',
            type: 'line',
            data: [
                { x: ixTime(data, lowerProng.ix), y: lowerProng.py },
                { x: tEnd, y: lowerProng.yEnd },
            ],
        },
    ];

    return {
        type: pivotType,
        variation: type,
        date: p2.x,
        dataIndex: i,
        /** Consecutive bars from first post-pivot bar with full OHLC inside fork (until first violation). */
        daysActive: ohlcBarsInsideStreak,
        totalFutureBars,
        encompassesAllFutureOhlc,
        closeContainedFullHistory,
        price: pivotPrice,
        positionPct: positionPct.toFixed(1),
        zoneLabel,
        zoneColor,
        nearnessScore,
        isUnbroken: closeContainedFullHistory,
        isActive,
        series,
        pivotKey: `${i}-${pivotType}-${p2.x}`,
    };
};

/** Every LHL/HLH pivot in lookback (newest / active first for UI). */
const enumerateAllPitchforks = (data, lookbackDays = 5475, type = 'Standard') => {
    if (!data || data.length < 5) return [];
    const cutoffTime = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const out = [];
    for (let i = 1; i < data.length - 1; i++) {
        if (new Date(data[i].x).getTime() < cutoffTime) continue;
        const pf = buildPitchforkAtIndex(data, i, type);
        if (pf) out.push(pf);
    }
    const sortRank = (p) =>
        (p.encompassesAllFutureOhlc ? 4 : 0) +
        (p.closeContainedFullHistory && !p.encompassesAllFutureOhlc ? 2 : 0) +
        (p.isActive ? 1 : 0);
    out.sort((a, b) => sortRank(b) - sortRank(a) || b.dataIndex - a.dataIndex);
    return out;
};

/** Screener: forks whose full OHLC stayed inside through the last bar (≥3 future bars). */
const findActivePitchforks = (data, lookbackDays, type = 'Standard') =>
    enumerateAllPitchforks(data, lookbackDays, type)
        .filter((p) => p.isActive)
        .sort((a, b) => a.nearnessScore - b.nearnessScore);


export {
  formatLargeNumber,
  calculateMaxPain,
  calculateSMA,
  calculateEMA,
  ixTime,
  calcPearson,
  calcZScore,
  toReturnSeries,
  buildPitchforkAtIndex,
  enumerateAllPitchforks,
  findActivePitchforks,
};
