import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { 
  Home, 
  FolderGit2, 
  Monitor, 
  Download, 
  FileText, 
  Image, 
  HardDrive,
  Settings,
  Bell,
  HelpCircle,
  FolderOpen,
  Info,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  X,
  Terminal,
  Radio,
  Activity,
  BrainCircuit,
  RefreshCw
} from 'lucide-react';
import { TitleBar } from './components/TitleBar/TitleBar';
import { SearchBar } from './components/SearchBar/SearchBar';
import { Sidebar, SidebarSectionData } from './components/Sidebar/Sidebar';
import { HomeDashboard } from './components/HomeDashboard/HomeDashboard';
import { OnboardingView } from './components/Onboarding/OnboardingView';
import { CommandCenter } from './components/CommandCenter/CommandCenter';
import { SearchResults } from './components/SearchResults/SearchResults';
import { DriveView } from './components/DriveView/DriveView';
import { DirectoryBrowser } from './components/DirectoryBrowser/DirectoryBrowser';
import { TabBar } from './components/TabBar/TabBar';
import { IconButton } from './components/IconButton/IconButton';
import { ContextMenu } from './components/ContextMenu/ContextMenu';
import { ProjectDetailsModal } from './components/ProjectDetailsModal/ProjectDetailsModal';
import { SettingsModal } from './components/SettingsModal/SettingsModal';

// Lazy-loaded secondary view components for code-splitting
const ProjectWorkspacePanel = lazy(() =>
  import('./components/ProjectWorkspacePanel/ProjectWorkspacePanel').then((m) => ({ default: m.ProjectWorkspacePanel }))
);
const StorageIntelligenceView = lazy(() =>
  import('./components/StorageIntelligenceView/StorageIntelligenceView').then((m) => ({ default: m.StorageIntelligenceView }))
);
const DeveloperHealthView = lazy(() =>
  import('./components/DeveloperHealthView/DeveloperHealthView').then((m) => ({ default: m.DeveloperHealthView }))
);
const WorkstationIntelligenceView = lazy(() =>
  import('./components/WorkstationIntelligenceView/WorkstationIntelligenceView').then((m) => ({ default: m.WorkstationIntelligenceView }))
);

import { SafeActionNavigationIntent } from './utils/safeActionResolver';
import { 
  ProjectInfo, 
  RecentProjectEntry, 
  ProjectDetails, 
  PinnedProjectEntry,
  ProjectProcessInfo,
  DebugStorageInfo
} from './types/project';
import { StorageIntelligenceOverview } from './types/storage';
import { DriveInfo, DirectoryResult, UserLocations } from './types/filesystem';
import { useTabs } from './hooks/useTabs';
import { 
  discoverProjects, 
  getRecentProjects, 
  saveRecentProject, 
  openPath, 
  openInVsCode, 
  openInTerminal, 
  openInExplorer, 
  copyPathToClipboard,
  toggleAppVisibility,
  onFocusSearchShortcut,
  getDrives,
  readDirectory,
  getUserLocations,
  getProjectDetails,
  runProjectScript,
  getPinnedProjects,
  togglePinProject,
  getRunningProcesses,
  stopProjectProcess,
  getDebugStorageInfo,
  getStorageOverview,
  scanDriveStorageReport,
  normalizePath,
  isTauri,
  getScanRoots,
  setScanRoots,
  pickScanRoot,
  OnboardingState,
  getOnboardingState,
  setOnboardingState,
  getWorkstationIntelligenceSummary,
  listWorkspaceProcesses,
  stopWorkspaceProcess
} from './services/tauriApi';
import { WorkstationIntelligenceSummary } from './types/intelligence';
import './App.css';

function App() {
  const [activeNav, setActiveNav] = useState('home');
  const [workspaceProjectPath, setWorkspaceProjectPath] = useState<string | null>(null);
  const [developerHealthIntent, setDeveloperHealthIntent] = useState<Partial<Pick<SafeActionNavigationIntent, 'tab' | 'projectPath' | 'targetId'>>>({});
  const [previousNav, setPreviousNav] = useState('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([]);
  const [pinnedProjects, setPinnedProjects] = useState<PinnedProjectEntry[]>([]);
  const [configuredRoots, setConfiguredRoots] = useState<string[]>([]);
  const [onboardingState, setOnboardingStateData] = useState<OnboardingState>({
    completed: false,
    dismissed: false,
    completedAt: null,
  });
  const [runningProcesses, setRunningProcesses] = useState<ProjectProcessInfo[]>([]);
  const [debugStorage, setDebugStorage] = useState<DebugStorageInfo | null>(null);
  const [workstationSummary, setWorkstationSummary] = useState<WorkstationIntelligenceSummary | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'locations' | 'maintenance' | 'help'>('locations');
  const [loading, setLoading] = useState(false);
  const [latencyMs, setLatencyMs] = useState(12);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Phase 8A: Storage Intelligence state
  const [storageOverview, setStorageOverview] = useState<StorageIntelligenceOverview | null>(null);
  const [activeStorageDrive, setActiveStorageDrive] = useState<string>('C');
  const [storageLoading, setStorageLoading] = useState(false);

  // Phase 3A: Filesystem state (for DriveView / This PC)
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [drivesLoading, setDrivesLoading] = useState(false);
  const [userLocations, setUserLocations] = useState<UserLocations | null>(null);

  // Phase 5: Per-tab directory data cache
  // Maps tabId -> { data, loading, error }
  const [tabDirCache, setTabDirCache] = useState<Record<string, {
    data: DirectoryResult | null;
    loading: boolean;
    error: string | null;
  }>>({});

  const searchInputRef = useRef<HTMLInputElement>(null);

  // ===== PHASE 5: TAB MANAGEMENT =====
  const {
    tabs,
    activeTabId,
    activeTab,
    newTab,
    closeTab,
    switchTab,
    switchTabByOffset,
    updateTab,
    navigateTab,
    goBackTab,
    goForwardTab,
  } = useTabs();

  // Current tab's directory cache entry
  const activeTabCache = tabDirCache[activeTabId] ?? { data: null, loading: false, error: null };

  // Load drives
  const loadDrives = useCallback(async () => {
    setDrivesLoading(true);
    try {
      const data = await getDrives();
      setDrives(data);
    } catch (err) {
      console.error('Failed to load drives:', err);
    } finally {
      setDrivesLoading(false);
    }
  }, []);

  // Load a directory for a specific tab
  const loadDirectoryForTab = useCallback(async (tabId: string, path: string) => {
    setTabDirCache((prev) => ({
      ...prev,
      [tabId]: { data: prev[tabId]?.data ?? null, loading: true, error: null },
    }));
    try {
      const result = await readDirectory(path);
      setTabDirCache((prev) => ({
        ...prev,
        [tabId]: { data: result, loading: false, error: null },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTabDirCache((prev) => ({
        ...prev,
        [tabId]: { data: null, loading: false, error: msg },
      }));
    }
  }, []);

  // Navigate the active tab to a path
  const handleTabNavigate = useCallback((targetPath: string) => {
    setSearchQuery('');
    if (targetPath === 'this-pc') {
      setActiveNav('this-pc');
      loadDrives();
      navigateTab(activeTabId, 'this-pc');
    } else {
      setActiveNav('explorer');
      navigateTab(activeTabId, targetPath);
      loadDirectoryForTab(activeTabId, targetPath);
    }
  }, [activeTabId, navigateTab, loadDrives, loadDirectoryForTab]);

  // Back
  const handleGoBack = useCallback(() => {
    if (activeTab.historyIndex <= 0) return;
    const nextIdx = activeTab.historyIndex - 1;
    const targetPath = activeTab.history[nextIdx];
    goBackTab(activeTabId);
    if (targetPath === 'this-pc') {
      setActiveNav('this-pc');
      loadDrives();
    } else {
      setActiveNav('explorer');
      loadDirectoryForTab(activeTabId, targetPath);
    }
  }, [activeTab, activeTabId, goBackTab, loadDrives, loadDirectoryForTab]);

  // Forward
  const handleGoForward = useCallback(() => {
    if (activeTab.historyIndex >= activeTab.history.length - 1) return;
    const nextIdx = activeTab.historyIndex + 1;
    const targetPath = activeTab.history[nextIdx];
    goForwardTab(activeTabId);
    if (targetPath === 'this-pc') {
      setActiveNav('this-pc');
      loadDrives();
    } else {
      setActiveNav('explorer');
      loadDirectoryForTab(activeTabId, targetPath);
    }
  }, [activeTab, activeTabId, goForwardTab, loadDrives, loadDirectoryForTab]);

  // Up
  const handleGoUp = useCallback(() => {
    if (activeNav !== 'explorer') return;
    const dirData = activeTabCache.data;
    if (dirData?.parentPath) {
      handleTabNavigate(dirData.parentPath);
    } else {
      handleTabNavigate('this-pc');
    }
  }, [activeNav, activeTabCache.data, handleTabNavigate]);

  // Refresh
  const handleRefresh = useCallback(() => {
    if (activeNav === 'this-pc') {
      loadDrives();
    } else if (activeNav === 'explorer' && activeTab.currentPath && activeTab.currentPath !== 'this-pc') {
      loadDirectoryForTab(activeTabId, activeTab.currentPath);
    }
  }, [activeNav, activeTab, activeTabId, loadDrives, loadDirectoryForTab]);

  // New tab action
  const handleNewTab = useCallback((path?: string) => {
    const targetPath = path ?? 'this-pc';
    const newTabId = newTab(targetPath);
    if (targetPath === 'this-pc') {
      setActiveNav('this-pc');
      loadDrives();
    } else {
      setActiveNav('explorer');
      loadDirectoryForTab(newTabId, targetPath);
    }
  }, [newTab, loadDrives, loadDirectoryForTab]);

  // Close tab
  const handleCloseTab = useCallback((id: string) => {
    closeTab(id);
    // Clean up cache entry
    setTabDirCache((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [closeTab]);

  // Switch tab — restore the tab's nav state
  const handleSwitchTab = useCallback((id: string) => {
    switchTab(id);
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.currentPath === 'this-pc') {
      setActiveNav('this-pc');
      loadDrives();
    } else if (tab.currentPath) {
      setActiveNav('explorer');
      // Load if we don't have cached data
      if (!tabDirCache[id]?.data) {
        loadDirectoryForTab(id, tab.currentPath);
      }
    } else {
      setActiveNav('this-pc');
    }
  }, [switchTab, tabs, tabDirCache, loadDrives, loadDirectoryForTab]);

  // Fetch running processes (combining legacy and workspace execution sessions)
  const fetchProcesses = useCallback(async () => {
    try {
      const [procs, wsSessions] = await Promise.all([
        getRunningProcesses().catch(() => [] as ProjectProcessInfo[]),
        listWorkspaceProcesses().catch(() => [] as any[]),
      ]);

      const mappedWsProcs: ProjectProcessInfo[] = (wsSessions || [])
        .filter((s: any) => s.state === 'RUNNING' || s.state === 'STARTING' || s.state === 'STOPPING')
        .map((s: any) => {
          const folderName = s.projectPath.split(/[\\/]/).filter(Boolean).pop() || s.projectPath;
          const statusMap: Record<string, ProjectProcessInfo['status']> = {
            STARTING: 'starting',
            RUNNING: 'running',
            STOPPING: 'running',
            EXITED: 'exited',
            FAILED: 'failed',
            STOPPED: 'stopped',
          };
          return {
            id: s.sessionId,
            projectName: folderName,
            projectPath: s.projectPath,
            scriptName: s.actionOrScript,
            packageManager: s.executable || 'workspace',
            status: statusMap[s.state] || 'running',
            startedAt: (s.startedAt || 0) * 1000,
            outputLines: [],
            exitCode: s.exitCode,
          };
        });

      const combined = [...procs];
      for (const wp of mappedWsProcs) {
        if (!combined.some((p) => p.id === wp.id || (p.projectPath === wp.projectPath && p.scriptName === wp.scriptName && (p.status === 'running' || p.status === 'starting')))) {
          combined.push(wp);
        }
      }

      setRunningProcesses(combined);
    } catch (err) {
      console.error('Failed to get running processes:', err);
    }
  }, []);

  // Stop running process (handles both legacy and workspace execution sessions)
  const handleStopProcess = useCallback(async (processId: string) => {
    try {
      let procName = processId;
      if (processId.startsWith('session-') || processId.startsWith('ws-')) {
        const stopped = await stopWorkspaceProcess(processId);
        procName = stopped.actionOrScript;
        setRunningProcesses((prev) => prev.filter((p) => p.id !== processId));
      } else {
        const proc = await stopProjectProcess(processId);
        procName = proc.scriptName;
        setRunningProcesses((prev) => prev.map((p) => (p.id === proc.id ? proc : p)));
      }
      setToast({
        type: 'success',
        message: `Process '${procName}' stopped.`,
      });
    } catch (err: any) {
      try {
        const stopped = await stopWorkspaceProcess(processId);
        setRunningProcesses((prev) => prev.filter((p) => p.id !== processId));
        setToast({
          type: 'success',
          message: `Process '${stopped.actionOrScript}' stopped.`,
        });
      } catch {
        console.error('Failed to stop process:', err);
        setToast({
          type: 'error',
          message: err?.message || 'Failed to stop process.',
        });
      }
    }
  }, []);

  // Load projects and locations on startup
  const loadStorage = useCallback(async (force = false) => {
    setStorageLoading(true);
    try {
      const overview = await getStorageOverview(force);
      setStorageOverview(overview);
    } catch (err) {
      console.error('Failed to load storage intelligence overview:', err);
    } finally {
      setStorageLoading(false);
    }
  }, []);

  const handleRefreshStorageDrive = useCallback(async (driveLetter: string) => {
    setStorageLoading(true);
    try {
      const rep = await scanDriveStorageReport(driveLetter, true);
      setStorageOverview((prev) => {
        if (!prev) {
          return {
            availableDrives: [driveLetter],
            reports: { [driveLetter]: rep },
            scannedAt: Date.now()
          };
        }
        return {
          ...prev,
          reports: {
            ...prev.reports,
            [driveLetter]: rep
          },
          scannedAt: Date.now()
        };
      });
      setToast({
        type: 'info',
        message: `Storage intelligence updated for drive ${driveLetter}:.`,
      });
    } catch (err: any) {
      console.error('Failed to rescan drive storage:', err);
      setToast({
        type: 'error',
        message: err?.message || `Failed to scan drive ${driveLetter}:`,
      });
    } finally {
      setStorageLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    const start = performance.now();
    try {
      const [discovered, recent, pinned, drivesData, locations, procs, storageInfo, roots, onboarding, wiSummary] = await Promise.all([
        discoverProjects(),
        getRecentProjects(),
        getPinnedProjects(),
        getDrives(),
        getUserLocations(),
        getRunningProcesses().catch(() => [] as ProjectProcessInfo[]),
        getDebugStorageInfo().catch(() => null),
        getScanRoots().catch(() => [] as string[]),
        getOnboardingState().catch(() => ({ completed: false, dismissed: false, completedAt: null })),
        getWorkstationIntelligenceSummary().catch(() => null),
      ]);
      const duration = Math.round(performance.now() - start);
      setLatencyMs(Math.max(duration, 1));
      setProjects(discovered);
      setRecentProjects(recent);
      setPinnedProjects(pinned);
      setDrives(drivesData);
      setUserLocations(locations);
      setRunningProcesses(procs);
      setDebugStorage(storageInfo);
      setConfiguredRoots(roots);
      setOnboardingStateData(onboarding);
      setWorkstationSummary(wiSummary);
      // Fetch storage intelligence in background
      loadStorage(false);
    } catch (err) {
      console.error('Failed to load initial data:', err);
    } finally {
      setLoading(false);
    }
  }, [loadStorage]);

  const handleAddProjectFolder = async () => {
    try {
      const picked = await pickScanRoot();
      if (!picked) return;
      const clean = picked.trim();
      if (!clean) return;
      const current = await getScanRoots();
      const norm = normalizePath(clean);
      if (current.some((r) => normalizePath(r) === norm)) {
        setToast({
          type: 'warning',
          message: `Folder is already configured: ${clean}`,
        });
        return;
      }
      const updated = [...current, clean];
      const saved = await setScanRoots(updated);
      setConfiguredRoots(saved);
      setToast({
        type: 'success',
        message: `Project folder added: ${clean}`,
      });
      // Discover and update projects
      const refreshedProjects = await discoverProjects();
      setProjects(refreshedProjects);
      if (refreshedProjects.length > 0) {
        const completedOnboarding = { completed: true, dismissed: true, completedAt: Date.now() };
        await setOnboardingState(completedOnboarding);
        setOnboardingStateData(completedOnboarding);
      }
      await loadData();
    } catch (err: any) {
      console.error('Failed to add project folder:', err);
      setToast({
        type: 'error',
        message: err?.message || 'Failed to add project folder.',
      });
    }
  };

  const handleSkipOnboarding = async () => {
    const skipped = { completed: false, dismissed: true, completedAt: Date.now() };
    try {
      await setOnboardingState(skipped);
      setOnboardingStateData(skipped);
    } catch (err) {
      console.error('Failed to save onboarding skip state:', err);
    }
  };

  const handleResetOnboarding = async () => {
    try {
      const resetState = { completed: false, dismissed: false, completedAt: null };
      await setOnboardingState(resetState);
      setOnboardingStateData(resetState);
      setIsSettingsOpen(false);
      setActiveNav('home');
      setToast({
        type: 'info',
        message: 'Onboarding walkthrough reset.',
      });
    } catch (err) {
      console.error('Failed to reset onboarding state:', err);
      setToast({
        type: 'error',
        message: 'Failed to reset onboarding walkthrough.',
      });
    }
  };

  const handleRemoveProjectFolder = async (pathToRemove: string) => {
    try {
      const norm = normalizePath(pathToRemove);
      const updated = configuredRoots.filter((r) => normalizePath(r) !== norm);
      const saved = await setScanRoots(updated);
      setConfiguredRoots(saved);
      setToast({
        type: 'success',
        message: `Removed scan folder: ${pathToRemove}`,
      });
      await loadData();
    } catch (err: any) {
      console.error('Failed to remove scan folder:', err);
      setToast({
        type: 'error',
        message: err?.message || 'Failed to remove scan folder.',
      });
    }
  };

  useEffect(() => {
    loadData();

    let unlisten: (() => void) | undefined;
    onFocusSearchShortcut(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
        searchInputRef.current.select();
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
    };
  }, [loadData]);

  // Synchronize running processes whenever active processes exist
  useEffect(() => {
    const hasActive = runningProcesses.some(
      (p) => p.status === 'running' || p.status === 'starting'
    );
    if (!hasActive) return;

    const timer = setInterval(() => {
      fetchProcesses();
    }, 1500);

    return () => clearInterval(timer);
  }, [runningProcesses, fetchProcesses]);

  // Autofocus search on initial mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Pinned paths set for fast lookup
  const pinnedPaths = useMemo(() => {
    return new Set(pinnedProjects.map((p) => normalizePath(p.path)));
  }, [pinnedProjects]);

  // Filtered projects based on real search query
  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    return projects
      .filter((p) => {
        if (p.name.toLowerCase().includes(q)) return true;
        if (p.path.toLowerCase().includes(q)) return true;
        if (p.projectType.toLowerCase().includes(q)) return true;
        if (p.technologies.some((t) => t.toLowerCase().includes(q))) return true;
        if (p.detectedIndicators.some((i) => i.toLowerCase().includes(q))) return true;
        return false;
      })
      .map((p) => ({
        ...p,
        isPinned: pinnedPaths.has(normalizePath(p.path))
      }));
  }, [searchQuery, projects, pinnedPaths]);

  // Reset selected index when search results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredProjects.length, searchQuery]);

  // Floating notification toast state (Phase 17)
  const [toast, setToast] = useState<{ type: 'success' | 'warning' | 'error' | 'info'; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const duration = toast.type === 'error' ? 7000 : toast.type === 'warning' ? 5000 : 3500;
    const timer = setTimeout(() => setToast(null), duration);
    return () => clearTimeout(timer);
  }, [toast]);

  // Unified Developer Project Context Menu state
  const [projectContextMenu, setProjectContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
    name: string;
    path: string;
    scripts?: string[];
  }>({
    isOpen: false,
    x: 0,
    y: 0,
    name: '',
    path: '',
    scripts: [],
  });

  // Phase 7A: Project Details Modal
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [detailsModalProject, setDetailsModalProject] = useState<ProjectDetails | null>(null);
  const [detailsModalLoading, setDetailsModalLoading] = useState(false);

  // Phase 7E: Pin / Unpin Project handler
  const handleTogglePin = useCallback(async (path: string, name: string) => {
    try {
      const updatedPinned = await togglePinProject(path, name);
      setPinnedProjects(updatedPinned);
      const targetNorm = normalizePath(path);
      const isNowPinned = updatedPinned.some((p) => normalizePath(p.path) === targetNorm);
      setToast({
        type: 'success',
        message: `${name} ${isNowPinned ? 'pinned to workspace' : 'unpinned from workspace'}.`,
      });
      // Keep details modal synchronized if open
      setDetailsModalProject((prev) => 
        prev && normalizePath(prev.path) === targetNorm
          ? { ...prev, isPinned: isNowPinned }
          : prev
      );
    } catch (err: any) {
      console.error('Failed to toggle pin:', err);
      setToast({
        type: 'error',
        message: err?.message || 'Failed to toggle pin project.',
      });
    }
  }, []);

  const handleShowProjectDetails = async (path: string) => {
    setIsDetailsModalOpen(true);
    setDetailsModalLoading(true);
    try {
      const details = await getProjectDetails(path);
      const isPinned = pinnedPaths.has(normalizePath(path));
      setDetailsModalProject({
        ...details,
        isPinned
      });
    } catch (err) {
      console.error('Failed to load project details:', err);
      setToast({
        type: 'error',
        message: 'Failed to inspect project details.',
      });
    } finally {
      setDetailsModalLoading(false);
    }
  };

  const handleOpenWorkspace = (path: string) => {
    setPreviousNav(activeNav === 'workspace' ? 'home' : activeNav);
    setWorkspaceProjectPath(path);
    setActiveNav('workspace');
    if (isDetailsModalOpen) {
      setIsDetailsModalOpen(false);
    }
  };

  const handleProjectContextMenu = (name: string, path: string, e: React.MouseEvent, scripts?: string[]) => {
    e.preventDefault();
    e.stopPropagation();
    setProjectContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      name,
      path,
      scripts: scripts || [],
    });
  };

  const handleRunScriptFromContextMenu = async (path: string, scriptName: string) => {
    await handleShowProjectDetails(path);
    try {
      await runProjectScript(path, scriptName);
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : e?.message || 'Failed to run script';
      setToast({
        type: 'error',
        message: msg,
      });
    }
  };

  const handleRunDevScript = async (path: string) => {
    await handleShowProjectDetails(path);
    try {
      await runProjectScript(path, 'dev');
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : e?.message || 'Failed to run dev';
      setToast({
        type: 'error',
        message: msg,
      });
    }
  };

  // Copy Path (copies real Windows path to text clipboard)
  const handleCopyPath = async (path: string) => {
    try {
      await copyPathToClipboard(path);
      setToast({
        type: 'success',
        message: `Copied path to clipboard: ${path.replace(/\//g, '\\')}`,
      });
    } catch {
      setToast({
        type: 'error',
        message: 'Failed to copy path to clipboard.',
      });
    }
  };

  // Project action handlers
  const handleOpenProject = async (path: string, name: string) => {
    try {
      await saveRecentProject(path, name);
      if (!isTauri()) {
        handleOpenWorkspace(path);
        setToast({
          type: 'info',
          message: `Opened ${name} workspace. (Desktop runtime required for native editor launch)`,
        });
        const recent = await getRecentProjects();
        setRecentProjects(recent);
        return;
      }
      await openInVsCode(path);
      setToast({
        type: 'success',
        message: `Opened ${name} in Visual Studio Code.`,
      });
    } catch {
      if (isTauri()) {
        await openPath(path);
      }
    }
    const recent = await getRecentProjects();
    setRecentProjects(recent);
  };

  const handleOpenInVsCode = async (path: string, name?: string) => {
    try {
      if (name) await saveRecentProject(path, name);
      await openInVsCode(path);
      setToast({
        type: 'success',
        message: `Opened ${name || 'project'} in Visual Studio Code.`,
      });
      const recent = await getRecentProjects();
      setRecentProjects(recent);
    } catch (e: any) {
      if (!isTauri()) {
        setToast({
          type: 'info',
          message: 'VS Code launch requires MAHI desktop app (not available in browser mode).',
        });
        return;
      }
      const errorStr = typeof e === 'string' ? e : e?.message || '';
      if (errorStr.toLowerCase().includes('not found') || errorStr.toLowerCase().includes('not installed')) {
        setToast({
          type: 'warning',
          message: 'Visual Studio Code is not installed or not in PATH.',
        });
      } else {
        setToast({
          type: 'error',
          message: `Failed to open in VS Code: ${errorStr || 'Unknown error'}. Opening in Explorer...`,
        });
      }
      await openInExplorer(path);
    }
  };

  const handleOpenInTerminal = async (path: string) => {
    try {
      await openInTerminal(path);
      setToast({
        type: 'success',
        message: 'Opened PowerShell terminal at project directory.',
      });
    } catch (e: any) {
      if (!isTauri()) {
        setToast({
          type: 'info',
          message: 'Terminal launch requires MAHI desktop app (not available in browser mode).',
        });
        return;
      }
      const errorStr = typeof e === 'string' ? e : e?.message || '';
      setToast({
        type: 'error',
        message: `Failed to open terminal: ${errorStr || 'Directory may be inaccessible'}`,
      });
    }
  };

  const handleOpenInExplorer = async (path: string) => {
    try {
      await openInExplorer(path);
      setToast({
        type: 'success',
        message: 'Revealed folder in Windows Explorer.',
      });
    } catch (e: any) {
      if (!isTauri()) {
        setToast({
          type: 'info',
          message: 'Windows Explorer launch requires MAHI desktop app (not available in browser mode).',
        });
        return;
      }
      const errorStr = typeof e === 'string' ? e : e?.message || '';
      setToast({
        type: 'error',
        message: `Failed to open Explorer: ${errorStr || 'Path may not exist'}`,
      });
    }
  };

  // Keyboard: Escape, Arrow Up/Down, Enter, Ctrl+T, Ctrl+W, Ctrl+Tab, Ctrl+Shift+Tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Tab management shortcuts (only when in explorer/this-pc view and not typing)
      const isTyping = (e.target as HTMLElement)?.tagName === 'INPUT' || 
                       (e.target as HTMLElement)?.tagName === 'TEXTAREA';

      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 't' && !isTyping) {
        e.preventDefault();
        handleNewTab();
        return;
      }

      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === 'w' && !isTyping) {
        e.preventDefault();
        handleCloseTab(activeTabId);
        return;
      }

      if (e.ctrlKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault();
        switchTabByOffset(e.shiftKey ? -1 : 1);
        return;
      }

      // Quick Workspace Developer Shortcuts (when not typing in an input)
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p' && !isTyping) {
        e.preventDefault();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
          searchInputRef.current.select();
        }
        return;
      }

      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'o' && !isTyping) {
        e.preventDefault();
        const target = filteredProjects[0] || projects[0];
        if (target) {
          handleOpenInExplorer(target.path);
        }
        return;
      }

      if (e.ctrlKey && !e.altKey && e.key === '`' && !isTyping) {
        e.preventDefault();
        const target = filteredProjects[0] || projects[0];
        if (target) {
          handleOpenInTerminal(target.path);
        }
        return;
      }

      if (e.key === 'Escape') {
        if (searchQuery !== '') {
          e.preventDefault();
          setSearchQuery('');
          setSelectedIndex(0);
        } else {
          e.preventDefault();
          toggleAppVisibility().catch(() => {});
        }
        return;
      }

      if (searchQuery.trim().length > 0 && filteredProjects.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filteredProjects.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filteredProjects.length) % filteredProjects.length);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const target = filteredProjects[selectedIndex];
          if (target) {
            handleOpenInVsCode(target.path, target.name);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, filteredProjects, selectedIndex, activeNav, activeTabId, handleNewTab, handleCloseTab, switchTabByOffset]);

  // Sidebar navigation handler
  const handleSidebarSelect = (id: string) => {
    setSearchQuery('');
    if (id === 'home' || id === 'projects' || id === 'command-center' || id === 'storage-intelligence' || id === 'workstation-intelligence') {
      setActiveNav(id);
    } else if (id === 'developer-health') {
      setDeveloperHealthIntent({});
      setActiveNav(id);
    } else if (id === 'workspace') {
      if (workspaceProjectPath) {
        setActiveNav('workspace');
      } else {
        setActiveNav('command-center');
      }
    } else if (id === 'this-pc') {
      handleTabNavigate('this-pc');
    } else if (userLocations) {
      if (id === 'desktop') handleTabNavigate(userLocations.desktop);
      else if (id === 'downloads') handleTabNavigate(userLocations.downloads);
      else if (id === 'documents') handleTabNavigate(userLocations.documents);
      else if (id === 'pictures') handleTabNavigate(userLocations.pictures);
      else setActiveNav(id);
    } else {
      setActiveNav(id);
    }
  };

  const activeProcessCount = runningProcesses.filter((p) => p.status === 'running' || p.status === 'starting').length;

  const sidebarSections: SidebarSectionData[] = [
    {
      title: 'WORKSPACE',
      items: [
        { id: 'home', label: 'Home', icon: <Home size={16} strokeWidth={2.2} /> },
        { 
          id: 'command-center', 
          label: 'Command Center', 
          icon: <Radio size={16} strokeWidth={2.2} />,
          badge: activeProcessCount > 0 ? `${activeProcessCount} active` : undefined
        },
        { 
          id: 'projects', 
          label: 'Projects', 
          icon: <FolderGit2 size={16} strokeWidth={2.2} />, 
          badge: projects.length 
        },
        ...(workspaceProjectPath
          ? [
              {
                id: 'workspace',
                label: 'Project Workspace',
                icon: <Terminal size={16} strokeWidth={2.2} />,
              },
            ]
          : []),
      ]
    },
    {
      title: 'LOCATIONS',
      items: [
        { id: 'desktop', label: 'Desktop', icon: <Monitor size={16} strokeWidth={2.2} /> },
        { id: 'downloads', label: 'Downloads', icon: <Download size={16} strokeWidth={2.2} /> },
        { id: 'documents', label: 'Documents', icon: <FileText size={16} strokeWidth={2.2} /> },
        { id: 'pictures', label: 'Pictures', icon: <Image size={16} strokeWidth={2.2} /> },
      ]
    },
    {
      title: 'SYSTEM',
      items: [
        { id: 'this-pc', label: 'This PC', icon: <HardDrive size={16} strokeWidth={2.2} /> },
        { id: 'workstation-intelligence', label: 'Workstation Health', icon: <BrainCircuit size={16} strokeWidth={2.2} /> },
        { id: 'storage-intelligence', label: 'Storage Diagnostics', icon: <HardDrive size={16} strokeWidth={2.2} /> },
        { id: 'developer-health', label: 'Developer Environment', icon: <Activity size={16} strokeWidth={2.2} /> },
      ]
    }
  ];

  const isExplorerView = activeNav === 'this-pc' || activeNav === 'explorer';

  return (
    <div className="mahi-app-root">
      {/* Native Drag Region & Window Title Bar */}
      <TitleBar appName="MAHI" />

      {/* Top Navigation & Global Search Area */}
      <header className="mahi-top-header">
        <div className="mahi-header-left">
          <IconButton 
            icon={<FolderOpen size={16} strokeWidth={2.2} />} 
            label="Workspaces" 
            tooltip="Browse developer workspaces"
            onClick={() => {
              const defaultWorkspacePath = configuredRoots[0] || (projects[0]?.path ? projects[0].path : 'this-pc');
              handleTabNavigate(defaultWorkspacePath);
            }}
          />
        </div>

        <div className="mahi-header-center">
          <SearchBar 
            ref={searchInputRef}
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search projects, technologies, paths... (e.g. NoboGhat, React, Rust)"
          />
        </div>

        <div className="mahi-header-right">
          <IconButton 
            icon={<Bell size={15} strokeWidth={2.2} />} 
            tooltip={
              workstationSummary && workstationSummary.totalFindings > 0
                ? `Workstation Findings: ${workstationSummary.totalFindings} issue(s) detected`
                : 'Workstation Intelligence'
            }
            onClick={() => setActiveNav('workstation-intelligence')}
          />
          <IconButton 
            icon={<HelpCircle size={15} strokeWidth={2.2} />} 
            tooltip="Shortcuts, Help & About"
            onClick={() => {
              setSettingsInitialTab('help');
              setIsSettingsOpen(true);
            }}
          />
          <IconButton 
            icon={<Settings size={15} strokeWidth={2.2} />} 
            tooltip="Settings & Maintenance"
            onClick={() => {
              setSettingsInitialTab('locations');
              setIsSettingsOpen(true);
            }}
          />
        </div>
      </header>

      {/* Main Body Layout: Sidebar + Main Workspace */}
      <div className="mahi-app-body">
        <Sidebar 
          sections={sidebarSections}
          activeId={activeNav}
          onSelect={handleSidebarSelect}
        />

        <main className="mahi-main-scroll-area">
          {/* Tab Bar — only shown in explorer mode */}
          {isExplorerView && !searchQuery.trim() && (
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSwitchTab={handleSwitchTab}
              onCloseTab={handleCloseTab}
              onNewTab={handleNewTab}
            />
          )}

          {searchQuery.trim().length > 0 ? (
            <SearchResults
              query={searchQuery}
              results={filteredProjects}
              selectedIndex={selectedIndex}
              onSelectIndex={setSelectedIndex}
              onOpenProject={(p) => handleOpenProject(p.path, p.name)}
              onOpenInVsCode={(p) => handleOpenInVsCode(p.path, p.name)}
              onOpenInTerminal={(p) => handleOpenInTerminal(p.path)}
              onOpenInExplorer={(p) => handleOpenInExplorer(p.path)}
              onCopyPath={(p) => handleCopyPath(p.path)}
              onShowDetails={(p) => handleShowProjectDetails(p.path)}
              onContextMenu={(p, e) => handleProjectContextMenu(p.name, p.path, e, p.scripts)}
              onOpenWorkspace={(p) => handleOpenWorkspace(p.path)}
              onTogglePin={(p) => handleTogglePin(p.path, p.name)}
            />
          ) : activeNav === 'workspace' && workspaceProjectPath ? (
            <Suspense fallback={
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '12px', color: '#8fa0bc' }}>
                <RefreshCw size={24} className="mahi-spin" />
                <span>Loading Workspace Panel...</span>
              </div>
            }>
              <ProjectWorkspacePanel
                projectPath={workspaceProjectPath}
                onBack={() => {
                  setActiveNav(previousNav || 'home');
                }}
                onOpenInVsCode={(path) => handleOpenInVsCode(path)}
                onOpenInTerminal={(path) => handleOpenInTerminal(path)}
                onOpenInExplorer={(path) => handleOpenInExplorer(path)}
                onNavigateToExplorer={(path) => handleTabNavigate(path)}
              />
            </Suspense>
          ) : activeNav === 'command-center' ? (
            <CommandCenter
              projects={projects}
              recentProjects={recentProjects}
              pinnedProjects={pinnedProjects}
              runningProcesses={runningProcesses}
              debugStorage={debugStorage}
              configuredRoots={configuredRoots}
              userLocations={userLocations}
              onOpenProject={handleOpenProject}
              onOpenInVsCode={handleOpenInVsCode}
              onOpenInTerminal={handleOpenInTerminal}
              onOpenInExplorer={handleOpenInExplorer}
              onOpenWorkspace={handleOpenWorkspace}
              onTogglePin={handleTogglePin}
              onStopProcess={handleStopProcess}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onNavigateToLocation={(loc) => handleTabNavigate(loc)}
              onRefreshAll={loadData}
              refreshing={loading}
              onOpenStorageIntelligence={() => setActiveNav('storage-intelligence')}
            />
          ) : activeNav === 'home' ? (
            !onboardingState.dismissed && !onboardingState.completed && projects.length === 0 ? (
              <OnboardingView
                configuredRoots={configuredRoots}
                isScanning={loading}
                onAddFolder={handleAddProjectFolder}
                onSkip={handleSkipOnboarding}
                onRescan={loadData}
              />
            ) : (
              <HomeDashboard 
                projects={projects}
                recentProjects={recentProjects}
                pinnedProjects={pinnedProjects}
                runningProcesses={runningProcesses}
                configuredRoots={configuredRoots}
                userLocations={userLocations}
                workstationSummary={workstationSummary}
                debugStorage={debugStorage}
                loading={loading}
                latencyMs={latencyMs}
                onRefresh={loadData}
                onOpenProject={handleOpenProject}
                onOpenInVsCode={handleOpenInVsCode}
                onOpenInTerminal={handleOpenInTerminal}
                onOpenInExplorer={handleOpenInExplorer}
                onCopyPath={handleCopyPath}
                onShowDetails={handleShowProjectDetails}
                onContextMenu={(p, e) => p.path && handleProjectContextMenu(p.name, p.path, e, p.scripts)}
                onFocusSearch={() => searchInputRef.current?.focus()}
                onRunDevScript={handleRunDevScript}
                onOpenWorkspace={handleOpenWorkspace}
                onTogglePin={handleTogglePin}
                onStopProcess={handleStopProcess}
                onOpenCommandCenter={() => setActiveNav('command-center')}
                onOpenStorageIntelligence={() => setActiveNav('storage-intelligence')}
                onOpenDeveloperHealth={() => setActiveNav('developer-health')}
                onOpenWorkstationIntelligence={() => setActiveNav('workstation-intelligence')}
                onAddProjectFolder={handleAddProjectFolder}
              />
            )
          ) : activeNav === 'projects' ? (
            <div className="mahi-projects-view-container">
              <SearchResults
                query=""
                results={projects.map((p) => ({
                  ...p,
                  isPinned: pinnedPaths.has(normalizePath(p.path))
                }))}
                selectedIndex={selectedIndex}
                onSelectIndex={setSelectedIndex}
                onOpenProject={(p) => handleOpenProject(p.path, p.name)}
                onOpenInVsCode={(p) => handleOpenInVsCode(p.path, p.name)}
                onOpenInTerminal={(p) => handleOpenInTerminal(p.path)}
                onOpenInExplorer={(p) => handleOpenInExplorer(p.path)}
                onCopyPath={(p) => handleCopyPath(p.path)}
                onShowDetails={(p) => handleShowProjectDetails(p.path)}
                onContextMenu={(p, e) => handleProjectContextMenu(p.name, p.path, e, p.scripts)}
                onOpenWorkspace={(p) => handleOpenWorkspace(p.path)}
                onTogglePin={(p) => handleTogglePin(p.path, p.name)}
              />
            </div>
          ) : activeNav === 'storage-intelligence' ? (
            <Suspense fallback={
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '12px', color: '#8fa0bc' }}>
                <RefreshCw size={24} className="mahi-spin" />
                <span>Loading Storage Intelligence...</span>
              </div>
            }>
              <StorageIntelligenceView
                reports={storageOverview?.reports || {}}
                availableDrives={storageOverview?.availableDrives || ['C', 'D']}
                activeDrive={activeStorageDrive}
                onSelectDrive={(d) => {
                  setActiveStorageDrive(d);
                  if (!storageOverview?.reports[d]) {
                    handleRefreshStorageDrive(d);
                  }
                }}
                onRefresh={(d) => handleRefreshStorageDrive(d)}
                refreshing={storageLoading}
                onNavigateToPath={(path) => handleTabNavigate(path)}
              />
            </Suspense>
          ) : activeNav === 'developer-health' ? (
            <Suspense fallback={
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '12px', color: '#8fa0bc' }}>
                <RefreshCw size={24} className="mahi-spin" />
                <span>Loading Developer Environment...</span>
              </div>
            }>
              <DeveloperHealthView
                onNavigateToPath={(path) => handleTabNavigate(path)}
                initialProjectPath={developerHealthIntent.projectPath || workspaceProjectPath || (projects.length > 0 ? projects[0].path : undefined)}
                initialTab={developerHealthIntent.tab}
                targetId={developerHealthIntent.targetId}
              />
            </Suspense>
          ) : activeNav === 'workstation-intelligence' ? (
            <Suspense fallback={
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '12px', color: '#8fa0bc' }}>
                <RefreshCw size={24} className="mahi-spin" />
                <span>Loading Workstation Health...</span>
              </div>
            }>
              <WorkstationIntelligenceView
                projectPath={workspaceProjectPath}
                onSafeAction={(intent) => {
                  if (intent.destination === 'storage') {
                    setActiveNav('storage-intelligence');
                  } else if (intent.destination === 'developer-health') {
                    setDeveloperHealthIntent({
                      tab: intent.tab,
                      projectPath: intent.projectPath,
                      targetId: intent.targetId,
                    });
                    setActiveNav('developer-health');
                  } else if (intent.destination === 'workspace' && intent.projectPath) {
                    handleOpenWorkspace(intent.projectPath);
                  } else {
                    setActiveNav('workstation-intelligence');
                  }
                }}
              />
            </Suspense>
          ) : activeNav === 'this-pc' ? (
            <DriveView
              drives={drives}
              loading={drivesLoading}
              onRefresh={loadDrives}
              onOpenDrive={(drivePath) => handleTabNavigate(drivePath)}
            />
          ) : activeNav === 'explorer' ? (
            <DirectoryBrowser
              currentPath={activeTab.currentPath}
              data={activeTabCache.data}
              loading={activeTabCache.loading}
              error={activeTabCache.error}
              canGoBack={activeTab.historyIndex > 0}
              canGoForward={activeTab.historyIndex < activeTab.history.length - 1}
              viewMode={activeTab.viewMode}
              sortField={activeTab.sortField}
              sortDirection={activeTab.sortDirection}
              selectedPaths={activeTab.selectedPaths}
              showPreview={activeTab.showPreview}
              onNavigate={(path) => handleTabNavigate(path)}
              onGoBack={handleGoBack}
              onGoForward={handleGoForward}
              onGoUp={handleGoUp}
              onRefresh={handleRefresh}
              onOpenThisPc={() => handleTabNavigate('this-pc')}
              onOpenFile={(filePath) => openPath(filePath)}
              onOpenInVsCode={(path) => handleOpenInVsCode(path)}
              onOpenInTerminal={(path) => handleOpenInTerminal(path)}
              onOpenInExplorer={(path) => handleOpenInExplorer(path)}
              onOpenInNewTab={(path) => handleNewTab(path)}
              onViewModeChange={(vm) => updateTab(activeTabId, { viewMode: vm })}
              onSortChange={(field, dir) => updateTab(activeTabId, { sortField: field, sortDirection: dir })}
              onSelectionChange={(paths) => updateTab(activeTabId, { selectedPaths: paths })}
              onPreviewToggle={(show) => updateTab(activeTabId, { showPreview: show })}
            />
          ) : (
            <div className="mahi-placeholder-view">
              <div className="mahi-placeholder-content">
                <div className="mahi-placeholder-icon">
                  <FolderGit2 size={32} />
                </div>
                <h2>{activeNav.toUpperCase()} Workspace</h2>
                <p>Location ready for instant explorer navigation.</p>
                <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                  <button 
                    type="button" 
                    className="mahi-back-home-btn"
                    onClick={() => handleTabNavigate('this-pc')}
                  >
                    Open Drives
                  </button>
                  <button 
                    type="button" 
                    className="mahi-back-home-btn"
                    style={{ background: 'rgba(255,255,255,0.06)' }}
                    onClick={() => setActiveNav('home')}
                  >
                    Return to Dashboard
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Unified Project Context Menu */}
      {projectContextMenu.isOpen && (
        <ContextMenu
          state={{
            isOpen: projectContextMenu.isOpen,
            x: projectContextMenu.x,
            y: projectContextMenu.y,
            targetItem: {
              name: projectContextMenu.name,
              path: projectContextMenu.path,
              isDirectory: true,
              isSymlink: false,
              isHidden: false,
              fileType: 'Developer Project',
            },
          }}
          viewMode="details"
          clipboard={null}
          selectedCount={1}
          isProject={true}
          onClose={() => setProjectContextMenu((prev) => ({ ...prev, isOpen: false }))}
          onOpenItem={() => handleOpenProject(projectContextMenu.path, projectContextMenu.name)}
          onOpenInVsCode={() => handleOpenInVsCode(projectContextMenu.path, projectContextMenu.name)}
          onOpenInTerminal={() => handleOpenInTerminal(projectContextMenu.path)}
          onOpenInExplorer={() => handleOpenInExplorer(projectContextMenu.path)}
          onCopyPath={() => handleCopyPath(projectContextMenu.path)}
          onShowGitStatus={() => handleShowProjectDetails(projectContextMenu.path)}
          onShowProjectDetails={() => handleShowProjectDetails(projectContextMenu.path)}
          onOpenWorkspace={() => handleOpenWorkspace(projectContextMenu.path)}
          onTogglePin={() => handleTogglePin(projectContextMenu.path, projectContextMenu.name)}
          isPinned={pinnedPaths.has(normalizePath(projectContextMenu.path))}
          projectScripts={projectContextMenu.scripts}
          onRunScript={(script) => handleRunScriptFromContextMenu(projectContextMenu.path, script)}
          onRefresh={() => {}}
          onSetViewMode={() => {}}
          onSetSort={() => {}}
          onCopy={() => {}}
          onCut={() => {}}
          onPaste={() => {}}
          onRename={() => {}}
          onDelete={() => {}}
          onNewFolder={() => {}}
          onProperties={() => {}}
        />
      )}

      {/* Phase 7A: Project Intelligence Modal */}
      <ProjectDetailsModal
        isOpen={isDetailsModalOpen}
        project={detailsModalProject}
        loading={detailsModalLoading}
        onClose={() => setIsDetailsModalOpen(false)}
        onOpenInVsCode={(path) => {
          handleOpenInVsCode(path);
          setIsDetailsModalOpen(false);
        }}
        onOpenInTerminal={(path) => handleOpenInTerminal(path)}
        onOpenInExplorer={(path) => handleOpenInExplorer(path)}
        onCopyPath={(path) => handleCopyPath(path)}
        onOpenWorkspace={handleOpenWorkspace}
        onTogglePin={handleTogglePin}
      />

      {/* Phase 7E, 8A & 18: Settings Modal (Locations, Maintenance, Help & About) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        initialTab={settingsInitialTab}
        onClose={() => setIsSettingsOpen(false)}
        onOpenStorageIntelligence={() => setActiveNav('storage-intelligence')}
        onOpenDeveloperHealth={() => setActiveNav('developer-health')}
        onOpenWorkstationHealth={() => setActiveNav('workstation-intelligence')}
        onResetOnboarding={handleResetOnboarding}
        configuredRoots={configuredRoots}
        onAddProjectFolder={handleAddProjectFolder}
        onRemoveProjectFolder={handleRemoveProjectFolder}
      />

      {/* Floating Notification Toast (Phase 17) */}
      {toast && (
        <div className="mahi-toast-container" role="status" aria-live="polite">
          <div className={`mahi-toast ${toast.type}`}>
            {toast.type === 'success' && <CheckCircle2 size={16} className="mahi-toast-icon success" />}
            {toast.type === 'warning' && <AlertTriangle size={16} className="mahi-toast-icon warning" />}
            {toast.type === 'error' && <AlertCircle size={16} className="mahi-toast-icon error" />}
            {toast.type === 'info' && <Info size={16} className="mahi-toast-icon info" />}
            <span className="mahi-toast-message">{toast.message}</span>
            <button
              type="button"
              className="mahi-toast-close"
              onClick={() => setToast(null)}
              title="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
