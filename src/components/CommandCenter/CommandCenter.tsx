import React, { useMemo } from 'react';
import { 
  Pin, 
  Clock, 
  Terminal, 
  Radio, 
  HardDrive, 
  GitBranch, 
  Settings, 
  FolderOpen, 
  Code2, 
  Square, 
  ExternalLink, 
  Globe, 
  RefreshCw, 
  ChevronRight,
  Database
} from 'lucide-react';
import { 
  ProjectInfo, 
  RecentProjectEntry, 
  PinnedProjectEntry, 
  ProjectProcessInfo,
  DebugStorageInfo
} from '../../types/project';
import { UserLocations } from '../../types/filesystem';
import { extractLocalhostUrls, normalizePath } from '../../services/tauriApi';
import { EmptyState } from '../EmptyState/EmptyState';
import './CommandCenter.css';

interface CommandCenterProps {
  projects: ProjectInfo[];
  recentProjects: RecentProjectEntry[];
  pinnedProjects: PinnedProjectEntry[];
  runningProcesses: ProjectProcessInfo[];
  debugStorage: DebugStorageInfo | null;
  configuredRoots?: string[];
  userLocations?: UserLocations | null;
  onOpenProject: (path: string, name: string) => void;
  onOpenInVsCode: (path: string, name?: string) => void;
  onOpenInTerminal: (path: string) => void;
  onOpenInExplorer: (path: string) => void;
  onOpenWorkspace: (path: string) => void;
  onTogglePin: (path: string, name: string) => void;
  onStopProcess: (processId: string) => void;
  onOpenSettings: () => void;
  onNavigateToLocation: (path: string) => void;
  onRefreshAll: () => void;
  refreshing: boolean;
  onOpenStorageIntelligence?: () => void;
}

export const CommandCenter: React.FC<CommandCenterProps> = ({
  projects,
  recentProjects,
  pinnedProjects,
  runningProcesses,
  debugStorage,
  configuredRoots = [],
  userLocations = null,
  onOpenProject,
  onOpenInVsCode,
  onOpenInTerminal,
  onOpenInExplorer,
  onOpenWorkspace,
  onTogglePin,
  onStopProcess,
  onOpenSettings,
  onNavigateToLocation,
  onRefreshAll,
  refreshing,
  onOpenStorageIntelligence,
}) => {
  // Active processes
  const activeProcesses = useMemo(() => {
    return runningProcesses.filter((p) => p.status === 'running' || p.status === 'starting');
  }, [runningProcesses]);

  // Discovered projects lookup
  const projectMap = useMemo(() => {
    const map = new Map<string, ProjectInfo>();
    projects.forEach((p) => {
      map.set(normalizePath(p.path), p);
    });
    return map;
  }, [projects]);

  // Aggregate Git summary across all discovered projects
  const gitSummaryMetrics = useMemo(() => {
    let repoCount = 0;
    let modifiedProjects = 0;
    let cleanProjects = 0;
    projects.forEach((p) => {
      if (p.gitSummary) {
        repoCount++;
        if (p.gitSummary.toLowerCase().includes('clean')) {
          cleanProjects++;
        } else {
          modifiedProjects++;
        }
      }
    });
    return { repoCount, modifiedProjects, cleanProjects };
  }, [projects]);

  // Format uptime for running process
  const formatUptime = (startedAt: number) => {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    if (elapsedSec < 60) return `${elapsedSec}s`;
    const mins = Math.floor(elapsedSec / 60);
    const remSecs = elapsedSec % 60;
    if (mins < 60) return `${mins}m ${remSecs}s`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h ${remMins}m`;
  };

  return (
    <div className="mahi-command-center">
      {/* Header Banner */}
      <div className="cc-header-banner">
        <div className="cc-banner-left">
          <div className="cc-badge">
            <Radio size={12} className="cc-pulse-icon" />
            <span>DEVELOPER COMMAND CENTER</span>
          </div>
          <h1 className="cc-title">Unified Workspace Hub</h1>
          <p className="cc-subtitle">
            Central dashboard for active processes, pinned projects, repositories, and workspace health.
          </p>
        </div>

        <div className="cc-banner-right">
          <button
            type="button"
            className="cc-refresh-btn"
            onClick={onRefreshAll}
            disabled={refreshing}
            title="Refresh workspace telemetry"
          >
            <RefreshCw size={14} className={refreshing ? 'mahi-spin' : ''} />
            <span>{refreshing ? 'Scanning...' : 'Refresh'}</span>
          </button>
          <button
            type="button"
            className="cc-settings-btn"
            onClick={onOpenSettings}
            title="Settings & Storage"
          >
            <Settings size={14} />
            <span>Settings</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="cc-metrics-grid">
        <div className="cc-metric-tile">
          <div className="metric-icon-wrap blue">
            <Terminal size={16} />
          </div>
          <div className="metric-info">
            <span className="metric-num">{activeProcesses.length}</span>
            <span className="metric-lbl">Active Processes</span>
          </div>
        </div>

        <div className="cc-metric-tile">
          <div className="metric-icon-wrap amber">
            <Pin size={16} />
          </div>
          <div className="metric-info">
            <span className="metric-num">{pinnedProjects.length}</span>
            <span className="metric-lbl">Pinned Workspaces</span>
          </div>
        </div>

        <div className="cc-metric-tile">
          <div className="metric-icon-wrap green">
            <GitBranch size={16} />
          </div>
          <div className="metric-info">
            <span className="metric-num">{gitSummaryMetrics.repoCount}</span>
            <span className="metric-lbl">Git Repositories</span>
          </div>
        </div>

        <div 
          className="cc-metric-tile" 
          onClick={onOpenStorageIntelligence || onOpenSettings} 
          style={{ cursor: 'pointer' }} 
          title="Click to open Storage Diagnostics"
        >
          <div className="metric-icon-wrap purple">
            <Database size={16} />
          </div>
          <div className="metric-info">
            <span className="metric-num">
              {debugStorage?.exists ? `${debugStorage.sizeMb} MB` : 'Advisor'}
            </span>
            <span className="metric-lbl">Storage Diagnostics</span>
          </div>
        </div>
      </div>

      {/* Main 2-Column Command Grid */}
      <div className="cc-main-grid">
        {/* Left Column: Running Processes + Pinned Projects */}
        <div className="cc-col-main">
          {/* Running Processes Section */}
          <section className="cc-card running-section">
            <div className="cc-card-header">
              <div className="cc-card-title">
                <Radio size={16} className="cc-title-icon green-pulse" />
                <h3>Running Projects & Processes</h3>
              </div>
              <span className="cc-count-pill">
                {activeProcesses.length} Active
              </span>
            </div>

            <div className="cc-card-body">
              {activeProcesses.length === 0 ? (
                <EmptyState
                  type="running-processes"
                  title="No background processes running"
                  description="MAHI monitors processes you start with runProjectScript. Launch dev scripts from your workspace."
                  compact={true}
                  onAction={() => {
                    if (pinnedProjects[0]) {
                      onOpenWorkspace(pinnedProjects[0].path);
                    } else if (projects[0]) {
                      onOpenWorkspace(projects[0].path);
                    }
                  }}
                  actionText="Open Workspace"
                />
              ) : (
                <div className="cc-process-list">
                  {activeProcesses.map((proc) => {
                    const urls = extractLocalhostUrls(proc.outputLines);
                    return (
                      <div key={proc.id} className="cc-process-item">
                        <div className="process-left">
                          <div className="process-status-indicator">
                            <span className="status-ping" />
                          </div>
                          <div className="process-details">
                            <div className="process-headline">
                              <span className="process-proj-name">{proc.projectName}</span>
                              <span className="process-script-pill">
                                {proc.packageManager} run {proc.scriptName}
                              </span>
                            </div>
                            <div className="process-subline">
                              <span className="uptime-tag">
                                <Clock size={11} />
                                {formatUptime(proc.startedAt)}
                              </span>
                              <span className="output-count">
                                {proc.outputLines.length} lines buffered
                              </span>
                              {urls.length > 0 && (
                                <a
                                  href={urls[0]}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="process-url-badge"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Globe size={11} />
                                  <span>{urls[0]}</span>
                                  <ExternalLink size={10} />
                                </a>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="process-actions">
                          <button
                            type="button"
                            className="cc-action-btn workspace"
                            onClick={() => onOpenWorkspace(proc.projectPath)}
                            title="Inspect logs and controls in Project Workspace"
                          >
                            <Terminal size={12} />
                            <span>Logs & Controls</span>
                          </button>
                          <button
                            type="button"
                            className="cc-action-btn stop"
                            onClick={() => onStopProcess(proc.id)}
                            title="Stop process"
                          >
                            <Square size={12} fill="currentColor" />
                            <span>Stop</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Pinned Projects Section */}
          <section className="cc-card pinned-section">
            <div className="cc-card-header">
              <div className="cc-card-title">
                <Pin size={16} className="cc-title-icon yellow" />
                <h3>Pinned Projects</h3>
              </div>
              <span className="cc-count-pill">
                {pinnedProjects.length} Pinned
              </span>
            </div>

            <div className="cc-card-body">
              {pinnedProjects.length === 0 ? (
                <EmptyState
                  type="pinned-projects"
                  title="No projects pinned yet"
                  description="Pin frequently used projects from the search bar, home dashboard, or right-click menu."
                  compact={true}
                  onAction={() => {
                    if (projects[0]) onOpenProject(projects[0].path, projects[0].name);
                  }}
                  actionText="Launch Top Project"
                />
              ) : (
                <div className="cc-pinned-list">
                  {pinnedProjects.map((pinned) => {
                    const normPath = normalizePath(pinned.path);
                    const info = projectMap.get(normPath);
                    return (
                      <div 
                        key={pinned.path} 
                        className="cc-project-row"
                        onClick={() => onOpenWorkspace(pinned.path)}
                      >
                        <div className="project-row-left">
                          <div className="project-glyph-box">
                            {pinned.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div className="project-row-meta">
                            <div className="project-name-row">
                              <span className="project-name">{pinned.name}</span>
                              {info?.gitSummary && (
                                <span className="project-git-tag" title={`Git: ${info.gitSummary}`}>
                                  <GitBranch size={10} />
                                  <span>{info.gitSummary}</span>
                                </span>
                              )}
                            </div>
                            <span className="project-path" title={pinned.path}>
                              {pinned.path}
                            </span>
                          </div>
                        </div>

                        <div className="project-row-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="cc-mini-btn"
                            onClick={() => onOpenInVsCode(pinned.path, pinned.name)}
                            title="Open in VS Code"
                          >
                            <Code2 size={13} />
                          </button>
                          <button
                            type="button"
                            className="cc-mini-btn"
                            onClick={() => onOpenInTerminal(pinned.path)}
                            title="Open Terminal"
                          >
                            <Terminal size={13} />
                          </button>
                          <button
                            type="button"
                            className="cc-mini-btn"
                            onClick={() => onOpenInExplorer(pinned.path)}
                            title="Open in Explorer"
                          >
                            <FolderOpen size={13} />
                          </button>
                          <button
                            type="button"
                            className="cc-mini-btn unpin"
                            onClick={() => onTogglePin(pinned.path, pinned.name)}
                            title="Unpin project"
                          >
                            <Pin size={13} fill="currentColor" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Recent Workspaces Section */}
          <section className="cc-card recent-section">
            <div className="cc-card-header">
              <div className="cc-card-title">
                <Clock size={16} className="cc-title-icon blue" />
                <h3>Recent Workspaces</h3>
              </div>
              <span className="cc-count-pill">
                {recentProjects.length} Recent
              </span>
            </div>

            <div className="cc-card-body">
              {recentProjects.length === 0 ? (
                <EmptyState
                  type="recent-projects"
                  compact={true}
                />
              ) : (
                <div className="cc-pinned-list">
                  {recentProjects.slice(0, 5).map((recent) => (
                    <div 
                      key={recent.path} 
                      className="cc-project-row"
                      onClick={() => onOpenWorkspace(recent.path)}
                    >
                      <div className="project-row-left">
                        <div className="project-glyph-box recent">
                          {recent.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="project-row-meta">
                          <span className="project-name">{recent.name}</span>
                          <span className="project-path" title={recent.path}>{recent.path}</span>
                        </div>
                      </div>

                      <div className="project-row-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="cc-mini-btn"
                          onClick={() => onOpenInVsCode(recent.path, recent.name)}
                          title="Open in VS Code"
                        >
                          <Code2 size={13} />
                        </button>
                        <button
                          type="button"
                          className="cc-mini-btn"
                          onClick={() => onOpenInTerminal(recent.path)}
                          title="Open Terminal"
                        >
                          <Terminal size={13} />
                        </button>
                        <button
                          type="button"
                          className="cc-mini-btn"
                          onClick={() => onOpenInExplorer(recent.path)}
                          title="Open in Explorer"
                        >
                          <FolderOpen size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right Column: Quick Explorer Locations + Git Activity + Storage Health */}
        <div className="cc-col-side">
          {/* Quick Explorer Locations */}
          <section className="cc-card side-card">
            <div className="cc-card-header">
              <div className="cc-card-title">
                <HardDrive size={16} className="cc-title-icon" />
                <h3>Quick Locations</h3>
              </div>
            </div>

            <div className="cc-quick-loc-list">
              {configuredRoots && configuredRoots.length > 0 && (
                configuredRoots.slice(0, 2).map((root) => {
                  const folderName = root.split(/[\\/]/).filter(Boolean).pop() || root;
                  return (
                    <div 
                      key={root}
                      className="cc-loc-item"
                      onClick={() => onNavigateToLocation(root)}
                    >
                      <div className="loc-icon-box">
                        <FolderOpen size={14} />
                      </div>
                      <div className="loc-info">
                        <span className="loc-name">{folderName}</span>
                        <span className="loc-path">{root}</span>
                      </div>
                      <ChevronRight size={13} className="loc-arrow" />
                    </div>
                  );
                })
              )}

              {userLocations?.documents && (
                <div 
                  className="cc-loc-item"
                  onClick={() => onNavigateToLocation(userLocations.documents)}
                >
                  <div className="loc-icon-box">
                    <FolderOpen size={14} />
                  </div>
                  <div className="loc-info">
                    <span className="loc-name">Documents</span>
                    <span className="loc-path">{userLocations.documents}</span>
                  </div>
                  <ChevronRight size={13} className="loc-arrow" />
                </div>
              )}

              <div 
                className="cc-loc-item"
                onClick={() => onNavigateToLocation('this-pc')}
              >
                <div className="loc-icon-box">
                  <HardDrive size={14} />
                </div>
                <div className="loc-info">
                  <span className="loc-name">This PC / All Drives</span>
                  <span className="loc-path">Storage Volumes & Filesystem</span>
                </div>
                <ChevronRight size={13} className="loc-arrow" />
              </div>
            </div>
          </section>

          {/* Git Activity Summary */}
          <section className="cc-card side-card">
            <div className="cc-card-header">
              <div className="cc-card-title">
                <GitBranch size={16} className="cc-title-icon" />
                <h3>Git Activity Summary</h3>
              </div>
            </div>

            <div className="cc-git-summary-box">
              <div className="git-stat-row">
                <span className="git-stat-label">Tracked Repositories</span>
                <span className="git-stat-val">{gitSummaryMetrics.repoCount}</span>
              </div>
              <div className="git-stat-row">
                <span className="git-stat-label">Clean Working Trees</span>
                <span className="git-stat-val clean">{gitSummaryMetrics.cleanProjects}</span>
              </div>
              <div className="git-stat-row">
                <span className="git-stat-label">Pending / Modified</span>
                <span className="git-stat-val modified">{gitSummaryMetrics.modifiedProjects}</span>
              </div>
              <p className="git-summary-note">
                Git operations are read-only. Clean status is maintained automatically without altering repo states.
              </p>
            </div>
          </section>

          {/* Storage & Engine Status */}
          <section className="cc-card side-card">
            <div className="cc-card-header">
              <div className="cc-card-title">
                <Database size={16} className="cc-title-icon" />
                <h3>Workspace Storage</h3>
              </div>
            </div>

            <div className="cc-storage-box">
              <div className="storage-status-row">
                <span className="storage-label">Debug Compilation Size:</span>
                <span className="storage-val">
                  {debugStorage?.exists ? `${debugStorage.sizeMb} MB` : '0 MB'}
                </span>
              </div>
              <p className="storage-desc">
                Clean Rust/Tauri debug artifacts whenever storage usage rises to keep the project lean.
              </p>
              <button
                type="button"
                className="cc-clean-storage-btn"
                onClick={onOpenSettings}
              >
                <Settings size={13} />
                <span>Open Storage Settings</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
