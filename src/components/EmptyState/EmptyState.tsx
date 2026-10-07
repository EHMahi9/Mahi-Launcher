import React from 'react';
import { 
  Pin, 
  Clock, 
  Terminal, 
  FileCode2, 
  GitBranch, 
  FolderGit2, 
  Radio, 
  ArrowRight
} from 'lucide-react';
import './EmptyState.css';

export type EmptyStateType = 
  | 'pinned-projects'
  | 'recent-projects'
  | 'running-processes'
  | 'pinned-scripts'
  | 'git-repo'
  | 'project-scripts'
  | 'search-results';

interface EmptyStateProps {
  type: EmptyStateType;
  title?: string;
  description?: string;
  actionText?: string;
  onAction?: () => void;
  secondaryText?: string;
  onSecondaryAction?: () => void;
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  type,
  title,
  description,
  actionText,
  onAction,
  secondaryText,
  onSecondaryAction,
  compact = false,
}) => {
  const getDefaultContent = () => {
    switch (type) {
      case 'pinned-projects':
        return {
          icon: <Pin size={compact ? 20 : 28} className="empty-state-glyph" />,
          title: 'No pinned projects yet',
          desc: 'Pin your high-priority projects for instant 1-click launch from the Home Dashboard and Command Center.',
          defaultActionText: 'Browse All Projects',
        };
      case 'recent-projects':
        return {
          icon: <Clock size={compact ? 20 : 28} className="empty-state-glyph" />,
          title: 'No recent activity recorded',
          desc: 'Open a project in VS Code, Terminal, or File Explorer to automatically populate your recent history.',
          defaultActionText: 'Explore Workspaces',
        };
      case 'running-processes':
        return {
          icon: <Radio size={compact ? 20 : 28} className="empty-state-glyph pulse" />,
          title: 'No active processes running',
          desc: 'MAHI monitors scripts you execute. Run a dev or build script from any project workspace to see live telemetry here.',
          defaultActionText: 'View Projects',
        };
      case 'pinned-scripts':
        return {
          icon: <Terminal size={compact ? 20 : 28} className="empty-state-glyph" />,
          title: 'No pinned scripts',
          desc: 'Click the pin icon on any package.json or manifest script to create quick-launch shortcuts.',
          defaultActionText: 'Find Scripts',
        };
      case 'git-repo':
        return {
          icon: <GitBranch size={compact ? 20 : 28} className="empty-state-glyph" />,
          title: 'Not a Git repository',
          desc: 'This directory is not currently tracked by Git. Initialize or clone a repository to enable live branch tracking.',
          defaultActionText: 'Open Terminal',
        };
      case 'project-scripts':
        return {
          icon: <FileCode2 size={compact ? 20 : 28} className="empty-state-glyph" />,
          title: 'No scripts discovered',
          desc: 'No runnable tasks were detected in package.json, Cargo.toml, or build manifests for this project.',
          defaultActionText: 'Open in VS Code',
        };
      case 'search-results':
      default:
        return {
          icon: <FolderGit2 size={compact ? 20 : 28} className="empty-state-glyph" />,
          title: 'No matching results found',
          desc: 'Try refining your search keyword or browse your local file system directly in Explorer.',
          defaultActionText: 'Clear Search',
        };
    }
  };

  const defaults = getDefaultContent();
  const displayTitle = title || defaults.title;
  const displayDesc = description || defaults.desc;
  const displayAction = actionText || defaults.defaultActionText;

  return (
    <div className={`mahi-empty-state-card ${type} ${compact ? 'is-compact' : ''}`}>
      <div className="empty-state-icon-wrap">
        {defaults.icon}
      </div>
      <div className="empty-state-text-wrap">
        <h4 className="empty-state-heading">{displayTitle}</h4>
        <p className="empty-state-body">{displayDesc}</p>
      </div>
      {(onAction || onSecondaryAction) && (
        <div className="empty-state-actions">
          {onAction && displayAction && (
            <button
              type="button"
              className="empty-state-btn primary"
              onClick={onAction}
            >
              <span>{displayAction}</span>
              <ArrowRight size={13} />
            </button>
          )}
          {onSecondaryAction && secondaryText && (
            <button
              type="button"
              className="empty-state-btn secondary"
              onClick={onSecondaryAction}
            >
              <span>{secondaryText}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
