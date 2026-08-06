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

export default function Sidebar() {
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
          <div className="nav-item active">
            <MessageSquare />
            <span>Chat</span>
          </div>
          <div className="nav-item">
            <LayoutDashboard />
            <span>Dashboard</span>
          </div>
        </div>

        <div className="nav-group">
          <div className="nav-group-title">Admin</div>
          <div className="nav-item">
            <Database />
            <span>Schema Manager</span>
          </div>
          <div className="nav-item">
            <BookOpen />
            <span>Examples Manager</span>
          </div>
          <div className="nav-item">
            <ScrollText />
            <span>Query Logs</span>
          </div>
          <div className="nav-item">
            <ShieldCheck />
            <span>Guardrails Config</span>
          </div>
          <div className="nav-item">
            <Settings />
            <span>Model Config</span>
          </div>
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="status-card">
          <div className="status-title">System Status</div>
          <div className="status-item">
            <div>
              <span className="status-dot"></span>
              <span className="status-text-success">All Systems Operational</span>
            </div>
          </div>
          <div className="status-item" style={{ marginTop: '0.75rem' }}>
            <span>DB Connection</span>
            <span className="status-text-success">Connected</span>
          </div>
          <div className="status-item">
            <span>Vector DB</span>
            <span className="status-text-success">Connected</span>
          </div>
        </div>
      </div>
    </div>
  );
}
