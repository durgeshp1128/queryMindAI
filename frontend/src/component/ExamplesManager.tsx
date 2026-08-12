import React, { useState, useEffect } from 'react';
import { Plus, Trash2, RefreshCw } from 'lucide-react';

interface Example {
    id: string;
    question: string;
    sql: string;
}

export default function ExamplesManager() {
    const [examples, setExamples] = useState<Example[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [newQuestion, setNewQuestion] = useState('');
    const [newSql, setNewSql] = useState('');
    const [adding, setAdding] = useState(false);

    const fetchExamples = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("http://127.0.0.1:8080/examples");
            if (!res.ok) throw new Error("Failed to fetch examples");
            const data = await res.json();
            setExamples(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchExamples();
    }, []);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newQuestion.trim() || !newSql.trim()) return;
        setAdding(true);
        try {
            const res = await fetch("http://127.0.0.1:8080/examples", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: newQuestion, sql: newSql })
            });
            if (!res.ok) throw new Error("Failed to add example");
            const newExample = await res.json();
            setExamples([...examples, newExample]);
            setNewQuestion('');
            setNewSql('');
        } catch (err: any) {
            alert(err.message);
        } finally {
            setAdding(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this example?")) return;
        try {
            const res = await fetch(`http://127.0.0.1:8080/examples/${id}`, {
                method: "DELETE"
            });
            if (!res.ok) throw new Error("Failed to delete example");
            setExamples(examples.filter(ex => ex.id !== id));
        } catch (err: any) {
            alert(err.message);
        }
    };

    return (
        <div className="chat-container">
            <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 className="chat-title">Examples Manager</h2>
                    <p className="chat-subtitle">Manage question-to-SQL pairs stored in your vector DB.</p>
                </div>
                <button 
                    onClick={fetchExamples} 
                    className="btn-icon" 
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid var(--border-color)', padding: '0.5rem 1rem' }}
                >
                    <RefreshCw size={16} /> Refresh
                </button>
            </div>

            <div style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', backgroundColor: 'var(--bg-sidebar)' }}>
                <h3 style={{ fontSize: '0.875rem', marginBottom: '1rem' }}>Add New Example</h3>
                <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>Question (Natural Language)</label>
                        <input 
                            type="text" 
                            className="chat-input" 
                            style={{ padding: '0.5rem 0.75rem' }}
                            value={newQuestion}
                            onChange={(e) => setNewQuestion(e.target.value)}
                            placeholder="e.g., How many active users are there?"
                            required
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>Target SQL Query</label>
                        <textarea 
                            className="chat-input" 
                            style={{ padding: '0.5rem 0.75rem', minHeight: '80px', resize: 'vertical' }}
                            value={newSql}
                            onChange={(e) => setNewSql(e.target.value)}
                            placeholder="e.g., SELECT count(*) FROM users WHERE status = 'active';"
                            required
                        />
                    </div>
                    <button type="submit" disabled={adding} className="send-button" style={{ position: 'relative', width: 'fit-content', padding: '0.5rem 1.5rem', alignSelf: 'flex-start' }}>
                        {adding ? 'Adding...' : <><Plus size={16} style={{ marginRight: '0.5rem' }} /> Add Example</>}
                    </button>
                </form>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Loading examples...</div>
            ) : error ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'red' }}>Error: {error}</div>
            ) : (
                <div className="data-table-container scrollbar-thin">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Question</th>
                                <th>SQL Query</th>
                                <th style={{ width: '80px', textAlign: 'center' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {examples.length === 0 ? (
                                <tr>
                                    <td colSpan={3} style={{ textAlign: 'center', padding: '2rem' }}>No examples found. Add one above!</td>
                                </tr>
                            ) : (
                                examples.map(ex => (
                                    <tr key={ex.id}>
                                        <td style={{ verticalAlign: 'top', minWidth: '200px' }}>{ex.question}</td>
                                        <td style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: 'var(--brand-primary)' }}>{ex.sql}</td>
                                        <td style={{ verticalAlign: 'top', textAlign: 'center' }}>
                                            <button onClick={() => handleDelete(ex.id)} className="btn-icon" style={{ color: 'red' }} title="Delete Example">
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
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
