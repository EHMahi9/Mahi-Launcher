import React, { useEffect, useRef } from 'react';
import { 
  Code2, 
  Terminal, 
  FolderOpen, 
  ArrowUpRight, 
  SearchX, 
  Sparkles, 
  Check,
  Link2,
  Info,
  GitBranch,
  LayoutDashboard,
  Pin
} from 'lucide-react';
import { ProjectInfo } from '../../types/project';
import './SearchResults.css';

interface SearchResultsProps {
  query: string;
  results: ProjectInfo[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onOpenProject: (project: ProjectInfo) => void;
  onOpenInVsCode: (project: ProjectInfo, e?: React.MouseEvent) => void;
  onOpenInTerminal: (project: ProjectInfo, e?: React.MouseEvent) => void;
  onOpenInExplorer: (project: ProjectInfo, e?: React.MouseEvent) => void;
  onCopyPath?: (project: ProjectInfo, e?: React.MouseEvent) => void;
  onShowDetails?: (project: ProjectInfo, e?: React.MouseEvent) => void;
  onContextMenu?: (project: ProjectInfo, e: React.MouseEvent) => void;
  onOpenWorkspace?: (project: ProjectInfo, e?: React.MouseEvent) => void;
  onTogglePin?: (project: ProjectInfo, e?: React.MouseEvent) => void;
}

export const SearchResults: React.FC<SearchResultsProps> = ({
  query,
  results,
  selectedIndex,
  onSelectIndex,
  onOpenProject,
  onOpenInVsCode,
  onOpenInTerminal,
  onOpenInExplorer,
  onCopyPath,
  onShowDetails,
  onContextMenu,
  onOpenWorkspace,
  onTogglePin,
}) => {
  const selectedItemRef = useRef<HTMLDivElement>(null);

  // Auto scroll highlighted item into view if navigating with keyboard
  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex]);

  if (results.length === 0) {
    return (
      <div className="mahi-search-empty">
        <div className="mahi-search-empty-icon">
          <SearchX size={36} strokeWidth={1.8} />
        </div>
        <h3 className="mahi-search-empty-title">No projects found for "{query}"</h3>
        <p className="mahi-search-empty-desc">
          Try searching by project name (e.g. <code>NoboGhat</code>, <code>marketplace</code>), directory path, or technology keywords like <code>React</code>, <code>Next.js</code>, <code>Rust</code>, <code>Spring Boot</code>, <code>Python</code>.
        </p>
      </div>
    );
  }

  const getGlyphColor = (type: string, tech: string[]) => {
    const lower = (type + ' ' + tech.join(' ')).toLowerCase();
    if (lower.includes('spring')) return { bg: 'rgba(0, 200, 255, 0.12)', color: '#00d2ff' };
    if (lower.includes('rust') || lower.includes('cargo')) return { bg: 'rgba(255, 120, 60, 0.12)', color: '#ff8a48' };
    if (lower.includes('next') || lower.includes('react')) return { bg: 'rgba(47, 127, 255, 0.14)', color: '#2f7fff' };
    if (lower.includes('python')) return { bg: 'rgba(255, 212, 59, 0.14)', color: '#ffd43b' };
    return { bg: 'rgba(130, 80, 255, 0.14)', color: '#9d66ff' };
  };

  return (
    <div className="mahi-search-results-container">
      <div className="mahi-search-results-header">
        <div className="mahi-search-count-badge">
          <Sparkles size={12} className="mahi-sparkle" />
          <span>{results.length} {results.length === 1 ? 'Project Match' : 'Project Matches'}</span>
        </div>
        <span className="mahi-search-hint">Use ↑ ↓ to navigate, ↵ to open in VS Code</span>
      </div>

      <div className="mahi-search-results-list" role="listbox">
        {results.map((project, idx) => {
          const isSelected = idx === selectedIndex;
          const { bg, color } = getGlyphColor(project.projectType, project.technologies);
          const glyph = project.name.substring(0, 2).toUpperCase();

          return (
            <div
              key={project.path}
              ref={isSelected ? selectedItemRef : null}
              className={`mahi-search-item ${isSelected ? 'is-selected' : ''}`}
              role="option"
              aria-selected={isSelected}
              onMouseEnter={() => onSelectIndex(idx)}
              onClick={() => onOpenProject(project)}
              onContextMenu={(e) => onContextMenu?.(project, e)}
            >
              <div 
                className="mahi-item-glyph-box" 
                style={{ background: bg, color: color }}
              >
                {glyph}
              </div>

              <div className="mahi-item-info">
                <div className="mahi-item-title-row">
                  <span className="mahi-item-name">{project.name}</span>
                  <span className="mahi-item-type-badge">{project.projectType}</span>
                  {project.gitSummary && (
                    <span className="mahi-search-git-pill" title={`Git: ${project.gitSummary}`}>
                      <GitBranch size={10} className="search-git-icon" />
                      <span>{project.gitSummary}</span>
                    </span>
                  )}
                </div>

                <div className="mahi-item-tags">
                  {project.technologies.slice(0, 4).map((tech) => (
                    <span key={tech} className="mahi-item-tag">
                      {tech}
                    </span>
                  ))}
                  {project.technologies.length > 4 && (
                    <span className="mahi-item-tag-more">
                      +{project.technologies.length - 4}
                    </span>
                  )}
                </div>

                <div className="mahi-item-path" title={project.path}>
                  {project.path}
                </div>
              </div>

              {/* Direct Quick Action Buttons */}
              <div className="mahi-item-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="mahi-action-pill-btn vs-code-btn"
                  title="Open in VS Code"
                  onClick={(e) => onOpenInVsCode(project, e)}
                >
                  <Code2 size={13} />
                  <span>VS Code</span>
                </button>

                <button
                  type="button"
                  className="mahi-action-pill-btn"
                  title="Open Terminal"
                  onClick={(e) => onOpenInTerminal(project, e)}
                >
                  <Terminal size={13} />
                  <span>Terminal</span>
                </button>

                <button
                  type="button"
                  className="mahi-action-pill-btn"
                  title="Reveal in Explorer"
                  onClick={(e) => onOpenInExplorer(project, e)}
                >
                  <FolderOpen size={13} />
                  <span>Explorer</span>
                </button>

                {onCopyPath && (
                  <button
                    type="button"
                    className="mahi-action-pill-btn"
                    title="Copy Path"
                    onClick={(e) => onCopyPath(project, e)}
                  >
                    <Link2 size={13} />
                    <span>Copy Path</span>
                  </button>
                )}

                {onShowDetails && (
                  <button
                    type="button"
                    className="mahi-action-pill-btn"
                    title="Project Intelligence"
                    onClick={(e) => onShowDetails(project, e)}
                  >
                    <Info size={13} />
                    <span>Details</span>
                  </button>
                )}

                {onOpenWorkspace && (
                  <button
                    type="button"
                    className="mahi-action-pill-btn"
                    title="Open Project Workspace Dashboard"
                    onClick={(e) => onOpenWorkspace(project, e)}
                  >
                    <LayoutDashboard size={13} />
                    <span>Workspace</span>
                  </button>
                )}

                {onTogglePin && (
                  <button
                    type="button"
                    className={`mahi-action-pill-btn ${project.isPinned ? 'is-pinned' : ''}`}
                    title={project.isPinned ? 'Unpin Project' : 'Pin Project'}
                    onClick={(e) => onTogglePin(project, e)}
                  >
                    <Pin size={12} fill={project.isPinned ? 'currentColor' : 'none'} />
                    <span>{project.isPinned ? 'Pinned' : 'Pin'}</span>
                  </button>
                )}

                <button
                  type="button"
                  className="mahi-action-pill-btn primary-btn"
                  title="Open Project"
                  onClick={() => onOpenProject(project)}
                >
                  <ArrowUpRight size={13} />
                </button>
              </div>

              {isSelected && (
                <div className="mahi-item-selected-indicator">
                  <Check size={12} strokeWidth={3} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mahi-search-footer-bar">
        <div className="mahi-shortcut-guide">
          <span className="mahi-key">↑</span>
          <span className="mahi-key">↓</span>
          <span className="mahi-key-label">Navigate</span>
          <span className="mahi-sep">·</span>
          <span className="mahi-key">↵ Enter</span>
          <span className="mahi-key-label">Launch in VS Code</span>
          <span className="mahi-sep">·</span>
          <span className="mahi-key">Esc</span>
          <span className="mahi-key-label">Clear / Hide</span>
        </div>
      </div>
    </div>
  );
};
