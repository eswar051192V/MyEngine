import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../utils/constants';
import './SchedulerPanel.css';

function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const idx = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    const value = n / (1024 ** idx);
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[idx]}`;
}

function formatTs(ts) {
    if (!ts) return '—';
    try {
        return new Date(ts).toLocaleString();
    } catch {
        return String(ts);
    }
}

export default function SchedulerPanel() {
    const [status, setStatus] = useState({ running: false, jobs: [] });
    const [logs, setLogs] = useState([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const loadStatus = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/scheduler/status`);
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || 'Unable to load scheduler status');
            setStatus(data);
            setError('');
        } catch (err) {
            setError(String(err));
        }
    };

    const loadLogs = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/scheduler/logs?limit=60`);
            const data = await res.json();
            if (data.ok) setLogs(data.logs || []);
        } catch {
            // Non-fatal.
        }
    };

    useEffect(() => {
        loadStatus();
        loadLogs();
        const t = setInterval(() => {
            loadStatus();
            loadLogs();
        }, 5000);
        return () => clearInterval(t);
    }, []);

    const exchangeCount = useMemo(
        () => Object.values(status.exchangeSymbolCounts || {}).reduce((acc, n) => acc + Number(n || 0), 0),
        [status.exchangeSymbolCounts]
    );

    const latestJobRun = useMemo(() => {
        const runs = (status.jobs || [])
            .map((job) => job?.last_run?.finished_at)
            .filter(Boolean)
            .sort((a, b) => (a > b ? -1 : 1));
        return runs[0] || null;
    }, [status.jobs]);

    const withBusy = async (fn) => {
        setBusy(true);
        try {
            await fn();
            await loadStatus();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="md-home-panel">
            <div className="md-section-head"><h2>Data Pipeline</h2></div>
            {error ? <p className="sp-error">{error}</p> : null}

            <div className="sp-stats">
                <div className="sp-stat"><span>Scheduler</span><strong>{status.running ? 'Running' : 'Stopped'}</strong></div>
                <div className="sp-stat"><span>Jobs</span><strong>{status.job_count || 0}</strong></div>
                <div className="sp-stat"><span>Tracked symbols</span><strong>{exchangeCount}</strong></div>
                <div className="sp-stat"><span>Data size</span><strong>{formatBytes(status.marketDataBytes)}</strong></div>
                <div className="sp-stat"><span>Last full download</span><strong>{formatTs(status.lastFullDownload?.finished_at)}</strong></div>
                <div className="sp-stat"><span>Last job run</span><strong>{formatTs(latestJobRun)}</strong></div>
            </div>
            {status.sessionPolicy?.portfolioLiveQuotes ? (
                <p className="sp-hint">{status.sessionPolicy.portfolioLiveQuotes}</p>
            ) : null}

            <div className="md-home-actions md-home-actions--wrap">
                <button
                    type="button"
                    className="md-btn md-btn--small"
                    disabled={busy}
                    onClick={() => withBusy(async () => fetch(`${API_BASE}/api/scheduler/start`, { method: 'POST' }))}
                >
                    Start scheduler
                </button>
                <button
                    type="button"
                    className="md-btn md-btn--small"
                    disabled={busy}
                    onClick={() => withBusy(async () => fetch(`${API_BASE}/api/scheduler/stop`, { method: 'POST' }))}
                >
                    Stop scheduler
                </button>
                <button
                    type="button"
                    className="md-btn md-btn--small"
                    disabled={busy}
                    onClick={() => withBusy(async () => fetch(`${API_BASE}/api/admin/bulk-info-load`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))}
                >
                    Bulk info refresh
                </button>
            </div>

            <div className="sp-jobs">
                <h3>Scheduled Jobs</h3>
                <table className="sp-table">
                    <thead>
                        <tr>
                            <th>Job</th>
                            <th>Next run</th>
                            <th>Last run</th>
                            <th>Trigger</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(status.jobs || []).map((job) => (
                            <tr key={job.id}>
                                <td>{job.id}</td>
                                <td>{formatTs(job.next_run_time)}</td>
                                <td>{formatTs(job.last_run?.finished_at)}</td>
                                <td>{job.trigger}</td>
                                <td className="sp-actions">
                                    <button type="button" className="md-btn md-btn--small" disabled={busy} onClick={() => withBusy(async () => fetch(`${API_BASE}/api/scheduler/job/${encodeURIComponent(job.id)}/trigger`, { method: 'POST' }))}>Run now</button>
                                    {job.paused ? (
                                        <button type="button" className="md-btn md-btn--small" disabled={busy} onClick={() => withBusy(async () => fetch(`${API_BASE}/api/scheduler/job/${encodeURIComponent(job.id)}/resume`, { method: 'POST' }))}>Resume</button>
                                    ) : (
                                        <button type="button" className="md-btn md-btn--small" disabled={busy} onClick={() => withBusy(async () => fetch(`${API_BASE}/api/scheduler/job/${encodeURIComponent(job.id)}/pause`, { method: 'POST' }))}>Pause</button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="sp-logs">
                <h3>Recent Pipeline Logs</h3>
                <div className="sp-log-list">
                    {(logs || []).map((row, idx) => (
                        <div key={`${row.ts || idx}-${idx}`} className="sp-log-row">
                            <span className="sp-log-time">{formatTs(row.ts)}</span>
                            <span className={`sp-log-level sp-log-level--${row.level || 'info'}`}>{row.level || 'info'}</span>
                            <span className="sp-log-msg">{row.message}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
