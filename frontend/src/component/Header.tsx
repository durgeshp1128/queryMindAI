import React from 'react';
import { ChevronDown } from 'lucide-react';

export default function Header() {
  return (
    <div className="top-header">
      <button className="header-model-select">
        Model: Claude 3.5 Sonnet
        <ChevronDown size={14} />
      </button>
      
      <div className="user-profile">
        <div className="avatar">A</div>
        <div className="user-info">
          <span className="user-name">Admin User</span>
          <span className="user-role">Administrator</span>
        </div>
        <ChevronDown size={14} className="text-secondary" />
      </div>
    </div>
  );
}
