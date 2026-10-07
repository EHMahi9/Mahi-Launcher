import React from 'react';
import './SectionHeader.css';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionText?: string;
  onAction?: () => void;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  actionText,
  onAction,
}) => {
  return (
    <div className="mahi-section-header">
      <div className="mahi-section-title-wrap">
        <h2 className="mahi-section-title">{title}</h2>
        {subtitle && <span className="mahi-section-subtitle">{subtitle}</span>}
      </div>
      {actionText && (
        <button type="button" className="mahi-section-action-btn" onClick={onAction}>
          {actionText}
        </button>
      )}
    </div>
  );
};
