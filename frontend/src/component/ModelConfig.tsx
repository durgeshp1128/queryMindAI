import React, { useState, useEffect } from 'react';
import { RefreshCw, Save, Cpu, Sliders, Database, Layers } from 'lucide-react';
import { Button } from './ui/Button';

interface ModelState {
  model_provider: string;
  model_name: string;
  temperature: number;
  max_tokens: number;
  sql_dialect: string;
}

const PROVIDER_MODELS: Record<string, string[]> = {
  groq: [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen/qwen3.8-27b',
    'groq/compound',
    'groq/compound-mini',
    'qwen/qwen3.6-27b',
  ],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
  ollama: ['llama3', 'codellama', 'mistral', 'phi3', 'qwen2.5-coder'],
};

const SQL_DIALECTS = ['sqlite', 'mysql', 'postgres', 'bigquery', 'snowflake', 'tsql'];

export default function ModelConfig() {
  const [config, setConfig] = useState<ModelState>({
    model_provider: 'groq',
    model_name: 'openai/gpt-oss-120b',
    temperature: 0.0,
    max_tokens: 512,
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
      const res = await fetch('http://127.0.0.1:8080/config');
      if (!res.ok) throw new Error('Failed to fetch config');
      const data = await res.json();
      setConfig({
        model_provider: data.model_provider || 'groq',
        model_name: data.model_name || 'openai/gpt-oss-120b',
        temperature: parseFloat(data.temperature || '0.0'),
        max_tokens: parseInt(data.max_tokens || '512', 10),
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
      const res = await fetch('http://127.0.0.1:8080/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_provider: config.model_provider,
          model_name: config.model_name,
          temperature: String(config.temperature),
          max_tokens: String(config.max_tokens),
          sql_dialect: config.sql_dialect,
        }),
      });
      if (!res.ok) throw new Error('Failed to save config');
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
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <div className="p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">LLM Model & Generation Config</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Select your LLM inference provider, model target, temperature parameters, and target SQL dialect.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchConfig} loading={loading}>
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Main Form */}
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl space-y-6">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">Loading model parameters...</div>
        ) : error ? (
          <div className="p-4 text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/50 rounded-xl border border-rose-200">
            Error: {error}
          </div>
        ) : (
          <div className="space-y-6">
            {/* LLM Provider Selection */}
            <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-600" /> Inference Provider
              </h3>
              <div className="flex gap-2 flex-wrap">
                {Object.keys(PROVIDER_MODELS).map((p) => {
                  const isSelected = config.model_provider === p;
                  return (
                    <button
                      key={p}
                      onClick={() => handleProviderChange(p)}
                      className={`px-4 py-2 rounded-lg text-xs font-semibold capitalize transition cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-500/20'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Model Name Select */}
            <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Cpu className="w-4 h-4 text-indigo-600" /> Active Model
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                The model used for Text-to-SQL generation and self-healing error recorrection.
              </p>
              <select
                className="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white font-mono"
                value={config.model_name}
                onChange={(e) => setConfig({ ...config, model_name: e.target.value })}
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {/* Hyperparameters: Temperature & Max Tokens */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Temperature */}
              <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-indigo-600" /> Temperature
                  </h3>
                  <span className="font-mono text-xs font-bold text-indigo-600 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/60 rounded">
                    {config.temperature.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Lower values (0.0) produce deterministic, highly consistent SQL.
                </p>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  className="w-full accent-indigo-600 cursor-pointer"
                  value={config.temperature}
                  onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
                />
              </div>

              {/* Max Tokens */}
              <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Max Output Tokens</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Token budget (automatically clamped based on selected model limits).
                </p>
                <input
                  type="number"
                  min={64}
                  max={4096}
                  step={64}
                  className="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white font-mono"
                  value={config.max_tokens}
                  onChange={(e) => setConfig({ ...config, max_tokens: parseInt(e.target.value, 10) || 512 })}
                />
              </div>
            </div>

            {/* SQL Dialect */}
            <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-indigo-600" /> SQL Dialect
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Dialect-specific SQL formatting and sqlglot AST parsing rules.
              </p>
              <select
                className="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white font-mono uppercase"
                value={config.sql_dialect}
                onChange={(e) => setConfig({ ...config, sql_dialect: e.target.value })}
              >
                {SQL_DIALECTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            {/* Save Button */}
            <div className="pt-2">
              <Button variant="primary" size="md" onClick={handleSave} loading={saving}>
                <Save className="w-4 h-4" />
                {saved ? '✓ Config Saved!' : 'Save Model Configuration'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
