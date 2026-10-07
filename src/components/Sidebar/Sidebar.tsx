import React from 'react';
import './Sidebar.css';

export interface SidebarItemData {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: string | number;
}

export interface SidebarSectionData {
  title: string;
  items: SidebarItemData[];
}

interface SidebarProps {
  sections: SidebarSectionData[];
  activeId: string;
  onSelect: (id: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sections,
  activeId,
  onSelect,
}) => {
  return (
    <aside className="mahi-sidebar">
      <div className="mahi-sidebar-inner">
        {sections.map((section, idx) => (
          <div key={idx} className="mahi-sidebar-group">
            <div className="mahi-sidebar-header">{section.title}</div>
            <nav className="mahi-sidebar-list">
              {section.items.map((item) => {
                const isActive = activeId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`mahi-sidebar-item ${isActive ? 'active' : ''}`}
                    onClick={() => onSelect(item.id)}
                  >
                    <div className="mahi-sidebar-active-indicator" />
                    <span className="mahi-sidebar-icon">{item.icon}</span>
                    <span className="mahi-sidebar-label">{item.label}</span>
                    {item.badge && (
                      <span className="mahi-sidebar-badge">{item.badge}</span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        ))}
      </div>

      <div className="mahi-sidebar-footer">
        <div className="mahi-system-indicator">
          <span className="mahi-status-dot online" />
          <span className="mahi-status-label">Windows 11 · Active</span>
        </div>
      </div>
    </aside>
  );
};
