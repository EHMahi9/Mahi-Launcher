import React, { useEffect, useState } from 'react';
import { 
  X, 
  Code2, 
  Terminal, 
  FolderOpen, 
  GitBranch, 
  Box, 
  Layers, 
  FileCode2, 
  ShieldCheck, 
  Link2, 
  RefreshCw,
  Sparkles,
  Calendar,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  AlertCircle,
  Play,
  Square,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
  Pin
} from 'lucide-react';
import { ProjectDetails, GitProjectStatus, ProjectProcessInfo } from '../../types/project';
import { formatDate } from '../../utils/formatters';
import { getGitStatus, runProjectScript, stopProjectProcess, getRunningProcesses, copyTextToClipboard } from '../../services/tauriApi';
import './ProjectDetailsModal.css';

interface ProjectDetailsModalProps {
  isOpen: boolean;
  project: ProjectDetails | null;
  loading: boolean;
  onClose: () => void;
  onOpenInVsCode?: (path: string) => void;
  onOpenInTerminal?: (path: string) => void;
  onOpenInExplorer?: (path: string) => void;
  onCopyPath?: (path: string) => void;
  onOpenWorkspace?: (path: string) => void;
  onTogglePin?: (path: string, name: string) => void;
}

export const ProjectDetailsModal: React.FC<ProjectDetailsModalProps> = ({
  isOpen,
  project,
  loading,
  onClose,
  onOpenInVsCode,
  onOpenInTerminal,
  onOpenInExplorer,
  onCopyPath,
  onOpenWorkspace,
  onTogglePin,
}) => {
  const [gitStatus, setGitStatus] = useState<GitProjectStatus | null>(null);
  const [isRefreshingGit, setIsRefreshingGit] = useState(false);
  const [processes, setProcesses] = useState<ProjectProcessInfo[]>([]);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [launchingScript, setLaunchingScript] = useState<string | null>(null);

  const normalizedProjectPath = project ? project.path.replace(/\\/g, '/').toLowerCase() : '';
  const projectProcesses = processes.filter(
    (p) => p.projectPath.replace(/\\/g, '/').toLowerCase() === normalizedProjectPath
  );

  const runningScriptMap = new Map<string, ProjectProcessInfo>();
  projectProcesses.forEach((p) => {
    if (p.status === 'running' || p.status === 'starting') {
      runningScriptMap.set(p.scriptName, p);
    }
  });

  const fetchProcesses = async () => {
    try {
      const list = await getRunningProcesses();
      setProcesses(list);
    } catch (e) {
      console.error('Failed to load processes:', e);
    }
  };

  useEffect(() => {
    if (isOpen && project) {
      fetchProcesses();
    }
  }, [isOpen, project]);

  useEffect(() => {
    if (!isOpen || !project) return;
    const hasActive = projectProcesses.some((p) => p.status === 'running' || p.status === 'starting');
    if (!hasActive) return;

    const timer = setInterval(() => {
      fetchProcesses();
    }, 1200);

    return () => clearInterval(timer);
  }, [isOpen, project, projectProcesses]);

  const handleRunScript = async (scriptName: string) => {
    if (!project) return;
    setScriptError(null);
    setLaunchingScript(scriptName);
    try {
      const proc = await runProjectScript(project.path, scriptName);
      setProcesses((prev) => [proc, ...prev.filter((p) => p.id !== proc.id)]);
      setExpandedLogId(proc.id);
    } catch (err: any) {
      setScriptError(err?.message || String(err));
    } finally {
      setLaunchingScript(null);
    }
  };

  const handleStopProcess = async (processId: string) => {
    try {
      const proc = await stopProjectProcess(processId);
      setProcesses((prev) => prev.map((p) => (p.id === proc.id ? proc : p)));
    } catch (err: any) {
      setScriptError(err?.message || String(err));
    }
  };

  const handleCopyLogs = async (processId: string, lines: string[]) => {
    const text = lines.join('\n');
    await copyTextToClipboard(text);
    setCopiedLogId(processId);
    setTimeout(() => setCopiedLogId(null), 2000);
  };

  // Sync git status when project changes or modal opens
  useEffect(() => {
    if (project) {
      setGitStatus(project.gitStatus ?? null);
    } else {
      setGitStatus(null);
    }
  }, [project]);

  useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
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

  const handleRefreshGitStatus = async () => {
    if (!project) return;
    setIsRefreshingGit(true);
    try {
      const status = await getGitStatus(project.path);
      setGitStatus(status);
    } catch (err) {
      console.error('Failed to refresh git status:', err);
    } finally {
      setIsRefreshingGit(false);
    }
  };

  if (!isOpen) return null;

  const glyph = project ? project.name.substring(0, 2).toUpperCase() : 'PJ';

  return (
    <div className="mahi-modal-overlay" onClick={onClose}>
      <div 
        className="mahi-project-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mahi-project-modal-title"
      >
        {/* Header */}
        <div className="mahi-project-modal-header">
          <div className="mahi-project-modal-glyph">
            {glyph}
          </div>
          <div className="mahi-project-modal-title-box">
            <div className="mahi-project-modal-title-row">
              <h2 id="mahi-project-modal-title" className="mahi-project-modal-name">
                {project ? project.name : 'Project Details'}
              </h2>
              {project && (
                <span className="mahi-project-modal-type-badge">
                  {project.projectType}
                </span>
              )}
            </div>
            <div className="mahi-project-modal-sub">
              <Sparkles size={11} className="mahi-sparkle" />
              <span>MAHI Project Intelligence</span>
            </div>
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

        {/* Content Body */}
        <div className="mahi-project-modal-body">
          {loading ? (
            <div className="mahi-project-modal-loading">
              <RefreshCw size={22} className="mahi-spin" />
              <span>Analyzing project structure & configuration...</span>
            </div>
          ) : project ? (
            <>
              {/* Path & Quick Copy */}
              <div className="mahi-modal-section">
                <span className="mahi-modal-section-label">Root Directory</span>
                <div className="mahi-modal-path-container">
                  <span className="mahi-modal-path-text" title={project.path}>
                    {project.path}
                  </span>
                  {onCopyPath && (
                    <button
                      type="button"
                      className="mahi-modal-copy-btn"
                      title="Copy Directory Path"
                      onClick={() => onCopyPath(project.path)}
                    >
                      <Link2 size={13} />
                      <span>Copy</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Status & Environment Badges */}
              <div className="mahi-modal-section">
                <span className="mahi-modal-section-label">Environment & Ecosystem</span>
                <div className="mahi-modal-meta-grid">
                  <div className={`mahi-modal-meta-card ${project.hasGit ? 'active' : ''}`}>
                    <GitBranch size={14} className="meta-icon git" />
                    <div className="meta-info">
                      <span className="meta-title">Version Control</span>
                      <span className="meta-val">{project.hasGit ? 'Git Repository' : 'No Git Detected'}</span>
                    </div>
                  </div>

                  <div className={`mahi-modal-meta-card ${project.hasDocker ? 'active' : ''}`}>
                    <Box size={14} className="meta-icon docker" />
                    <div className="meta-info">
                      <span className="meta-title">Containerization</span>
                      <span className="meta-val">{project.hasDocker ? 'Docker Configured' : 'Not Present'}</span>
                    </div>
                  </div>

                  <div className="mahi-modal-meta-card active">
                    <Layers size={14} className="meta-icon pkg" />
                    <div className="meta-info">
                      <span className="meta-title">Package Manager</span>
                      <span className="meta-val">{project.packageManager ? project.packageManager : 'None / Built-in'}</span>
                    </div>
                  </div>

                  {project.lastOpened ? (
                    <div className="mahi-modal-meta-card">
                      <Calendar size={14} className="meta-icon time" />
                      <div className="meta-info">
                        <span className="meta-title">Last Opened</span>
                        <span className="meta-val">{formatDate(project.lastOpened)}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Phase 7B: Live Git Status Section */}
              <div className="mahi-modal-section mahi-git-status-section">
                <div className="mahi-modal-section-title-row">
                  <div className="mahi-git-section-title">
                    <GitBranch size={13} className="git-title-icon" />
                    <span className="mahi-modal-section-label">Live Git Status</span>
                  </div>
                  {project.hasGit && (
                    <button
                      type="button"
                      className="mahi-git-refresh-btn"
                      onClick={handleRefreshGitStatus}
                      disabled={isRefreshingGit}
                      title="Refresh live Git status from local repository"
                    >
                      <RefreshCw size={11} className={isRefreshingGit ? "mahi-spin" : ""} />
                      <span>{isRefreshingGit ? "Refreshing..." : "Refresh Git Status"}</span>
                    </button>
                  )}
                </div>

                {!project.hasGit || (gitStatus && !gitStatus.isGitRepo) ? (
                  <div className="mahi-git-empty-card">
                    <GitBranch size={15} className="text-muted" />
                    <span>No Git repository</span>
                  </div>
                ) : gitStatus ? (
                  <div className="mahi-git-card">
                    {/* Top Row: Branch & Upstream status */}
                    <div className="mahi-git-top-row">
                      <div className="mahi-git-branch-badge">
                        <GitBranch size={13} className="git-branch-icon" />
                        <span className="git-branch-name">{gitStatus.branch || 'Detached HEAD'}</span>
                      </div>

                      <div className="mahi-git-upstream-info">
                        {gitStatus.hasUpstream ? (
                          <div className="mahi-git-divergence">
                            {gitStatus.ahead ? (
                              <span className="ahead-badge" title="Commits ahead of upstream">
                                <ArrowUp size={11} /> {gitStatus.ahead} ahead
                              </span>
                            ) : null}
                            {gitStatus.behind ? (
                              <span className="behind-badge" title="Commits behind upstream">
                                <ArrowDown size={11} /> {gitStatus.behind} behind
                              </span>
                            ) : null}
                            {!gitStatus.ahead && !gitStatus.behind ? (
                              <span className="synced-badge">
                                <CheckCircle2 size={11} /> Up to date with {gitStatus.upstreamBranch || 'upstream'}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="no-upstream-badge">No upstream configured</span>
                        )}
                      </div>
                    </div>

                    {/* Working Tree Counts */}
                    <div className="mahi-git-counts-grid">
                      <div className={`mahi-git-count-chip ${gitStatus.modifiedCount > 0 ? 'has-modified' : ''}`}>
                        <span className="count-num">{gitStatus.modifiedCount}</span>
                        <span className="count-label">modified</span>
                      </div>
                      <div className={`mahi-git-count-chip ${gitStatus.stagedCount > 0 ? 'has-staged' : ''}`}>
                        <span className="count-num">{gitStatus.stagedCount}</span>
                        <span className="count-label">staged</span>
                      </div>
                      <div className={`mahi-git-count-chip ${gitStatus.untrackedCount > 0 ? 'has-untracked' : ''}`}>
                        <span className="count-num">{gitStatus.untrackedCount}</span>
                        <span className="count-label">untracked</span>
                      </div>
                      {gitStatus.deletedCount > 0 && (
                        <div className="mahi-git-count-chip has-deleted">
                          <span className="count-num">{gitStatus.deletedCount}</span>
                          <span className="count-label">deleted</span>
                        </div>
                      )}
                      {gitStatus.renamedCount > 0 && (
                        <div className="mahi-git-count-chip has-renamed">
                          <span className="count-num">{gitStatus.renamedCount}</span>
                          <span className="count-label">renamed</span>
                        </div>
                      )}
                    </div>

                    {/* Changed Files List (bounded) */}
                    {gitStatus.changedFiles.length > 0 ? (
                      <div className="mahi-git-files-container">
                        <div className="mahi-git-files-header">
                          <span>Working Tree Changes ({gitStatus.totalChangedCount})</span>
                          {gitStatus.totalChangedCount > gitStatus.changedFiles.length && (
                            <span className="mahi-git-more-hint">showing first {gitStatus.changedFiles.length}</span>
                          )}
                        </div>
                        <div className="mahi-git-files-list">
                          {gitStatus.changedFiles.map((file, i) => (
                            <div key={i} className="mahi-git-file-row">
                              <span className={`git-status-code ${file.status.toLowerCase().replace('?', 'u')}`}>
                                {file.status}
                              </span>
                              <span className="git-file-name" title={file.path}>
                                {file.path}
                              </span>
                              {file.isStaged && <span className="git-staged-tag">staged</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="mahi-git-clean-banner">
                        <CheckCircle2 size={13} className="clean-icon" />
                        <span>Working tree clean — no uncommitted changes</span>
                      </div>
                    )}

                    {/* Git Root */}
                    {gitStatus.gitRoot && (
                      <div className="mahi-git-root-row">
                        <span className="git-root-label">Repository Root:</span>
                        <span className="git-root-path" title={gitStatus.gitRoot}>
                          {gitStatus.gitRoot}
                        </span>
                      </div>
                    )}

                    {gitStatus.error && (
                      <div className="mahi-git-error-banner">
                        <AlertCircle size={13} />
                        <span>{gitStatus.error}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mahi-git-loading">
                    <RefreshCw size={14} className="mahi-spin" />
                    <span>Loading Git status...</span>
                  </div>
                )}
              </div>

              {/* Technologies */}
              <div className="mahi-modal-section">
                <span className="mahi-modal-section-label">Technologies & Runtimes</span>
                <div className="mahi-modal-tags-row">
                  {project.technologies.length > 0 ? (
                    project.technologies.map((tech) => (
                      <span key={tech} className="mahi-tech-chip">
                        {tech}
                      </span>
                    ))
                  ) : (
                    <span className="mahi-tech-chip">Developer project</span>
                  )}
                </div>
              </div>

              {/* Frameworks */}
              {project.frameworks.length > 0 && (
                <div className="mahi-modal-section">
                  <span className="mahi-modal-section-label">Frameworks & Libraries</span>
                  <div className="mahi-modal-tags-row">
                    {project.frameworks.map((fw) => (
                      <span key={fw} className="mahi-framework-chip">
                        {fw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Available Scripts */}
              <div className="mahi-modal-section">
                <div className="mahi-modal-section-title-row">
                  <span className="mahi-modal-section-label">Available Scripts</span>
                  <span className="mahi-modal-section-subtag">
                    {project.packageManager ? project.packageManager : 'Node'}
                  </span>
                </div>

                {scriptError && (
                  <div className="mahi-modal-script-error">
                    <AlertCircle size={14} />
                    <span>{scriptError}</span>
                  </div>
                )}

                {project.scripts.length > 0 ? (
                  <div className="mahi-modal-scripts-list">
                    {project.scripts.map((scriptName) => {
                      const detected = project.detectedScripts?.find((s) => s.name === scriptName);
                      const runningProc = runningScriptMap.get(scriptName);
                      const isRunning = Boolean(runningProc);
                      const isLaunching = launchingScript === scriptName;

                      return (
                        <div key={scriptName} className={`mahi-script-row ${isRunning ? 'running' : ''}`}>
                          <div className="mahi-script-info">
                            <span className="mahi-script-name">
                              <span className="mahi-script-glyph">▶</span>
                              {scriptName}
                            </span>
                            {detected?.command && (
                              <span className="mahi-script-cmd" title={detected.command}>
                                {detected.command}
                              </span>
                            )}
                          </div>

                          <div className="mahi-script-actions">
                            {isRunning ? (
                              <button
                                type="button"
                                className="mahi-script-btn stop"
                                onClick={() => runningProc && handleStopProcess(runningProc.id)}
                                title="Stop running process"
                              >
                                <Square size={11} fill="currentColor" />
                                <span>Stop</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="mahi-script-btn run"
                                onClick={() => handleRunScript(scriptName)}
                                disabled={isLaunching}
                                title="Run script"
                              >
                                <Play size={11} fill="currentColor" />
                                <span>{isLaunching ? 'Starting...' : 'Run'}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : project.importantFiles.some((f) => f.includes('package.json')) ? (
                  <div className="mahi-modal-empty-scripts">
                    <span>No runnable scripts were found.</span>
                  </div>
                ) : null}
              </div>

              {/* Active & Recent Process Logs */}
              {projectProcesses.length > 0 && (
                <div className="mahi-modal-section mahi-process-section">
                  <div className="mahi-modal-section-title-row">
                    <span className="mahi-modal-section-label">Process Output & Status</span>
                    <span className="mahi-modal-section-subtag">{projectProcesses.length} tracked</span>
                  </div>

                  <div className="mahi-process-cards-list">
                    {projectProcesses.map((proc) => {
                      const isExpanded = expandedLogId === proc.id;
                      const isRunning = proc.status === 'running' || proc.status === 'starting';

                      return (
                        <div key={proc.id} className={`mahi-process-card status-${proc.status}`}>
                          <div className="mahi-process-card-header">
                            <div className="mahi-process-header-left">
                              <span className={`mahi-process-status-pill ${proc.status}`}>
                                {proc.status === 'running' ? (
                                  <>
                                    <span className="proc-pulse-dot" />
                                    Running
                                  </>
                                ) : proc.status === 'starting' ? (
                                  'Starting'
                                ) : proc.status === 'exited' ? (
                                  `Exited · code ${proc.exitCode ?? 0}`
                                ) : proc.status === 'failed' ? (
                                  `Failed · code ${proc.exitCode ?? 1}`
                                ) : (
                                  'Stopped'
                                )}
                              </span>
                              <span className="mahi-process-cmd-title">
                                {proc.packageManager} run {proc.scriptName}
                              </span>
                            </div>

                            <div className="mahi-process-header-actions">
                              {isRunning && (
                                <button
                                  type="button"
                                  className="mahi-proc-btn-stop"
                                  onClick={() => handleStopProcess(proc.id)}
                                  title="Stop Process"
                                >
                                  <Square size={10} fill="currentColor" />
                                  <span>Stop</span>
                                </button>
                              )}
                              <button
                                type="button"
                                className="mahi-proc-btn-toggle"
                                onClick={() => setExpandedLogId(isExpanded ? null : proc.id)}
                                title={isExpanded ? 'Hide output' : 'Show output'}
                              >
                                <span>{proc.outputLines.length} lines</span>
                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </button>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="mahi-process-log-container">
                              <div className="mahi-process-log-toolbar">
                                <span className="mahi-log-count">Last {proc.outputLines.length} lines</span>
                                <button
                                  type="button"
                                  className="mahi-log-copy-btn"
                                  onClick={() => handleCopyLogs(proc.id, proc.outputLines)}
                                  title="Copy Output"
                                >
                                  {copiedLogId === proc.id ? (
                                    <>
                                      <Check size={11} />
                                      <span>Copied</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy size={11} />
                                      <span>Copy</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              <pre className="mahi-process-log-viewer">
                                {proc.outputLines.length > 0 ? (
                                  proc.outputLines.join('\n')
                                ) : (
                                  <span className="log-empty">Waiting for output...</span>
                                )}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Important Files */}
              {project.importantFiles.length > 0 && (
                <div className="mahi-modal-section">
                  <span className="mahi-modal-section-label">Key Configuration Files</span>
                  <div className="mahi-modal-files-row">
                    {project.importantFiles.map((file) => {
                      const isEnv = file.includes('.env');
                      return (
                        <div 
                          key={file} 
                          className={`mahi-file-chip ${isEnv ? 'env-chip' : ''}`}
                          title={isEnv ? 'Environment file (presence detected only; never read for security)' : file}
                        >
                          {isEnv ? (
                            <ShieldCheck size={12} className="env-shield-icon" />
                          ) : (
                            <FileCode2 size={12} className="file-icon" />
                          )}
                          <span>{file}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="mahi-project-modal-empty">
              <span>No project details available.</span>
            </div>
          )}
        </div>

        {/* Modal Actions Footer */}
        <div className="mahi-project-modal-footer">
          <div className="mahi-project-modal-actions-left">
            {onOpenInVsCode && project && (
              <button
                type="button"
                className="mahi-modal-action-btn primary vs-code"
                onClick={() => onOpenInVsCode(project.path)}
              >
                <Code2 size={14} />
                <span>Open in VS Code</span>
              </button>
            )}
            {onOpenInTerminal && project && (
              <button
                type="button"
                className="mahi-modal-action-btn"
                onClick={() => onOpenInTerminal(project.path)}
              >
                <Terminal size={14} />
                <span>Terminal</span>
              </button>
            )}
            {onOpenInExplorer && project && (
              <button
                type="button"
                className="mahi-modal-action-btn"
                onClick={() => onOpenInExplorer(project.path)}
              >
                <FolderOpen size={14} />
                <span>Explorer</span>
              </button>
            )}
            {onOpenWorkspace && project && (
              <button
                type="button"
                className="mahi-modal-action-btn workspace-btn"
                onClick={() => {
                  onOpenWorkspace(project.path);
                  onClose();
                }}
                style={{
                  background: 'rgba(139, 92, 246, 0.15)',
                  borderColor: 'rgba(139, 92, 246, 0.4)',
                  color: '#c4b5fd',
                }}
              >
                <LayoutDashboard size={14} />
                <span>Open Project Dashboard</span>
              </button>
            )}
            {onTogglePin && project && (
              <button
                type="button"
                className={`mahi-modal-action-btn ${project.isPinned ? 'pinned-active' : ''}`}
                onClick={() => onTogglePin(project.path, project.name)}
                style={project.isPinned ? {
                  background: 'rgba(56, 189, 248, 0.15)',
                  borderColor: 'rgba(56, 189, 248, 0.4)',
                  color: '#38bdf8'
                } : undefined}
              >
                <Pin size={14} fill={project.isPinned ? 'currentColor' : 'none'} />
                <span>{project.isPinned ? 'Unpin Project' : 'Pin Project'}</span>
              </button>
            )}
          </div>

          <button
            type="button"
            className="mahi-modal-close-action-btn"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
