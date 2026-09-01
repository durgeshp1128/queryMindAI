import React from 'react';
import {
  MessageSquare,
  LayoutDashboard,
  Database,
  BookOpen,
  ScrollText,
  ShieldCheck,
  Settings,
  BrainCircuit,
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export default function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const mainNav = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  ];

  const adminNav = [
    { id: 'schema', label: 'Schema Manager', icon: Database },
    { id: 'examples', label: 'Examples Manager', icon: BookOpen },
    { id: 'logs', label: 'Query Logs', icon: ScrollText },
    { id: 'guardrails', label: 'Guardrails Config', icon: ShieldCheck },
    { id: 'model', label: 'Model Config', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col h-full select-none shrink-0">
      {/* Brand Header */}
      <div className="p-5 flex items-center gap-3 border-b border-slate-200 dark:border-slate-800">
        <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-md shadow-indigo-500/20">
          <BrainCircuit className="w-6 h-6" />
        </div>
        <div>
          <h1 className="font-bold text-slate-900 dark:text-white text-base leading-tight">QueryMind AI</h1>
          <p className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Text-to-SQL Engine</p>
        </div>
      </div>

      {/* Nav Groups */}
      <div className="flex-1 overflow-y-auto p-3 space-y-6">
        <div>
          <h2 className="px-3 mb-2 text-[11px] font-bold tracking-wider text-slate-400 dark:text-slate-500 uppercase">Main</h2>
          <nav className="space-y-1">
            {mainNav.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shadow-sm font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div>
          <h2 className="px-3 mb-2 text-[11px] font-bold tracking-wider text-slate-400 dark:text-slate-500 uppercase">Admin</h2>
          <nav className="space-y-1">
            {adminNav.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shadow-sm font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </aside>
  );
}
