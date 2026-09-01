import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Copy,
  BookOpen,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Zap,
  Clock,
  Database,
  Check,
} from 'lucide-react';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';

const SAMPLE_PROMPTS = [
  'Top 5 selling products last month',
  'Total revenue by category',
  'Customers who haven\'t ordered',
  'Monthly sales trend',
  'Top customers by revenue',
];

interface QueryResponse {
  sql_query: string;
  retrieved_examples?: Array<{ question: string; sql: string }>;
  original_failed_sql?: string | null;
  healing_error_message?: string | null;
  execution_time_ms: number;
  row_count: number;
  was_healed: boolean;
  data: Record<string, any>[];
  summary: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  response?: QueryResponse;
  error?: string;
  timestamp: string;
}

type SortDirection = 'asc' | 'desc' | null;

interface SortState {
  column: string | null;
  direction: SortDirection;
}

function sortData(data: Record<string, any>[], sortState: SortState): Record<string, any>[] {
  if (!sortState.column || !sortState.direction) return data;

  return [...data].sort((a, b) => {
    const valA = a[sortState.column!];
    const valB = b[sortState.column!];

    if (valA == null && valB == null) return 0;
    if (valA == null) return sortState.direction === 'asc' ? -1 : 1;
    if (valB == null) return sortState.direction === 'asc' ? 1 : -1;

    const numA = Number(valA);
    const numB = Number(valB);
    if (!isNaN(numA) && !isNaN(numB)) {
      return sortState.direction === 'asc' ? numA - numB : numB - numA;
    }

    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();
    if (strA < strB) return sortState.direction === 'asc' ? -1 : 1;
    if (strA > strB) return sortState.direction === 'asc' ? 1 : -1;
    return 0;
  });
}

export default function QueryChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sortStates, setSortStates] = useState<Record<string, SortState>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleCopySql = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSort = (messageId: string, column: string) => {
    setSortStates((prev) => {
      const current = prev[messageId] || { column: null, direction: null };
      let newDirection: SortDirection;

      if (current.column !== column) {
        newDirection = 'asc';
      } else if (current.direction === 'asc') {
        newDirection = 'desc';
      } else if (current.direction === 'desc') {
        newDirection = null;
      } else {
        newDirection = 'asc';
      }

      return {
        ...prev,
        [messageId]: { column: newDirection ? column : null, direction: newDirection },
      };
    });
  };

  const getSortIcon = (messageId: string, column: string) => {
    const sortState = sortStates[messageId];
    if (!sortState || sortState.column !== column) {
      return <span className="text-slate-400 opacity-60">⇅</span>;
    }
    if (sortState.direction === 'asc') {
      return <ArrowUp className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />;
    }
    return <ArrowDown className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />;
  };

  const handleSubmit = async (promptText: string) => {
    if (!promptText.trim() || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: promptText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('http://127.0.0.1:8080/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText }),
      });

      if (!res.ok) {
        let errorDetail = 'Failed to connect to backend';
        try {
          const errorData = await res.json();
          if (errorData && errorData.detail) {
            errorDetail = errorData.detail;
          }
        } catch (e) {
          // Ignore JSON parse errors for non-JSON response
        }
        throw new Error(errorDetail);
      }

      const data = await res.json();

      const botMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Query successfully processed and executed against SQLite.',
        response: data,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err: any) {
      let displayError = 'Connection Refused or API Error. Please ensure backend is running.';
      if (err.message && err.message !== 'Failed to fetch') {
        displayError = err.message;
      }

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm sorry, I was unable to process your query.",
        error: displayError,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Empty State / Welcome Screen */}
      {messages.length === 0 ? (
        <div className="flex-1 overflow-y-auto p-6 md:p-12 flex flex-col items-center justify-center max-w-3xl mx-auto w-full text-center">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/60 rounded-2xl text-indigo-600 dark:text-indigo-400 mb-4 shadow-sm">
            <Sparkles className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Chat with your SQLite Data
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-md">
            Ask questions in plain natural language and get instant, validated SQL queries and structured analytical tables.
          </p>

          <div className="mt-8 w-full bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm text-left">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" /> Suggested Prompts
            </div>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_PROMPTS.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSubmit(prompt)}
                  className="px-3.5 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 hover:text-indigo-600 transition cursor-pointer"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Message Stream */
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {messages.map((msg) => {
            const sortState = sortStates[msg.id] || { column: null, direction: null };
            const displayData = msg.response?.data ? sortData(msg.response.data, sortState) : [];

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} w-full`}
              >
                <div
                  className={`max-w-3xl w-full rounded-2xl p-5 ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white shadow-md self-end max-w-xl'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {/* User Bubble */}
                  {msg.role === 'user' ? (
                    <div className="space-y-1">
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                      <span className="block text-[10px] text-indigo-200 text-right opacity-80">{msg.timestamp}</span>
                    </div>
                  ) : (
                    /* Assistant Response */
                    <div className="space-y-4">
                      {/* Intro / Error */}
                      {msg.error ? (
                        <div className="p-3.5 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>{msg.error}</span>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 dark:text-slate-400">{msg.content}</p>
                      )}

                      {/* Response Payload */}
                      {msg.response && (
                        <>
                          {/* Self-Healing Alert Badge if active */}
                          {msg.response.was_healed && (
                            <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl space-y-2">
                              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-semibold text-xs">
                                <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
                                <span>Self-Healing Engine Repaired This Query</span>
                              </div>
                              <p className="text-xs text-slate-600 dark:text-slate-400">
                                The initial SQL encountered an execution error and was automatically diagnosed and corrected by the AI self-healing loop.
                              </p>
                              {msg.response.healing_error_message && (
                                <div className="p-2 bg-slate-900 text-rose-400 font-mono text-[11px] rounded border border-slate-800 overflow-x-auto">
                                  <strong>Caught Error:</strong> {msg.response.healing_error_message}
                                </div>
                              )}
                              {msg.response.original_failed_sql && (
                                <div className="text-[11px] font-mono text-slate-500">
                                  <strong>Initial Failed SQL:</strong> {msg.response.original_failed_sql}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Generated SQL Code Block */}
                          {msg.response.sql_query && (
                            <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-900">
                              <div className="px-4 py-2 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between text-xs">
                                <span className="font-semibold text-slate-300 font-mono flex items-center gap-1.5">
                                  <Database className="w-3.5 h-3.5 text-indigo-400" />
                                  {msg.response.was_healed ? 'Healed SQLite Query' : 'Generated SQLite Query'}
                                </span>
                                <button
                                  onClick={() => handleCopySql(msg.response!.sql_query, msg.id)}
                                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition cursor-pointer"
                                >
                                  {copiedId === msg.id ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5" /> Copy SQL
                                    </>
                                  )}
                                </button>
                              </div>
                              <pre className="p-4 text-xs font-mono text-emerald-400 overflow-x-auto leading-relaxed">
                                <code>{msg.response.sql_query}</code>
                              </pre>
                            </div>
                          )}

                          {/* Interactive Result Table */}
                          {displayData.length > 0 && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-slate-700 dark:text-slate-300">
                                  Result Table ({msg.response.row_count} rows)
                                </span>
                                {sortState.column && (
                                  <span className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                                    Sorted by: {sortState.column} ({sortState.direction})
                                  </span>
                                )}
                              </div>

                              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                                <div className="overflow-x-auto max-h-80">
                                  <table className="w-full text-left border-collapse">
                                    <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-500 uppercase">
                                      <tr>
                                        {Object.keys(msg.response.data[0]).map((key) => (
                                          <th
                                            key={key}
                                            onClick={() => handleSort(msg.id, key)}
                                            className="py-2.5 px-3.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition select-none"
                                            title={`Sort by ${key}`}
                                          >
                                            <div className="flex items-center gap-1.5">
                                              <span>{key}</span>
                                              {getSortIcon(msg.id, key)}
                                            </div>
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                      {displayData.map((row, idx) => (
                                        <tr
                                          key={idx}
                                          className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition font-mono"
                                        >
                                          {Object.keys(row).map((key) => (
                                            <td key={key} className="py-2.5 px-3.5 text-slate-800 dark:text-slate-200">
                                              {String(row[key])}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Execution Meta Badges */}
                          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 dark:text-slate-400 pt-1">
                            <Badge variant="neutral" size="sm">
                              {msg.response.row_count} rows
                            </Badge>
                            <Badge variant="neutral" size="sm">
                              <Clock className="w-3 h-3 text-slate-400" />
                              {msg.response.execution_time_ms} ms
                            </Badge>
                            {msg.response.was_healed && (
                              <Badge variant="warning" size="sm">
                                ⚡ Self-Healed
                              </Badge>
                            )}
                          </div>

                          {/* AI Summary Card */}
                          {msg.response.summary && (
                            <div className="p-3.5 bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 rounded-xl flex items-start gap-2.5">
                              <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                                  AI Summary
                                </p>
                                <p className="text-xs text-slate-700 dark:text-slate-300 mt-0.5 leading-relaxed">
                                  {msg.response.summary}
                                </p>
                              </div>
                            </div>
                          )}

                          <span className="block text-[10px] text-slate-400 text-right">{msg.timestamp}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Loading Indicator */}
          {loading && (
            <div className="flex items-center gap-3 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-fit shadow-sm">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce [animation-delay:0.4s]"></div>
              </div>
              <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                Generating SQL, running AST guardrails & executing...
              </span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input Bar */}
      <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(input);
          }}
          className="max-w-4xl mx-auto flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your database in plain English..."
            disabled={loading}
            className="flex-1 px-4 py-3 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white placeholder:text-slate-400 disabled:opacity-50"
          />
          <Button type="submit" variant="primary" size="lg" disabled={!input.trim() || loading} loading={loading}>
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}