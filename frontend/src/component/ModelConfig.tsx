import React, { useState, useEffect } from 'react';
import { RefreshCw, Save, Cpu } from 'lucide-react';

interface ModelState {
    model_provider: string;
    model_name: string;
    temperature: number;
    max_tokens: number;
    sql_dialect: string;
}

const PROVIDER_MODELS: Record<string, string[]> = {
    groq: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'gemma2-9b-it', 'mixtral-8x7b-32768'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
    ollama: ['llama3', 'codellama', 'mistral', 'phi3'],
};

const SQL_DIALECTS = ['sqlite', 'mysql', 'postgres', 'bigquery', 'snowflake', 'tsql'];

export default function ModelConfig() {
    const [config, setConfig] = useState<ModelState>({
        model_provider: 'groq',
        model_name: 'llama-3.1-8b-instant',
        temperature: 0.0,
        max_tokens: 1024,
        sql_dialect: 'sqlite',
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
                model_provider: data.model_provider || 'groq',
                model_name: data.model_name || 'llama-3.1-8b-instant',
                temperature: parseFloat(data.temperature || '0.0'),
                max_tokens: parseInt(data.max_tokens || '1024', 10),
                sql_dialect: data.sql_dialect || 'sqlite',
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

    const handleProviderChange = (provider: string) => {
        const models = PROVIDER_MODELS[provider] || [];
        setConfig({
            ...config,
            model_provider: provider,
            model_name: models[0] || '',
        });
    };

    const handleSave = async () => {
        setSaving(true);
        setSaved(false);
        try {
            const res = await fetch("http://127.0.0.1:8080/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model_provider: config.model_provider,
                    model_name: config.model_name,
                    temperature: String(config.temperature),
                    max_tokens: String(config.max_tokens),
                    sql_dialect: config.sql_dialect,
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

    const availableModels = PROVIDER_MODELS[config.model_provider] || [];

    return (
        <div className="chat-container">
            <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 className="chat-title">Model Config</h2>
                    <p className="chat-subtitle">Select the provider, model, temperature, token budget, and SQL dialect.</p>
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
                    {/* Provider */}
                    <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', backgroundColor: 'var(--bg-sidebar)' }}>
                        <h3 style={{ fontSize: '0.875rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Cpu size={16} /> LLM Provider
                        </h3>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {Object.keys(PROVIDER_MODELS).map(p => (
                                <button
                                    key={p}
                                    onClick={() => handleProviderChange(p)}
                                    style={{
                                        padding: '0.4rem 1rem',
                                        borderRadius: '0.375rem',
                                        border: config.model_provider === p ? '2px solid var(--brand-primary)' : '1px solid var(--border-color)',
                                        backgroundColor: config.model_provider === p ? 'var(--brand-primary)' : 'transparent',
                                        color: config.model_provider === p ? '#fff' : 'var(--text-primary)',
                                        cursor: 'pointer',
                                        fontSize: '0.8rem',
                                        fontWeight: config.model_provider === p ? 600 : 400,
                                        textTransform: 'capitalize',
                                        transition: 'all 0.15s ease',
                                    }}
                                >
                                    {p}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Model Name */}
                    <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', backgroundColor: 'var(--bg-sidebar)' }}>
                        <h3 style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>Model Name</h3>
                        <select
                            className="chat-input"
                            style={{ padding: '0.5rem 0.75rem', maxWidth: '350px' }}
                            value={config.model_name}
                            onChange={(e) => setConfig({ ...config, model_name: e.target.value })}
                        >
                            {availableModels.map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>

                    {/* Temperature & Max Tokens - side by side */}
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: '200px', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', backgroundColor: 'var(--bg-sidebar)' }}>
                            <h3 style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>Temperature</h3>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem 0' }}>
                                Controls randomness. Lower = more deterministic.
                            </p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <input
                                    type="range"
                                    min={0}
                                    max={2}
                                    step={0.1}
                                    value={config.temperature}
                                    onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
                                    style={{ flex: 1, accentColor: 'var(--brand-primary)' }}
                                />
                                <span style={{ fontFamily: 'monospace', fontSize: '0.875rem', minWidth: '36px', textAlign: 'right' }}>
                                    {config.temperature.toFixed(1)}
                                </span>
                            </div>
                        </div>

                        <div style={{ flex: 1, minWidth: '200px', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', backgroundColor: 'var(--bg-sidebar)' }}>
                            <h3 style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>Max Tokens</h3>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem 0' }}>
                                Maximum number of tokens in the LLM response.
                            </p>
                            <input
                                type="number"
                                className="chat-input"
                                style={{ padding: '0.5rem 0.75rem', maxWidth: '150px' }}
                                value={config.max_tokens}
                                min={64}
                                max={32768}
                                onChange={(e) => setConfig({ ...config, max_tokens: parseInt(e.target.value) || 1024 })}
                            />
                        </div>
                    </div>

                    {/* SQL Dialect */}
                    <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', backgroundColor: 'var(--bg-sidebar)' }}>
                        <h3 style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>SQL Dialect</h3>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem 0' }}>
                            Dialect used for AST parsing and SQL generation via sqlglot.
                        </p>
                        <select
                            className="chat-input"
                            style={{ padding: '0.5rem 0.75rem', maxWidth: '200px' }}
                            value={config.sql_dialect}
                            onChange={(e) => setConfig({ ...config, sql_dialect: e.target.value })}
                        >
                            {SQL_DIALECTS.map(d => (
                                <option key={d} value={d}>{d}</option>
                            ))}
                        </select>
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
