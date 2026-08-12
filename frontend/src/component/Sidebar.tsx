import React from 'react';
import {
  MessageSquare,
  LayoutDashboard,
  Database,
  BookOpen,
  ScrollText,
  ShieldCheck,
  Settings,
  BrainCircuit
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export default function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <BrainCircuit className="logo-icon" />
        <div>
          <div className="logo-text">QueryMind AI</div>
          <div className="logo-sub">Text-to-SQL Analytics Engine</div>
        </div>
      </div>

      <div className="sidebar-nav">
        <div className="nav-group">
          <div className="nav-group-title">Main</div>
          <div 
            className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare />
            <span>Chat</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutDashboard />
            <span>Dashboard</span>
          </div>
        </div>

        <div className="nav-group">
          <div className="nav-group-title">Admin</div>
          <div 
            className={`nav-item ${activeTab === 'schema' ? 'active' : ''}`}
            onClick={() => setActiveTab('schema')}
          >
            <Database />
            <span>Schema Manager</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'examples' ? 'active' : ''}`}
            onClick={() => setActiveTab('examples')}
          >
            <BookOpen />
            <span>Examples Manager</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            <ScrollText />
            <span>Query Logs</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'guardrails' ? 'active' : ''}`}
            onClick={() => setActiveTab('guardrails')}
          >
            <ShieldCheck />
            <span>Guardrails Config</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'model' ? 'active' : ''}`}
            onClick={() => setActiveTab('model')}
          >
            <Settings />
            <span>Model Config</span>
          </div>
        </div>
      </div>
    </div>
  );
}
