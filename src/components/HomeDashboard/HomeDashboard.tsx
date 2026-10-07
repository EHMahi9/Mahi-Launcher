import React from 'react';
import { 
  FolderGit2, 
  FolderPlus, 
  Terminal, 
  Code2, 
  Search, 
  HardDrive, 
  Sparkles, 
  ChevronRight, 
  RefreshCw,
  Square,
  Clock,
  ExternalLink,
  Globe,
  ShieldCheck,
  AlertTriangle,
  Activity,
  BrainCircuit,
  X
} from 'lucide-react';
import { ProjectCard, ProjectData } from '../ProjectCard/ProjectCard';
import { QuickAction } from '../QuickAction/QuickAction';
import { SectionHeader } from '../SectionHeader/SectionHeader';
import { EmptyState } from '../EmptyState/EmptyState';
import { 
  ProjectInfo, 
  RecentProjectEntry, 
  PinnedProjectEntry, 
  ProjectProcessInfo,
  DebugStorageInfo
} from '../../types/project';
import { WorkstationIntelligenceSummary } from '../../types/intelligence';
import { UserLocations } from '../../types/filesystem';
import { extractLocalhostUrls, normalizePath } from '../../services/tauriApi';
import './HomeDashboard.css';

interface HomeDashboardProps {
  projects: ProjectInfo[];
  recentProjects: RecentProjectEntry[];
  pinnedProjects?: PinnedProjectEntry[];
  runningProcesses?: ProjectProcessInfo[];
  configuredRoots?: string[];
  userLocations?: UserLocations | null;
  workstationSummary?: WorkstationIntelligenceSummary | null;
  debugStorage?: DebugStorageInfo | null;
  loading: boolean;
  latencyMs: number;
  onRefresh: () => void;
  onOpenProject: (path: string, name: string) => void;
  onOpenInVsCode: (path: string, name: string) => void;
  onOpenInTerminal: (path: string) => void;
  onOpenInExplorer: (path: string) => void;
  onCopyPath?: (path: string) => void;
  onShowDetails?: (path: string, name?: string) => void;
  onContextMenu?: (project: ProjectData, e: React.MouseEvent) => void;
  onFocusSearch: () => void;
  onRunDevScript?: (path: string) => void;
  onOpenWorkspace?: (path: string) => void;
  onTogglePin?: (path: string, name: string) => void;
  onStopProcess?: (processId: string) => void;
  onOpenCommandCenter?: () => void;
  onOpenStorageIntelligence?: () => void;
  onOpenDeveloperHealth?: () => void;
  onOpenWorkstationIntelligence?: () => void;
  onAddProjectFolder?: () => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  projects,
  recentProjects,
  pinnedProjects = [],
  runningProcesses = [],
  configuredRoots = [],
  userLocations = null,
  workstationSummary = null,
  debugStorage = null,
  loading,
  latencyMs,
  onRefresh,
  onOpenProject,
  onOpenInVsCode,
  onOpenInTerminal,
  onOpenInExplorer,
  onCopyPath,
  onShowDetails,
  onContextMenu,
  onFocusSearch,
  onRunDevScript,
  onOpenWorkspace,
  onTogglePin,
  onStopProcess,
  onOpenCommandCenter,
  onOpenStorageIntelligence,
  onOpenDeveloperHealth,
  onOpenWorkstationIntelligence,
  onAddProjectFolder,
}) => {
  const [projectFilter, setProjectFilter] = React.useState('');

  const quickAccessLocations = React.useMemo(() => {
    const list: Array<{ label: string; path: string; items: string; icon: React.ReactNode }> = [];

    // 1. Configured scan roots
    if (configuredRoots && configuredRoots.length > 0) {
      configuredRoots.slice(0, 3).forEach((root) => {
        const folderName = root.split(/[\\/]/).filter(Boolean).pop() || root;
        list.push({
          label: folderName,
          path: root,
          items: 'Configured scan root',
          icon: <FolderGit2 size={15} />,
        });
      });
    }

    // 2. Standard user locations from system
    if (userLocations && list.length < 3) {
      if (userLocations.documents && !list.some((l) => l.path === userLocations.documents)) {
        list.push({
          label: 'Documents',
          path: userLocations.documents,
          items: 'User documents',
          icon: <HardDrive size={15} />,
        });
      }
      if (list.length < 3 && userLocations.desktop && !list.some((l) => l.path === userLocations.desktop)) {
        list.push({
          label: 'Desktop',
          path: userLocations.desktop,
          items: 'User desktop',
          icon: <HardDrive size={15} />,
        });
      }
      if (list.length < 3 && userLocations.downloads && !list.some((l) => l.path === userLocations.downloads)) {
        list.push({
          label: 'Downloads',
          path: userLocations.downloads,
          items: 'User downloads',
          icon: <HardDrive size={15} />,
        });
      }
    }

    // 3. Fallback to This PC if empty
    if (list.length === 0) {
      list.push({
        label: 'This PC',
        path: 'this-pc',
        items: 'Storage volumes',
        icon: <HardDrive size={15} />,
      });
    }

    return list;
  }, [configuredRoots, userLocations]);

  const pinnedPaths = React.useMemo(() => {
    return new Set(pinnedProjects.map((p) => normalizePath(p.path)));
  }, [pinnedProjects]);

  // Active processes
  const activeProcesses = React.useMemo(() => {
    return runningProcesses.filter((p) => p.status === 'running' || p.status === 'starting');
  }, [runningProcesses]);

  // Format uptime for process item
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

  // Format pinned projects cards
  const pinnedProjectCards: ProjectData[] = React.useMemo(() => {
    return pinnedProjects.map((pinned, idx) => {
      const normPath = normalizePath(pinned.path);
      const matched = projects.find(
        (p) => normalizePath(p.path) === normPath
      );
      const techStr = matched 
        ? matched.technologies.slice(0, 3).join(' · ') || matched.projectType
        : 'Developer Workspace';

      const getColors = (_name: string) => {
        const colors = [
          { bg: 'rgba(0, 200, 255, 0.12)', color: '#00d2ff' },
          { bg: 'rgba(47, 127, 255, 0.14)', color: '#2f7fff' },
          { bg: 'rgba(130, 80, 255, 0.14)', color: '#9d66ff' },
          { bg: 'rgba(255, 120, 60, 0.12)', color: '#ff8a48' },
        ];
        return colors[idx % colors.length];
      };

      const { bg, color } = getColors(pinned.name);

      return {
        id: `pinned-${pinned.path}`,
        name: pinned.name,
        tech: techStr,
        path: pinned.path,
        activity: 'Pinned',
        iconBg: bg,
        iconColor: color,
        gitSummary: matched?.gitSummary,
        hasDevScript: matched?.hasDevScript,
        scripts: matched?.scripts,
        isPinned: true,
      };
    });
  }, [pinnedProjects, projects]);

  // Format recent projects or fallback to top discovered projects
  const displayProjects: ProjectData[] = React.useMemo(() => {
    if (recentProjects.length > 0) {
      return recentProjects.slice(0, 6).map((recent, idx) => {
        const normRecent = normalizePath(recent.path);
        const matched = projects.find(
          (p) => normalizePath(p.path) === normRecent
        );
        const techStr = matched 
          ? matched.technologies.slice(0, 3).join(' · ') || matched.projectType
          : 'Developer Workspace';

        const getColors = (_name: string) => {
          const colors = [
            { bg: 'rgba(0, 200, 255, 0.12)', color: '#00d2ff' },
            { bg: 'rgba(47, 127, 255, 0.14)', color: '#2f7fff' },
            { bg: 'rgba(130, 80, 255, 0.14)', color: '#9d66ff' },
            { bg: 'rgba(255, 120, 60, 0.12)', color: '#ff8a48' },
          ];
          return colors[idx % colors.length];
        };

        const { bg, color } = getColors(recent.name);

        return {
          id: `recent-${recent.path}`,
          name: recent.name,
          tech: techStr,
          path: recent.path,
          activity: 'Recent',
          iconBg: bg,
          iconColor: color,
          gitSummary: matched?.gitSummary,
          hasDevScript: matched?.hasDevScript,
          scripts: matched?.scripts,
          isPinned: pinnedPaths.has(normRecent),
        };
      });
    }

    return projects.slice(0, 6).map((p, idx) => {
      const normP = normalizePath(p.path);
      const getColors = (type: string) => {
        if (type.includes('Rust')) return { bg: 'rgba(255, 120, 60, 0.12)', color: '#ff8a48' };
        if (type.includes('Java')) return { bg: 'rgba(0, 200, 255, 0.12)', color: '#00d2ff' };
        if (type.includes('Node')) return { bg: 'rgba(47, 127, 255, 0.14)', color: '#2f7fff' };
        return { bg: 'rgba(130, 80, 255, 0.14)', color: '#9d66ff' };
      };

      const { bg, color } = getColors(p.projectType);

      return {
        id: `disc-${p.path}`,
        name: p.name,
        tech: p.technologies.slice(0, 3).join(' · ') || p.projectType,
        path: p.path,
        activity: idx === 0 ? 'Latest' : 'Active',
        iconBg: bg,
        iconColor: color,
        gitSummary: p.gitSummary,
        hasDevScript: p.hasDevScript,
        scripts: p.scripts,
        isPinned: pinnedPaths.has(normP),
      };
    });
  }, [recentProjects, projects, pinnedPaths]);

  // Inline filtered projects
  const filteredDisplayProjects = React.useMemo(() => {
    if (!projectFilter.trim()) return displayProjects;
    const q = projectFilter.toLowerCase().trim();
    return displayProjects.filter((p) => {
      const nameMatch = p.name.toLowerCase().includes(q);
      const techMatch = p.tech.toLowerCase().includes(q);
      const pathMatch = p.path ? p.path.toLowerCase().includes(q) : false;
      return nameMatch || techMatch || pathMatch;
    });
  }, [displayProjects, projectFilter]);

  // Attention summary computations
  const criticalCount = workstationSummary?.criticalCount || 0;
  const highCount = workstationSummary?.highCount || 0;
  const mediumCount = workstationSummary?.mediumCount || 0;
  const attentionCount = criticalCount + highCount;
  const advisoryCount = mediumCount;
  const hasActionableFindings = attentionCount > 0 || advisoryCount > 0;
  const priorityItemsCount = attentionCount > 0 ? attentionCount : advisoryCount;

  const primaryPath = projects[0]?.path || null;

  return (
    <div className="mahi-dashboard">
      {/* Hero Welcome Banner */}
      <div className="mahi-hero-banner">
        <div className="mahi-hero-content">
          <div className="mahi-hero-badge">
            <Sparkles size={13} className="mahi-sparkle-icon" />
            <span>MAHI DEVELOPER WORKSPACE</span>
          </div>
          <h1 className="mahi-hero-title">Welcome to MAHI</h1>
          <p className="mahi-hero-subtitle">
            Your high-performance workspace for Windows. Fast, focused, and built for productive flow.
          </p>
        </div>
        
        <div className="mahi-hero-stats">
          <div className="mahi-stat-chip" onClick={onRefresh} title="Click to rescan projects" style={{ cursor: 'pointer' }}>
            <span className="mahi-stat-num">
              {loading ? <RefreshCw size={14} className="mahi-spin" /> : projects.length}
            </span>
            <span className="mahi-stat-lbl">Discovered Projects</span>
          </div>
          <div className="mahi-stat-chip">
            <span className="mahi-stat-num">{latencyMs}ms</span>
            <span className="mahi-stat-lbl">Scan Latency</span>
          </div>
        </div>
      </div>

      {/* Workstation Health & Attention Ribbon */}
      {workstationSummary && (
        <div className={`mahi-health-ribbon ${hasActionableFindings ? 'attention' : 'healthy'}`}>
          <div className="health-ribbon-left">
            <div className={`health-ribbon-icon-box ${hasActionableFindings ? 'attention' : 'healthy'}`}>
              {hasActionableFindings ? (
                <AlertTriangle size={16} />
              ) : (
                <ShieldCheck size={16} />
              )}
            </div>
            <div className="health-ribbon-text">
              <div className="health-ribbon-title-row">
                <span className="health-ribbon-title">
                  {hasActionableFindings
                    ? `${priorityItemsCount} Priority Item${priorityItemsCount === 1 ? '' : 's'} Require Review`
                    : 'Workstation Status: Healthy'}
                </span>
                <span className={`health-ribbon-badge ${hasActionableFindings ? 'attention' : 'healthy'}`}>
                  {hasActionableFindings ? (attentionCount > 0 ? 'Action Needed' : 'Advisory') : 'Verified'}
                </span>
              </div>
              <p className="health-ribbon-desc">
                {hasActionableFindings
                  ? (workstationSummary.topFindings[0]?.title || 'Toolchains, environment variables, or developer caches require review')
                  : 'Toolchains, environment variables, and storage areas are operating within nominal limits.'}
              </p>
            </div>
          </div>

          <div className="health-ribbon-actions">
            {hasActionableFindings ? (
              <button
                type="button"
                className="health-ribbon-action-btn attention"
                onClick={onOpenWorkstationIntelligence}
                title="Open Findings Hub"
              >
                <span>Review Findings</span>
                <ChevronRight size={13} />
              </button>
            ) : (
              <button
                type="button"
                className="health-ribbon-action-btn healthy"
                onClick={onOpenWorkstationIntelligence}
                title="Open Findings Hub"
              >
                <span>View Findings Hub</span>
                <ChevronRight size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Hierarchy Step 1: Suggested Actions */}
      <section className="mahi-dashboard-section">
        <SectionHeader 
          title="Command Center & Quick Actions" 
          subtitle="Instant developer operations and workspace transitions" 
          actionText={onOpenCommandCenter ? "Open Command Center" : undefined}
          onAction={onOpenCommandCenter}
        />
        <div className="mahi-actions-grid">
          <QuickAction 
            label="Open Project" 
            description={primaryPath ? "Browse workspace or open directory" : "Add project folder to scan"}
            icon={<FolderPlus size={16} />}
            badge="Ctrl + O"
            onClick={() => {
              if (primaryPath) {
                onOpenInExplorer(primaryPath);
              } else if (onAddProjectFolder) {
                onAddProjectFolder();
              }
            }}
          />
          <QuickAction 
            label="Open in VS Code" 
            description={primaryPath ? "Resume current workspace in editor" : "No projects discovered"}
            icon={<Code2 size={16} />}
            badge="Ctrl + P"
            disabled={!primaryPath}
            onClick={() => {
              if (primaryPath) onOpenInVsCode(primaryPath, projects[0]?.name || 'Workspace');
            }}
          />
          <QuickAction 
            label="Open Terminal" 
            description={primaryPath ? "Launch PowerShell in project directory" : "No projects discovered"}
            icon={<Terminal size={16} />}
            badge="Ctrl + `"
            disabled={!primaryPath}
            onClick={() => {
              if (primaryPath) onOpenInTerminal(primaryPath);
            }}
          />
          <QuickAction 
            label="Explore Files" 
            description="Inspect local filesystem in Explorer"
            icon={<FolderGit2 size={16} />}
            onClick={() => onOpenInExplorer(primaryPath || 'this-pc')}
          />
          <QuickAction 
            label="Storage Diagnostics" 
            description="Inspect drive usage & C→D advisor"
            icon={<HardDrive size={16} />}
            onClick={onOpenStorageIntelligence}
          />
          <QuickAction 
            label="Developer Environment" 
            description="Check toolchains, PATH & repairs"
            icon={<Activity size={16} />}
            onClick={onOpenDeveloperHealth || onOpenWorkstationIntelligence}
          />
          <QuickAction 
            label="Search Workspace" 
            description="Fast sub-millisecond file & project search"
            icon={<Search size={16} />}
            badge="Alt + Space"
            onClick={onFocusSearch}
          />
        </div>
      </section>

      {/* Hierarchy Step 2: Dedicated Pinned Projects Section */}
      <section className="mahi-dashboard-section pinned-section">
        <SectionHeader
          title="Pinned Projects"
          subtitle="Priority developer workspaces"
        />
        {pinnedProjectCards.length > 0 ? (
          <div className="mahi-projects-grid">
            {pinnedProjectCards.map((project) => (
              <ProjectCard 
                key={project.id} 
                project={project}
                onClick={() => project.path && onOpenProject(project.path, project.name)}
                onOpenVsCode={(e) => {
                  e.stopPropagation();
                  if (project.path) onOpenInVsCode(project.path, project.name);
                }}
                onOpenTerminal={(e) => {
                  e.stopPropagation();
                  if (project.path) onOpenInTerminal(project.path);
                }}
                onOpenExplorer={(e) => {
                  e.stopPropagation();
                  if (project.path) onOpenInExplorer(project.path);
                }}
                onCopyPath={(e) => {
                  e.stopPropagation();
                  if (project.path && onCopyPath) onCopyPath(project.path);
                }}
                onShowDetails={(e) => {
                  e.stopPropagation();
                  if (project.path && onShowDetails) onShowDetails(project.path, project.name);
                }}
                onContextMenu={(e) => {
                  if (onContextMenu) onContextMenu(project, e);
                }}
                onRunDevScript={(e) => {
                  e.stopPropagation();
                  if (project.path && onRunDevScript) onRunDevScript(project.path);
                }}
                onOpenWorkspace={(e) => {
                  e.stopPropagation();
                  if (project.path && onOpenWorkspace) onOpenWorkspace(project.path);
                }}
                onTogglePin={(e) => {
                  e.stopPropagation();
                  if (project.path && onTogglePin) onTogglePin(project.path, project.name);
                }}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            type="pinned-projects"
            title="No pinned projects"
            description={projects.length === 0
              ? "Add your project folders or scan workspaces to pin your priority projects here."
              : "Keep your most important projects at your fingertips. Click the pin icon on any project card or right-click to pin."}
            compact={true}
            actionText={projects.length === 0 && onAddProjectFolder ? "Add Project Folder" : "Browse Discovered Projects"}
            onAction={projects.length === 0 && onAddProjectFolder ? onAddProjectFolder : onFocusSearch}
          />
        )}
      </section>

      {/* Hierarchy Step 3: Running Projects & Processes */}
      {activeProcesses.length > 0 && (
        <section className="mahi-dashboard-section running-processes-home-section">
          <SectionHeader
            title="Running Projects & Processes"
            subtitle={`${activeProcesses.length} active process${activeProcesses.length > 1 ? 'es' : ''} currently executing`}
            actionText={onOpenCommandCenter ? "View in Command Center" : undefined}
            onAction={onOpenCommandCenter}
          />
          <div className="mahi-home-running-grid">
            {activeProcesses.map((proc) => {
              const urls = extractLocalhostUrls(proc.outputLines);
              return (
                <div key={proc.id} className="mahi-home-proc-card">
                  <div className="proc-card-top">
                    <div className="proc-title-row">
                      <span className="proc-ping-dot" />
                      <span className="proc-proj-title">{proc.projectName}</span>
                      <span className="proc-cmd-chip">{proc.packageManager} run {proc.scriptName}</span>
                    </div>
                    {onStopProcess && (
                      <button
                        type="button"
                        className="proc-quick-stop-btn"
                        onClick={() => onStopProcess(proc.id)}
                        title="Stop process"
                      >
                        <Square size={11} fill="currentColor" />
                        <span>Stop</span>
                      </button>
                    )}
                  </div>

                  <div className="proc-card-bottom">
                    <div className="proc-meta-items">
                      <span className="proc-uptime">
                        <Clock size={10} />
                        {formatUptime(proc.startedAt)}
                      </span>
                      <span className="proc-buffer-lines">
                        {proc.outputLines.length} lines logged
                      </span>
                    </div>

                    <div className="proc-bottom-actions">
                      {urls.length > 0 && (
                        <a
                          href={urls[0]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="proc-url-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Globe size={11} />
                          <span>{urls[0]}</span>
                          <ExternalLink size={10} />
                        </a>
                      )}
                      {onOpenWorkspace && (
                        <button
                          type="button"
                          className="proc-workspace-link"
                          onClick={() => onOpenWorkspace(proc.projectPath)}
                          title="Open Project Workspace logs & environment"
                        >
                          <Terminal size={11} />
                          <span>Workspace</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Hierarchy Step 4: Recent Projects & Step 5: Quick Locations */}
      <div className="mahi-dashboard-columns">
        {/* Left Column: Recent Projects */}
        <section className="mahi-dashboard-section main-col">
          <div className="mahi-projects-header-bar">
            <SectionHeader 
              title={projectFilter.trim() ? "Filtered Workspaces" : (recentProjects.length > 0 ? "Recent Projects" : "Discovered Projects")} 
              subtitle={projectFilter.trim() ? `${filteredDisplayProjects.length} matching workspace${filteredDisplayProjects.length !== 1 ? 's' : ''}` : "Frequently opened workspaces"} 
              actionText={!projectFilter.trim() && projects.length > 6 ? `View all (${projects.length})` : undefined}
              onAction={onFocusSearch}
            />
            {displayProjects.length > 0 && (
              <div className="mahi-inline-filter-wrap">
                <Search size={12} className="inline-filter-icon" />
                <input
                  type="text"
                  className="mahi-inline-filter-input"
                  placeholder="Filter projects..."
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                />
                {projectFilter && (
                  <button
                    type="button"
                    className="mahi-inline-filter-clear"
                    onClick={() => setProjectFilter('')}
                    title="Clear filter"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )}
          </div>

          {filteredDisplayProjects.length > 0 ? (
            <div className="mahi-projects-grid">
              {filteredDisplayProjects.map((project) => (
                <ProjectCard 
                  key={project.id} 
                  project={project}
                  onClick={() => project.path && onOpenProject(project.path, project.name)}
                  onOpenVsCode={(e) => {
                    e.stopPropagation();
                    if (project.path) onOpenInVsCode(project.path, project.name);
                  }}
                  onOpenTerminal={(e) => {
                    e.stopPropagation();
                    if (project.path) onOpenInTerminal(project.path);
                  }}
                  onOpenExplorer={(e) => {
                    e.stopPropagation();
                    if (project.path) onOpenInExplorer(project.path);
                  }}
                  onCopyPath={(e) => {
                    e.stopPropagation();
                    if (project.path && onCopyPath) onCopyPath(project.path);
                  }}
                  onShowDetails={(e) => {
                    e.stopPropagation();
                    if (project.path && onShowDetails) onShowDetails(project.path, project.name);
                  }}
                  onContextMenu={(e) => {
                    if (onContextMenu) onContextMenu(project, e);
                  }}
                  onRunDevScript={(e) => {
                    e.stopPropagation();
                    if (project.path && onRunDevScript) onRunDevScript(project.path);
                  }}
                  onOpenWorkspace={(e) => {
                    e.stopPropagation();
                    if (project.path && onOpenWorkspace) onOpenWorkspace(project.path);
                  }}
                  onTogglePin={(e) => {
                    e.stopPropagation();
                    if (project.path && onTogglePin) onTogglePin(project.path, project.name);
                  }}
                />
              ))}
            </div>
          ) : projectFilter.trim() ? (
            <EmptyState
              type="search-results"
              title={`No projects match "${projectFilter}"`}
              description="Try searching for a different framework, language, or path keyword."
              compact={true}
              actionText="Clear Filter"
              onAction={() => setProjectFilter('')}
            />
          ) : (
            <EmptyState
              type="recent-projects"
              title={projects.length === 0 ? "No developer projects discovered" : "No recent activity recorded"}
              description={projects.length === 0
                ? "MAHI automatically detects Git, Node, Rust, Python, Go, and Java projects. Add your workspace or code directory to start."
                : "Open a project in VS Code, Terminal, or File Explorer to automatically populate your recent history."}
              compact={true}
              actionText={onAddProjectFolder ? "Add Project Folder" : "Scan Projects"}
              onAction={onAddProjectFolder || onRefresh}
              secondaryText={projects.length === 0 ? "Rescan" : undefined}
              onSecondaryAction={projects.length === 0 ? onRefresh : undefined}
            />
          )}
        </section>

        {/* Right Column: Quick Access & Workstation Status */}
        <section className="mahi-dashboard-section side-col">
          <SectionHeader 
            title="Quick Access" 
            subtitle="Pinned locations" 
          />
          <div className="mahi-quick-access-list">
            {quickAccessLocations.map((loc, idx) => (
              <div 
                key={idx} 
                className="mahi-access-row"
                onClick={() => onOpenInExplorer(loc.path)}
                title={`Open ${loc.path} in Windows Explorer`}
                style={{ cursor: 'pointer' }}
              >
                <div className="mahi-access-icon">{loc.icon}</div>
                <div className="mahi-access-info">
                  <span className="mahi-access-name">{loc.label}</span>
                  <span className="mahi-access-sub">{loc.items} · {loc.path}</span>
                </div>
                <ChevronRight size={14} className="mahi-access-arrow" />
              </div>
            ))}
          </div>

          {/* Dynamic Workstation Intelligence & Health Card */}
          <div className="mahi-system-summary-card dynamic-health-card">
            <div className="mahi-summary-head">
              <BrainCircuit size={15} className="mahi-summary-icon" />
              <span className="summary-head-title">Workstation Health</span>
              <span className={`dynamic-health-chip ${hasActionableFindings ? 'attention' : 'healthy'}`}>
                {hasActionableFindings ? `${attentionCount + advisoryCount} Alert${attentionCount + advisoryCount > 1 ? 's' : ''}` : 'Optimal'}
              </span>
            </div>

            <div className="dynamic-metric-strip">
              <div 
                className="dynamic-metric-box" 
                onClick={onOpenStorageIntelligence}
                title="Inspect storage telemetry"
                style={{ cursor: 'pointer' }}
              >
                <span className="metric-val">
                  {debugStorage?.exists ? `${debugStorage.sizeMb}MB` : 'Checked'}
                </span>
                <span className="metric-lbl">Storage</span>
              </div>
              <div 
                className="dynamic-metric-box" 
                onClick={onOpenDeveloperHealth}
                title="Inspect developer health"
                style={{ cursor: 'pointer' }}
              >
                <span className="metric-val">Optimal</span>
                <span className="metric-lbl">Toolchain</span>
              </div>
              <div 
                className="dynamic-metric-box" 
                onClick={onOpenWorkstationIntelligence}
                title="Inspect correlation findings"
                style={{ cursor: 'pointer' }}
              >
                <span className="metric-val">
                  {workstationSummary ? workstationSummary.totalFindings : 0}
                </span>
                <span className="metric-lbl">Findings</span>
              </div>
            </div>

            {workstationSummary && workstationSummary.topFindings.length > 0 ? (
              <div className="dynamic-findings-snippet">
                {workstationSummary.topFindings.slice(0, 2).map((f) => (
                  <div 
                    key={f.id} 
                    className="dynamic-finding-item"
                    onClick={onOpenWorkstationIntelligence}
                    title={f.explanation}
                  >
                    <span className={`finding-sev-marker ${f.severity.toLowerCase()}`} />
                    <span className="finding-title-label">{f.title}</span>
                    <ChevronRight size={12} className="finding-arrow-icon" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="mahi-summary-desc">
                System engines correlated across storage, toolchains, and environment paths with 0 blocking anomalies.
              </p>
            )}

            <div className="dynamic-quick-hub-links">
              {onOpenStorageIntelligence && (
                <button type="button" className="quick-hub-btn" onClick={onOpenStorageIntelligence}>
                  <HardDrive size={11} />
                  <span>Storage</span>
                </button>
              )}
              {onOpenDeveloperHealth && (
                <button type="button" className="quick-hub-btn" onClick={onOpenDeveloperHealth}>
                  <Activity size={11} />
                  <span>Health</span>
                </button>
              )}
              {onOpenWorkstationIntelligence && (
                <button type="button" className="quick-hub-btn" onClick={onOpenWorkstationIntelligence}>
                  <BrainCircuit size={11} />
                  <span>Findings</span>
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
