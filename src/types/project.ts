export interface GitChangedFile {
  path: string;
  status: string;
  isStaged: boolean;
}

export interface GitProjectStatus {
  isGitRepo: boolean;
  gitRoot: string | null;
  branch: string | null;
  modifiedCount: number;
  stagedCount: number;
  untrackedCount: number;
  deletedCount: number;
  renamedCount: number;
  totalChangedCount: number;
  ahead: number | null;
  behind: number | null;
  hasUpstream: boolean;
  upstreamBranch: string | null;
  changedFiles: GitChangedFile[];
  isClean: boolean;
  error: string | null;
}

export interface ProjectScript {
  name: string;
  projectPath: string;
  ecosystem: string;
  packageManager: string;
  command?: string | null;
  description?: string | null;
}

export type ProcessStatus = 'starting' | 'running' | 'exited' | 'failed' | 'stopped';

export interface ProjectProcessInfo {
  id: string;
  projectName: string;
  projectPath: string;
  scriptName: string;
  packageManager: string;
  status: ProcessStatus;
  exitCode?: number | null;
  startedAt: number;
  outputLines: string[];
}

export interface ProjectInfo {
  name: string;
  path: string;
  projectType: string;
  technologies: string[];
  lastOpened?: number | null;
  detectedIndicators: string[];
  gitSummary?: string;
  hasDevScript?: boolean;
  scripts?: string[];
  isPinned?: boolean;
}

export interface RecentProjectEntry {
  name: string;
  path: string;
  timestamp: number;
}

export interface PinnedProjectEntry {
  path: string;
  name: string;
  pinnedAt: number;
}

export interface CustomEnvVar {
  key: string;
  value: string;
  enabled: boolean;
  isSecret: boolean;
}

export interface ProjectWorkspaceConfig {
  pinnedScripts: string[];
  envOverrides: CustomEnvVar[];
}

export interface DebugStorageInfo {
  exists: boolean;
  path: string | null;
  sizeBytes: number;
  sizeMb: number;
  sizeGb: number;
}

export interface CleanStorageResult {
  success: boolean;
  recoveredBytes: number;
  recoveredMb: number;
  recoveredGb: number;
  deletedPaths: string[];
  message: string;
}

export interface ProjectDetails {
  name: string;
  path: string;
  projectType: string;
  technologies: string[];
  frameworks: string[];
  packageManager: string | null;
  hasGit: boolean;
  hasDocker: boolean;
  importantFiles: string[];
  scripts: string[];
  lastOpened?: number | null;
  detectedIndicators: string[];
  gitStatus?: GitProjectStatus | null;
  detectedScripts?: ProjectScript[];
  isPinned?: boolean;
}


