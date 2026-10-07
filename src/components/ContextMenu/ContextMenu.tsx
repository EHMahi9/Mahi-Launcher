import React, { useEffect, useRef } from 'react';
import { 
  FolderOpen, 
  Copy, 
  Scissors, 
  Trash2, 
  Edit3, 
  Info, 
  RefreshCw, 
  LayoutGrid, 
  List, 
  FolderPlus, 
  ClipboardPaste,
  ArrowUpDown,
  AlertTriangle,
  Code2,
  Terminal,
  Link2,
  GitBranch,
  Play,
  LayoutDashboard,
  Pin
} from 'lucide-react';
import { ContextMenuState, ViewMode, SortField } from '../../types/explorer';
import { ClipboardState } from '../../types/filesystem';
import './ContextMenu.css';

interface ContextMenuProps {
  state: ContextMenuState;
  viewMode: ViewMode;
  clipboard: ClipboardState | null;
  selectedCount: number;
  onClose: () => void;
  onOpenItem: () => void;
  onRefresh: () => void;
  onSetViewMode: (mode: ViewMode) => void;
  onSetSort: (field: SortField) => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onRename: () => void;
  onDelete: (permanent: boolean) => void;
  onNewFolder: () => void;
  onProperties: () => void;
  onOpenInVsCode?: () => void;
  onOpenInTerminal?: () => void;
  onOpenInExplorer?: () => void;
  onCopyPath?: () => void;
  onOpenInNewTab?: () => void;
  onShowProjectDetails?: () => void;
  onShowGitStatus?: () => void;
  onOpenWorkspace?: () => void;
  onRunScript?: (scriptName: string) => void;
  onTogglePin?: () => void;
  isPinned?: boolean;
  projectScripts?: string[];
  isProject?: boolean;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  state,
  viewMode,
  clipboard,
  selectedCount,
  onClose,
  onOpenItem,
  onRefresh,
  onSetViewMode,
  onSetSort,
  onCopy,
  onCut,
  onPaste,
  onRename,
  onDelete,
  onNewFolder,
  onProperties,
  onOpenInVsCode,
  onOpenInTerminal,
  onOpenInExplorer,
  onCopyPath,
  onOpenInNewTab,
  onShowProjectDetails,
  onShowGitStatus,
  onOpenWorkspace,
  onRunScript,
  onTogglePin,
  isPinned = false,
  projectScripts,
  isProject = false,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (!state.isOpen) return null;

  // Viewport clamping
  const menuWidth = 230;
  const menuHeight = state.targetItem ? 380 : 310;
  const x = Math.min(state.x, window.innerWidth - menuWidth - 10);
  const y = Math.min(state.y, window.innerHeight - menuHeight - 10);

  const isItemMenu = Boolean(state.targetItem);
  const hasClipboard = Boolean(clipboard && clipboard.items.length > 0);

  return (
    <div
      ref={menuRef}
      className="mahi-context-menu"
      style={{ left: `${Math.max(x, 10)}px`, top: `${Math.max(y, 10)}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {isProject ? (
        <>
          <div className="mahi-menu-header">
            <span 
              className="mahi-menu-title" 
              title={state.targetItem?.name}
            >
              {state.targetItem?.name || 'Developer Project'}
            </span>
          </div>

          <button
            type="button"
            className="mahi-menu-item"
            onClick={() => {
              onOpenItem();
              onClose();
            }}
          >
            <FolderOpen size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">Open</span>
            <span className="mahi-menu-shortcut">↵</span>
          </button>

          {onOpenInVsCode && (
            <button
              type="button"
              className="mahi-menu-item"
              onClick={() => {
                onOpenInVsCode();
                onClose();
              }}
            >
              <Code2 size={14} className="mahi-menu-icon" />
              <span className="mahi-menu-label">Open in VS Code</span>
              <span className="mahi-menu-shortcut">Ctrl+P</span>
            </button>
          )}

          {onOpenInTerminal && (
            <button
              type="button"
              className="mahi-menu-item"
              onClick={() => {
                onOpenInTerminal();
                onClose();
              }}
            >
              <Terminal size={14} className="mahi-menu-icon" />
              <span className="mahi-menu-label">Open in Terminal</span>
              <span className="mahi-menu-shortcut">Ctrl+`</span>
            </button>
          )}

          {onOpenInExplorer && (
            <button
              type="button"
              className="mahi-menu-item"
              onClick={() => {
                onOpenInExplorer();
                onClose();
              }}
            >
              <FolderOpen size={14} className="mahi-menu-icon" />
              <span className="mahi-menu-label">Open in Explorer</span>
              <span className="mahi-menu-shortcut">Ctrl+O</span>
            </button>
          )}

          {onCopyPath && (
            <button
              type="button"
              className="mahi-menu-item"
              onClick={() => {
                onCopyPath();
                onClose();
              }}
            >
              <Link2 size={14} className="mahi-menu-icon" />
              <span className="mahi-menu-label">Copy Path</span>
              <span className="mahi-menu-shortcut">Ctrl+C</span>
            </button>
          )}

          {(onShowGitStatus || onShowProjectDetails || onOpenWorkspace) && (
            <div className="mahi-menu-divider" />
          )}

          {onOpenWorkspace && (
            <button
              type="button"
              className="mahi-menu-item"
              onClick={() => {
                onOpenWorkspace();
                onClose();
              }}
            >
              <LayoutDashboard size={14} className="mahi-menu-icon" />
              <span className="mahi-menu-label">Open Dashboard</span>
            </button>
          )}

          {onShowGitStatus && (
            <button
              type="button"
              className="mahi-menu-item"
              onClick={() => {
                onShowGitStatus();
                onClose();
              }}
            >
              <GitBranch size={14} className="mahi-menu-icon" />
              <span className="mahi-menu-label">Git Status</span>
            </button>
          )}

          {onShowProjectDetails && (
            <button
              type="button"
              className="mahi-menu-item"
              onClick={() => {
                onShowProjectDetails();
                onClose();
              }}
            >
              <Info size={14} className="mahi-menu-icon" />
              <span className="mahi-menu-label">Project Details</span>
            </button>
          )}

          {onTogglePin && (
            <button
              type="button"
              className="mahi-menu-item"
              onClick={() => {
                onTogglePin();
                onClose();
              }}
            >
              <Pin size={14} className="mahi-menu-icon" fill={isPinned ? 'currentColor' : 'none'} />
              <span className="mahi-menu-label">{isPinned ? 'Unpin Project' : 'Pin Project'}</span>
            </button>
          )}

          {projectScripts && projectScripts.length > 0 && onRunScript && (
            <>
              <div className="mahi-menu-divider" />
              <div className="mahi-menu-header">
                <span className="mahi-menu-title">Run Script</span>
              </div>
              {projectScripts.map((script) => (
                <button
                  key={script}
                  type="button"
                  className="mahi-menu-item"
                  onClick={() => {
                    onRunScript(script);
                    onClose();
                  }}
                >
                  <Play size={12} className="mahi-menu-icon" fill="currentColor" />
                  <span className="mahi-menu-label">{script}</span>
                </button>
              ))}
            </>
          )}
        </>
      ) : isItemMenu ? (
        <>
          <div className="mahi-menu-header">
            <span 
              className="mahi-menu-title" 
              title={selectedCount > 1 ? `${selectedCount} items selected` : state.targetItem?.name}
            >
              {selectedCount > 1 ? `${selectedCount} items selected` : state.targetItem?.name}
            </span>
          </div>

          <button
            type="button"
            className="mahi-menu-item"
            onClick={() => {
              onOpenItem();
              onClose();
            }}
          >
            <FolderOpen size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">Open</span>
            <span className="mahi-menu-shortcut">↵</span>
          </button>

          {onOpenInNewTab && state.targetItem?.isDirectory && (
            <button
              type="button"
              className="mahi-menu-item"
              onClick={() => {
                onOpenInNewTab();
                onClose();
              }}
            >
              <FolderOpen size={14} className="mahi-menu-icon" />
              <span className="mahi-menu-label">Open in new tab</span>
            </button>
          )}

          {onOpenInVsCode && (
            <button
              type="button"
              className="mahi-menu-item"
              onClick={() => {
                onOpenInVsCode();
                onClose();
              }}
            >
              <Code2 size={14} className="mahi-menu-icon" />
              <span className="mahi-menu-label">Open in VS Code</span>
            </button>
          )}

          {onOpenInTerminal && state.targetItem?.isDirectory && (
            <button
              type="button"
              className="mahi-menu-item"
              onClick={() => {
                onOpenInTerminal();
                onClose();
              }}
            >
              <Terminal size={14} className="mahi-menu-icon" />
              <span className="mahi-menu-label">Open in Terminal</span>
            </button>
          )}

          {onOpenInExplorer && (
            <button
              type="button"
              className="mahi-menu-item"
              onClick={() => {
                onOpenInExplorer();
                onClose();
              }}
            >
              <FolderOpen size={14} className="mahi-menu-icon" />
              <span className="mahi-menu-label">Open in Explorer</span>
            </button>
          )}

          {onCopyPath && (
            <button
              type="button"
              className="mahi-menu-item"
              onClick={() => {
                onCopyPath();
                onClose();
              }}
            >
              <Link2 size={14} className="mahi-menu-icon" />
              <span className="mahi-menu-label">Copy Path</span>
            </button>
          )}

          <div className="mahi-menu-divider" />

          <button
            type="button"
            className="mahi-menu-item"
            onClick={() => {
              onCopy();
              onClose();
            }}
          >
            <Copy size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">
              {selectedCount > 1 ? `Copy (${selectedCount})` : 'Copy'}
            </span>
            <span className="mahi-menu-shortcut">Ctrl+C</span>
          </button>

          <button
            type="button"
            className="mahi-menu-item"
            onClick={() => {
              onCut();
              onClose();
            }}
          >
            <Scissors size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">
              {selectedCount > 1 ? `Cut (${selectedCount})` : 'Cut'}
            </span>
            <span className="mahi-menu-shortcut">Ctrl+X</span>
          </button>

          {state.targetItem?.isDirectory && hasClipboard && (
            <button
              type="button"
              className="mahi-menu-item"
              onClick={() => {
                onPaste();
                onClose();
              }}
            >
              <ClipboardPaste size={14} className="mahi-menu-icon" />
              <span className="mahi-menu-label">Paste into folder</span>
              <span className="mahi-menu-shortcut">Ctrl+V</span>
            </button>
          )}

          <div className="mahi-menu-divider" />

          <button
            type="button"
            className={`mahi-menu-item ${selectedCount > 1 ? 'is-disabled' : ''}`}
            disabled={selectedCount > 1}
            onClick={() => {
              if (selectedCount <= 1) {
                onRename();
                onClose();
              }
            }}
          >
            <Edit3 size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">Rename</span>
            <span className="mahi-menu-shortcut">F2</span>
          </button>

          <button
            type="button"
            className="mahi-menu-item danger"
            onClick={() => {
              onDelete(false);
              onClose();
            }}
          >
            <Trash2 size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">
              {selectedCount > 1 ? `Delete ${selectedCount} items` : 'Delete'}
            </span>
            <span className="mahi-menu-shortcut">Del</span>
          </button>

          <button
            type="button"
            className="mahi-menu-item danger"
            onClick={() => {
              onDelete(true);
              onClose();
            }}
          >
            <AlertTriangle size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">Delete permanently</span>
            <span className="mahi-menu-shortcut">Shift+Del</span>
          </button>

          <div className="mahi-menu-divider" />

          <button
            type="button"
            className={`mahi-menu-item ${selectedCount > 1 ? 'is-disabled' : ''}`}
            disabled={selectedCount > 1}
            onClick={() => {
              if (selectedCount <= 1) {
                onProperties();
                onClose();
              }
            }}
          >
            <Info size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">Properties</span>
            <span className="mahi-menu-shortcut">Alt+↵</span>
          </button>
        </>
      ) : (
        <>
          <div className="mahi-menu-section-label">View</div>
          <button
            type="button"
            className={`mahi-menu-item ${viewMode === 'details' ? 'active' : ''}`}
            onClick={() => {
              onSetViewMode('details');
              onClose();
            }}
          >
            <List size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">Details view</span>
          </button>
          <button
            type="button"
            className={`mahi-menu-item ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => {
              onSetViewMode('grid');
              onClose();
            }}
          >
            <LayoutGrid size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">Grid view</span>
          </button>

          <div className="mahi-menu-divider" />

          <div className="mahi-menu-section-label">Sort by</div>
          <button
            type="button"
            className="mahi-menu-item"
            onClick={() => {
              onSetSort('name');
              onClose();
            }}
          >
            <ArrowUpDown size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">Name</span>
          </button>
          <button
            type="button"
            className="mahi-menu-item"
            onClick={() => {
              onSetSort('modifiedDate');
              onClose();
            }}
          >
            <ArrowUpDown size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">Date modified</span>
          </button>
          <button
            type="button"
            className="mahi-menu-item"
            onClick={() => {
              onSetSort('fileType');
              onClose();
            }}
          >
            <ArrowUpDown size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">Type</span>
          </button>
          <button
            type="button"
            className="mahi-menu-item"
            onClick={() => {
              onSetSort('size');
              onClose();
            }}
          >
            <ArrowUpDown size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">Size</span>
          </button>

          <div className="mahi-menu-divider" />

          <button
            type="button"
            className="mahi-menu-item"
            onClick={() => {
              onRefresh();
              onClose();
            }}
          >
            <RefreshCw size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">Refresh</span>
            <span className="mahi-menu-shortcut">F5</span>
          </button>

          <div className="mahi-menu-divider" />

          <button
            type="button"
            className="mahi-menu-item"
            onClick={() => {
              onNewFolder();
              onClose();
            }}
          >
            <FolderPlus size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">New folder</span>
            <span className="mahi-menu-shortcut">Ctrl+Shift+N</span>
          </button>

          <button
            type="button"
            className={`mahi-menu-item ${!hasClipboard ? 'is-disabled' : ''}`}
            disabled={!hasClipboard}
            onClick={() => {
              if (hasClipboard) {
                onPaste();
                onClose();
              }
            }}
            title={hasClipboard ? `Paste ${clipboard?.items.length} items` : 'Clipboard is empty'}
          >
            <ClipboardPaste size={14} className="mahi-menu-icon" />
            <span className="mahi-menu-label">Paste</span>
            <span className="mahi-menu-shortcut">Ctrl+V</span>
          </button>
        </>
      )}
    </div>
  );
};
