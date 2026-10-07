import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HomeDashboard } from './HomeDashboard';
import { ProjectInfo, RecentProjectEntry, PinnedProjectEntry, ProjectProcessInfo, DebugStorageInfo } from '../../types/project';
import { WorkstationIntelligenceSummary } from '../../types/intelligence';

const mockProjects: ProjectInfo[] = [
  {
    name: 'AlphaProject',
    path: 'D:/Code/AlphaProject',
    projectType: 'React',
    technologies: ['React', 'TypeScript', 'Vite'],
    hasDevScript: true,
    scripts: ['dev', 'build'],
    detectedIndicators: ['package.json'],
  },
  {
    name: 'BetaRust',
    path: 'D:/Code/BetaRust',
    projectType: 'Rust',
    technologies: ['Rust', 'Cargo'],
    hasDevScript: false,
    scripts: ['build', 'test'],
    detectedIndicators: ['Cargo.toml'],
  },
];

const mockRecent: RecentProjectEntry[] = [
  {
    name: 'AlphaProject',
    path: 'D:/Code/AlphaProject',
    timestamp: Date.now(),
  },
];

const mockPinned: PinnedProjectEntry[] = [
  {
    name: 'BetaRust',
    path: 'D:/Code/BetaRust',
    pinnedAt: Date.now(),
  },
];

const mockProcesses: ProjectProcessInfo[] = [
  {
    id: 'proc-1',
    projectName: 'AlphaProject',
    projectPath: 'D:/Code/AlphaProject',
    scriptName: 'dev',
    packageManager: 'npm',
    status: 'running',
    startedAt: Date.now() - 60000,
    outputLines: ['Ready on http://localhost:3000'],
  },
];

const defaultProps = {
  projects: mockProjects,
  recentProjects: mockRecent,
  pinnedProjects: mockPinned,
  runningProcesses: [],
  configuredRoots: ['D:/Code'],
  userLocations: null,
  workstationSummary: null,
  debugStorage: null,
  loading: false,
  latencyMs: 8,
  onRefresh: vi.fn(),
  onOpenProject: vi.fn(),
  onOpenInVsCode: vi.fn(),
  onOpenInTerminal: vi.fn(),
  onOpenInExplorer: vi.fn(),
  onFocusSearch: vi.fn(),
};

describe('HomeDashboard (Phase 14 — Project-Centric Home)', () => {
  it('renders welcome hero banner, stats, and pinned projects', () => {
    render(<HomeDashboard {...defaultProps} />);

    expect(screen.getByText('Welcome to MAHI')).toBeTruthy();
    expect(screen.getByText('Discovered Projects')).toBeTruthy();
    expect(screen.getByText('8ms')).toBeTruthy();
    expect(screen.getByText('Pinned Projects')).toBeTruthy();
    // BetaRust is pinned
    expect(screen.getAllByText('BetaRust').length).toBeGreaterThan(0);
  });

  it('renders active running processes with localhost URL and stop button', () => {
    const handleStop = vi.fn();
    render(
      <HomeDashboard
        {...defaultProps}
        runningProcesses={mockProcesses}
        onStopProcess={handleStop}
      />
    );

    expect(screen.getByText('Running Projects & Processes')).toBeTruthy();
    expect(screen.getByText('npm run dev')).toBeTruthy();
    expect(screen.getByText('http://localhost:3000')).toBeTruthy();

    const stopBtn = screen.getByText('Stop');
    fireEvent.click(stopBtn);
    expect(handleStop).toHaveBeenCalledWith('proc-1');
  });

  it('renders attention ribbon when actionable findings exist', () => {
    const handleOpenWI = vi.fn();
    const attentionSummary: WorkstationIntelligenceSummary = {
      totalFindings: 2,
      criticalCount: 1,
      highCount: 1,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 0,
      topFindings: [
        {
          id: 'test-1',
          category: 'STORAGE',
          severity: 'HIGH',
          title: 'Developer cache consumes 8.4 GB',
          summary: 'Large cache in target directory',
          explanation: 'Target folder size exceeds threshold',
          evidence: [],
          sourceEngine: 'StorageIntelligence',
          recommendation: 'Clean cache',
          safeActionKind: null,
          targetId: 'D:/Code/AlphaProject',
        },
      ],
    };

    render(
      <HomeDashboard
        {...defaultProps}
        workstationSummary={attentionSummary}
        onOpenWorkstationIntelligence={handleOpenWI}
      />
    );

    expect(screen.getByText(/2 Priority Items Require Review/)).toBeTruthy();
    expect(screen.getAllByText('Developer cache consumes 8.4 GB').length).toBeGreaterThan(0);

    const reviewBtn = screen.getByText('Review Findings');
    fireEvent.click(reviewBtn);
    expect(handleOpenWI).toHaveBeenCalledTimes(1);
  });

  it('renders healthy ribbon when workstation has zero critical/high findings', () => {
    const healthySummary: WorkstationIntelligenceSummary = {
      totalFindings: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 0,
      topFindings: [],
    };

    render(
      <HomeDashboard
        {...defaultProps}
        workstationSummary={healthySummary}
      />
    );

    expect(screen.getByText('Workstation Status: Healthy')).toBeTruthy();
    expect(screen.getByText(/Toolchains, environment variables, and storage areas are operating within nominal limits/)).toBeTruthy();
  });

  it('filters project list using inline filter input', () => {
    render(<HomeDashboard {...defaultProps} />);

    // Initially both AlphaProject is in recent/discovered
    expect(screen.getAllByText('AlphaProject').length).toBeGreaterThan(0);

    const filterInput = screen.getByPlaceholderText('Filter projects...');
    fireEvent.change(filterInput, { target: { value: 'Beta' } });

    // Filtered title appears
    expect(screen.getByText('Filtered Workspaces')).toBeTruthy();
    // BetaRust should be in filtered list
    expect(screen.getAllByText('BetaRust').length).toBeGreaterThan(0);
    // AlphaProject should no longer be in filtered list
    expect(screen.queryByText('AlphaProject')).toBeNull();

    // Clear filter
    const clearBtn = screen.getByTitle('Clear filter');
    fireEvent.click(clearBtn);
    expect(screen.getAllByText('AlphaProject').length).toBeGreaterThan(0);
  });

  it('renders dynamic Workstation Telemetry card with storage and findings metric tiles', () => {
    const handleStorage = vi.fn();
    const handleHealth = vi.fn();
    const handleWI = vi.fn();
    const mockStorage: DebugStorageInfo = {
      exists: true,
      path: 'D:/target/debug',
      sizeBytes: 251658240,
      sizeMb: 240,
      sizeGb: 0.23,
    };

    render(
      <HomeDashboard
        {...defaultProps}
        debugStorage={mockStorage}
        onOpenStorageIntelligence={handleStorage}
        onOpenDeveloperHealth={handleHealth}
        onOpenWorkstationIntelligence={handleWI}
      />
    );

    expect(screen.getByText('Workstation Health')).toBeTruthy();
    expect(screen.getByText('240MB')).toBeTruthy();
    expect(screen.getAllByText('Optimal').length).toBeGreaterThan(0);

    // Click storage tile
    const storageTile = screen.getByTitle('Inspect storage telemetry');
    fireEvent.click(storageTile);
    expect(handleStorage).toHaveBeenCalledTimes(1);
  });
});
