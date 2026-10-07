import React from 'react';
import './IconButton.css';

interface IconButtonProps {
  icon: React.ReactNode;
  label?: string;
  tooltip?: string;
  onClick?: () => void;
  active?: boolean;
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  label,
  tooltip,
  onClick,
  active,
}) => {
  return (
    <button
      type="button"
      className={`mahi-icon-btn ${active ? 'active' : ''}`}
      title={tooltip || label}
      onClick={onClick}
    >
      <span className="mahi-icon-btn-icon">{icon}</span>
      {label && <span className="mahi-icon-btn-label">{label}</span>}
    </button>
  );
};
