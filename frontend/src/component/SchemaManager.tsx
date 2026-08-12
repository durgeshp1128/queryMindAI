import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Lock, Unlock, Save } from 'lucide-react';

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
            const res = await fetch("http://127.0.0.1:8080/schema");
            if (!res.ok) throw new Error("Failed to fetch schema");
            const data: ColumnMeta[] = await res.json();
            setSchema(data);
            // Initialize descriptions from fetched data
            const descMap: Record<string, string> = {};
            data.forEach(col => {
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
        setSaving(prev => ({ ...prev, [key]: true }));
        try {
            const res = await fetch("http://127.0.0.1:8080/schema/metadata", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    table_name: col.table_name,
                    column_name: col.column_name,
                    description: editedDescriptions[key] ?? col.description,
                    is_sensitive: col.is_sensitive,
                })
            });
            if (!res.ok) throw new Error("Failed to save metadata");
        } catch (err: any) {
            alert(err.message);
        } finally {
            setSaving(prev => ({ ...prev, [key]: false }));
        }
    };

    const handleToggleSensitive = async (col: ColumnMeta) => {
        const key = `${col.table_name}.${col.column_name}`;
        const newSensitive = !col.is_sensitive;

        // Optimistic update
        setSchema(prev => prev.map(c =>
            c.table_name === col.table_name && c.column_name === col.column_name
                ? { ...c, is_sensitive: newSensitive }
                : c
        ));

        try {
            const res = await fetch("http://127.0.0.1:8080/schema/metadata", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    table_name: col.table_name,
                    column_name: col.column_name,
                    description: editedDescriptions[key] ?? col.description,
                    is_sensitive: newSensitive,
                })
            });
            if (!res.ok) throw new Error("Failed to toggle sensitivity");
        } catch (err: any) {
            // Revert on failure
            setSchema(prev => prev.map(c =>
                c.table_name === col.table_name && c.column_name === col.column_name
                    ? { ...c, is_sensitive: !newSensitive }
                    : c
            ));
            alert(err.message);
        }
    };

    // Group columns by table for a clearer layout
    const tables = schema.reduce<Record<string, ColumnMeta[]>>((acc, col) => {
        if (!acc[col.table_name]) acc[col.table_name] = [];
        acc[col.table_name].push(col);
        return acc;
    }, {});

    return (
        <div className="chat-container">
            <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 className="chat-title">Schema Manager</h2>
                    <p className="chat-subtitle">View tables/columns, add custom descriptions, or mark sensitive columns to hide from the AI.</p>
                </div>
                <button
                    onClick={fetchSchema}
                    className="btn-icon"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid var(--border-color)', padding: '0.5rem 1rem' }}
                >
                    <RefreshCw size={16} /> Refresh
                </button>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Loading schema...</div>
            ) : error ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'red' }}>Error: {error}</div>
            ) : Object.keys(tables).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>No user tables found in the database.</div>
            ) : (
                Object.entries(tables).map(([tableName, columns]) => (
                    <div key={tableName} style={{ marginBottom: '1.5rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem' }}>
                        <div style={{
                            padding: '0.75rem 1rem',
                            backgroundColor: 'var(--bg-sidebar)',
                            borderBottom: '1px solid var(--border-color)',
                            fontWeight: 600,
                            fontSize: '0.875rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}>
                            <span style={{ color: 'var(--brand-primary)' }}>📋</span> {tableName}
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 400 }}>
                                ({columns.length} column{columns.length !== 1 ? 's' : ''})
                            </span>
                        </div>
                        <div className="data-table-container scrollbar-thin">
                            <table className="data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                                <thead>
                                    <tr>
                                        <th style={{ width: '180px' }}>Column</th>
                                        <th style={{ width: '120px' }}>Type</th>
                                        <th>Description</th>
                                        <th style={{ width: '90px', textAlign: 'center' }}>Sensitive</th>
                                        <th style={{ width: '80px', textAlign: 'center' }}>Save</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {columns.map(col => {
                                        const key = `${col.table_name}.${col.column_name}`;
                                        const isSaving = saving[key] || false;
                                        return (
                                            <tr key={key} style={{ opacity: col.is_sensitive ? 0.6 : 1 }}>
                                                <td style={{ fontFamily: 'monospace', fontWeight: 500 }}>{col.column_name}</td>
                                                <td style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{col.column_type}</td>
                                                <td>
                                                    <input
                                                        type="text"
                                                        className="chat-input"
                                                        style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                                                        value={editedDescriptions[key] ?? ''}
                                                        onChange={(e) => setEditedDescriptions(prev => ({ ...prev, [key]: e.target.value }))}
                                                        placeholder="Add a description..."
                                                    />
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <button
                                                        onClick={() => handleToggleSensitive(col)}
                                                        className="btn-icon"
                                                        title={col.is_sensitive ? "Marked as sensitive (hidden from AI)" : "Not sensitive"}
                                                        style={{ color: col.is_sensitive ? '#ef4444' : 'var(--text-secondary)' }}
                                                    >
                                                        {col.is_sensitive ? <Lock size={16} /> : <Unlock size={16} />}
                                                    </button>
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <button
                                                        onClick={() => handleSave(col)}
                                                        className="btn-icon"
                                                        disabled={isSaving}
                                                        title="Save description"
                                                        style={{ color: 'var(--brand-primary)' }}
                                                    >
                                                        {isSaving ? '...' : <Save size={16} />}
                                                    </button>
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
    );
}
