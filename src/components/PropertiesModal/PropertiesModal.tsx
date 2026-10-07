import React, { useEffect } from 'react';
import { Folder, File, X, RefreshCw } from 'lucide-react';
import { DetailedProperties } from '../../types/filesystem';
import { formatBytes, formatDate } from '../../utils/formatters';
import './PropertiesModal.css';

interface PropertiesModalProps {
  isOpen: boolean;
  properties: DetailedProperties | null;
  loading: boolean;
  onClose: () => void;
}

export const PropertiesModal: React.FC<PropertiesModalProps> = ({
  isOpen,
  properties,
  loading,
  onClose,
}) => {
  useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          onClose();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="mahi-modal-overlay" onClick={onClose}>
      <div 
        className="mahi-prop-card" 
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mahi-prop-header">
          <div className="mahi-modal-icon-badge">
            {properties?.isDirectory ? <Folder size={18} /> : <File size={18} />}
          </div>
          <div className="mahi-prop-title-box">
            <span className="mahi-prop-name" title={properties?.name || 'Properties'}>
              {properties?.name || 'Properties'}
            </span>
            <span className="mahi-prop-type-sub">
              {properties ? properties.fileType : 'Loading...'}
            </span>
          </div>
          <button 
            type="button" 
            className="mahi-modal-close-btn" 
            onClick={onClose}
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mahi-prop-body">
          {loading ? (
            <div className="mahi-prop-loading">
              <RefreshCw size={20} className="mahi-spin" />
              <span>Retrieving properties...</span>
            </div>
          ) : properties ? (
            <>
              <div className="mahi-prop-section">
                <div className="mahi-prop-row">
                  <span className="mahi-prop-label">Type:</span>
                  <span className="mahi-prop-value">{properties.fileType}</span>
                </div>
                <div className="mahi-prop-row">
                  <span className="mahi-prop-label">Location:</span>
                  <span className="mahi-prop-value path" title={properties.location}>
                    {properties.location}
                  </span>
                </div>
                <div className="mahi-prop-row">
                  <span className="mahi-prop-label">Full Path:</span>
                  <span className="mahi-prop-value path" title={properties.path}>
                    {properties.path}
                  </span>
                </div>
                {!properties.isDirectory && properties.size !== null && properties.size !== undefined && (
                  <div className="mahi-prop-row">
                    <span className="mahi-prop-label">Size:</span>
                    <span className="mahi-prop-value">
                      {formatBytes(properties.size)} ({properties.size.toLocaleString()} bytes)
                    </span>
                  </div>
                )}
                {properties.isDirectory && (
                  <div className="mahi-prop-row">
                    <span className="mahi-prop-label">Contains:</span>
                    <span className="mahi-prop-value">
                      {properties.itemCount !== null && properties.itemCount !== undefined
                        ? `${properties.itemCount} items`
                        : 'Calculating...'}
                    </span>
                  </div>
                )}
              </div>

              <div className="mahi-prop-section">
                {properties.createdDate && (
                  <div className="mahi-prop-row">
                    <span className="mahi-prop-label">Created:</span>
                    <span className="mahi-prop-value">{formatDate(properties.createdDate)}</span>
                  </div>
                )}
                {properties.modifiedDate && (
                  <div className="mahi-prop-row">
                    <span className="mahi-prop-label">Modified:</span>
                    <span className="mahi-prop-value">{formatDate(properties.modifiedDate)}</span>
                  </div>
                )}
                {properties.accessedDate && (
                  <div className="mahi-prop-row">
                    <span className="mahi-prop-label">Accessed:</span>
                    <span className="mahi-prop-value">{formatDate(properties.accessedDate)}</span>
                  </div>
                )}
              </div>

              <div className="mahi-prop-section">
                <div className="mahi-prop-row">
                  <span className="mahi-prop-label">Attributes:</span>
                  <div className="mahi-prop-tags">
                    <span className={`mahi-prop-tag ${properties.isReadOnly ? 'active' : ''}`}>
                      {properties.isReadOnly ? 'Read-only' : 'Read/Write'}
                    </span>
                    {properties.isHidden && (
                      <span className="mahi-prop-tag active">Hidden</span>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="mahi-modal-message">Unable to load item properties.</p>
          )}
        </div>

        <div className="mahi-modal-footer">
          <button 
            type="button" 
            className="mahi-btn primary" 
            onClick={onClose}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};
