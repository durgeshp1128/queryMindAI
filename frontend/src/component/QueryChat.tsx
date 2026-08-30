import React, { useState, useRef, useEffect } from "react";
import { Send, Copy, BookOpen, AlertTriangle, ArrowUp, ArrowDown } from "lucide-react";

const SAMPLE_PROMPTS = [
    "Top 5 selling products last month",
    "Total revenue by category",
    "Customers who haven't ordered",
    "Monthly sales trend",
    "Top customers by revenue"
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
    role: "user" | "assistant";
    content: string;
    response?: QueryResponse;
    error?: string;
    timestamp: string;
}

type SortDirection = "asc" | "desc" | null;

interface SortState {
    column: string | null;
    direction: SortDirection;
}

function sortData(data: Record<string, any>[], sortState: SortState): Record<string, any>[] {
    if (!sortState.column || !sortState.direction) return data;

    return [...data].sort((a, b) => {
        const valA = a[sortState.column!];
        const valB = b[sortState.column!];

        // Handle nulls
        if (valA == null && valB == null) return 0;
        if (valA == null) return sortState.direction === "asc" ? -1 : 1;
        if (valB == null) return sortState.direction === "asc" ? 1 : -1;

        // Numeric comparison
        const numA = Number(valA);
        const numB = Number(valB);
        if (!isNaN(numA) && !isNaN(numB)) {
            return sortState.direction === "asc" ? numA - numB : numB - numA;
        }

        // String comparison
        const strA = String(valA).toLowerCase();
        const strB = String(valB).toLowerCase();
        if (strA < strB) return sortState.direction === "asc" ? -1 : 1;
        if (strA > strB) return sortState.direction === "asc" ? 1 : -1;
        return 0;
    });
}

export default function QueryChat() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [sortStates, setSortStates] = useState<Record<string, SortState>>({});
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSort = (messageId: string, column: string) => {
        setSortStates(prev => {
            const current = prev[messageId] || { column: null, direction: null };
            let newDirection: SortDirection;

            if (current.column !== column) {
                newDirection = "asc";
            } else if (current.direction === "asc") {
                newDirection = "desc";
            } else if (current.direction === "desc") {
                newDirection = null;
            } else {
                newDirection = "asc";
            }

            return {
                ...prev,
                [messageId]: { column: newDirection ? column : null, direction: newDirection }
            };
        });
    };

    const getSortIcon = (messageId: string, column: string) => {
        const sortState = sortStates[messageId];
        if (!sortState || sortState.column !== column) {
            return <span className="sort-indicator inactive">⇅</span>;
        }
        if (sortState.direction === "asc") {
            return <ArrowUp size={12} className="sort-indicator active" />;
        }
        return <ArrowDown size={12} className="sort-indicator active" />;
    };

    const handleSubmit = async (promptText: string) => {
        if (!promptText.trim() || loading) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            role: "user",
            content: promptText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setMessages(prev => [...prev, userMsg]);
        setInput("");
        setLoading(true);

        try {
            const res = await fetch("http://127.0.0.1:8080/query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: promptText }),
            });

            if (!res.ok) {
                let errorDetail = "Failed to connect to backend";
                try {
                    const errorData = await res.json();
                    if (errorData && errorData.detail) {
                        errorDetail = errorData.detail;
                    }
                } catch (e) {
                    // Ignore JSON parse errors for error responses
                }
                throw new Error(errorDetail);
            }

            const data = await res.json();

            const botMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: "Here is the result for your query.",
                response: data,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            setMessages(prev => [...prev, botMsg]);

        } catch (err: any) {
            console.error("Backend request failed:", err);

            let displayError = "Connection Refused or API Error. Please ensure the backend is running and reachable.";
            if (err.message && err.message !== "Failed to fetch") {
                displayError = err.message;
            } else if (err.detail) {
                displayError = err.detail;
            }

            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: "I'm sorry, I was unable to process your query.",
                error: displayError,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="chat-container">
            {messages.length === 0 ? (
                <>
                    <div className="chat-header">
                        <h2 className="chat-title">Chat with your data</h2>
                        <p className="chat-subtitle">
                            Ask questions in natural language and get instant insights from your database.
                        </p>
                    </div>

                    <div className="sample-prompts-card">
                        <div className="sample-prompts-title">Sample Prompts</div>
                        <div className="prompts-list">
                            {SAMPLE_PROMPTS.map((prompt, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => handleSubmit(prompt)}
                                    className="prompt-chip"
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            ) : (
                <div className="chat-messages">
                    {messages.map((msg) => {
                        const sortState = sortStates[msg.id] || { column: null, direction: null };
                        const displayData = msg.response?.data
                            ? sortData(msg.response.data, sortState)
                            : [];

                        return (
                            <div key={msg.id} className={`message-row ${msg.role}`}>
                                <div className={`message-bubble ${msg.role}`}>
                                    {msg.role === 'user' ? (
                                        <>
                                            <div>{msg.content}</div>
                                            <div className="message-timestamp" style={{ color: "var(--brand-light)", opacity: 0.8 }}>{msg.timestamp}</div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="bot-intro-text">{msg.content}</div>

                                            {msg.error && (
                                                <div style={{ color: "red", display: "flex", gap: "8px", alignItems: "center" }}>
                                                    <AlertTriangle size={16} /> {msg.error}
                                                </div>
                                            )}

                                            {msg.response && (
                                                <>
                                                    {msg.response.was_healed && (
                                                        <div style={{
                                                            margin: '0.75rem 0',
                                                            padding: '0.75rem',
                                                            borderRadius: '0.5rem',
                                                            backgroundColor: 'rgba(234, 179, 8, 0.1)',
                                                            border: '1px solid rgba(234, 179, 8, 0.3)',
                                                            color: '#eab308'
                                                        }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '0.85rem' }}>
                                                                <span>⚡ Self-Healing Activated & Succeeded</span>
                                                            </div>
                                                            <div style={{ fontSize: '0.75rem', marginTop: '4px', color: 'var(--text-secondary)' }}>
                                                                Initial query encountered a SQLite runtime error, was automatically diagnosed by AI, and fixed on the fly.
                                                            </div>
                                                            {msg.response.healing_error_message && (
                                                                <div style={{ marginTop: '6px', fontSize: '0.72rem', color: '#ef4444', fontFamily: 'monospace', backgroundColor: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px' }}>
                                                                    <strong>Error caught:</strong> {msg.response.healing_error_message}
                                                                </div>
                                                            )}
                                                            {msg.response.original_failed_sql && (
                                                                <div style={{ marginTop: '4px', fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                                                                    <strong>Initial SQL:</strong> {msg.response.original_failed_sql}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {msg.response.sql_query && (
                                                        <div className="sql-container">
                                                            <div className="sql-header">
                                                                <span>{msg.response.was_healed ? "Healed Executable SQL" : "Generated SQL"}</span>
                                                                <button className="btn-icon" style={{ padding: "2px" }} title="Copy SQL">
                                                                    <Copy size={14} />
                                                                </button>
                                                            </div>
                                                            <div className="sql-code">
                                                                {msg.response.sql_query}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {displayData.length > 0 && (
                                                        <div className="data-table-section">
                                                            <div className="data-table-title">
                                                                Query Results
                                                                {sortState.column && (
                                                                    <span style={{ fontSize: '0.7rem', color: 'var(--brand-primary)', marginLeft: '0.5rem' }}>
                                                                        Sorted by: {sortState.column} ({sortState.direction})
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="data-table-container scrollbar-thin">
                                                                <table className="data-table">
                                                                    <thead>
                                                                        <tr>
                                                                            {Object.keys(msg.response.data[0]).map((key) => (
                                                                                <th
                                                                                    key={key}
                                                                                    onClick={() => handleSort(msg.id, key)}
                                                                                    style={{ cursor: 'pointer', userSelect: 'none' }}
                                                                                    title={`Click to sort by ${key}`}
                                                                                >
                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                                        {key}
                                                                                        {getSortIcon(msg.id, key)}
                                                                                    </div>
                                                                                </th>
                                                                            ))}
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {displayData.map((row, idx) => (
                                                                            <tr key={idx}>
                                                                                {Object.keys(row).map((key) => (
                                                                                    <td key={key}>{row[key]}</td>
                                                                                ))}
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    )}

                                                    <div className="query-meta">
                                                        Rows Returned: {msg.response.row_count} | Execution Time: {msg.response.execution_time_ms} ms
                                                    </div>

                                                    {msg.response.summary && (
                                                        <div className="ai-summary-card">
                                                            <BookOpen size={18} className="ai-summary-icon" />
                                                            <div className="ai-summary-content">
                                                                <div className="ai-summary-title">AI Summary</div>
                                                                <div className="ai-summary-text">{msg.response.summary}</div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    <div className="message-timestamp">{msg.timestamp}</div>
                                                </>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {loading && (
                        <div className="loading-indicator">
                            <span style={{ animation: "pulse 1.5s infinite" }}>●</span>
                            <span style={{ animation: "pulse 1.5s infinite", animationDelay: "0.2s" }}>●</span>
                            <span style={{ animation: "pulse 1.5s infinite", animationDelay: "0.4s" }}>●</span>
                            Generating SQL & executing query...
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            )}

            <div className="chat-input-container">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleSubmit(input);
                    }}
                    className="chat-input-form"
                >
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask another question..."
                        disabled={loading}
                        className="chat-input"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || loading}
                        className="send-button"
                    >
                        <Send size={16} />
                    </button>
                </form>
            </div>
        </div>
    );
}