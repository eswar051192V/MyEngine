import React, { useEffect, useState } from 'react';
import './AlertsPage.css';

export default function AlertsPage() {
    const [alertForm, setAlertForm] = useState({ symbol: '', condition: 'Price >', value: '' });
    const [alerts, setAlerts] = useState([]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem('qe_alerts_v1');
            if (raw) setAlerts(JSON.parse(raw));
        } catch {
            setAlerts([]);
        }
    }, []);

    useEffect(() => {
        localStorage.setItem('qe_alerts_v1', JSON.stringify(alerts));
    }, [alerts]);

    return (
        <div className="md-content mw-content">
            <div className="mw-split">
                <div className="md-home-panel">
                    <div className="md-section-head"><h2>Active alerts</h2></div>
                    <div className="md-home-list">
                        {alerts.map((a) => (
                            <div key={a.id} className="md-list-item">
                                <span>{a.symbol}</span>
                                <span>{a.condition} {a.value}</span>
                                <button type="button" className="md-watch-card__rm" onClick={() => setAlerts((prev) => prev.filter((x) => x.id !== a.id))}>×</button>
                            </div>
                        ))}
                        {!alerts.length && <div className="md-empty">No alerts configured.</div>}
                    </div>
                </div>
                <div className="md-home-panel">
                    <div className="md-section-head"><h2>Create alert</h2></div>
                    <div className="md-form-grid">
                        <input className="md-input" placeholder="AAPL" value={alertForm.symbol} onChange={(e) => setAlertForm((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))} />
                        <select className="md-select-inline" value={alertForm.condition} onChange={(e) => setAlertForm((p) => ({ ...p, condition: e.target.value }))}>
                            <option>Price &gt;</option>
                            <option>Price &lt;</option>
                            <option>% Change &gt;</option>
                            <option>% Change &lt;</option>
                        </select>
                        <input className="md-input" placeholder="Target value" value={alertForm.value} onChange={(e) => setAlertForm((p) => ({ ...p, value: e.target.value }))} />
                    </div>
                    <button
                        type="button"
                        className="md-btn md-btn--small"
                        onClick={() => {
                            if (!alertForm.symbol || !alertForm.value) return;
                            setAlerts((prev) => [{ id: `${Date.now()}`, ...alertForm }, ...prev]);
                            setAlertForm({ symbol: '', condition: 'Price >', value: '' });
                        }}
                    >
                        Save alert
                    </button>
                </div>
            </div>
        </div>
    );
}
