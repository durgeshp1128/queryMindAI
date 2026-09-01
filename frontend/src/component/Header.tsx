import React from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';

export default function Header() {
  return (
    <header className="h-16 px-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2">
        <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer">
          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
          <span>Model: openai/gpt-oss-120b</span>
          <ChevronDown className="w-3 h-3 text-slate-400" />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5 pl-3 border-l border-slate-200 dark:border-slate-800">
          <div className="w-8 h-8 rounded-full bg-indigo-600 text-white font-semibold text-xs flex items-center justify-center shadow-sm">
            A
          </div>
          <div className="hidden sm:block text-left">
            <p className="text-xs font-semibold text-slate-900 dark:text-white leading-tight">Admin User</p>
            <p className="text-[10px] text-slate-400 leading-tight">Administrator</p>
          </div>
        </div>
      </div>
    </header>
  );
}
