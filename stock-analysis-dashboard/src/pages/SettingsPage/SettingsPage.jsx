import React from 'react';
import './SettingsPage.css';
import SchedulerPanel from '../../components/SchedulerPanel';

export default function SettingsPage({ state, handlers }) {
    return (
        <div className="md-content mw-content">
            <div className="mw-split">
                <div className="md-home-panel">
                    <div className="md-section-head"><h2>Preferences</h2></div>
                    <div className="md-home-actions md-home-actions--wrap">
                        <label className="md-field-label" htmlFor="mw-theme-settings">Theme</label>
                        <select
                            id="mw-theme-settings"
                            className="md-select-inline"
                            value={state.theme}
                            onChange={(e) => handlers.setTheme(e.target.value)}
                        >
                            {state.themeOptions.map((o) => (
                                <option key={o.id} value={o.id}>{o.label}</option>
                            ))}
                        </select>
                        <button type="button" className="md-btn md-btn--small" onClick={() => handlers.cleanDashboard()}>
                            Reset workspace
                        </button>
                    </div>
                </div>
                <div className="md-home-panel">
                    <div className="md-section-head"><h2>Local LLM Runtime</h2></div>
                    <div className="md-form-grid">
                        <label className="md-toggle">
                            <input
                                type="checkbox"
                                checked={state.localLlmEnabled}
                                onChange={(e) => handlers.setLocalLlmEnabled(e.target.checked)}
                            />
                            <span>Use local LLM for analysis</span>
                        </label>
                        <input className="md-input" placeholder="http://127.0.0.1:11434" value={state.localLlmBaseUrl} onChange={(e) => handlers.setLocalLlmBaseUrl(e.target.value)} />
                        <input className="md-input" placeholder="llama3.1" value={state.localLlmModel} onChange={(e) => handlers.setLocalLlmModel(e.target.value)} />
                    </div>
                    <div className="md-home-actions">
                        <button type="button" className="md-btn md-btn--small" disabled={state.localLlmTesting} onClick={() => handlers.testLocalLlm()}>
                            {state.localLlmTesting ? 'Testing...' : 'Test local runtime'}
                        </button>
                    </div>
                    {state.localLlmLastStatus && (
                        <p className="md-rail__muted" style={{ marginTop: '0.5rem' }}>{state.localLlmLastStatus}</p>
                    )}
                </div>
                <div className="md-home-panel">
                    <div className="md-section-head"><h2>Data operations</h2></div>
                    <div className="md-home-actions">
                        <button type="button" className="md-btn md-btn--small md-btn--danger" onClick={() => handlers.nukeLocalData()}>Nuke local data</button>
                        <button type="button" className="md-btn md-btn--small" onClick={() => handlers.resetAndRedownloadAll()}>Reset + redownload</button>
                    </div>
                </div>
                <SchedulerPanel />
            </div>
        </div>
    );
}
