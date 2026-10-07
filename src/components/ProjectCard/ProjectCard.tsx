import React from 'react';
import { ArrowUpRight, Code2, Terminal, FolderOpen, Link2, Info, GitBranch, Play, LayoutDashboard, Pin } from 'lucide-react';
import './ProjectCard.css';

export interface ProjectData {
  id: string;
  name: string;
  tech: string;
  path?: string;
  activity: string;
  iconBg?: string;
  iconColor?: string;
  technologies?: string[];
  projectType?: string;
  gitSummary?: string;
  hasDevScript?: boolean;
  scripts?: string[];
  isPinned?: boolean;
}

interface ProjectCardProps {
  project: ProjectData;
  onClick?: () => void;
  onOpenVsCode?: (e: React.MouseEvent) => void;
  onOpenTerminal?: (e: React.MouseEvent) => void;
  onOpenExplorer?: (e: React.MouseEvent) => void;
  onCopyPath?: (e: React.MouseEvent) => void;
  onShowDetails?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onRunDevScript?: (e: React.MouseEvent) => void;
  onOpenWorkspace?: (e: React.MouseEvent) => void;
  onTogglePin?: (e: React.MouseEvent) => void;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({ 
  project, 
  onClick,
  onOpenVsCode,
  onOpenTerminal,
  onOpenExplorer,
  onCopyPath,
  onShowDetails,
  onContextMenu,
  onRunDevScript,
  onOpenWorkspace,
  onTogglePin,
}) => {
  return (
    <div 
      className="mahi-project-card" 
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div className="mahi-project-header">
        <div 
          className="mahi-project-icon-box"
          style={{
            background: project.iconBg || 'rgba(47, 127, 255, 0.12)',
            color: project.iconColor || '#2f7fff'
          }}
        >
          <span className="mahi-project-glyph">
            {project.name.substring(0, 2).toUpperCase()}
          </span>
        </div>
        <div className="mahi-project-meta">
          <div className="mahi-project-title-row">
            <h3 className="mahi-project-name" title={project.name}>{project.name}</h3>
            <div className="mahi-project-top-right">
              {onTogglePin && (
                <button
                  type="button"
                  className={`mahi-card-pin-icon-btn ${project.isPinned ? 'is-pinned' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(e);
                  }}
                  title={project.isPinned ? 'Unpin project' : 'Pin project'}
                >
                  <Pin size={13} fill={project.isPinned ? 'currentColor' : 'none'} />
                </button>
              )}
              <button
                type="button"
                className="mahi-card-launch-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onClick?.();
                }}
                title={`Open ${project.name}`}
                aria-label={`Open ${project.name}`}
              >
                <ArrowUpRight size={14} className="mahi-project-arrow" />
              </button>
            </div>
          </div>
          <div className="mahi-project-sub-row">
            <span className="mahi-project-tech">{project.tech}</span>
            {project.gitSummary && (
              <span className="mahi-card-git-tag" title={`Git: ${project.gitSummary}`}>
                <GitBranch size={10} className="card-git-icon" />
                <span>{project.gitSummary}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mahi-project-footer">
        {project.path && (
          <span className="mahi-project-path" title={project.path}>
            {project.path}
          </span>
        )}
        <span className="mahi-project-activity">{project.activity}</span>
      </div>

      {/* Hover Action Strip */}
      <div className="mahi-project-card-actions" onClick={(e) => e.stopPropagation()}>
        {project.hasDevScript && onRunDevScript && (
          <button
            type="button"
            className="mahi-card-action-btn dev-run"
            title="Run 'dev' script"
            onClick={onRunDevScript}
          >
            <Play size={10} fill="currentColor" />
            <span>dev</span>
          </button>
        )}
        {onOpenVsCode && (
          <button
            type="button"
            className="mahi-card-action-btn vs-code"
            title="Open in VS Code"
            onClick={onOpenVsCode}
          >
            <Code2 size={13} />
            <span>Code</span>
          </button>
        )}
        {onOpenTerminal && (
          <button
            type="button"
            className="mahi-card-action-btn"
            title="Open PowerShell"
            onClick={onOpenTerminal}
          >
            <Terminal size={13} />
            <span>Terminal</span>
          </button>
        )}
        {onOpenExplorer && (
          <button
            type="button"
            className="mahi-card-action-btn"
            title="Open in Explorer"
            onClick={onOpenExplorer}
          >
            <FolderOpen size={13} />
            <span>Explorer</span>
          </button>
        )}
        {onCopyPath && project.path && (
          <button
            type="button"
            className="mahi-card-action-btn"
            title="Copy Path"
            onClick={onCopyPath}
          >
            <Link2 size={13} />
            <span>Copy Path</span>
          </button>
        )}
        {onShowDetails && project.path && (
          <button
            type="button"
            className="mahi-card-action-btn"
            title="Project Intelligence"
            onClick={onShowDetails}
          >
            <Info size={13} />
            <span>Details</span>
          </button>
        )}
        {onOpenWorkspace && project.path && (
          <button
            type="button"
            className="mahi-card-action-btn workspace-btn"
            title="Open Project Workspace Dashboard"
            onClick={onOpenWorkspace}
          >
            <LayoutDashboard size={13} />
            <span>Workspace</span>
          </button>
        )}
        {onTogglePin && (
          <button
            type="button"
            className={`mahi-card-action-btn pin-btn ${project.isPinned ? 'is-pinned' : ''}`}
            title={project.isPinned ? 'Unpin Project' : 'Pin Project'}
            onClick={onTogglePin}
          >
            <Pin size={12} fill={project.isPinned ? 'currentColor' : 'none'} />
            <span>{project.isPinned ? 'Pinned' : 'Pin'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
