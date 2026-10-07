import React, { useEffect, useRef } from 'react';
import { Trash2, AlertTriangle, X } from 'lucide-react';
import './ConfirmDeleteModal.css';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  isPermanent: boolean;
  items: string[];
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  isOpen,
  isPermanent,
  items,
  loading = false,
  onConfirm,
  onCancel,
}) => {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          onConfirm();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      // Focus confirm button
      setTimeout(() => confirmBtnRef.current?.focus(), 50);

      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, onCancel, onConfirm]);

  if (!isOpen || items.length === 0) return null;

  const count = items.length;
  const firstName = items[0].replace(/\\+$/, '').split('\\').pop() || items[0];

  const title = isPermanent ? 'Delete permanently?' : 'Move to Recycle Bin?';
  const message = isPermanent
    ? count === 1
      ? `Are you sure you want to permanently delete "${firstName}"?`
      : `Are you sure you want to permanently delete these ${count} items?`
    : count === 1
      ? `Move "${firstName}" to the Recycle Bin?`
      : `Move ${count} items to the Recycle Bin?`;

  return (
    <div className="mahi-modal-overlay" onClick={onCancel}>
      <div 
        className="mahi-modal-card" 
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mahi-modal-header">
          <div className={`mahi-modal-icon-badge ${isPermanent ? 'danger' : ''}`}>
            {isPermanent ? <AlertTriangle size={18} /> : <Trash2 size={18} />}
          </div>
          <h3 className="mahi-modal-title">{title}</h3>
          <button 
            type="button" 
            className="mahi-modal-close-btn" 
            onClick={onCancel}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mahi-modal-body">
          <p className="mahi-modal-message">{message}</p>

          {isPermanent && (
            <div className="mahi-modal-warning-box">
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>These items cannot be recovered from the Recycle Bin.</span>
            </div>
          )}

          {count > 1 && (
            <div className="mahi-modal-item-preview">
              {items.map((item) => {
                const name = item.replace(/\\+$/, '').split('\\').pop() || item;
                return (
                  <div key={item} className="mahi-modal-item-line" title={item}>
                    • {name}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mahi-modal-footer">
          <button 
            type="button" 
            className="mahi-btn secondary" 
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`mahi-btn ${isPermanent ? 'danger' : 'primary'}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Deleting...' : isPermanent ? 'Delete Permanently' : 'Move to Recycle Bin'}
          </button>
        </div>
      </div>
    </div>
  );
};
