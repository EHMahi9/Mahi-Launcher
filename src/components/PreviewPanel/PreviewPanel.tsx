import React, { useState, useEffect, useRef } from 'react';
import { 
  Folder, 
  File, 
  FileCode, 
  FileJson, 
  FileText, 
  Image as ImageIcon, 
  Archive, 
  ExternalLink, 
  FolderOpen, 
  RefreshCw, 
  X, 
  Eye, 
  Layers,
  Binary
} from 'lucide-react';
import { FileEntry, TextPreviewResult, ImagePreviewResult, DetailedProperties } from '../../types/filesystem';
import { formatBytes, formatDate } from '../../utils/formatters';
import { readTextPreview, readImagePreview, getDetailedProperties } from '../../services/tauriApi';
import './PreviewPanel.css';

interface PreviewPanelProps {
  isOpen: boolean;
  selectedEntries: FileEntry[];
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onOpenFolder: (path: string) => void;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({
  isOpen,
  selectedEntries,
  onClose,
  onOpenFile,
  onOpenFolder,
}) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [textPreview, setTextPreview] = useState<TextPreviewResult | null>(null);
  const [imagePreview, setImagePreview] = useState<ImagePreviewResult | null>(null);
  const [folderProps, setFolderProps] = useState<DetailedProperties | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const reqIdRef = useRef<number>(0);

  const singleItem = selectedEntries.length === 1 ? selectedEntries[0] : null;

  // Categorize file
  const ext = (singleItem?.extension || '').toLowerCase();
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ico'].includes(ext);
  const isText = [
    'ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'java', 'html', 'css', 'scss',
    'json', 'toml', 'yaml', 'yml', 'md', 'txt', 'log', 'env', 'sql', 'sh',
    'c', 'cpp', 'h', 'hpp', 'go', 'ps1', 'xml', 'gitignore'
  ].includes(ext);
  const isPdf = ext === 'pdf';
  const isArchive = ['zip', '7z', 'rar', 'tar', 'gz'].includes(ext);
  const isBinary = ['exe', 'dll', 'bin', 'msi', 'iso'].includes(ext);

  useEffect(() => {
    const currentReqId = ++reqIdRef.current;

    // Reset states
    setTextPreview(null);
    setImagePreview(null);
    setFolderProps(null);
    setPreviewError(null);

    if (!singleItem || !isOpen) {
      setLoading(false);
      return;
    }

    if (singleItem.isDirectory) {
      setLoading(true);
      getDetailedProperties(singleItem.path)
        .then((props) => {
          if (currentReqId === reqIdRef.current) {
            setFolderProps(props);
            setLoading(false);
          }
        })
        .catch(() => {
          if (currentReqId === reqIdRef.current) {
            setLoading(false);
          }
        });
      return;
    }

    if (isImage) {
      setLoading(true);
      readImagePreview(singleItem.path)
        .then((res) => {
          if (currentReqId === reqIdRef.current) {
            setImagePreview(res);
            setLoading(false);
          }
        })
        .catch((err: any) => {
          if (currentReqId === reqIdRef.current) {
            setPreviewError(typeof err === 'string' ? err : 'Unable to preview image.');
            setLoading(false);
          }
        });
      return;
    }

    if (isText) {
      setLoading(true);
      readTextPreview(singleItem.path)
        .then((res) => {
          if (currentReqId === reqIdRef.current) {
            setTextPreview(res);
            setLoading(false);
          }
        })
        .catch((err: any) => {
          if (currentReqId === reqIdRef.current) {
            setPreviewError(typeof err === 'string' ? err : 'Unable to load text preview.');
            setLoading(false);
          }
        });
      return;
    }

    setLoading(false);
  }, [singleItem?.path, singleItem?.isDirectory, isImage, isText, isOpen]);

  if (!isOpen) return null;

  // Render hero icon based on type
  const renderHeroIcon = () => {
    if (!singleItem) return null;

    if (singleItem.isDirectory) {
      return (
        <div className="mahi-preview-icon-wrapper folder">
          <Folder size={36} />
        </div>
      );
    }
    if (isImage) {
      return (
        <div className="mahi-preview-icon-wrapper image">
          <ImageIcon size={36} />
        </div>
      );
    }
    if (isText) {
      if (['json', 'toml', 'yaml', 'yml'].includes(ext)) {
        return (
          <div className="mahi-preview-icon-wrapper json">
            <FileJson size={36} />
          </div>
        );
      }
      if (['md', 'txt', 'log'].includes(ext)) {
        return (
          <div className="mahi-preview-icon-wrapper code">
            <FileText size={36} />
          </div>
        );
      }
      return (
        <div className="mahi-preview-icon-wrapper code">
          <FileCode size={36} />
        </div>
      );
    }
    if (isPdf) {
      return (
        <div className="mahi-preview-icon-wrapper pdf">
          <FileText size={36} />
        </div>
      );
    }
    if (isArchive) {
      return (
        <div className="mahi-preview-icon-wrapper archive">
          <Archive size={36} />
        </div>
      );
    }
    if (isBinary) {
      return (
        <div className="mahi-preview-icon-wrapper">
          <Binary size={36} />
        </div>
      );
    }
    return (
      <div className="mahi-preview-icon-wrapper">
        <File size={36} />
      </div>
    );
  };

  return (
    <aside className="mahi-preview-panel" aria-label="File Preview">
      {/* Header */}
      <div className="mahi-preview-header">
        <div className="mahi-preview-header-title">
          <Eye size={14} className="mahi-preview-header-icon" />
          <span>Preview</span>
        </div>
        <button 
          type="button" 
          className="mahi-preview-close-btn" 
          onClick={onClose}
          title="Hide Preview Panel"
        >
          <X size={15} />
        </button>
      </div>

      <div className="mahi-preview-body">
        {selectedEntries.length === 0 ? (
          /* NO SELECTION */
          <div className="mahi-preview-empty">
            <File size={40} className="mahi-preview-empty-icon" />
            <h4>Select a file or folder to preview</h4>
            <p>Details, metadata, and live content previews will display here.</p>
          </div>
        ) : selectedEntries.length > 1 ? (
          /* MULTI SELECTION */
          <div className="mahi-preview-multi">
            <div className="mahi-preview-multi-badge">
              <Layers size={28} />
            </div>
            <h3 className="mahi-preview-multi-title">
              {selectedEntries.length} items selected
            </h3>
            <div className="mahi-preview-multi-stats">
              <div>
                Folders: <strong>{selectedEntries.filter((e) => e.isDirectory).length}</strong>
              </div>
              <div>
                Files: <strong>{selectedEntries.filter((e) => !e.isDirectory).length}</strong>
              </div>
              {(() => {
                const totalBytes = selectedEntries.reduce((sum, e) => sum + (e.size || 0), 0);
                return totalBytes > 0 ? (
                  <div>
                    Total Size: <strong>{formatBytes(totalBytes)}</strong>
                  </div>
                ) : null;
              })()}
            </div>
            <p className="mahi-preview-empty" style={{ padding: 0 }}>
              Select a single item to view its preview.
            </p>
          </div>
        ) : singleItem ? (
          /* SINGLE ITEM PREVIEW */
          <>
            {/* Hero / Summary */}
            <div className="mahi-preview-hero">
              {renderHeroIcon()}
              <h3 className="mahi-preview-name" title={singleItem.name}>
                {singleItem.name}
              </h3>
              <span className="mahi-preview-type-pill">
                {singleItem.isDirectory ? 'File folder' : singleItem.fileType}
              </span>
            </div>

            {/* Folder Specific Information */}
            {singleItem.isDirectory && (
              <div className="mahi-preview-meta-card">
                <div className="mahi-preview-meta-row">
                  <span className="mahi-preview-meta-label">Type:</span>
                  <span className="mahi-preview-meta-value">File folder</span>
                </div>
                <div className="mahi-preview-meta-row">
                  <span className="mahi-preview-meta-label">Location:</span>
                  <span className="mahi-preview-meta-value path" title={singleItem.path}>
                    {singleItem.path}
                  </span>
                </div>
                <div className="mahi-preview-meta-row">
                  <span className="mahi-preview-meta-label">Contains:</span>
                  <span className="mahi-preview-meta-value">
                    {folderProps?.itemCount !== null && folderProps?.itemCount !== undefined
                      ? `${folderProps.itemCount} items`
                      : 'Calculating...'}
                  </span>
                </div>
                {singleItem.modifiedDate && (
                  <div className="mahi-preview-meta-row">
                    <span className="mahi-preview-meta-label">Modified:</span>
                    <span className="mahi-preview-meta-value">{formatDate(singleItem.modifiedDate)}</span>
                  </div>
                )}
                <button
                  type="button"
                  className="mahi-preview-action-btn"
                  onClick={() => onOpenFolder(singleItem.path)}
                >
                  <FolderOpen size={14} />
                  <span>Open Folder</span>
                </button>
              </div>
            )}

            {/* Image Preview */}
            {!singleItem.isDirectory && isImage && (
              <>
                {loading ? (
                  <div className="mahi-preview-loading">
                    <RefreshCw size={20} className="mahi-spin" />
                    <span>Loading image...</span>
                  </div>
                ) : imagePreview ? (
                  <div className="mahi-preview-img-container">
                    <img 
                      src={imagePreview.dataUrl} 
                      alt={singleItem.name} 
                      className="mahi-preview-img"
                    />
                  </div>
                ) : (
                  <div className="mahi-preview-empty" style={{ height: 'auto', padding: '12px' }}>
                    <p>{previewError || 'No image preview available.'}</p>
                  </div>
                )}
              </>
            )}

            {/* Text / Code Preview */}
            {!singleItem.isDirectory && isText && (
              <>
                {loading ? (
                  <div className="mahi-preview-loading">
                    <RefreshCw size={20} className="mahi-spin" />
                    <span>Loading preview...</span>
                  </div>
                ) : textPreview ? (
                  <div className="mahi-code-preview-box">
                    <div className="mahi-code-preview-header">
                      <span>{textPreview.language.toUpperCase()}</span>
                      <span>{textPreview.lineCount} lines</span>
                    </div>
                    <div className="mahi-code-preview-scroll">
                      {textPreview.content.split('\n').map((line, idx) => (
                        <div key={idx} className="mahi-code-line">
                          <span className="mahi-line-num">{idx + 1}</span>
                          <span className="mahi-line-text">{line}</span>
                        </div>
                      ))}
                    </div>
                    {textPreview.isTruncated && (
                      <div className="mahi-code-truncated-notice">
                        Showing first 64 KB of {formatBytes(textPreview.totalBytes)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mahi-preview-empty" style={{ height: 'auto', padding: '12px' }}>
                    <p>{previewError || 'Preview unavailable for this file.'}</p>
                  </div>
                )}
              </>
            )}

            {/* PDF View / Button */}
            {!singleItem.isDirectory && isPdf && (
              <div className="mahi-preview-meta-card">
                <div className="mahi-preview-meta-row">
                  <span className="mahi-preview-meta-label">Format:</span>
                  <span className="mahi-preview-meta-value">Adobe PDF Document</span>
                </div>
                <button
                  type="button"
                  className="mahi-preview-action-btn"
                  onClick={() => onOpenFile(singleItem.path)}
                >
                  <ExternalLink size={14} />
                  <span>Open PDF Document</span>
                </button>
              </div>
            )}

            {/* File Metadata (For all files) */}
            {!singleItem.isDirectory && (
              <div className="mahi-preview-meta-card">
                <div className="mahi-preview-meta-row">
                  <span className="mahi-preview-meta-label">Type:</span>
                  <span className="mahi-preview-meta-value">{singleItem.fileType}</span>
                </div>
                <div className="mahi-preview-meta-row">
                  <span className="mahi-preview-meta-label">Size:</span>
                  <span className="mahi-preview-meta-value">
                    {formatBytes(singleItem.size)} ({singleItem.size ? singleItem.size.toLocaleString() : 0} bytes)
                  </span>
                </div>
                {singleItem.modifiedDate && (
                  <div className="mahi-preview-meta-row">
                    <span className="mahi-preview-meta-label">Modified:</span>
                    <span className="mahi-preview-meta-value">{formatDate(singleItem.modifiedDate)}</span>
                  </div>
                )}
                <div className="mahi-preview-meta-row">
                  <span className="mahi-preview-meta-label">Location:</span>
                  <span className="mahi-preview-meta-value path" title={singleItem.path}>
                    {singleItem.path}
                  </span>
                </div>

                {!isPdf && (
                  <button
                    type="button"
                    className="mahi-preview-action-btn"
                    onClick={() => onOpenFile(singleItem.path)}
                  >
                    <ExternalLink size={14} />
                    <span>Open File</span>
                  </button>
                )}
              </div>
            )}
          </>
        ) : null}
      </div>
    </aside>
  );
};
