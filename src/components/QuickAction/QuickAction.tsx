import React from 'react';
import './QuickAction.css';

interface QuickActionProps {
  label: string;
  description?: string;
  icon: React.ReactNode;
  badge?: string;
  disabled?: boolean;
  onClick?: () => void;
}

export const QuickAction: React.FC<QuickActionProps> = ({
  label,
  description,
  icon,
  badge,
  disabled,
  onClick,
}) => {
  return (
    <button
      type="button"
      className={`mahi-quick-action-btn ${disabled ? 'disabled' : ''}`}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      title={`${label}${description ? ` — ${description}` : ''}`}
    >
      <div className="mahi-quick-action-icon-wrapper">
        {icon}
      </div>
      <div className="mahi-quick-action-text-wrapper">
        <div className="mahi-quick-action-top-row">
          <span className="mahi-quick-action-label">{label}</span>
          {badge && <span className="mahi-quick-action-badge">{badge}</span>}
        </div>
        {description && (
          <span className="mahi-quick-action-desc">{description}</span>
        )}
      </div>
    </button>
  );
};
