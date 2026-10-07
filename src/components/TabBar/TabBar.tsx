import React from 'react';
import { Folder, X, Plus } from 'lucide-react';
import { TabState } from '../../types/tabs';
import './TabBar.css';

interface TabBarProps {
  tabs: TabState[];
  activeTabId: string;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onNewTab,
}) => {
  return (
    <div className="mahi-tab-bar" role="tablist" aria-label="Browser tabs">
      <div className="mahi-tab-list">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              className={`mahi-tab ${isActive ? 'is-active' : ''}`}
              onClick={() => onSwitchTab(tab.id)}
              title={tab.currentPath === 'this-pc' ? 'This PC' : tab.currentPath}
            >
              <Folder size={13} className="mahi-tab-icon" />
              <span className="mahi-tab-title">{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="mahi-tab-close"
                  aria-label={`Close ${tab.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  title="Close tab (Ctrl + W)"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="mahi-tab-new-btn"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onNewTab();
        }}
        title="New tab (Ctrl + T)"
        aria-label="New tab"
      >
        <Plus size={14} />
      </button>
    </div>
  );
};
