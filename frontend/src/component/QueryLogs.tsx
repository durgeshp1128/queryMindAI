import React, { useState, useEffect } from 'react';
import { RefreshCw, AlertCircle, CheckCircle, Clock, ScrollText, Code2 } from 'lucide-react';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';

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
      const res = await fetch('http://127.0.0.1:8080/logs');
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
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <div className="p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Query Execution Audit Logs</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Audit past natural language queries, generated SQL statements, latencies, and execution health.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchLogs} loading={loading}>
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Main Container */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">Loading audit logs...</div>
        ) : error ? (
          <div className="p-4 text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/50 rounded-xl border border-rose-200">
            Error: {error}
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50 dark:bg-slate-800/50">
                    <th className="py-3 px-4 w-12">ID</th>
                    <th className="py-3 px-4 w-1/3">User Prompt</th>
                    <th className="py-3 px-4 w-1/3">Generated SQL</th>
                    <th className="py-3 px-4 w-28">Status</th>
                    <th className="py-3 px-4 w-28">Latency</th>
                    <th className="py-3 px-4 w-40 text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        No query logs recorded yet.
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition">
                        <td className="py-3 px-4 text-slate-400 font-mono">{log.id}</td>
                        <td className="py-3 px-4 font-medium text-slate-900 dark:text-white max-w-xs truncate" title={log.prompt}>
                          {log.prompt}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-700 dark:text-emerald-400 max-w-xs truncate" title={log.sql_query || ''}>
                          {log.sql_query || '-'}
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant={log.status === 'SUCCESS' ? 'success' : 'error'} size="sm">
                            {log.status === 'SUCCESS' ? (
                              <CheckCircle className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <AlertCircle className="w-3 h-3 text-rose-600" />
                            )}
                            {log.status}
                          </Badge>
                          {log.error_message && (
                            <p className="text-[10px] text-rose-500 mt-1 max-w-xs truncate" title={log.error_message}>
                              {log.error_message}
                            </p>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-400 font-mono">
                          {log.latency_ms !== null ? (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              {log.latency_ms} ms
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-400 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
