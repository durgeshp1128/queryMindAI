import React from 'react'
import './App.css'
import Sidebar from './component/Sidebar'
import Header from './component/Header'
import QueryChat from './component/QueryChat'

function App() {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <Header />
        <QueryChat />
      </div>
    </div>
  )
}

export default App
