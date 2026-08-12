import React, { useState, useEffect } from 'react';
import { RefreshCw, Save, ShieldCheck, ShieldOff } from 'lucide-react';

interface GuardrailsState {
    block_write_operations: boolean;
    default_row_limit: number;
    restricted_tables: string;
}

export default function GuardrailsConfig() {
    const [config, setConfig] = useState<GuardrailsState>({
        block_write_operations: true,
        default_row_limit: 100,
        restricted_tables: '',
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const fetchConfig = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("http://127.0.0.1:8080/config");
            if (!res.ok) throw new Error("Failed to fetch config");
            const data = await res.json();
            setConfig({
                block_write_operations: data.block_write_operations === "true",
                default_row_limit: parseInt(data.default_row_limit || "100", 10),
                restricted_tables: data.restricted_tables || "",
            });
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchConfig();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setSaved(false);
        try {
            const res = await fetch("http://127.0.0.1:8080/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    block_write_operations: config.block_write_operations ? "true" : "false",
                    default_row_limit: String(config.default_row_limit),
                    restricted_tables: config.restricted_tables,
                })
            });
            if (!res.ok) throw new Error("Failed to save config");
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="chat-container">
            <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 className="chat-title">Guardrails Config</h2>
                    <p className="chat-subtitle">Enable/disable write operations, change default row limits, or restrict table access.</p>
                </div>
                <button
                    onClick={fetchConfig}
                    className="btn-icon"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid var(--border-color)', padding: '0.5rem 1rem' }}
                >
                    <RefreshCw size={16} /> Refresh
                </button>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Loading config...</div>
            ) : error ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'red' }}>Error: {error}</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {/* Block Write Operations */}
                    <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', backgroundColor: 'var(--bg-sidebar)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h3 style={{ fontSize: '0.875rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    {config.block_write_operations ? <ShieldCheck size={18} style={{ color: '#22c55e' }} /> : <ShieldOff size={18} style={{ color: '#ef4444' }} />}
                                    Block Write Operations
                                </h3>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                                    When enabled, DELETE, DROP, UPDATE, INSERT, and other mutation queries are blocked at the AST level.
                                </p>
                            </div>
                            <label style={{ position: 'relative', display: 'inline-block', width: '48px', height: '26px', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={config.block_write_operations}
                                    onChange={(e) => setConfig({ ...config, block_write_operations: e.target.checked })}
                                    style={{ opacity: 0, width: 0, height: 0 }}
                                />
                                <span style={{
                                    position: 'absolute', inset: 0, borderRadius: '13px',
                                    backgroundColor: config.block_write_operations ? 'var(--brand-primary)' : '#555',
                                    transition: 'background-color 0.2s',
                                }}></span>
                                <span style={{
                                    position: 'absolute', top: '3px',
                                    left: config.block_write_operations ? '25px' : '3px',
                                    width: '20px', height: '20px', borderRadius: '50%',
                                    backgroundColor: '#fff', transition: 'left 0.2s',
                                }}></span>
                            </label>
                        </div>
                    </div>

                    {/* Default Row Limit */}
                    <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', backgroundColor: 'var(--bg-sidebar)' }}>
                        <h3 style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>Default Row Limit</h3>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem 0' }}>
                            Maximum number of rows returned by any query. Applied via AST injection when no LIMIT is specified.
                        </p>
                        <input
                            type="number"
                            className="chat-input"
                            style={{ padding: '0.5rem 0.75rem', maxWidth: '200px' }}
                            value={config.default_row_limit}
                            min={1}
                            max={10000}
                            onChange={(e) => setConfig({ ...config, default_row_limit: parseInt(e.target.value) || 100 })}
                        />
                    </div>

                    {/* Restricted Tables */}
                    <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', backgroundColor: 'var(--bg-sidebar)' }}>
                        <h3 style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>Restricted Tables</h3>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem 0' }}>
                            Comma-separated list of table names that the AI is NOT allowed to query. Queries referencing these tables are rejected.
                        </p>
                        <input
                            type="text"
                            className="chat-input"
                            style={{ padding: '0.5rem 0.75rem' }}
                            value={config.restricted_tables}
                            onChange={(e) => setConfig({ ...config, restricted_tables: e.target.value })}
                            placeholder="e.g., users_private, admin_sessions"
                        />
                    </div>

                    {/* Save Button */}
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="send-button"
                        style={{ position: 'relative', width: 'fit-content', padding: '0.5rem 1.5rem', alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                        <Save size={16} />
                        {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Changes'}
                    </button>
                </div>
            )}
        </div>
    );
}
