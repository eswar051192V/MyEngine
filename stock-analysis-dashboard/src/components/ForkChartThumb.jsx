import React, { useEffect, useState } from 'react';
import { API_BASE } from '../utils/constants';

const ForkChartThumb = ({ symbol }) => {
    const [data, setData] = useState([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`${API_BASE}/api/ticker/${encodeURIComponent(symbol)}/ohlc?timeframe=5Y`);
                const raw = await res.json();
                if (!cancelled) {
                    const rows = (raw || [])
                        .map((d) => Number(d?.y?.[3]))
                        .filter((v) => Number.isFinite(v));
                    setData(rows.slice(-160));
                }
            } catch {
                if (!cancelled) setData([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [symbol]);

    if (!data.length) {
        return (
            <div
                style={{
                    width: 170,
                    height: 68,
                    borderRadius: 8,
                    background: 'rgba(148,163,184,0.14)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 11,
                    color: '#8b909a',
                }}
            >
                Loading...
            </div>
        );
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = Math.max(1e-9, max - min);
    const w = 170;
    const h = 68;
    const pad = 6;
    const points = data
        .map((v, i) => {
            const x = pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2);
            const y = h - pad - ((v - min) / range) * (h - pad * 2);
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(' ');
    const areaPoints = `${pad},${h - pad} ${points} ${w - pad},${h - pad}`;

    return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${symbol} fork chart thumbnail`}>
            <defs>
                <linearGradient id={`forkThumb_${symbol}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d4af37" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#d4af37" stopOpacity="0.04" />
                </linearGradient>
            </defs>
            <rect x="0" y="0" width={w} height={h} rx="8" fill="rgba(15,23,42,0.35)" />
            <polygon points={areaPoints} fill={`url(#forkThumb_${symbol})`} />
            <polyline points={points} fill="none" stroke="#f0d875" strokeWidth="1.6" />
        </svg>
    );
};

export default ForkChartThumb;
