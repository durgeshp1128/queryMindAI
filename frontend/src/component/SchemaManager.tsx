import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Lock, Unlock, Save, Database, Table } from 'lucide-react';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';

interface ColumnMeta {
  table_name: string;
  column_name: string;
  column_type: string;
  description: string;
  is_sensitive: boolean;
}

export default function SchemaManager() {
  const [schema, setSchema] = useState<ColumnMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [editedDescriptions, setEditedDescriptions] = useState<Record<string, string>>({});

  const fetchSchema = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('http://127.0.0.1:8080/schema');
      if (!res.ok) throw new Error('Failed to fetch schema');
      const data: ColumnMeta[] = await res.json();
      setSchema(data);
      const descMap: Record<string, string> = {};
      data.forEach((col) => {
        descMap[`${col.table_name}.${col.column_name}`] = col.description || '';
      });
      setEditedDescriptions(descMap);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchema();
  }, [fetchSchema]);

  const handleSave = async (col: ColumnMeta) => {
    const key = `${col.table_name}.${col.column_name}`;
    setSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch('http://127.0.0.1:8080/schema/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_name: col.table_name,
          column_name: col.column_name,
          description: editedDescriptions[key] ?? col.description,
          is_sensitive: col.is_sensitive,
        }),
      });
      if (!res.ok) throw new Error('Failed to save metadata');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleToggleSensitive = async (col: ColumnMeta) => {
    const key = `${col.table_name}.${col.column_name}`;
    const newSensitive = !col.is_sensitive;

    setSchema((prev) =>
      prev.map((c) =>
        c.table_name === col.table_name && c.column_name === col.column_name
          ? { ...c, is_sensitive: newSensitive }
          : c
      )
    );

    try {
      const res = await fetch('http://127.0.0.1:8080/schema/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_name: col.table_name,
          column_name: col.column_name,
          description: editedDescriptions[key] ?? col.description,
          is_sensitive: newSensitive,
        }),
      });
      if (!res.ok) throw new Error('Failed to toggle sensitivity');
    } catch (err: any) {
      setSchema((prev) =>
        prev.map((c) =>
          c.table_name === col.table_name && c.column_name === col.column_name
            ? { ...c, is_sensitive: !newSensitive }
            : c
        )
      );
      alert(err.message);
    }
  };

  const tables = schema.reduce<Record<string, ColumnMeta[]>>((acc, col) => {
    if (!acc[col.table_name]) acc[col.table_name] = [];
    acc[col.table_name].push(col);
    return acc;
  }, {});

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <div className="p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Database Schema Manager</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            View tables and columns, provide semantic descriptions, or mask sensitive fields from the LLM prompt.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchSchema} loading={loading}>
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Main Container */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">Loading database schema...</div>
        ) : error ? (
          <div className="p-4 text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/50 rounded-xl border border-rose-200">
            Error: {error}
          </div>
        ) : Object.keys(tables).length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">No user tables found in database.</div>
        ) : (
          Object.entries(tables).map(([tableName, columns]) => (
            <div
              key={tableName}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden"
            >
              {/* Table Header */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Table className="w-4 h-4 text-indigo-600" />
                  <span className="font-bold text-sm text-slate-900 dark:text-white">{tableName}</span>
                  <Badge variant="neutral" size="sm">
                    {columns.length} column{columns.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
              </div>

              {/* Table Columns Grid */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50/50 dark:bg-slate-900/30">
                      <th className="py-3 px-4 w-1/4">Column Name</th>
                      <th className="py-3 px-4 w-1/6">Data Type</th>
                      <th className="py-3 px-4 w-1/3">Semantic Description</th>
                      <th className="py-3 px-4 text-center w-1/6">Sensitivity</th>
                      <th className="py-3 px-4 text-right w-24">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {columns.map((col) => {
                      const key = `${col.table_name}.${col.column_name}`;
                      const isSaving = saving[key];
                      return (
                        <tr
                          key={col.column_name}
                          className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition"
                        >
                          <td className="py-3 px-4 font-semibold font-mono text-slate-800 dark:text-slate-200">
                            {col.column_name}
                          </td>
                          <td className="py-3 px-4">
                            <Badge variant="neutral" size="sm">
                              {col.column_type}
                            </Badge>
                          </td>
                          <td className="py-3 px-4">
                            <input
                              type="text"
                              className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white"
                              value={editedDescriptions[key] ?? ''}
                              onChange={(e) =>
                                setEditedDescriptions({
                                  ...editedDescriptions,
                                  [key]: e.target.value,
                                })
                              }
                              placeholder="Add column context for LLM..."
                            />
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => handleToggleSensitive(col)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                                col.is_sensitive
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
                                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                              }`}
                            >
                              {col.is_sensitive ? (
                                <>
                                  <Lock className="w-3 h-3" /> Sensitive
                                </>
                              ) : (
                                <>
                                  <Unlock className="w-3 h-3" /> Visible
                                </>
                              )}
                            </button>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSave(col)}
                              loading={isSaving}
                            >
                              <Save className="w-3.5 h-3.5" />
                              Save
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
