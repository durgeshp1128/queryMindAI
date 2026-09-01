import React, { useState, useEffect } from 'react';
import { RefreshCw, Save, ShieldCheck, ShieldOff } from 'lucide-react';
import { Button } from './ui/Button';

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
      const res = await fetch('http://127.0.0.1:8080/config');
      if (!res.ok) throw new Error('Failed to fetch config');
      const data = await res.json();
      setConfig({
        block_write_operations: data.block_write_operations === 'true',
        default_row_limit: parseInt(data.default_row_limit || '100', 10),
        restricted_tables: data.restricted_tables || '',
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
      const res = await fetch('http://127.0.0.1:8080/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block_write_operations: config.block_write_operations ? 'true' : 'false',
          default_row_limit: String(config.default_row_limit),
          restricted_tables: config.restricted_tables,
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

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <div className="p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Security & Guardrails Config</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Configure AST security guardrails, row execution quotas, and restricted database tables.
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
          <div className="py-12 text-center text-sm text-slate-400">Loading guardrail settings...</div>
        ) : error ? (
          <div className="p-4 text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/50 rounded-xl border border-rose-200">
            Error: {error}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Block Write Mutations */}
            <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between gap-6">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {config.block_write_operations ? (
                    <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  ) : (
                    <ShieldOff className="w-5 h-5 text-rose-600" />
                  )}
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Block Write & Data Mutation Operations
                  </h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  When enabled, all mutating statements (DELETE, DROP, UPDATE, INSERT, ALTER, TRUNCATE) are rejected at the sqlglot AST parsing stage.
                </p>
              </div>

              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={config.block_write_operations}
                  onChange={(e) => setConfig({ ...config, block_write_operations: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-500 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            {/* Default Row Limit */}
            <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Default Row Limit</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Maximum row count allowed per execution. Injected automatically into queries without explicit LIMIT.
                </p>
              </div>
              <div className="w-48">
                <input
                  type="number"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white font-mono"
                  value={config.default_row_limit}
                  min={1}
                  max={10000}
                  onChange={(e) => setConfig({ ...config, default_row_limit: parseInt(e.target.value) || 100 })}
                />
              </div>
            </div>

            {/* Restricted Tables */}
            <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Restricted Database Tables</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Comma-separated list of sensitive tables that queries are forbidden from accessing.
                </p>
              </div>
              <input
                type="text"
                className="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                value={config.restricted_tables}
                onChange={(e) => setConfig({ ...config, restricted_tables: e.target.value })}
                placeholder="e.g., users_private, internal_secrets, payroll"
              />
            </div>

            {/* Save Button */}
            <div className="pt-2">
              <Button variant="primary" size="md" onClick={handleSave} loading={saving}>
                <Save className="w-4 h-4" />
                {saved ? '✓ Guardrails Saved!' : 'Save Guardrails Config'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
