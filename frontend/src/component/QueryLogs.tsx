import React, { useState, useEffect } from 'react';
import { RefreshCw, AlertCircle, CheckCircle, Clock } from 'lucide-react';

interface QueryLog {
    id: number;
    prompt: string;
    sql_query: string | null;
    status: string;
    latency_ms: number | null;
    error_message: string | null;
    created_at: string;
}

export default function QueryLogs() {
    const [logs, setLogs] = useState<QueryLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchLogs = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("http://127.0.0.1:8080/logs");
            if (!res.ok) {
                throw new Error(`Failed to fetch logs: ${res.statusText}`);
            }
            const data = await res.json();
            setLogs(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    return (
        <div className="chat-container">
            <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 className="chat-title">Query Logs</h2>
                    <p className="chat-subtitle">View past queries, generated SQL, execution status, and latency.</p>
                </div>
                <button 
                    onClick={fetchLogs} 
                    className="btn-icon" 
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid var(--border-color)', padding: '0.5rem 1rem' }}
                >
                    <RefreshCw size={16} /> Refresh
                </button>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Loading logs...</div>
            ) : error ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'red' }}>Error: {error}</div>
            ) : (
                <div className="data-table-container scrollbar-thin" style={{ maxHeight: 'calc(100vh - 200px)' }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Prompt</th>
                                <th>SQL Query</th>
                                <th>Status</th>
                                <th>Latency (ms)</th>
                                <th>Created At</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.length === 0 ? (
                                <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>No query logs found.</td>
                                </tr>
                            ) : (
                                logs.map(log => (
                                    <tr key={log.id}>
                                        <td>{log.id}</td>
                                        <td style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={log.prompt}>
                                            {log.prompt}
                                        </td>
                                        <td style={{ maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace' }} title={log.sql_query || ''}>
                                            {log.sql_query || '-'}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: log.status === 'SUCCESS' ? 'var(--success)' : 'red' }}>
                                                {log.status === 'SUCCESS' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                                                {log.status}
                                            </div>
                                            {log.error_message && (
                                                <div style={{ fontSize: '10px', color: 'red', marginTop: '4px', whiteSpace: 'normal', maxWidth: '200px' }}>
                                                    {log.error_message}
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            {log.latency_ms !== null ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <Clock size={14} /> {log.latency_ms}
                                                </div>
                                            ) : '-'}
                                        </td>
                                        <td style={{ whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString()}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
