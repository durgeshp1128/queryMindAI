import React, { useState, useEffect } from 'react';
import { Plus, Trash2, RefreshCw, Pencil, Check, X, BookOpen } from 'lucide-react';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';

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

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState('');
  const [editSql, setEditSql] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchExamples = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('http://127.0.0.1:8080/examples');
      if (!res.ok) throw new Error('Failed to fetch examples');
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
      const res = await fetch('http://127.0.0.1:8080/examples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: newQuestion, sql: newSql }),
      });
      if (!res.ok) throw new Error('Failed to add example');
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
    if (!confirm('Are you sure you want to delete this example?')) return;
    try {
      const res = await fetch(`http://127.0.0.1:8080/examples/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete example');
      setExamples(examples.filter((ex) => ex.id !== id));
    } catch (err: any) {
      alert(err.message);
    }
  };

  const startEditing = (ex: Example) => {
    setEditingId(ex.id);
    setEditQuestion(ex.question);
    setEditSql(ex.sql);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditQuestion('');
    setEditSql('');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editQuestion.trim() || !editSql.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`http://127.0.0.1:8080/examples/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: editQuestion, sql: editSql }),
      });
      if (!res.ok) throw new Error('Failed to update example');
      const updated = await res.json();
      setExamples(examples.map((ex) => (ex.id === editingId ? updated : ex)));
      cancelEditing();
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
            <BookOpen className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Few-Shot Examples Manager</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage question-to-SQL pairs stored in ChromaDB vector database for in-context learning.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchExamples} loading={loading}>
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Main Container */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Add New Example Card */}
        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <Plus className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Add New Example Pair</h3>
          </div>

          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Natural Language Question
              </label>
              <input
                type="text"
                className="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                placeholder="e.g., Show top 5 customers with their total spending amount"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Target SQLite Query
              </label>
              <textarea
                className="w-full px-3.5 py-2 text-xs font-mono bg-slate-900 text-emerald-400 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[90px] resize-y"
                value={newSql}
                onChange={(e) => setNewSql(e.target.value)}
                placeholder="SELECT c.customer_id, SUM(o.total_amount) AS total_spent FROM customers c JOIN orders o..."
                required
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" variant="primary" size="sm" loading={adding}>
                <Plus className="w-4 h-4" />
                Add to Vector DB
              </Button>
            </div>
          </form>
        </div>

        {/* Examples Table / List */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active Examples in Vector DB ({examples.length})
            </h3>
          </div>

          {loading && examples.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">Loading vector examples...</div>
          ) : error ? (
            <div className="p-4 text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/50 border-b border-rose-200">
              Error: {error}
            </div>
          ) : examples.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">No examples found. Add one above!</div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {examples.map((ex) => (
                <div key={ex.id} className="p-5 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition">
                  {editingId === ex.id ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                          Edit Question
                        </label>
                        <input
                          type="text"
                          className="w-full px-3 py-1.5 text-sm bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-indigo-500"
                          value={editQuestion}
                          onChange={(e) => setEditQuestion(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                          Edit SQL Query
                        </label>
                        <textarea
                          className="w-full px-3 py-1.5 text-xs font-mono bg-slate-900 text-emerald-400 border border-slate-700 rounded-md focus:ring-2 focus:ring-indigo-500 min-h-[80px]"
                          value={editSql}
                          onChange={(e) => setEditSql(e.target.value)}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={cancelEditing}>
                          <X className="w-3.5 h-3.5" /> Cancel
                        </Button>
                        <Button variant="primary" size="sm" onClick={handleSaveEdit} loading={saving}>
                          <Check className="w-3.5 h-3.5" /> Save Changes
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="brand" size="sm">ID: {ex.id}</Badge>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">{ex.question}</p>
                        </div>
                        <div className="p-3 bg-slate-900 rounded-lg font-mono text-xs text-emerald-400 overflow-x-auto">
                          <code>{ex.sql}</code>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => startEditing(ex)} title="Edit">
                          <Pencil className="w-4 h-4 text-slate-500 hover:text-indigo-600" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(ex.id)} title="Delete">
                          <Trash2 className="w-4 h-4 text-slate-500 hover:text-rose-600" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
