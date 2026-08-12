import React, { useState } from 'react'
import './App.css'
import Sidebar from './component/Sidebar'
import Header from './component/Header'
import QueryChat from './component/QueryChat'
import SchemaManager from './component/SchemaManager'
import ExamplesManager from './component/ExamplesManager'
import QueryLogs from './component/QueryLogs'
import GuardrailsConfig from './component/GuardrailsConfig'
import ModelConfig from './component/ModelConfig'

function App() {
  const [activeTab, setActiveTab] = useState('chat');

  const renderContent = () => {
    switch (activeTab) {
      case 'chat': return <QueryChat />;
      case 'dashboard': return <div className="chat-container"><div className="chat-header"><h2 className="chat-title">Dashboard</h2></div></div>;
      case 'schema': return <SchemaManager />;
      case 'examples': return <ExamplesManager />;
      case 'logs': return <QueryLogs />;
      case 'guardrails': return <GuardrailsConfig />;
      case 'model': return <ModelConfig />;
      default: return <QueryChat />;
    }
  }

  return (
    <div className="app-layout">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="main-content">
        <Header />
        {renderContent()}
      </div>
    </div>
  )
}

export default App
