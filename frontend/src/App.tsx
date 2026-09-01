import React, { useState } from 'react';
import Sidebar from './component/Sidebar';
import Header from './component/Header';
import QueryChat from './component/QueryChat';
import SchemaManager from './component/SchemaManager';
import ExamplesManager from './component/ExamplesManager';
import QueryLogs from './component/QueryLogs';
import GuardrailsConfig from './component/GuardrailsConfig';
import ModelConfig from './component/ModelConfig';

export default function App() {
  const [activeTab, setActiveTab] = useState('chat');

  const renderContent = () => {
    switch (activeTab) {
      case 'chat':
        return <QueryChat />;
      case 'dashboard':
        return (
          <div className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-8 items-center justify-center text-center">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Analytics Dashboard</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
              Use the Chat view to execute queries, or manage your schemas and few-shot vector examples.
            </p>
          </div>
        );
      case 'schema':
        return <SchemaManager />;
      case 'examples':
        return <ExamplesManager />;
      case 'logs':
        return <QueryLogs />;
      case 'guardrails':
        return <GuardrailsConfig />;
      case 'model':
        return <ModelConfig />;
      default:
        return <QueryChat />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 antialiased">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <Header />
        <main className="flex-1 flex flex-col h-full overflow-hidden">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
