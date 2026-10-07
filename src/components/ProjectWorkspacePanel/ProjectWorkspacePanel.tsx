import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  Code2,
  Terminal,
  FolderOpen,
  GitBranch,
  RefreshCw,
  Play,
  Square,
  Copy,
  Check,
  ExternalLink,
  FileCode2,
  AlertCircle,
  Clock,
  Globe,
  Radio,
  X,
  FileText,
  Pin,
  PinOff,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  SlidersHorizontal,
  Key
} from 'lucide-react';
import { 
  ProjectDetails, 
  GitProjectStatus, 
  ProjectProcessInfo, 
  ProjectScript,
  CustomEnvVar,
  ProjectWorkspaceConfig
} from '../../types/project';
import { WorkspaceProcessStatus } from '../../types/workspaceProcess';
import { WorkspaceProfile } from '../../types/workspaceProfile';
import {
  getProjectDetails,
  getGitStatus,
  stopProjectProcess,
  stopWorkspaceProcess,
  getRunningProcesses,
  copyPathToClipboard,
  copyTextToClipboard,
  openExternalUrl,
  extractLocalhostUrls,
  getProjectWorkspaceConfig,
  saveProjectWorkspaceConfig,
  togglePinScript,
  listWorkspaceProcesses,
  getWorkspaceProfile
} from '../../services/tauriApi';
import { EmptyState } from '../EmptyState/EmptyState';
import { ExecutionPreviewModal } from '../ExecutionPreview/ExecutionPreviewModal';
import { WorkspaceProcessView } from '../WorkspaceProcess/WorkspaceProcessView';
import './ProjectWorkspacePanel.css';

interface ProjectWorkspacePanelProps {
  projectPath: string;
  onBack: () => void;
  onOpenInVsCode: (path: string) => void;
  onOpenInTerminal: (path: string) => void;
  onOpenInExplorer: (path: string) => void;
  onNavigateToExplorer?: (path: string) => void;
}

export const ProjectWorkspacePanel: React.FC<ProjectWorkspacePanelProps> = ({
  projectPath,
  onBack,
  onOpenInVsCode,
  onOpenInTerminal,
  onOpenInExplorer,
  onNavigateToExplorer,
}) => {
  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Phase 7E: Workspace configuration state
  const [workspaceConfig, setWorkspaceConfig] = useState<ProjectWorkspaceConfig>({
    pinnedScripts: [],
    envOverrides: [],
  });
  const [showEnvSection, setShowEnvSection] = useState(false);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');
  const [newEnvIsSecret, setNewEnvIsSecret] = useState(false);
  const [editingEnvKey, setEditingEnvKey] = useState<string | null>(null);
  const [editEnvValue, setEditEnvValue] = useState('');
  const [editEnvIsSecret, setEditEnvIsSecret] = useState(false);

  // Git state
  const [gitStatus, setGitStatus] = useState<GitProjectStatus | null>(null);
  const [isRefreshingGit, setIsRefreshingGit] = useState(false);

  // Runtime & Process state
  const [processes, setProcesses] = useState<ProjectProcessInfo[]>([]);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);

  // Phase 9C-D3: Execution Preview & Workspace Process Session state
  const [previewAction, setPreviewAction] = useState<string | null>(null);
  const [activeWorkspaceSession, setActiveWorkspaceSession] = useState<WorkspaceProcessStatus | null>(null);
  const [activeWorkspaceSessionId, setActiveWorkspaceSessionId] = useState<string | null>(null);
  const [workspaceSessions, setWorkspaceSessions] = useState<WorkspaceProcessStatus[]>([]);

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Normalized path comparison helper
  const normalizedPath = useMemo(() => {
    return projectPath.replace(/\\/g, '/').toLowerCase();
  }, [projectPath]);

  // Phase 9C-C: Workspace Profile state
  const [workspaceProfile, setWorkspaceProfile] = useState<WorkspaceProfile | null>(null);

  // Load project details, initial git status, and workspace config
  const loadProject = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [details, wsConfig, wsProfile] = await Promise.all([
        getProjectDetails(projectPath),
        getProjectWorkspaceConfig(projectPath),
        getWorkspaceProfile(projectPath).catch(() => null)
      ]);
      setProject(details);
      setGitStatus(details.gitStatus ?? null);
      setWorkspaceConfig(wsConfig);
      setWorkspaceProfile(wsProfile);
    } catch (err: any) {
      console.error('Failed to load project details or workspace config:', err);
      setError(err?.message || 'Failed to load project details');
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  // Load processes
  const fetchProcesses = useCallback(async () => {
    try {
      const list = await getRunningProcesses();
      setProcesses(list);
    } catch (e) {
      console.error('Failed to get running processes:', e);
    }
  }, []);

  // Phase 9C-D3: Fetch workspace execution sessions
  const fetchWorkspaceSessions = useCallback(async () => {
    try {
      const list = await listWorkspaceProcesses();
      const forThisProject = list.filter(
        (s) => s.projectPath.replace(/\\/g, '/').toLowerCase() === normalizedPath
      );
      setWorkspaceSessions(forThisProject);
    } catch (e) {
      console.warn('Failed to list workspace processes:', e);
    }
  }, [normalizedPath]);

  useEffect(() => {
    loadProject();
    fetchProcesses();
    fetchWorkspaceSessions();
  }, [loadProject, fetchProcesses, fetchWorkspaceSessions]);

  // Toggle Pinned Script
  const handleTogglePinScript = async (scriptName: string) => {
    try {
      const updatedPinned = await togglePinScript(projectPath, scriptName);
      setWorkspaceConfig((prev) => ({
        ...prev,
        pinnedScripts: updatedPinned
      }));
    } catch (err: any) {
      console.error('Failed to toggle pin script:', err);
      setActionError(err?.message || 'Failed to pin script');
    }
  };

  // Custom Env Overrides Handlers
  const handleSaveEnvOverrides = async (newEnvList: CustomEnvVar[]) => {
    try {
      const updatedConfig: ProjectWorkspaceConfig = {
        ...workspaceConfig,
        envOverrides: newEnvList
      };
      await saveProjectWorkspaceConfig(projectPath, updatedConfig);
      setWorkspaceConfig(updatedConfig);
    } catch (err: any) {
      console.error('Failed to save workspace config:', err);
      setActionError(err?.message || 'Failed to save environment overrides');
    }
  };

  const handleAddEnvVar = async () => {
    const key = newEnvKey.trim();
    if (!key) return;
    if (workspaceConfig.envOverrides.some((v) => v.key.toLowerCase() === key.toLowerCase())) {
      setActionError(`Variable '${key}' already exists.`);
      return;
    }
    const updated = [
      ...workspaceConfig.envOverrides,
      {
        key,
        value: newEnvValue,
        enabled: true,
        isSecret: newEnvIsSecret
      }
    ];
    await handleSaveEnvOverrides(updated);
    setNewEnvKey('');
    setNewEnvValue('');
    setNewEnvIsSecret(false);
  };

  const handleToggleEnvEnabled = async (key: string) => {
    const updated = workspaceConfig.envOverrides.map((v) => 
      v.key === key ? { ...v, enabled: !v.enabled } : v
    );
    await handleSaveEnvOverrides(updated);
  };

  const handleDeleteEnvVar = async (key: string) => {
    const updated = workspaceConfig.envOverrides.filter((v) => v.key !== key);
    await handleSaveEnvOverrides(updated);
  };

  const handleStartEditEnv = (item: CustomEnvVar) => {
    setEditingEnvKey(item.key);
    setEditEnvValue(item.value);
    setEditEnvIsSecret(item.isSecret);
  };

  const handleSaveEditEnv = async () => {
    if (!editingEnvKey) return;
    const updated = workspaceConfig.envOverrides.map((v) => 
      v.key === editingEnvKey 
        ? { ...v, value: editEnvValue, isSecret: editEnvIsSecret } 
        : v
    );
    await handleSaveEnvOverrides(updated);
    setEditingEnvKey(null);
  };

  const toggleRevealSecret = (key: string) => {
    setRevealedSecrets((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // Filter processes belonging strictly to this project
  const projectProcesses = useMemo(() => {
    return processes.filter(
      (p) => p.projectPath.replace(/\\/g, '/').toLowerCase() === normalizedPath
    );
  }, [processes, normalizedPath]);

  // Auto-poll runtime processes ONLY when active (running or starting) processes exist
  useEffect(() => {
    const hasActiveLegacy = projectProcesses.some(
      (p) => p.status === 'running' || p.status === 'starting'
    );
    const hasActiveWs = workspaceSessions.some(
      (s) => s.state === 'RUNNING' || s.state === 'STARTING' || s.state === 'STOPPING'
    );
    if (!hasActiveLegacy && !hasActiveWs) return;

    const timer = setInterval(() => {
      if (hasActiveLegacy) fetchProcesses();
      if (hasActiveWs) fetchWorkspaceSessions();
    }, 1200);

    return () => clearInterval(timer);
  }, [projectProcesses, workspaceSessions, fetchProcesses, fetchWorkspaceSessions]);

  // Map of currently running scripts
  const runningScriptMap = useMemo(() => {
    const map = new Map<string, ProjectProcessInfo>();
    projectProcesses.forEach((p) => {
      if (p.status === 'running' || p.status === 'starting') {
        map.set(p.scriptName, p);
      }
    });
    return map;
  }, [projectProcesses]);

  // Candidate primary development script: dev > start > serve
  const devScript: ProjectScript | undefined = useMemo(() => {
    if (!project) return undefined;
    const scripts = project.detectedScripts || [];
    return (
      scripts.find((s) => s.name === 'dev') ||
      scripts.find((s) => s.name === 'start') ||
      scripts.find((s) => s.name === 'serve') ||
      (project.scripts.includes('dev')
        ? {
            name: 'dev',
            projectPath: project.path,
            ecosystem: 'node',
            packageManager: project.packageManager || 'npm',
            command: null,
            description: null,
          }
        : undefined)
    );
  }, [project]);

  const runningDevProcess = devScript ? runningScriptMap.get(devScript.name) : undefined;

  // Selected process for log output
  const activeSelectedProcess = useMemo(() => {
    if (selectedProcessId) {
      const found = projectProcesses.find((p) => p.id === selectedProcessId);
      if (found) return found;
    }
    // Default to the running dev process or the most recent process
    if (runningDevProcess) return runningDevProcess;
    return projectProcesses[0] || null;
  }, [selectedProcessId, projectProcesses, runningDevProcess]);

  // Detected URLs across project processes or active selected process
  const detectedUrls = useMemo(() => {
    if (activeSelectedProcess) {
      return extractLocalhostUrls(activeSelectedProcess.outputLines);
    }
    if (runningDevProcess) {
      return extractLocalhostUrls(runningDevProcess.outputLines);
    }
    return [];
  }, [activeSelectedProcess, runningDevProcess]);

  // Auto-scroll logs to bottom when new output arrives
  useEffect(() => {
    if (activeSelectedProcess && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeSelectedProcess?.outputLines.length]);

  // Refresh Git Status manually
  const handleRefreshGit = async () => {
    if (!project) return;
    setIsRefreshingGit(true);
    try {
      const status = await getGitStatus(project.path);
      setGitStatus(status);
    } catch (err: any) {
      console.error('Failed to refresh git status:', err);
    } finally {
      setIsRefreshingGit(false);
    }
  };

  // Phase 9C-D3: Execution Preview Triggers & Handlers
  const handleOpenExecutionPreview = (actionOrScript: string) => {
    setActionError(null);
    setPreviewAction(actionOrScript);
  };

  const handleExecutionLaunched = (sessionStatus: WorkspaceProcessStatus) => {
    setActiveWorkspaceSession(sessionStatus);
    setActiveWorkspaceSessionId(sessionStatus.sessionId);
    setWorkspaceSessions((prev) => [
      sessionStatus,
      ...prev.filter((s) => s.sessionId !== sessionStatus.sessionId)
    ]);
    setPreviewAction(null);
  };

  // Stop process (handles both workspace sessions and legacy processes)
  const handleStopProcess = async (processId: string) => {
    setActionError(null);
    try {
      if (processId.startsWith('session-') || processId.startsWith('ws-')) {
        const stopped = await stopWorkspaceProcess(processId);
        setWorkspaceSessions((prev) => prev.map((s) => (s.sessionId === stopped.sessionId ? stopped : s)));
      } else {
        const proc = await stopProjectProcess(processId);
        setProcesses((prev) => prev.map((p) => (p.id === proc.id ? proc : p)));
      }
    } catch (err: any) {
      try {
        const stopped = await stopWorkspaceProcess(processId);
        setWorkspaceSessions((prev) => prev.map((s) => (s.sessionId === stopped.sessionId ? stopped : s)));
      } catch {
        setActionError(err?.message || String(err));
      }
    }
  };

  // Copy Path
  const handleCopyPath = async () => {
    if (!project) return;
    try {
      await copyPathToClipboard(project.path);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    } catch (err) {
      console.error('Failed to copy path:', err);
    }
  };

  // Copy Logs
  const handleCopyLogs = async (processId: string, lines: string[]) => {
    const text = lines.join('\n');
    await copyTextToClipboard(text);
    setCopiedLogId(processId);
    setTimeout(() => setCopiedLogId(null), 2000);
  };

  // Open detected localhost URL
  const handleOpenUrl = async (url: string) => {
    try {
      await openExternalUrl(url);
    } catch (err) {
      console.error('Failed to open url:', err);
    }
  };

  // Format uptime from timestamp
  const formatUptime = (startedAt: number) => {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    if (elapsedSec < 60) return `${elapsedSec}s`;
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h ${remMins}m`;
  };

  if (loading) {
    return (
      <div className="mahi-workspace-panel loading-state">
        <div className="mahi-workspace-loading-spinner">
          <RefreshCw size={28} className="mahi-spin" />
        </div>
        <h2>Loading Project Command Center...</h2>
        <p>{projectPath}</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="mahi-workspace-panel error-state">
        <AlertCircle size={36} className="error-icon" />
        <h2>Unable to load project workspace</h2>
        <p>{error || 'Project metadata could not be resolved from this location.'}</p>
        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button type="button" className="mahi-ws-btn primary" onClick={loadProject}>
            <RefreshCw size={14} />
            <span>Retry</span>
          </button>
          <button type="button" className="mahi-ws-btn secondary" onClick={onBack}>
            <ArrowLeft size={14} />
            <span>Return</span>
          </button>
        </div>
      </div>
    );
  }

  const glyph = project.name.substring(0, 2).toUpperCase();

  return (
    <div className="mahi-workspace-panel">
      {/* Top Breadcrumb & Action Toolbar */}
      <div className="mahi-ws-toolbar">
        <div className="mahi-ws-breadcrumb">
          <button type="button" className="mahi-ws-back-btn" onClick={onBack} title="Return to previous view">
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>
          <span className="mahi-ws-sep">/</span>
          <span className="mahi-ws-crumb-root">Projects</span>
          <span className="mahi-ws-sep">/</span>
          <span className="mahi-ws-crumb-active">{project.name}</span>
        </div>

        <div className="mahi-ws-quick-actions">
          <button
            type="button"
            className="mahi-ws-action-pill vs-code"
            onClick={() => onOpenInVsCode(project.path)}
            title="Open project in Visual Studio Code"
          >
            <Code2 size={13} />
            <span>VS Code</span>
          </button>

          <button
            type="button"
            className="mahi-ws-action-pill"
            onClick={() => onOpenInTerminal(project.path)}
            title="Open project in PowerShell Terminal"
          >
            <Terminal size={13} />
            <span>Terminal</span>
          </button>

          <button
            type="button"
            className="mahi-ws-action-pill"
            onClick={() => onOpenInExplorer(project.path)}
            title="Reveal project in Windows Explorer"
          >
            <FolderOpen size={13} />
            <span>Explorer</span>
          </button>

          {onNavigateToExplorer && (
            <button
              type="button"
              className="mahi-ws-action-pill"
              onClick={() => onNavigateToExplorer(project.path)}
              title="Browse project inside MAHI Filesystem Explorer"
            >
              <FileText size={13} />
              <span>Browse Files</span>
            </button>
          )}

          <button
            type="button"
            className="mahi-ws-action-pill"
            onClick={handleCopyPath}
            title="Copy path to clipboard"
          >
            {copiedPath ? <Check size={13} /> : <Copy size={13} />}
            <span>{copiedPath ? 'Copied' : 'Copy Path'}</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="mahi-ws-banner error">
          <AlertCircle size={15} />
          <span>{actionError}</span>
          <button type="button" className="banner-dismiss" onClick={() => setActionError(null)}>
            <X size={13} />
          </button>
        </div>
      )}

      {/* Main Command Center Header */}
      <div className="mahi-ws-header-card">
        <div className="mahi-ws-header-left">
          <div className="mahi-ws-glyph-box">
            <span className="mahi-ws-glyph">{glyph}</span>
          </div>
          <div className="mahi-ws-header-info">
            <div className="mahi-ws-title-row">
              <h1 className="mahi-ws-project-name">{project.name}</h1>
              <span className="mahi-ws-type-badge">{project.projectType}</span>
              {project.packageManager && (
                <span className="mahi-ws-pm-badge">{project.packageManager}</span>
              )}
            </div>
            <div className="mahi-ws-path-row" onClick={handleCopyPath} title="Click to copy full path">
              <span className="mahi-ws-path">{project.path}</span>
            </div>
            <div className="mahi-ws-tags-row">
              {project.technologies.map((t) => (
                <span key={t} className="mahi-ws-tech-pill">
                  {t}
                </span>
              ))}
              {project.frameworks.map((f) => (
                <span key={f} className="mahi-ws-tech-pill framework">
                  {f}
                </span>
              ))}
            </div>
            <div className="mahi-ws-runtime-badge-row">
              <span className="mahi-ws-runtime-pill" title="Workspace Profile Mode">
                <SlidersHorizontal size={11} />
                <span>
                  {workspaceProfile?.enabled
                    ? 'Managed Workspace Profile'
                    : 'Default System Environment'}
                </span>
              </span>
              <span className="mahi-ws-runtime-pill toolchain" title="Bound Toolchain Runtimes">
                <span>
                  {workspaceProfile && workspaceProfile.toolBindings.length > 0
                    ? workspaceProfile.toolBindings.map((b) => `${b.tool}${b.version ? ` v${b.version}` : ''}`).join(' · ')
                    : (project.packageManager ? `${project.packageManager} (auto-resolved)` : project.projectType)}
                </span>
              </span>
              {workspaceConfig.envOverrides.filter((e) => e.enabled).length > 0 && (
                <span className="mahi-ws-runtime-pill env" title="Custom Environment Overrides Active">
                  <span>{workspaceConfig.envOverrides.filter((e) => e.enabled).length} Overrides</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Primary Quick Dev Action Card */}
        {devScript && (
          <div className={`mahi-ws-dev-hero ${runningDevProcess ? 'is-running' : ''}`}>
            {runningDevProcess ? (
              <div className="mahi-ws-dev-running-box">
                <div className="mahi-ws-dev-status-row">
                  <div className="mahi-ws-status-indicator pulse">
                    <span className="status-dot green" />
                    <span className="status-label">RUNNING</span>
                  </div>
                  <span className="mahi-ws-uptime">
                    <Clock size={11} />
                    {formatUptime(runningDevProcess.startedAt)}
                  </span>
                </div>

                <div className="mahi-ws-dev-title">
                  {runningDevProcess.packageManager} run {runningDevProcess.scriptName}
                </div>

                {detectedUrls.length > 0 && (
                  <div className="mahi-ws-dev-url-box">
                    <Globe size={13} className="globe-icon" />
                    <span className="dev-url">{detectedUrls[0]}</span>
                    <button
                      type="button"
                      className="mahi-ws-open-url-btn"
                      onClick={() => handleOpenUrl(detectedUrls[0])}
                      title="Open in default browser"
                    >
                      <ExternalLink size={12} />
                      <span>Open</span>
                    </button>
                  </div>
                )}

                <div className="mahi-ws-dev-actions">
                  <button
                    type="button"
                    className="mahi-ws-btn danger"
                    onClick={() => handleStopProcess(runningDevProcess.id)}
                    title="Stop development server"
                  >
                    <Square size={13} fill="currentColor" />
                    <span>Stop</span>
                  </button>
                  <button
                    type="button"
                    className="mahi-ws-btn secondary"
                    onClick={() => setSelectedProcessId(runningDevProcess.id)}
                  >
                    <FileCode2 size={13} />
                    <span>View Output</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="mahi-ws-dev-idle-box">
                <div className="mahi-ws-dev-idle-meta">
                  <span className="dev-idle-label">Quick Development Action</span>
                  <span className="dev-idle-command">
                    {devScript.packageManager} run {devScript.name}
                  </span>
                </div>
                <button
                  type="button"
                  className="mahi-ws-btn primary-dev"
                  onClick={() => handleOpenExecutionPreview(devScript.name)}
                  title={`Run '${devScript.name}' script`}
                >
                  <Play size={14} fill="currentColor" />
                  <span>Run Development</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Two-Column Command Center: Git Status & Runtime */}
      <div className="mahi-ws-grid">
        {/* Column 1: Git Status */}
        <div className="mahi-ws-card git-section">
          <div className="mahi-ws-card-header">
            <div className="mahi-ws-card-title-box">
              <GitBranch size={16} className="card-header-icon" />
              <h3>Git Repository</h3>
            </div>
            <div className="mahi-ws-card-header-actions">
              {gitStatus?.branch && (
                <span className="mahi-ws-branch-pill">
                  <GitBranch size={11} />
                  <span>{gitStatus.branch}</span>
                </span>
              )}
              <button
                type="button"
                className="mahi-ws-icon-btn"
                onClick={handleRefreshGit}
                disabled={isRefreshingGit}
                title="Refresh Git status"
              >
                <RefreshCw size={13} className={isRefreshingGit ? 'mahi-spin' : ''} />
              </button>
            </div>
          </div>

          <div className="mahi-ws-card-body">
            {gitStatus?.isGitRepo ? (
              <div className="mahi-ws-git-content">
                {/* Stats Chips Row */}
                <div className="mahi-ws-git-stats-grid">
                  <div className={`mahi-ws-stat-tile ${gitStatus.isClean ? 'clean' : 'has-changes'}`}>
                    <span className="stat-value">{gitStatus.totalChangedCount}</span>
                    <span className="stat-label">Changed</span>
                  </div>
                  <div className="mahi-ws-stat-tile">
                    <span className="stat-value">{gitStatus.stagedCount}</span>
                    <span className="stat-label">Staged</span>
                  </div>
                  <div className="mahi-ws-stat-tile">
                    <span className="stat-value">{gitStatus.modifiedCount}</span>
                    <span className="stat-label">Modified</span>
                  </div>
                  <div className="mahi-ws-stat-tile">
                    <span className="stat-value">{gitStatus.untrackedCount}</span>
                    <span className="stat-label">Untracked</span>
                  </div>
                </div>

                {/* Upstream sync info */}
                {gitStatus.hasUpstream && (
                  <div className="mahi-ws-upstream-bar">
                    <span className="upstream-branch">{gitStatus.upstreamBranch || 'upstream'}</span>
                    <div className="upstream-metrics">
                      {gitStatus.ahead !== null && gitStatus.ahead > 0 && (
                        <span className="metric ahead">↑ {gitStatus.ahead} ahead</span>
                      )}
                      {gitStatus.behind !== null && gitStatus.behind > 0 && (
                        <span className="metric behind">↓ {gitStatus.behind} behind</span>
                      )}
                      {gitStatus.ahead === 0 && gitStatus.behind === 0 && (
                        <span className="metric syncd">In sync</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Changed Files List */}
                {gitStatus.changedFiles && gitStatus.changedFiles.length > 0 ? (
                  <div className="mahi-ws-git-file-list">
                    <div className="git-file-list-title">Modified Files ({gitStatus.changedFiles.length})</div>
                    <div className="git-files-scroll">
                      {gitStatus.changedFiles.slice(0, 10).map((file, idx) => (
                        <div key={idx} className="git-file-item">
                          <span className={`git-status-tag ${file.status}`}>
                            {file.status}
                          </span>
                          <span className="git-file-path" title={file.path}>
                            {file.path}
                          </span>
                          {file.isStaged && <span className="git-staged-tag">staged</span>}
                        </div>
                      ))}
                      {gitStatus.changedFiles.length > 10 && (
                        <div className="git-file-more">
                          +{gitStatus.changedFiles.length - 10} more files
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mahi-ws-git-clean-msg">
                    <Check size={16} className="clean-check-icon" />
                    <span>Working tree is completely clean</span>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                type="git-repo"
                title="Not a Git repository"
                description="This project is not currently version-controlled with Git."
                compact={true}
                actionText="Open in Terminal"
                onAction={() => onOpenInTerminal(project.path)}
              />
            )}
          </div>
        </div>

        {/* Column 2: Runtime Processes */}
        <div className="mahi-ws-card runtime-section">
          <div className="mahi-ws-card-header">
            <div className="mahi-ws-card-title-box">
              <Radio size={16} className="card-header-icon" />
              <h3>Runtime Processes</h3>
            </div>
            <span className="mahi-ws-count-pill">
              {projectProcesses.filter((p) => p.status === 'running' || p.status === 'starting').length +
                workspaceSessions.filter((s) => s.state === 'RUNNING' || s.state === 'STARTING').length}{' '}
              active
            </span>
          </div>

          <div className="mahi-ws-card-body">
            {projectProcesses.length === 0 && workspaceSessions.length === 0 ? (
              <EmptyState
                type="running-processes"
                title="No managed processes running"
                description="Launch a detected script below to monitor logs, status, and ports."
                compact={true}
                actionText={devScript ? `Run '${devScript.name}'` : undefined}
                onAction={devScript ? () => handleOpenExecutionPreview(devScript.name) : undefined}
              />
            ) : (
              <div className="mahi-ws-process-list">
                {/* Phase 9C-D3: Workspace Execution Sessions */}
                {workspaceSessions.map((session) => {
                  const isRunning = session.state === 'RUNNING' || session.state === 'STARTING';
                  const isSelected = activeWorkspaceSessionId === session.sessionId;

                  return (
                    <div
                      key={session.sessionId}
                      className={`mahi-ws-process-card ${isRunning ? 'running' : 'inactive'} ${
                        isSelected ? 'is-selected' : ''
                      }`}
                      onClick={() => {
                        setActiveWorkspaceSessionId(session.sessionId);
                        setActiveWorkspaceSession(session);
                      }}
                    >
                      <div className="process-header">
                        <div className="process-title-group">
                          <span className="process-cmd">
                            ⚡ {session.actionOrScript}
                          </span>
                          <span className={`process-status-badge ${session.state.toLowerCase()}`}>
                            {isRunning && <span className="status-dot green" />}
                            {session.state}
                            {session.exitCode !== null && ` · code ${session.exitCode}`}
                          </span>
                        </div>

                        <div className="process-actions" onClick={(e) => e.stopPropagation()}>
                          {isRunning && (
                            <button
                              type="button"
                              className="mahi-ws-btn-mini stop"
                              onClick={() => handleStopProcess(session.sessionId)}
                              title="Stop this process"
                            >
                              <Square size={11} fill="currentColor" />
                              <span>Stop</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className={`mahi-ws-btn-mini output ${isSelected ? 'active' : ''}`}
                            onClick={() => {
                              setActiveWorkspaceSessionId(session.sessionId);
                              setActiveWorkspaceSession(session);
                            }}
                            title="Open interactive session terminal"
                          >
                            <Terminal size={11} />
                            <span>Terminal</span>
                          </button>
                        </div>
                      </div>

                      <div className="process-meta-bar">
                        <span className="process-meta-item">
                          PID: {session.pid ?? '—'}
                        </span>
                        <span className="process-meta-item">
                          Lines: {session.totalStdoutLines + session.totalStderrLines}
                        </span>
                        <span className="process-meta-item">
                          <Clock size={10} />
                          {isRunning ? formatUptime(session.startedAt * 1000) : 'Finished'}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {/* Legacy Managed Processes */}
                {projectProcesses.map((proc) => {
                  const isRunning = proc.status === 'running' || proc.status === 'starting';
                  const isSelected = activeSelectedProcess?.id === proc.id && !activeWorkspaceSessionId;
                  const urls = extractLocalhostUrls(proc.outputLines);

                  return (
                    <div
                      key={proc.id}
                      className={`mahi-ws-process-card ${isRunning ? 'running' : 'inactive'} ${
                        isSelected ? 'is-selected' : ''
                      }`}
                      onClick={() => {
                        setActiveWorkspaceSessionId(null);
                        setSelectedProcessId(proc.id);
                      }}
                    >
                      <div className="process-header">
                        <div className="process-title-group">
                          <span className="process-cmd">
                            {proc.packageManager} run {proc.scriptName}
                          </span>
                          <span className={`process-status-badge ${proc.status}`}>
                            {isRunning && <span className="status-dot green" />}
                            {proc.status === 'running' && 'Running'}
                            {proc.status === 'starting' && 'Starting'}
                            {proc.status === 'exited' && `Exited · code ${proc.exitCode ?? 0}`}
                            {proc.status === 'failed' && `Failed · code ${proc.exitCode ?? 1}`}
                            {proc.status === 'stopped' && 'Stopped'}
                          </span>
                        </div>

                        <div className="process-actions" onClick={(e) => e.stopPropagation()}>
                          {isRunning && (
                            <button
                              type="button"
                              className="mahi-ws-btn-mini stop"
                              onClick={() => handleStopProcess(proc.id)}
                              title="Stop this process"
                            >
                              <Square size={11} fill="currentColor" />
                              <span>Stop</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className={`mahi-ws-btn-mini output ${isSelected ? 'active' : ''}`}
                            onClick={() => {
                              setActiveWorkspaceSessionId(null);
                              setSelectedProcessId(proc.id);
                            }}
                            title="View log buffer"
                          >
                            <FileCode2 size={11} />
                            <span>Logs</span>
                          </button>
                        </div>
                      </div>

                      {/* Uptime and PID/Time */}
                      <div className="process-meta-bar">
                        <span className="process-meta-item">
                          <Clock size={10} />
                          {isRunning ? formatUptime(proc.startedAt) : 'Finished'}
                        </span>
                        <span className="process-meta-item">
                          Lines: {proc.outputLines.length}
                        </span>
                        {urls.length > 0 && (
                          <div className="process-url-chip" onClick={() => handleOpenUrl(urls[0])}>
                            <Globe size={10} />
                            <span>{urls[0]}</span>
                            <ExternalLink size={9} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Phase 7E: Pinned Scripts Bar */}
      {workspaceConfig.pinnedScripts.length > 0 && (
        <div className="mahi-ws-pinned-scripts-section">
          <div className="mahi-ws-section-header">
            <div className="title-group">
              <Pin size={15} className="section-icon pinned-icon" />
              <h2>Pinned Scripts</h2>
            </div>
            <span className="section-subtitle">
              Quick access shortcuts for this workspace
            </span>
          </div>

          <div className="mahi-ws-pinned-scripts-grid">
            {workspaceConfig.pinnedScripts.map((scriptName) => {
              const scriptObj = project.detectedScripts?.find((s) => s.name === scriptName);
              const runningProc = runningScriptMap.get(scriptName);
              const isRunning = Boolean(runningProc);

              return (
                <div key={scriptName} className={`mahi-pinned-script-chip ${isRunning ? 'is-running' : ''}`}>
                  <div className="pinned-chip-main">
                    <Pin size={11} className="pinned-chip-glyph" />
                    <span className="pinned-chip-name">{scriptName}</span>
                    <span className="pinned-chip-pm">{scriptObj?.packageManager || project.packageManager || 'npm'}</span>
                  </div>

                  <div className="pinned-chip-actions">
                    {isRunning ? (
                      <button
                        type="button"
                        className="pinned-chip-btn stop"
                        onClick={() => runningProc && handleStopProcess(runningProc.id)}
                        title="Stop script"
                      >
                        <Square size={10} fill="currentColor" />
                        <span>Stop</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="pinned-chip-btn run"
                        onClick={() => handleOpenExecutionPreview(scriptName)}
                        title={`Run '${scriptName}'`}
                      >
                        <Play size={10} fill="currentColor" />
                        <span>Run</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="pinned-chip-btn unpin"
                      onClick={() => handleTogglePinScript(scriptName)}
                      title="Unpin script"
                    >
                      <PinOff size={11} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Available Scripts Section */}
      <div className="mahi-ws-scripts-section">
        <div className="mahi-ws-section-header">
          <div className="title-group">
            <Play size={16} className="section-icon" />
            <h2>Available Manifest Scripts</h2>
          </div>
          <span className="section-subtitle">
            Discovered from {project.packageManager || 'package'}.json · Click pin to save favorites
          </span>
        </div>

        {project.detectedScripts && project.detectedScripts.length > 0 ? (
          <div className="mahi-ws-scripts-grid">
            {project.detectedScripts.map((script) => {
              const runningProc = runningScriptMap.get(script.name);
              const isRunning = Boolean(runningProc);
              const isPinned = workspaceConfig.pinnedScripts.includes(script.name);

              return (
                <div
                  key={script.name}
                  className={`mahi-ws-script-card ${isRunning ? 'is-running' : ''}`}
                >
                  <div className="script-top">
                    <div className="script-title-row">
                      <span className="script-name">▶ {script.name}</span>
                      <div className="script-top-actions">
                        <button
                          type="button"
                          className={`mahi-pin-script-btn ${isPinned ? 'is-pinned' : ''}`}
                          onClick={() => handleTogglePinScript(script.name)}
                          title={isPinned ? 'Unpin script' : 'Pin script'}
                        >
                          <Pin size={12} fill={isPinned ? 'currentColor' : 'none'} />
                        </button>
                        <span className="script-pm-tag">{script.packageManager}</span>
                      </div>
                    </div>
                    {script.command && (
                      <div className="script-cmd" title={script.command}>
                        {script.command}
                      </div>
                    )}
                  </div>

                  <div className="script-bottom">
                    {isRunning ? (
                      <div className="script-running-status">
                        <span className="running-dot" />
                        <span className="running-txt">Running</span>
                        <button
                          type="button"
                          className="mahi-ws-script-stop-btn"
                          onClick={() => runningProc && handleStopProcess(runningProc.id)}
                          title="Stop this running script"
                        >
                          <Square size={11} fill="currentColor" />
                          <span>Stop</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="mahi-ws-script-run-btn"
                        onClick={() => handleOpenExecutionPreview(script.name)}
                        title={`Execute '${script.packageManager} run ${script.name}'`}
                      >
                        <Play size={12} fill="currentColor" />
                        <span>Run</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            type="project-scripts"
            title="No scripts discovered"
            description="No runnable scripts found in package.json or project manifests."
            compact={true}
            actionText="Open in VS Code"
            onAction={() => onOpenInVsCode(project.path)}
          />
        )}
      </div>

      {/* Phase 7E: Custom Environment Overrides Section */}
      <div className="mahi-ws-env-section">
        <div className="mahi-ws-section-header">
          <div className="title-group">
            <SlidersHorizontal size={16} className="section-icon env-icon" />
            <h2>Custom Environment Overrides</h2>
            <span className="env-count-pill">
              {workspaceConfig.envOverrides.filter((e) => e.enabled).length} active
            </span>
          </div>
          <button
            type="button"
            className="mahi-toggle-env-btn"
            onClick={() => setShowEnvSection(!showEnvSection)}
          >
            {showEnvSection ? 'Hide Overrides' : 'Manage Overrides'}
          </button>
        </div>

        <p className="mahi-env-notice">
          Scoped strictly to scripts launched by MAHI for this project. System environment is preserved. 
          MAHI <strong>never</strong> reads or imports <code>.env</code> files automatically.
        </p>

        {showEnvSection && (
          <div className="mahi-env-card">
            {/* Add New Variable Form */}
            <div className="mahi-env-add-form">
              <input
                type="text"
                placeholder="VARIABLE_NAME (e.g. PORT)"
                value={newEnvKey}
                onChange={(e) => setNewEnvKey(e.target.value.toUpperCase())}
                className="mahi-env-input key"
              />
              <input
                type={newEnvIsSecret ? 'password' : 'text'}
                placeholder="Value (e.g. 3000)"
                value={newEnvValue}
                onChange={(e) => setNewEnvValue(e.target.value)}
                className="mahi-env-input val"
              />
              <label className="mahi-env-secret-label" title="Mask value in UI">
                <input
                  type="checkbox"
                  checked={newEnvIsSecret}
                  onChange={(e) => setNewEnvIsSecret(e.target.checked)}
                />
                <Key size={12} />
                <span>Secret</span>
              </label>
              <button
                type="button"
                className="mahi-env-add-btn"
                onClick={handleAddEnvVar}
                disabled={!newEnvKey.trim()}
              >
                <Plus size={13} />
                <span>Add Override</span>
              </button>
            </div>

            {/* List of Defined Variables */}
            {workspaceConfig.envOverrides.length > 0 ? (
              <div className="mahi-env-list">
                {workspaceConfig.envOverrides.map((envVar) => {
                  const isEditing = editingEnvKey === envVar.key;
                  const isRevealed = Boolean(revealedSecrets[envVar.key]);

                  return (
                    <div key={envVar.key} className={`mahi-env-item ${envVar.enabled ? 'is-enabled' : 'is-disabled'}`}>
                      <div className="mahi-env-item-left">
                        <label className="mahi-env-toggle-switch" title={envVar.enabled ? 'Enabled' : 'Disabled'}>
                          <input
                            type="checkbox"
                            checked={envVar.enabled}
                            onChange={() => handleToggleEnvEnabled(envVar.key)}
                          />
                          <span className="slider" />
                        </label>
                        <span className="env-var-key">{envVar.key}</span>
                        <span className="env-var-eq">=</span>

                        {isEditing ? (
                          <div className="env-edit-inline">
                            <input
                              type={editEnvIsSecret && !isRevealed ? 'password' : 'text'}
                              value={editEnvValue}
                              onChange={(e) => setEditEnvValue(e.target.value)}
                              className="mahi-env-input edit"
                            />
                            <button type="button" className="env-save-edit-btn" onClick={handleSaveEditEnv}>
                              Save
                            </button>
                            <button type="button" className="env-cancel-edit-btn" onClick={() => setEditingEnvKey(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="env-var-val-box">
                            <span className="env-var-val">
                              {envVar.isSecret && !isRevealed ? '••••••••' : envVar.value || '""'}
                            </span>
                            {envVar.isSecret && (
                              <button
                                type="button"
                                className="env-eye-btn"
                                onClick={() => toggleRevealSecret(envVar.key)}
                                title={isRevealed ? 'Mask secret' : 'Reveal secret'}
                              >
                                {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {!isEditing && (
                        <div className="mahi-env-item-actions">
                          <button
                            type="button"
                            className="env-action-btn edit"
                            onClick={() => handleStartEditEnv(envVar)}
                            title="Edit value"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="env-action-btn delete"
                            onClick={() => handleDeleteEnvVar(envVar.key)}
                            title="Delete override"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mahi-env-empty">
                <span>No custom environment overrides configured for this project.</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Phase 9C-D3: Workspace Process Interactive Terminal View */}
      {activeWorkspaceSessionId && (
        <div className="mahi-ws-terminal-container">
          <WorkspaceProcessView
            sessionId={activeWorkspaceSessionId}
            initialStatus={activeWorkspaceSession || undefined}
            onClose={() => {
              setActiveWorkspaceSessionId(null);
              setActiveWorkspaceSession(null);
            }}
          />
        </div>
      )}

      {/* Legacy Process Output Terminal Panel (when no active workspace session is selected) */}
      {!activeWorkspaceSessionId && activeSelectedProcess && (
        <div className="mahi-ws-terminal-panel">
          <div className="mahi-ws-terminal-header">
            <div className="terminal-title-group">
              <Terminal size={15} className="term-icon" />
              <span className="term-title">
                {activeSelectedProcess.packageManager} run {activeSelectedProcess.scriptName}
              </span>
              <span className={`term-status-badge ${activeSelectedProcess.status}`}>
                {activeSelectedProcess.status}
              </span>
              <span className="term-buffer-count">
                {activeSelectedProcess.outputLines.length} / 300 lines
              </span>
            </div>

            <div className="terminal-actions">
              {detectedUrls.length > 0 && (
                <button
                  type="button"
                  className="mahi-ws-term-btn url-btn"
                  onClick={() => handleOpenUrl(detectedUrls[0])}
                  title="Open detected URL in default browser"
                >
                  <Globe size={12} />
                  <span>{detectedUrls[0]}</span>
                  <ExternalLink size={11} />
                </button>
              )}

              <button
                type="button"
                className="mahi-ws-term-btn"
                onClick={() => handleCopyLogs(activeSelectedProcess.id, activeSelectedProcess.outputLines)}
                title="Copy output buffer to clipboard"
              >
                {copiedLogId === activeSelectedProcess.id ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedLogId === activeSelectedProcess.id ? 'Copied' : 'Copy Output'}</span>
              </button>

              {(activeSelectedProcess.status === 'running' ||
                activeSelectedProcess.status === 'starting') && (
                <button
                  type="button"
                  className="mahi-ws-term-btn danger"
                  onClick={() => handleStopProcess(activeSelectedProcess.id)}
                  title="Stop this process"
                >
                  <Square size={12} fill="currentColor" />
                  <span>Stop</span>
                </button>
              )}
            </div>
          </div>

          <div className="mahi-ws-terminal-body" tabIndex={0}>
            {activeSelectedProcess.outputLines.length === 0 ? (
              <div className="term-empty-line">
                [process starting] awaiting stdout/stderr output from {activeSelectedProcess.scriptName}...
              </div>
            ) : (
              activeSelectedProcess.outputLines.map((line, idx) => (
                <div key={idx} className="term-line">
                  <span className="term-line-no">{idx + 1}</span>
                  <span className="term-line-content">{line}</span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {/* Phase 9C-D3: Execution Preview & Confirmation Modal */}
      {previewAction && project && (
        <ExecutionPreviewModal
          isOpen={Boolean(previewAction)}
          projectPath={project.path}
          projectName={project.name}
          actionOrScript={previewAction}
          onClose={() => setPreviewAction(null)}
          onLaunched={handleExecutionLaunched}
        />
      )}
    </div>
  );
};
