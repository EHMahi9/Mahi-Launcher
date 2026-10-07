import { invoke, isTauri } from '@tauri-apps/api/core';
export { isTauri };
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { 
  ProjectInfo, 
  RecentProjectEntry, 
  ProjectDetails, 
  GitProjectStatus, 
  ProjectProcessInfo,
  PinnedProjectEntry,
  CustomEnvVar,
  ProjectWorkspaceConfig,
  DebugStorageInfo,
  CleanStorageResult
} from '../types/project';
import { SystemClipboardFiles } from '../types/filesystem';
import {
  WorkspaceProcessStatus,
  WorkspaceProcessOutput,
} from '../types/workspaceProcess';
import {
  WorkstationFindingsReport,
  WorkstationIntelligenceSummary,
} from '../types/intelligence';

// In-memory session cache for project intelligence
const projectDetailsCache = new Map<string, ProjectDetails>();
const mockProcesses: ProjectProcessInfo[] = [];

export function clearProjectDetailsCache(): void {
  projectDetailsCache.clear();
}

export async function runProjectScript(
  projectPath: string, 
  scriptName: string, 
  envOverrides?: CustomEnvVar[]
): Promise<ProjectProcessInfo> {
  if (!isTauri()) {
    const proc: ProjectProcessInfo = {
      id: `mock-proc-${Date.now()}-${scriptName}`,
      projectName: projectPath.split('/').filter(Boolean).pop() || 'Project',
      projectPath,
      scriptName,
      packageManager: 'pnpm',
      status: 'running',
      exitCode: null,
      startedAt: Date.now(),
      outputLines: [`[mock] Started 'pnpm run ${scriptName}'`],
    };
    mockProcesses.push(proc);
    return proc;
  }
  return await invoke<ProjectProcessInfo>('run_project_script', { 
    projectPath, 
    scriptName, 
    envOverrides: envOverrides ?? null 
  });
}

export async function stopProjectProcess(processId: string): Promise<ProjectProcessInfo> {
  if (!isTauri()) {
    const proc = mockProcesses.find((p) => p.id === processId);
    if (proc) {
      proc.status = 'stopped';
      proc.outputLines.push('[mock] Process stopped by user.');
      return proc;
    }
    throw new Error('Process not found');
  }
  return await invoke<ProjectProcessInfo>('stop_project_process', { processId });
}

export async function getRunningProcesses(): Promise<ProjectProcessInfo[]> {
  if (!isTauri()) {
    return [...mockProcesses];
  }
  return await invoke<ProjectProcessInfo[]>('get_running_processes');
}

export async function getGitStatus(path: string): Promise<GitProjectStatus> {
  if (!isTauri()) {
    return {
      isGitRepo: true,
      gitRoot: path.replace(/\\/g, '/'),
      branch: 'main',
      modifiedCount: 2,
      stagedCount: 1,
      untrackedCount: 1,
      deletedCount: 0,
      renamedCount: 0,
      totalChangedCount: 4,
      ahead: 2,
      behind: 0,
      hasUpstream: true,
      upstreamBranch: 'origin/main',
      changedFiles: [
        { path: 'src/App.tsx', status: 'M', isStaged: false },
        { path: 'src/types/project.ts', status: 'M', isStaged: true },
        { path: 'src-tauri/src/commands.rs', status: 'M', isStaged: false },
        { path: 'notes.txt', status: '??', isStaged: false },
      ],
      isClean: false,
      error: null,
    };
  }
  return await invoke<GitProjectStatus>('get_git_status', { path });
}

export async function getProjectDetails(path: string, forceRefresh = false): Promise<ProjectDetails> {
  const normalized = path.replace(/\\/g, '/');
  if (!forceRefresh && projectDetailsCache.has(normalized)) {
    return projectDetailsCache.get(normalized)!;
  }

  if (!isTauri()) {
    const mock: ProjectDetails = {
      name: normalized.split('/').filter(Boolean).pop() || 'Developer Project',
      path: normalized,
      projectType: 'Node / Web',
      technologies: ['TypeScript', 'Node.js', 'Git'],
      frameworks: ['React', 'Next.js', 'Tailwind CSS'],
      packageManager: 'pnpm',
      hasGit: true,
      hasDocker: true,
      importantFiles: ['package.json', 'tsconfig.json', 'pnpm-lock.yaml', 'README.md', '.env (present)'],
      scripts: ['dev', 'build', 'lint', 'start'],
      detectedScripts: [
        { name: 'dev', projectPath: normalized, ecosystem: 'node', packageManager: 'pnpm', command: 'next dev', description: null },
        { name: 'build', projectPath: normalized, ecosystem: 'node', packageManager: 'pnpm', command: 'next build', description: null },
        { name: 'lint', projectPath: normalized, ecosystem: 'node', packageManager: 'pnpm', command: 'next lint', description: null },
        { name: 'start', projectPath: normalized, ecosystem: 'node', packageManager: 'pnpm', command: 'next start', description: null },
      ],
      lastOpened: Date.now(),
      detectedIndicators: ['package.json', '.git', 'Dockerfile'],
      gitStatus: {
        isGitRepo: true,
        gitRoot: normalized,
        branch: 'main',
        modifiedCount: 3,
        stagedCount: 1,
        untrackedCount: 1,
        deletedCount: 0,
        renamedCount: 0,
        totalChangedCount: 5,
        ahead: 2,
        behind: 0,
        hasUpstream: true,
        upstreamBranch: 'origin/main',
        changedFiles: [
          { path: 'src/App.tsx', status: 'M', isStaged: false },
          { path: 'src/types/project.ts', status: 'M', isStaged: true },
          { path: 'src-tauri/src/commands.rs', status: 'M', isStaged: false },
        ],
        isClean: false,
        error: null,
      },
    };
    projectDetailsCache.set(normalized, mock);
    return mock;
  }

  const details = await invoke<ProjectDetails>('get_project_details', { path });
  projectDetailsCache.set(normalized, details);
  return details;
}

export async function discoverProjects(): Promise<ProjectInfo[]> {
  if (!isTauri()) {
    console.warn('Running outside Tauri environment, returning mock projects.');
    return [
      {
        name: 'NoboGhat',
        path: 'D:/Projects/NoboGhat',
        projectType: 'Java / Maven',
        technologies: ['Spring Boot', 'React', 'MySQL', 'Git'],
        lastOpened: Date.now() - 7200000,
        detectedIndicators: ['pom.xml', '.git'],
      },
      {
        name: 'Mahi Launcher',
        path: 'D:/Code/NEXT JS/Mahi Launcher',
        projectType: 'Rust',
        technologies: ['Rust', 'Tauri 2', 'React', 'TypeScript', 'Vite'],
        lastOpened: Date.now(),
        detectedIndicators: ['Cargo.toml', 'package.json'],
      },
      {
        name: 'marketplace',
        path: 'D:/Code/NEXT JS/marketplace',
        projectType: 'Node / Web',
        technologies: ['Next.js', 'React', 'TypeScript', 'Node.js'],
        lastOpened: Date.now() - 86400000,
        detectedIndicators: ['package.json'],
      },
    ];
  }
  return await invoke<ProjectInfo[]>('discover_projects');
}

const DEV_SCAN_ROOTS_STORAGE_KEY = 'mahi_configured_scan_roots';

export async function getScanRoots(): Promise<string[]> {
  if (!isTauri()) {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(DEV_SCAN_ROOTS_STORAGE_KEY) : null;
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  }
  return await invoke<string[]>('get_scan_roots');
}

export async function setScanRoots(roots: string[]): Promise<string[]> {
  if (!isTauri()) {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(DEV_SCAN_ROOTS_STORAGE_KEY, JSON.stringify(roots));
      }
    } catch {}
    return roots;
  }
  return await invoke<string[]>('set_scan_roots', { roots });
}

export async function pickScanRoot(): Promise<string | null> {
  if (!isTauri()) {
    const entered = window.prompt('Enter project directory path (Browser Preview mode):');
    return entered ? entered.trim() : null;
  }
  return await invoke<string | null>('pick_scan_root');
}

export interface OnboardingState {
  completed: boolean;
  dismissed: boolean;
  completedAt?: number | null;
}

const DEV_ONBOARDING_STORAGE_KEY = 'mahi_onboarding_state';

export async function getOnboardingState(): Promise<OnboardingState> {
  if (!isTauri()) {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(DEV_ONBOARDING_STORAGE_KEY) : null;
      if (raw) return JSON.parse(raw);
    } catch {}
    return { completed: false, dismissed: false, completedAt: null };
  }
  return await invoke<OnboardingState>('get_onboarding_state');
}

export async function setOnboardingState(state: OnboardingState): Promise<OnboardingState> {
  if (!isTauri()) {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(DEV_ONBOARDING_STORAGE_KEY, JSON.stringify(state));
      }
    } catch {}
    return state;
  }
  return await invoke<OnboardingState>('set_onboarding_state', { state });
}

export async function openPath(path: string): Promise<void> {
  if (!isTauri()) {
    console.log('[Dev] openPath called for:', path);
    throw new Error('Opening local paths requires MAHI desktop runtime.');
  }
  return await invoke('open_path', { path });
}

export async function openInExplorer(path: string): Promise<void> {
  if (!isTauri()) {
    console.log('[Dev] openInExplorer called for:', path);
    throw new Error('Windows Explorer launch requires MAHI desktop runtime.');
  }
  return await invoke('open_in_explorer', { path });
}

export async function openInTerminal(path: string): Promise<void> {
  if (!isTauri()) {
    console.log('[Dev] openInTerminal called for:', path);
    throw new Error('Terminal launch requires MAHI desktop runtime.');
  }
  return await invoke('open_in_terminal', { path });
}

export async function openInVsCode(path: string): Promise<void> {
  if (!isTauri()) {
    console.log('[Dev] openInVsCode called for:', path);
    throw new Error('VS Code launch requires MAHI desktop runtime.');
  }
  return await invoke('open_in_vscode', { path });
}

export async function checkVsCodeAvailable(): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  return await invoke<boolean>('check_vscode_available');
}

export async function getRecentProjects(): Promise<RecentProjectEntry[]> {
  if (!isTauri()) {
    return [
      { name: 'Mahi Launcher', path: 'D:/Code/NEXT JS/Mahi Launcher', timestamp: Date.now() },
      { name: 'NoboGhat', path: 'D:/Projects/NoboGhat', timestamp: Date.now() - 7200000 },
    ];
  }
  return await invoke<RecentProjectEntry[]>('get_recent_projects');
}

export async function saveRecentProject(path: string, name: string): Promise<void> {
  if (!isTauri()) {
    console.log('[Dev] saveRecentProject:', { path, name });
    return;
  }
  return await invoke('save_recent_project', { path, name });
}

export async function toggleAppVisibility(): Promise<void> {
  if (!isTauri()) {
    console.log('[Dev] toggleAppVisibility called');
    return;
  }
  return await invoke('toggle_app_visibility');
}

export async function onFocusSearchShortcut(callback: () => void): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => {};
  }
  return await listen('mahi-shortcut-focus-search', () => {
    callback();
  });
}

// ----------------- PHASE 3A: REAL FILESYSTEM IPC -----------------

import { DriveInfo, DirectoryResult, FileEntry, UserLocations, FileOperationResult, DetailedProperties, TextPreviewResult, ImagePreviewResult } from '../types/filesystem';

export async function getDrives(): Promise<DriveInfo[]> {
  if (!isTauri()) {
    return [
      {
        letter: 'C:',
        path: 'C:\\',
        volumeLabel: 'C Drive',
        fileSystem: 'NTFS',
        driveType: 'Fixed',
        totalBytes: 254903578624,
        availableBytes: 25062727680,
        usedBytes: 229840850944,
        usedPercentage: 90.1,
        isReady: true,
      },
      {
        letter: 'D:',
        path: 'D:\\',
        volumeLabel: 'D DRIVE',
        fileSystem: 'NTFS',
        driveType: 'Fixed',
        totalBytes: 255932231680,
        availableBytes: 85314572288,
        usedBytes: 170617659392,
        usedPercentage: 66.7,
        isReady: true,
      }
    ];
  }
  return await invoke<DriveInfo[]>('get_drives');
}

// Browser-mode interactive mock filesystem storage
const mockFileSystem = new Map<string, FileEntry[]>();

function getMockEntriesForPath(dirPath: string): FileEntry[] {
  const norm = normalizePath(dirPath);
  if (!mockFileSystem.has(norm)) {
    mockFileSystem.set(norm, [
      {
        name: 'node_modules',
        path: `${dirPath}\\node_modules`,
        isDirectory: true,
        isSymlink: false,
        isHidden: false,
        size: null,
        modifiedDate: Date.now() - 3600000,
        extension: null,
        fileType: 'File folder',
      },
      {
        name: 'src',
        path: `${dirPath}\\src`,
        isDirectory: true,
        isSymlink: false,
        isHidden: false,
        size: null,
        modifiedDate: Date.now() - 1800000,
        extension: null,
        fileType: 'File folder',
      },
      {
        name: 'package.json',
        path: `${dirPath}\\package.json`,
        isDirectory: false,
        isSymlink: false,
        isHidden: false,
        size: 1540,
        modifiedDate: Date.now() - 7200000,
        extension: 'json',
        fileType: 'JSON File',
      }
    ]);
  }
  return mockFileSystem.get(norm)!;
}

export async function readDirectory(path: string): Promise<DirectoryResult> {
  if (!isTauri()) {
    const cleanPath = path.replace(/\//g, '\\');
    const lastSlash = cleanPath.lastIndexOf('\\');
    const parentPath = lastSlash > 0 ? cleanPath.substring(0, lastSlash) : undefined;
    const entries = [...getMockEntriesForPath(path)];
    const dirCount = entries.filter((e) => e.isDirectory).length;
    const fileCount = entries.filter((e) => !e.isDirectory).length;
    return {
      path: cleanPath,
      parentPath,
      entries,
      totalCount: entries.length,
      dirCount,
      fileCount,
    };
  }
  return await invoke<DirectoryResult>('read_directory', { path });
}

export async function getFileMetadata(path: string): Promise<FileEntry> {
  return await invoke<FileEntry>('get_file_metadata', { path });
}

export async function getUserLocations(): Promise<UserLocations> {
  if (!isTauri()) {
    return {
      desktop: 'C:\\Users\\Admin\\Desktop',
      downloads: 'C:\\Users\\Admin\\Downloads',
      documents: 'C:\\Users\\Admin\\Documents',
      pictures: 'C:\\Users\\Admin\\Pictures',
      userProfile: 'C:\\Users\\Admin',
    };
  }
  return await invoke<UserLocations>('get_user_locations');
}

// ----------------- PHASE 3C: REAL FILE OPERATIONS IPC -----------------

export async function copyItems(sources: string[], destinationDir: string): Promise<FileOperationResult> {
  if (!isTauri()) {
    console.log('[Dev] copyItems called:', { sources, destinationDir });
    const destEntries = getMockEntriesForPath(destinationDir);
    const affected: string[] = [];
    for (const src of sources) {
      const name = src.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || 'item';
      const newPath = `${destinationDir.replace(/\//g, '\\')}\\${name}`;
      destEntries.push({
        name,
        path: newPath,
        isDirectory: !name.includes('.'),
        isSymlink: false,
        isHidden: false,
        size: 1024,
        modifiedDate: Date.now(),
        extension: name.includes('.') ? name.split('.').pop() || null : null,
        fileType: !name.includes('.') ? 'File folder' : 'File',
      });
      affected.push(newPath);
    }
    return {
      success: true,
      successCount: sources.length,
      failureCount: 0,
      errors: [],
      affectedPaths: affected,
    };
  }
  return await invoke<FileOperationResult>('copy_items', { sources, destinationDir });
}

export async function moveItems(sources: string[], destinationDir: string): Promise<FileOperationResult> {
  if (!isTauri()) {
    console.log('[Dev] moveItems called:', { sources, destinationDir });
    const destEntries = getMockEntriesForPath(destinationDir);
    const affected: string[] = [];
    const normSources = new Set(sources.map((s) => normalizePath(s)));
    for (const [key, entries] of mockFileSystem.entries()) {
      mockFileSystem.set(key, entries.filter((e) => !normSources.has(normalizePath(e.path))));
    }
    for (const src of sources) {
      const name = src.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || 'item';
      const newPath = `${destinationDir.replace(/\//g, '\\')}\\${name}`;
      destEntries.push({
        name,
        path: newPath,
        isDirectory: !name.includes('.'),
        isSymlink: false,
        isHidden: false,
        size: 1024,
        modifiedDate: Date.now(),
        extension: name.includes('.') ? name.split('.').pop() || null : null,
        fileType: !name.includes('.') ? 'File folder' : 'File',
      });
      affected.push(newPath);
    }
    return {
      success: true,
      successCount: sources.length,
      failureCount: 0,
      errors: [],
      affectedPaths: affected,
    };
  }
  return await invoke<FileOperationResult>('move_items', { sources, destinationDir });
}

export async function renameItem(path: string, newName: string): Promise<string> {
  if (!isTauri()) {
    console.log('[Dev] renameItem called:', { path, newName });
    const cleanPath = path.replace(/\//g, '\\');
    const lastSlash = cleanPath.lastIndexOf('\\');
    const parent = lastSlash >= 0 ? cleanPath.substring(0, lastSlash) : '';
    const newPath = parent ? `${parent}\\${newName}` : newName;
    if (parent) {
      const entries = getMockEntriesForPath(parent);
      const target = entries.find((e) => normalizePath(e.path) === normalizePath(path));
      if (target) {
        target.name = newName;
        target.path = newPath;
        target.modifiedDate = Date.now();
      }
    }
    return newPath;
  }
  return await invoke<string>('rename_item', { path, newName });
}

export async function deleteToRecycleBin(paths: string[]): Promise<FileOperationResult> {
  if (!isTauri()) {
    console.log('[Dev] deleteToRecycleBin called:', paths);
    const normSet = new Set(paths.map((p) => normalizePath(p)));
    for (const [key, entries] of mockFileSystem.entries()) {
      mockFileSystem.set(key, entries.filter((e) => !normSet.has(normalizePath(e.path))));
    }
    return {
      success: true,
      successCount: paths.length,
      failureCount: 0,
      errors: [],
      affectedPaths: paths,
    };
  }
  return await invoke<FileOperationResult>('delete_to_recycle_bin', { paths });
}

export async function deletePermanently(paths: string[]): Promise<FileOperationResult> {
  if (!isTauri()) {
    console.log('[Dev] deletePermanently called:', paths);
    const normSet = new Set(paths.map((p) => normalizePath(p)));
    for (const [key, entries] of mockFileSystem.entries()) {
      mockFileSystem.set(key, entries.filter((e) => !normSet.has(normalizePath(e.path))));
    }
    return {
      success: true,
      successCount: paths.length,
      failureCount: 0,
      errors: [],
      affectedPaths: paths,
    };
  }
  return await invoke<FileOperationResult>('delete_permanently', { paths });
}

export async function createDirectory(parentDir: string, name?: string): Promise<string> {
  if (!isTauri()) {
    console.log('[Dev] createDirectory called:', { parentDir, name });
    const entries = getMockEntriesForPath(parentDir);
    let folderName = name?.trim() || 'New folder';
    let counter = 1;
    while (entries.some((e) => e.name.toLowerCase() === folderName.toLowerCase())) {
      counter++;
      folderName = `New folder (${counter})`;
    }
    const cleanParent = parentDir.replace(/\//g, '\\');
    const newPath = `${cleanParent}\\${folderName}`;
    const newEntry: FileEntry = {
      name: folderName,
      path: newPath,
      isDirectory: true,
      isSymlink: false,
      isHidden: false,
      size: null,
      modifiedDate: Date.now(),
      extension: null,
      fileType: 'File folder',
    };
    entries.unshift(newEntry);
    return newPath;
  }
  return await invoke<string>('create_directory', { parentDir, name });
}

export async function getDetailedProperties(path: string): Promise<DetailedProperties> {
  if (!isTauri()) {
    const isDir = !path.includes('.');
    const fileName = path.split('\\').pop() || path;
    return {
      name: fileName,
      path,
      location: path.substring(0, path.lastIndexOf('\\')),
      fileType: isDir ? 'File folder' : 'File',
      isDirectory: isDir,
      size: isDir ? null : 1024,
      createdDate: Date.now() - 86400000,
      modifiedDate: Date.now() - 3600000,
      accessedDate: Date.now(),
      itemCount: isDir ? 5 : null,
      isReadOnly: false,
      isHidden: false,
    };
  }
  return await invoke<DetailedProperties>('get_detailed_properties', { path });
}

// ----------------- PHASE 4: PREVIEW PANEL IPC -----------------

export async function readTextPreview(path: string, maxBytes?: number): Promise<TextPreviewResult> {
  if (!isTauri()) {
    const fileName = path.split('\\').pop() || path;
    const ext = fileName.split('.').pop() || 'txt';
    return {
      content: `// Preview for ${fileName}\n// Sample loaded text in dev environment\nconst name = "MAHI";\nconsole.log("Hello from " + name);`,
      totalBytes: 120,
      isTruncated: false,
      lineCount: 4,
      language: ext,
    };
  }
  return await invoke<TextPreviewResult>('read_text_preview', { path, maxBytes });
}

export async function readImagePreview(path: string): Promise<ImagePreviewResult> {
  if (!isTauri()) {
    return {
      dataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%232f7fff" width="100" height="100"/><text x="50" y="55" fill="white" font-size="14" text-anchor="middle">Preview</text></svg>',
      mimeType: 'image/svg+xml',
      size: 512,
    };
  }
  return await invoke<ImagePreviewResult>('read_image_preview', { path });
}

// ----------------- PHASE 6: NATIVE WINDOWS INTEGRATION IPC -----------------

export async function getSystemClipboardFiles(): Promise<SystemClipboardFiles | null> {
  if (!isTauri()) {
    return null;
  }
  return await invoke<SystemClipboardFiles | null>('get_system_clipboard_files');
}

export async function setSystemClipboardFiles(paths: string[], isCut: boolean): Promise<void> {
  if (!isTauri()) {
    console.log('[Dev] setSystemClipboardFiles:', { paths, isCut });
    return;
  }
  return await invoke<void>('set_system_clipboard_files', { paths, isCut });
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (!isTauri()) {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
    return;
  }
  return await invoke<void>('copy_text_to_clipboard', { text });
}

export async function copyPathToClipboard(path: string): Promise<void> {
  const normalized = path.replace(/\//g, '\\');
  try {
    await copyTextToClipboard(normalized);
  } catch {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(normalized);
    }
  }
}

// ----------------- PHASE 7D: LOCALHOST URL OPENER & DETECTOR -----------------

import { openUrl as tauriOpenUrl } from '@tauri-apps/plugin-opener';

export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    await tauriOpenUrl(url);
  } catch (err) {
    console.warn('Failed to open URL via plugin-opener, falling back to window.open:', err);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function extractLocalhostUrls(lines: string[]): string[] {
  const urlRegex = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s'"`,)\]]*)?/gi;
  const found = new Set<string>();

  for (const line of lines) {
    // Strip ANSI escape sequences
    const cleanLine = line.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
    const matches = cleanLine.match(urlRegex);
    if (matches) {
      for (const m of matches) {
        // Standardize 0.0.0.0 to localhost for clickable browser navigation
        const normalized = m.replace('0.0.0.0', 'localhost');
        found.add(normalized);
      }
    }
  }

  return Array.from(found);
}

// ----------------- PHASE 7E: PERSONALIZED PROJECT WORKSPACE & STORAGE -----------------

export function normalizePath(path: string): string {
  if (!path) return '';
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

const DEV_PINNED_STORAGE_KEY = 'mahi_dev_pinned_projects';
const DEV_CONFIGS_STORAGE_KEY = 'mahi_dev_workspace_configs';

function getDevStoredPinned(): PinnedProjectEntry[] {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(DEV_PINNED_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[Dev] Failed to parse stored pinned projects:', e);
  }
  const initial: PinnedProjectEntry[] = [
    { path: 'D:/Code/NEXT JS/Mahi Launcher', name: 'Mahi Launcher', pinnedAt: Date.now() }
  ];
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DEV_PINNED_STORAGE_KEY, JSON.stringify(initial));
    }
  } catch {}
  return initial;
}

function setDevStoredPinned(entries: PinnedProjectEntry[]): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DEV_PINNED_STORAGE_KEY, JSON.stringify(entries));
    }
  } catch (e) {
    console.warn('[Dev] Failed to save pinned projects to localStorage:', e);
  }
}

export async function getPinnedProjects(): Promise<PinnedProjectEntry[]> {
  if (!isTauri()) {
    return getDevStoredPinned();
  }
  return await invoke<PinnedProjectEntry[]>('get_pinned_projects');
}

export async function togglePinProject(path: string, name: string): Promise<PinnedProjectEntry[]> {
  const cleanPath = path?.trim();
  if (!cleanPath) {
    throw new Error('Project path cannot be empty.');
  }

  if (!isTauri()) {
    const current = getDevStoredPinned();
    const targetNorm = normalizePath(cleanPath);
    const isCurrentlyPinned = current.some((p) => normalizePath(p.path) === targetNorm);

    let updated: PinnedProjectEntry[];
    if (isCurrentlyPinned) {
      // Unpin: remove all occurrences (guarantees duplicate prevention)
      updated = current.filter((p) => normalizePath(p.path) !== targetNorm);
    } else {
      // Pin: remove any duplicate matches first, then append exactly one
      const cleanName = name?.trim() || cleanPath.split(/[\/\\]/).filter(Boolean).pop() || 'Project';
      updated = [
        ...current.filter((p) => normalizePath(p.path) !== targetNorm),
        {
          path: cleanPath,
          name: cleanName,
          pinnedAt: Date.now(),
        }
      ];
    }
    setDevStoredPinned(updated);
    return updated;
  }

  const cleanName = name?.trim() || '';
  return await invoke<PinnedProjectEntry[]>('toggle_pin_project', { path: cleanPath, name: cleanName });
}

function getDevStoredConfigs(): Record<string, ProjectWorkspaceConfig> {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(DEV_CONFIGS_STORAGE_KEY) : null;
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  return {
    'd:/code/next js/mahi launcher': {
      pinnedScripts: ['dev', 'start'],
      envOverrides: [
        { key: 'PORT', value: '3000', enabled: true, isSecret: false }
      ]
    }
  };
}

function setDevStoredConfigs(configs: Record<string, ProjectWorkspaceConfig>): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DEV_CONFIGS_STORAGE_KEY, JSON.stringify(configs));
    }
  } catch {}
}

export async function getProjectWorkspaceConfig(projectPath: string): Promise<ProjectWorkspaceConfig> {
  if (!isTauri()) {
    const configs = getDevStoredConfigs();
    const norm = normalizePath(projectPath);
    return configs[norm] || {
      pinnedScripts: ['dev', 'start'],
      envOverrides: [
        { key: 'PORT', value: '3000', enabled: true, isSecret: false }
      ]
    };
  }
  return await invoke<ProjectWorkspaceConfig>('get_project_workspace_config', { projectPath });
}

export async function saveProjectWorkspaceConfig(
  projectPath: string, 
  config: ProjectWorkspaceConfig
): Promise<ProjectWorkspaceConfig> {
  if (!isTauri()) {
    const configs = getDevStoredConfigs();
    const norm = normalizePath(projectPath);
    configs[norm] = config;
    setDevStoredConfigs(configs);
    return config;
  }
  return await invoke<ProjectWorkspaceConfig>('save_project_workspace_config', { projectPath, config });
}

export async function togglePinScript(projectPath: string, scriptName: string): Promise<string[]> {
  if (!isTauri()) {
    const config = await getProjectWorkspaceConfig(projectPath);
    const existingIndex = config.pinnedScripts.indexOf(scriptName);
    if (existingIndex >= 0) {
      config.pinnedScripts.splice(existingIndex, 1);
    } else {
      config.pinnedScripts.push(scriptName);
    }
    await saveProjectWorkspaceConfig(projectPath, config);
    return config.pinnedScripts;
  }
  return await invoke<string[]>('toggle_pin_script', { projectPath, scriptName });
}

export async function getDebugStorageInfo(): Promise<DebugStorageInfo> {
  if (!isTauri()) {
    return {
      exists: true,
      path: 'D:\\Code\\NEXT JS\\Mahi Launcher\\src-tauri\\target\\debug',
      sizeBytes: 0,
      sizeMb: 0,
      sizeGb: 0
    };
  }
  return await invoke<DebugStorageInfo>('get_debug_storage_info');
}

export async function cleanDebugArtifacts(): Promise<CleanStorageResult> {
  if (!isTauri()) {
    return {
      success: true,
      recoveredBytes: 0,
      recoveredMb: 0,
      recoveredGb: 0,
      deletedPaths: [],
      message: '[Dev] Clean debug artifacts simulated.'
    };
  }
  return await invoke<CleanStorageResult>('clean_debug_artifacts');
}

// ----------------- PHASE 8A: STORAGE INTELLIGENCE ENGINE -----------------

import type { StorageIntelligenceOverview, StorageDriveReport } from '../types/storage';

export async function getStorageOverview(forceRefresh = false): Promise<StorageIntelligenceOverview> {
  if (!isTauri()) {
    return {
      availableDrives: ['C', 'D'],
      scannedAt: Date.now(),
      reports: {
        C: {
          driveLetter: 'C',
          totalBytes: 254903578624,
          usedBytes: 192545992704,
          freeBytes: 62357585920,
          freePercentage: 24.5,
          usedPercentage: 75.5,
          categories: [
            { category: 'Applications', label: 'Applications', bytes: 49283072000, formattedSize: '45.9 GB', percentage: 25.6, itemCount: 142, description: 'Installed applications and Windows software packages.' },
            { category: 'User Files', label: 'User Files', bytes: 95133696000, formattedSize: '88.6 GB', percentage: 49.4, itemCount: 5120, description: 'User documents, desktop, downloads, and app settings.' },
            { category: 'Windows/System', label: 'Windows/System', bytes: 41339187200, formattedSize: '38.5 GB', percentage: 21.5, itemCount: 820, description: 'Windows system binaries, driver store, and component cache.' },
            { category: 'Developer Data', label: 'Developer Data', bytes: 14817638400, formattedSize: '13.8 GB', percentage: 7.7, itemCount: 34, description: 'Caches for Cargo, npm, gradle, and Python packages.' },
            { category: 'Temporary Files', label: 'Temporary Files', bytes: 2574254080, formattedSize: '2.4 GB', percentage: 1.3, itemCount: 1840, description: 'User temp directories and transient logs.' },
          ],
          topDirectories: [
            { path: 'C:\\Program Files', name: 'Program Files', category: 'Applications', bytes: 45097156608, formattedSize: '42.0 GB', classification: 'SYSTEM_MANAGED', reason: 'Installed 64-bit software. Manage via Windows Installed Apps.', cleanupPotential: 'Use official uninstaller.', isSensitiveMasked: false },
            { path: 'C:\\Windows\\WinSxS', name: 'WinSxS Component Store', category: 'Windows/System', bytes: 15461882880, formattedSize: '14.4 GB', classification: 'SYSTEM_MANAGED', reason: 'Windows component store for system updates and rollbacks.', cleanupPotential: 'Dism.exe component cleanup.', isSensitiveMasked: false },
            { path: 'C:\\Users\\Admin\\.cargo', name: '.cargo Package Cache', category: 'Developer Data', bytes: 3640655872, formattedSize: '3.4 GB', classification: 'SAFE_TO_CLEAN', reason: 'Rust crate registry index and downloaded .crate archives.', cleanupPotential: 'Safe to clear; will re-download when needed.', isSensitiveMasked: false },
            { path: 'C:\\Users\\Admin\\AppData\\Local\\Temp', name: 'Local Temp Files', category: 'Temporary Files', bytes: 2574254080, formattedSize: '2.4 GB', classification: 'SAFE_TO_CLEAN', reason: 'Temporary setup and log files.', cleanupPotential: 'Safe to delete unlocked files.', isSensitiveMasked: false },
          ],
          largeFiles: [
            { path: 'C:\\Users\\Admin\\Downloads\\Windows11_23H2.iso', name: 'Windows11_23H2.iso', category: 'Disk Images', bytes: 6442450944, formattedSize: '6.0 GB', extension: 'iso', classification: 'REVIEW_REQUIRED', reason: 'OS Installation image.', isSensitiveMasked: false },
          ],
          developerStorage: [
            { name: 'Cargo Package Cache', path: 'C:\\Users\\Admin\\.cargo', ecosystem: 'Rust / Cargo', toolOrProject: 'cargo', bytes: 3640655872, formattedSize: '3.4 GB', exists: true, purpose: 'Downloaded crate packages and registry.', isRebuildable: true, cleanupPotential: 'Safe to clean; cargo re-downloads automatically.', relocationPotential: 'Set CARGO_HOME environment variable to D: drive.', classification: 'SAFE_TO_CLEAN' },
            { name: 'npm Global Cache', path: 'C:\\Users\\Admin\\AppData\\Local\\npm-cache', ecosystem: 'Node.js / npm', toolOrProject: 'npm', bytes: 1288490188, formattedSize: '1.2 GB', exists: true, purpose: 'Downloaded npm tarballs.', isRebuildable: true, cleanupPotential: 'Safe to prune via npm cache clean --force.', relocationPotential: 'npm config set cache D:\\npm-cache', classification: 'SAFE_TO_CLEAN' },
          ],
          applicationStorage: [
            { name: 'LDPlayer Android Emulator', installPath: 'C:\\LDPlayer', bytes: 30386585600, formattedSize: '28.3 GB', isRelocatable: true, suggestedMethod: 'Move virtual disks via LDMultiPlayer settings.', classification: 'RELOCATABLE', reason: 'Virtual disk images (vmdk) consuming primary drive space.' }
          ],
          relocationCandidates: [
            { title: 'Relocate Cargo Home to D: Drive', currentPath: 'C:\\Users\\Admin\\.cargo', suggestedDestination: 'D:\\Developer\\.cargo', bytes: 3640655872, formattedSize: '3.4 GB', method: 'Set CARGO_HOME to D:\\Developer\\.cargo', risk: 'LOW', rationale: 'Cargo seamlessly uses the D: path across all projects without modifying repo configurations.' },
            { title: 'Move LDPlayer Virtual Disks to D: Drive', currentPath: 'C:\\LDPlayer', suggestedDestination: 'D:\\Emulators\\LDPlayer', bytes: 30386585600, formattedSize: '28.3 GB', method: 'Supported relocation in LDMultiPlayer disk settings', risk: 'LOW', rationale: 'Virtual disk images are large contiguous files ideal for secondary high-capacity storage.' },
          ],
          recoverableSpace: {
            definitelyReclaimableBytes: 6214909952,
            definitelyReclaimableFormatted: '5.8 GB',
            potentiallyReclaimableBytes: 15784181760,
            potentiallyReclaimableFormatted: '14.7 GB',
            relocatableBytes: 34027241472,
            relocatableFormatted: '31.7 GB',
            reviewRequiredBytes: 95133696000,
            reviewRequiredFormatted: '88.6 GB'
          },
          recommendations: [
            { id: 'rec-1', title: 'Cargo Crate Cache — 3.4 GB', category: 'Developer Data', bytes: 3640655872, formattedSize: '3.4 GB', classification: 'SAFE_TO_CLEAN', isSafeToClean: true, risk: 'LOW', why: 'Downloaded compiler crates and registry index. Rebuildable: Yes.', futureAction: 'Safe to purge; cargo re-fetches dependencies on next cargo build.', path: 'C:\\Users\\Admin\\.cargo' },
            { id: 'rec-2', title: 'Relocate LDPlayer to D: Drive — 28.3 GB', category: 'Relocatable', bytes: 30386585600, formattedSize: '28.3 GB', classification: 'RELOCATABLE', isSafeToClean: false, risk: 'LOW', why: 'Android emulator virtual disk images consume valuable space on OS drive C:.', futureAction: 'Change disk location in LDMultiPlayer settings.', path: 'C:\\LDPlayer' },
            { id: 'rec-3', title: 'User Temp Files — 2.4 GB', category: 'Temporary Files', bytes: 2574254080, formattedSize: '2.4 GB', classification: 'SAFE_TO_CLEAN', isSafeToClean: true, risk: 'LOW', why: 'Temporary runtime installation files and session logs.', futureAction: 'Safe to clean unreferenced files.', path: 'C:\\Users\\Admin\\AppData\\Local\\Temp' },
          ],
          scanTimestamp: Date.now()
        },
        D: {
          driveLetter: 'D',
          totalBytes: 255932231680,
          usedBytes: 195540807680,
          freeBytes: 60391424000,
          freePercentage: 23.6,
          usedPercentage: 76.4,
          categories: [
            { category: 'Developer Data', label: 'Developer Data', bytes: 85899345920, formattedSize: '80.0 GB', percentage: 43.9, itemCount: 120, description: 'Next.js projects, node_modules, Rust targets, and Git repositories.' },
            { category: 'User Files', label: 'User Files', bytes: 64424509440, formattedSize: '60.0 GB', percentage: 32.9, itemCount: 240, description: 'Personal project archives and downloaded assets.' },
            { category: 'Applications & Data', label: 'Applications & Data', bytes: 45216952320, formattedSize: '42.1 GB', percentage: 23.1, itemCount: 88, description: 'Tools and workspace utilities.' },
          ],
          topDirectories: [
            { path: 'D:\\Code\\NEXT JS', name: 'NEXT JS Projects', category: 'Developer Data', bytes: 75161927680, formattedSize: '70.0 GB', classification: 'REVIEW_REQUIRED', reason: 'Active web and desktop software projects.', cleanupPotential: 'Clean old node_modules or cargo target debug folders.', isSensitiveMasked: false },
          ],
          largeFiles: [],
          developerStorage: [
            { name: 'Mahi Launcher (target/debug)', path: 'D:\\Code\\NEXT JS\\Mahi Launcher\\src-tauri\\target', ecosystem: 'Rust / Cargo', toolOrProject: 'Mahi Launcher', bytes: 8365476, formattedSize: '8.0 MB', exists: true, purpose: 'Rust compiler build cache.', isRebuildable: true, cleanupPotential: 'Debug build folder can be cleaned safely.', relocationPotential: 'Local project artifact.', classification: 'SAFE_TO_CLEAN' }
          ],
          applicationStorage: [],
          relocationCandidates: [],
          recoverableSpace: {
            definitelyReclaimableBytes: 8365476,
            definitelyReclaimableFormatted: '8.0 MB',
            potentiallyReclaimableBytes: 8589934592,
            potentiallyReclaimableFormatted: '8.0 GB',
            relocatableBytes: 0,
            relocatableFormatted: '0 B',
            reviewRequiredBytes: 64424509440,
            reviewRequiredFormatted: '60.0 GB'
          },
          recommendations: [
            { id: 'rec-d-1', title: 'Target Debug Artifacts — 8.0 MB', category: 'Developer Data', bytes: 8365476, formattedSize: '8.0 MB', classification: 'SAFE_TO_CLEAN', isSafeToClean: true, risk: 'LOW', why: 'Compilation cache. Rebuildable: Yes.', futureAction: 'Safe to clean.', path: 'D:\\Code\\NEXT JS\\Mahi Launcher\\src-tauri\\target' }
          ],
          scanTimestamp: Date.now()
        }
      }
    };
  }

  return await invoke<StorageIntelligenceOverview>('get_storage_overview', { forceRefresh });
}

export async function scanDriveStorageReport(driveLetter: string, forceRefresh = false): Promise<StorageDriveReport> {
  if (!isTauri()) {
    const overview = await getStorageOverview(forceRefresh);
    return overview.reports[driveLetter.toUpperCase()] || overview.reports['C'];
  }
  return await invoke<StorageDriveReport>('scan_drive_storage_report', { driveLetter, forceRefresh });
}

// ----------------- PHASE 8B: SAFE CLEANUP ENGINE -----------------

import type { CleanupPreview, CleanupExecutionResult, CleanupHistoryEntry } from '../types/storage';

export async function getCleanupPreview(targetPaths: string[]): Promise<CleanupPreview> {
  if (!isTauri()) {
    return {
      targets: targetPaths.map((p, idx) => ({
        id: `mock-target-${idx}`,
        name: p.split(/[/\\]/).pop() || p,
        path: p,
        category: 'Safe Developer & Temp Cache',
        bytes: 104857600,
        formattedSize: '100.0 MB',
        reason: 'Rebuildable cache or temporary files.',
        isRebuildable: true,
        classification: 'SAFE_TO_CLEAN'
      })),
      totalBytes: targetPaths.length * 104857600,
      totalFormatted: `${(targetPaths.length * 100).toFixed(1)} MB`,
      targetCount: targetPaths.length,
      containsUnsafeItems: false,
      warnings: []
    };
  }
  return await invoke<CleanupPreview>('get_cleanup_preview', { targetPaths });
}

export async function executeSafeCleanup(targetPaths: string[]): Promise<CleanupExecutionResult> {
  if (!isTauri()) {
    return {
      success: true,
      recoveredBytes: targetPaths.length * 104857600,
      recoveredFormatted: `${(targetPaths.length * 100).toFixed(1)} MB`,
      cleanedItems: targetPaths.length * 12,
      skippedFiles: 0,
      errors: [],
      affectedDrives: ['C'],
      timestamp: Date.now()
    };
  }
  return await invoke<CleanupExecutionResult>('execute_safe_cleanup', { targetPaths });
}

export async function getCleanupHistory(): Promise<CleanupHistoryEntry[]> {
  if (!isTauri()) {
    return [
      {
        id: 'mock-hist-1',
        timestamp: Date.now() - 3600000,
        formattedTime: '10:30 UTC',
        category: 'Safe Developer & Temp Cleanup',
        bytesReclaimed: 2811919569,
        formattedSize: '2.62 GB',
        cleanedItems: 482,
        targetsSummary: ['Rust / Tauri debug compiler artifacts (2.62 GB)']
      }
    ];
  }
  return await invoke<CleanupHistoryEntry[]>('get_cleanup_history');
}

// ----------------- PHASE 8C: GUIDED STORAGE RELOCATION ASSISTANT -----------------

import type {
  GuidedRelocationCandidate,
  RelocationPreview,
  RelocationResult,
  RelocationHistoryEntry,
} from '../types/storage';

export async function detectGuidedRelocationCandidates(): Promise<GuidedRelocationCandidate[]> {
  if (!isTauri()) {
    // Mock candidates for web preview
    return [
      {
        id: 'reloc-huggingface',
        name: 'Hugging Face Model Cache',
        category: 'HUGGING_FACE',
        categoryLabel: 'Hugging Face Cache',
        currentPath: 'C:\\Users\\Admin\\.cache\\huggingface',
        suggestedDestination: 'D:\\AI\\huggingface',
        bytes: 32212254720,
        formattedSize: '30.00 GB',
        method: 'Set HF_HOME environment variable to D:\\AI\\huggingface and copy existing cache.',
        risk: 'LOW',
        whySafe: 'Hugging Face Hub natively respects HF_HOME. Models are purely data blobs — no OS integration.',
        whatChanges: 'HF_HOME system environment variable is updated to D:\\AI\\huggingface. All future downloads go to D:.',
        whatStaysSame: 'All project code, Python scripts, and package imports remain unchanged.',
        envChangesDescription: 'System environment variable HF_HOME = D:\\AI\\huggingface',
        requiresRestart: true,
        envVarName: 'HF_HOME',
      },
      {
        id: 'reloc-cargo-home',
        name: 'Cargo Home (Crates, Registry & Binaries)',
        category: 'CARGO_HOME',
        categoryLabel: 'Cargo Home',
        currentPath: 'C:\\Users\\Admin\\.cargo',
        suggestedDestination: 'D:\\Developer\\.cargo',
        bytes: 3640655872,
        formattedSize: '3.39 GB',
        method: 'Set CARGO_HOME system environment variable to D:\\Developer\\.cargo. Copy existing .cargo directory to D:. Verify with "cargo --version".',
        risk: 'LOW',
        whySafe: 'Cargo natively respects CARGO_HOME. No project source code or release binaries are touched.',
        whatChanges: 'CARGO_HOME system environment variable updated. Registry, crate cache, and installed binaries move to D:.',
        whatStaysSame: 'Cargo.toml, Cargo.lock, src/, and all target/release artifacts remain in their project directories.',
        envChangesDescription: 'System environment variable CARGO_HOME = D:\\Developer\\.cargo',
        requiresRestart: true,
        envVarName: 'CARGO_HOME',
      },
    ];
  }
  return await invoke<GuidedRelocationCandidate[]>('detect_guided_relocation_candidates');
}

export async function getRelocationPreview(
  candidateId: string,
  destinationPath: string
): Promise<RelocationPreview> {
  if (!isTauri()) {
    return {
      candidateId,
      candidateName: 'Mock Candidate',
      currentPath: 'C:\\Users\\Admin\\.cache\\huggingface',
      destinationPath,
      bytesToMove: 32212254720,
      formattedSize: '30.00 GB',
      destinationDriveFreeBytes: 64424509440,
      destinationFreeFormatted: '60.00 GB',
      hasAdequateSpace: true,
      whatChanges: 'HF_HOME system environment variable is updated.',
      whatStaysSame: 'All project code and scripts remain unchanged.',
      envChangesDescription: `System environment variable HF_HOME = ${destinationPath}`,
      requiresRestart: true,
      method: 'Set HF_HOME environment variable and copy cache.',
      risk: 'LOW',
      estimatedCRecoveryFormatted: '30.00 GB',
      warnings: [],
    };
  }
  return await invoke<RelocationPreview>('get_relocation_preview', { candidateId, destinationPath });
}

export async function executeGuidedRelocation(
  candidateId: string,
  destinationPath: string,
  confirmEnvChanges: boolean
): Promise<RelocationResult> {
  if (!isTauri()) {
    return {
      success: true,
      candidateId,
      source: 'C:\\Users\\Admin\\.cache\\huggingface',
      destination: destinationPath,
      bytesMoved: 32212254720,
      formattedSize: '30.00 GB',
      envChangesMade: [`HF_HOME = ${destinationPath}`],
      verificationPassed: true,
      rollbackPerformed: false,
      errors: [],
      timestamp: Date.now(),
      formattedTime: '10:00 UTC (approx. year 2026)',
    };
  }
  return await invoke<RelocationResult>('execute_guided_relocation', {
    candidateId,
    destinationPath,
    confirmEnvChanges,
  });
}

export async function getRelocationHistory(): Promise<RelocationHistoryEntry[]> {
  if (!isTauri()) {
    return [
      {
        id: 'reloc-hist-mock-1',
        timestamp: Date.now() - 7200000,
        formattedTime: '08:00 UTC (approx. year 2026)',
        category: 'Cargo Home',
        source: 'C:\\Users\\Admin\\.cargo',
        destination: 'D:\\Developer\\.cargo',
        bytesMoved: 3640655872,
        formattedSize: '3.39 GB',
        success: true,
        method: 'Set CARGO_HOME environment variable',
        rollbackPerformed: false,
        envChangesMade: [],
        isRecoverable: true,
      },
    ];
  }
  return await invoke<RelocationHistoryEntry[]>('get_relocation_history');
}

export async function cancelRelocation(candidateId: string): Promise<void> {
  if (!isTauri()) {
    console.log('[Mock] Cancelled relocation', candidateId);
    return;
  }
  return await invoke<void>('cancel_relocation', { candidateId });
}

import { RelocationProgressPayload } from '../types/storage';

export async function listenToRelocationProgress(
  callback: (payload: RelocationProgressPayload) => void
): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => {};
  }
  return await listen<RelocationProgressPayload>('relocation-progress', (event) => {
    callback(event.payload);
  });
}


export async function executeRelocationRestore(entryId: string, confirmEnvChanges: boolean): Promise<RelocationResult> {
  if (!isTauri()) {
    return {
      success: true,
      candidateId: entryId,
      source: 'D:\\MAHI_Storage\\HuggingFace',
      destination: 'C:\\Users\\User\\.cache\\huggingface',
      bytesMoved: 1024 * 1024 * 1024 * 2,
      formattedSize: '2.00 GB',
      filesRestored: 42,
      verificationMethod: 'Two-level verification: 100% file existence and size parity, with chunked bitwise byte comparison',
      configChanged: confirmEnvChanges,
      oldCopyRemoved: true,
      envChangesMade: confirmEnvChanges ? ['Unset HF_HOME'] : [],
      verificationPassed: true,
      rollbackPerformed: false,
      errors: [],
      timestamp: Date.now(),
      formattedTime: 'Just now',
    };
  }
  return await invoke<RelocationResult>('execute_relocation_restore', { entryId, confirmEnvChanges });
}

import { DeveloperEnvironmentReport, ProjectCompatibilityCheck } from '../types/health';

export async function runDeveloperEnvironmentAudit(
  projectPaths?: string[]
): Promise<DeveloperEnvironmentReport> {
  if (!isTauri()) {
    return {
      generatedAt: Date.now(),
      healthScore: 92,
      overallStatus: 'HEALTHY',
      healthyCount: 14,
      infoCount: 3,
      warningCount: 1,
      criticalCount: 0,
      tools: [
        {
          id: 'git',
          name: 'Git',
          category: 'VCS',
          status: 'HEALTHY',
          isInstalled: true,
          version: '2.54.0.windows.1',
          executablePath: 'C:\\Program Files\\Git\\cmd\\git.exe',
          detectionMethod: 'Resolved via system PATH',
          shadowedCount: 0,
        },
        {
          id: 'node',
          name: 'Node.js',
          category: 'RUNTIME',
          status: 'HEALTHY',
          isInstalled: true,
          version: '24.16.0',
          executablePath: 'C:\\Program Files\\nodejs\\node.exe',
          detectionMethod: 'Resolved via system PATH',
          shadowedCount: 0,
        },
        {
          id: 'npm',
          name: 'npm',
          category: 'PACKAGE_MANAGER',
          status: 'HEALTHY',
          isInstalled: true,
          version: '10.8.2',
          executablePath: 'C:\\Program Files\\nodejs\\npm.cmd',
          detectionMethod: 'Resolved via system PATH',
          shadowedCount: 0,
        },
        {
          id: 'pnpm',
          name: 'pnpm',
          category: 'PACKAGE_MANAGER',
          status: 'HEALTHY',
          isInstalled: true,
          version: '9.15.4',
          executablePath: 'C:\\Users\\Admin\\AppData\\Local\\pnpm\\pnpm.cmd',
          detectionMethod: 'Resolved via system PATH',
          shadowedCount: 0,
        },
        {
          id: 'python',
          name: 'Python',
          category: 'RUNTIME',
          status: 'HEALTHY',
          isInstalled: true,
          version: '3.10.11',
          executablePath: 'C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python310\\python.exe',
          detectionMethod: 'Resolved via system PATH',
          shadowedCount: 1,
          notes: 'Multiple installations detected in PATH (2)',
        },
        {
          id: 'rust',
          name: 'Rust (rustc)',
          category: 'RUNTIME',
          status: 'INFO',
          isInstalled: true,
          version: '1.84.0',
          executablePath: 'C:\\Users\\Admin\\.cargo\\bin\\rustc.exe',
          detectionMethod: 'Discovered in standard installation directory (not currently in PATH)',
          shadowedCount: 0,
          notes: 'Executable is installed but its folder is not in PATH',
        },
        {
          id: 'cargo',
          name: 'Cargo',
          category: 'PACKAGE_MANAGER',
          status: 'INFO',
          isInstalled: true,
          version: '1.84.0',
          executablePath: 'C:\\Users\\Admin\\.cargo\\bin\\cargo.exe',
          detectionMethod: 'Discovered in standard installation directory (not currently in PATH)',
          shadowedCount: 0,
          notes: 'Executable is installed but its folder is not in PATH',
        },
        {
          id: 'java',
          name: 'Java Runtime',
          category: 'RUNTIME',
          status: 'HEALTHY',
          isInstalled: true,
          version: '25',
          executablePath: 'C:\\Program Files\\Eclipse Adoptium\\jdk-25\\bin\\java.exe',
          detectionMethod: 'Resolved via system PATH',
          shadowedCount: 0,
        },
        {
          id: 'vscode',
          name: 'Visual Studio Code',
          category: 'EDITOR',
          status: 'HEALTHY',
          isInstalled: true,
          version: '1.98.0',
          executablePath: 'C:\\Users\\Admin\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd',
          detectionMethod: 'Resolved via system PATH',
          shadowedCount: 0,
        },
      ],
      pathDiagnostics: {
        totalEntries: 24,
        validEntries: 23,
        missingEntries: 1,
        duplicateEntries: 1,
        developerEntries: 11,
        entries: [
          {
            path: 'C:\\Program Files\\nodejs',
            index: 0,
            exists: true,
            isDuplicate: false,
            category: 'Developer Toolchain',
            detectedTool: 'Node.js',
            status: 'HEALTHY',
          },
          {
            path: 'C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python310',
            index: 1,
            exists: true,
            isDuplicate: false,
            category: 'Developer Toolchain',
            detectedTool: 'Python',
            status: 'HEALTHY',
          },
          {
            path: 'C:\\Users\\Admin\\OldTools\\stale_bin',
            index: 2,
            exists: false,
            isDuplicate: false,
            category: 'Developer Toolchain',
            status: 'WARNING',
            issue: 'Directory does not exist on disk (stale PATH entry)',
          },
        ],
        conflicts: [
          {
            executable: 'python.exe',
            activePath: 'C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python310\\python.exe',
            activeVersion: '3.10.11',
            shadowedPaths: [
              {
                path: 'C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python314\\python.exe',
                version: '3.14.0',
                pathIndex: 8,
              }
            ],
            explanation: "2 instances of 'python.exe' found in PATH. Active binary is Python 3.10; Python 3.14 is shadowed.",
            severity: 'INFO',
          }
        ],
        overallStatus: 'WARNING',
      },
      multipleVersions: [
        {
          toolId: 'python',
          toolName: 'Python',
          versions: [
            {
              version: '3.14',
              path: 'C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python314\\python.exe',
              source: 'Windows Python Launcher (py.exe)',
              isActive: true,
            },
            {
              version: '3.10',
              path: 'C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python310\\python.exe',
              source: 'Windows Python Launcher (py.exe)',
              isActive: false,
            }
          ],
          activeVersion: '3.14',
          status: 'HEALTHY',
          classification: 'Healthy — Managed cleanly by Windows Python Launcher',
          explanation: 'Multiple Python versions are installed and registered with py.exe launcher.',
          suggestedAction: 'Use py -3.x or virtual environments per project.',
        }
      ],
      projectCompatibility: [
        {
          projectPath: 'd:\\Code\\NEXT JS\\Mahi Launcher',
          projectName: 'Mahi Launcher',
          ecosystem: 'Node.js + Rust',
          overallStatus: 'HEALTHY',
          summary: 'Workstation satisfies all project requirements.',
          requirements: [
            {
              target: 'Package Manager Lockfile (pnpm)',
              required: 'pnpm installed on machine',
              machineInstalled: '9.15.4',
              satisfied: true,
              status: 'HEALTHY',
              notes: 'pnpm-lock.yaml is present in project',
            },
            {
              target: 'Rust Toolchain',
              required: 'Cargo & rustc installed',
              machineInstalled: '1.84.0',
              satisfied: true,
              status: 'HEALTHY',
              notes: 'Cargo.toml manifest present',
            }
          ]
        }
      ],
      environmentVariables: [
        {
          name: 'JAVA_HOME',
          isSet: true,
          sanitizedValue: 'C:\\Program Files\\Eclipse Adoptium\\jdk-25',
          targetExists: true,
          matchesActiveTool: true,
          status: 'HEALTHY',
          explanation: 'JAVA_HOME: Java Development Kit installation directory',
          recommendation: 'Configuration is valid.',
        },
        {
          name: 'GOPATH',
          isSet: true,
          sanitizedValue: 'C:\\Users\\Admin\\go',
          targetExists: false,
          matchesActiveTool: false,
          status: 'WARNING',
          explanation: 'GOPATH is set to C:\\Users\\Admin\\go, but this folder does not exist.',
          recommendation: 'Create the directory or unset GOPATH if Go modules are used.',
        }
      ],
      developerStorage: [],
      findings: [
        {
          id: 'path-stale-2',
          title: 'Stale PATH Directory',
          category: 'path',
          severity: 'WARNING',
          evidence: "Directory does not exist: 'C:\\Users\\Admin\\OldTools\\stale_bin'",
          explanation: 'Stale PATH directories cause lookup delays.',
          suggestedAction: 'Remove stale directory from Environment Variables.',
        }
      ]
    };
  }
  return await invoke<DeveloperEnvironmentReport>('run_developer_environment_audit', { projectPaths });
}

export async function auditProjectCompatibility(
  projectPath: string
): Promise<ProjectCompatibilityCheck> {
  if (!isTauri()) {
    return {
      projectPath,
      projectName: projectPath.split('\\').pop() || 'Project',
      ecosystem: 'Node.js',
      overallStatus: 'HEALTHY',
      summary: 'Project requirements verified.',
      requirements: [
        {
          target: 'Node.js Runtime',
          required: '>= 18.0.0',
          machineInstalled: '24.16.0',
          satisfied: true,
          status: 'HEALTHY',
          notes: 'Defined in package.json engines.node',
        }
      ]
    };
  }
  return await invoke<ProjectCompatibilityCheck>('audit_project_compatibility', { projectPath });
}

import {
  RepairPlan,
  RepairExecutionResult,
  RepairHistoryEntry,
  RestorePreview,
} from '../types/repair';

export async function getAvailableRepairs(): Promise<RepairPlan[]> {
  if (!isTauri()) {
    return [
      {
        id: 'repair-dup-path-14',
        category: 'DUPLICATE_USER_PATH',
        affectedItem: 'User PATH',
        currentState: "Duplicate entry at position 14: 'C:\\Users\\Admin\\.cargo\\bin'",
        proposedState: 'Remove duplicate entry at position 14',
        reason: 'Exact duplicate path entry detected in User PATH.',
        evidence: "'C:\\Users\\Admin\\.cargo\\bin' already appears at position 0 in User PATH.",
        risk: 'LOW',
        reversible: true,
        actions: [
          'Create backup snapshot of User PATH in MAHI storage',
          'Remove duplicate instance at index 14 from HKCU\\Environment\\Path',
          'Verify remaining User PATH retains first occurrence at index 0',
        ],
        expectedResult: 'Duplicate entry removed; original entry preserved at index 0.',
        rollbackPlan: 'Restore previous User PATH value from MAHI configuration snapshot.',
        available: true,
      },
      {
        id: 'repair-stale-path-8',
        category: 'STALE_USER_PATH',
        affectedItem: 'User PATH',
        currentState: "Missing folder at position 8: 'C:\\Users\\Admin\\OldTools\\stale_bin'",
        proposedState: 'Remove stale entry at position 8',
        reason: 'Directory does not exist on disk. Stale developer path remnants slow down resolution.',
        evidence: "Directory does not exist on disk: 'C:\\Users\\Admin\\OldTools\\stale_bin'",
        risk: 'LOW',
        reversible: true,
        actions: [
          'Create backup snapshot of User PATH in MAHI storage',
          'Remove stale entry at index 8 from HKCU\\Environment\\Path',
          'Verify User PATH without the stale entry',
        ],
        expectedResult: 'Stale non-existent directory removed from User PATH.',
        rollbackPlan: 'Restore previous User PATH value from MAHI configuration snapshot.',
        available: true,
      },
      {
        id: 'repair-env-GOPATH',
        category: 'BROKEN_DEVELOPER_ENV',
        affectedItem: 'GOPATH',
        currentState: "GOPATH = 'C:\\Users\\Admin\\missing_go' (missing path)",
        proposedState: "Update GOPATH = 'C:\\Users\\Admin\\go'",
        reason: 'GOPATH points to a folder that does not exist.',
        evidence: "Found standard Go workspace directory at 'C:\\Users\\Admin\\go'",
        risk: 'MEDIUM',
        reversible: true,
        actions: [
          'Create backup snapshot of User variable GOPATH in MAHI storage',
          "Update HKCU\\Environment\\GOPATH to verified directory 'C:\\Users\\Admin\\go'",
          'Verify GOPATH exists on disk and reflects in User Environment',
        ],
        expectedResult: 'GOPATH updated to existing developer installation directory.',
        rollbackPlan: 'Restore GOPATH to previous value from MAHI snapshot.',
        available: true,
      },
    ];
  }
  return await invoke<RepairPlan[]>('get_available_repairs');
}

export async function executeDeveloperEnvironmentRepair(
  repairId: string
): Promise<RepairExecutionResult> {
  if (!isTauri()) {
    return {
      success: true,
      repairId,
      category: 'DUPLICATE_USER_PATH',
      affectedItem: 'User PATH',
      previousValuePreview: "15 entries (contained duplicate at index 14)",
      newValuePreview: "14 entries (duplicate index 14 removed)",
      verificationPassed: true,
      verificationDetails: "Verified duplicate removed. Original occurrence preserved at index 0.",
      rollbackPerformed: false,
      snapshotId: `snap-${repairId}-${Date.now()}`,
      message: "User PATH repair verified successfully. New processes will use the updated configuration.",
      timestamp: Date.now(),
    };
  }
  return await invoke<RepairExecutionResult>('execute_developer_environment_repair', { repairId });
}

export async function getRepairHistory(): Promise<RepairHistoryEntry[]> {
  if (!isTauri()) {
    return [
      {
        id: 'hist-mock-1',
        repairId: 'repair-dup-path-14',
        category: 'DUPLICATE_USER_PATH',
        target: 'User PATH',
        timestamp: Date.now() - 3600000,
        formattedTime: '1 hour ago',
        status: 'COMPLETED',
        description: "Removed duplicate entry at position 14: 'C:\\Users\\Admin\\.cargo\\bin'",
        snapshotId: 'snap-mock-1',
        canRestore: true,
      }
    ];
  }
  return await invoke<RepairHistoryEntry[]>('get_repair_history');
}

export async function getRestoreConfigurationPreview(
  historyEntryId: string
): Promise<RestorePreview> {
  if (!isTauri()) {
    return {
      historyEntryId,
      target: 'User PATH',
      currentValue: '14 entries',
      restoredValue: '15 entries (including previously removed entry)',
      risk: 'LOW',
      summary: 'Restore previous User PATH configuration from backup taken 1 hour ago.',
    };
  }
  return await invoke<RestorePreview>('get_restore_configuration_preview', { historyEntryId });
}

export async function executeRestoreConfiguration(
  historyEntryId: string
): Promise<RepairExecutionResult> {
  if (!isTauri()) {
    return {
      success: true,
      repairId: `restore-${historyEntryId}`,
      category: 'DUPLICATE_USER_PATH',
      affectedItem: 'User PATH',
      previousValuePreview: '14 entries',
      newValuePreview: '15 entries (restored from backup)',
      verificationPassed: true,
      verificationDetails: 'Verified User PATH successfully restored to previous backup state.',
      rollbackPerformed: false,
      snapshotId: `snap-restored-${Date.now()}`,
      message: 'Previous User PATH configuration successfully restored.',
      timestamp: Date.now(),
    };
  }
  return await invoke<RepairExecutionResult>('execute_restore_configuration', { historyEntryId });
}

// -------------------------------------------------------------------------
// Phase 9C-B: Toolchain Resolution Engine API
// -------------------------------------------------------------------------

import {
  ToolInstallation,
  ProjectToolchainReport,
} from '../types/toolchain';

export async function getToolchainInstallations(): Promise<ToolInstallation[]> {
  if (!isTauri()) {
    return [
      {
        id: 'node::c:\\program files\\nodejs\\node.exe',
        tool: 'node',
        version: '20.11.0',
        executablePath: 'C:\\Program Files\\nodejs\\node.exe',
        detectionSource: 'SYSTEM_PATH',
        pathIndex: 0,
        isActive: true,
        isVerified: true,
        verificationMethod: 'node.exe --version',
        evidence: 'Found in PATH[0]: C:\\Program Files\\nodejs',
      },
      {
        id: 'python::c:\\users\\admin\\appdata\\local\\programs\\python\\python311\\python.exe',
        tool: 'python',
        version: '3.11.8',
        executablePath: 'C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
        detectionSource: 'SYSTEM_PATH',
        pathIndex: 2,
        isActive: true,
        isVerified: true,
        verificationMethod: 'python.exe --version',
        evidence: 'Found in PATH[2]: C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python311',
      },
      {
        id: 'cargo::c:\\users\\admin\\.cargo\\bin\\cargo.exe',
        tool: 'cargo',
        version: '1.77.0',
        executablePath: 'C:\\Users\\Admin\\.cargo\\bin\\cargo.exe',
        detectionSource: 'SYSTEM_PATH',
        pathIndex: 1,
        isActive: true,
        isVerified: true,
        verificationMethod: 'cargo.exe --version',
        evidence: 'Found in PATH[1]: C:\\Users\\Admin\\.cargo\\bin',
      },
      {
        id: 'rust::c:\\users\\admin\\.cargo\\bin\\rustc.exe',
        tool: 'rust',
        version: '1.77.0',
        executablePath: 'C:\\Users\\Admin\\.cargo\\bin\\rustc.exe',
        detectionSource: 'SYSTEM_PATH',
        pathIndex: 1,
        isActive: true,
        isVerified: true,
        verificationMethod: 'rustc.exe --version',
        evidence: 'Found in PATH[1]: C:\\Users\\Admin\\.cargo\\bin',
      },
      {
        id: 'git::c:\\program files\\git\\cmd\\git.exe',
        tool: 'git',
        version: '2.44.0',
        executablePath: 'C:\\Program Files\\Git\\cmd\\git.exe',
        detectionSource: 'SYSTEM_PATH',
        pathIndex: 4,
        isActive: true,
        isVerified: true,
        verificationMethod: 'git.exe --version',
        evidence: 'Found in PATH[4]: C:\\Program Files\\Git\\cmd',
      },
    ];
  }
  return await invoke<ToolInstallation[]>('get_toolchain_installations');
}

export async function resolveProjectToolchain(
  projectPath: string
): Promise<ProjectToolchainReport> {
  if (!isTauri()) {
    return {
      projectPath,
      generatedAt: Math.floor(Date.now() / 1000),
      requirementsFound: 2,
      missingCount: 0,
      mismatchCount: 0,
      compatibleCount: 2,
      results: [
        {
          tool: 'node',
          status: 'ACTIVE',
          activeInstallation: {
            id: 'node::c:\\program files\\nodejs\\node.exe',
            tool: 'node',
            version: '20.11.0',
            executablePath: 'C:\\Program Files\\nodejs\\node.exe',
            detectionSource: 'SYSTEM_PATH',
            pathIndex: 0,
            isActive: true,
            isVerified: true,
            verificationMethod: 'node.exe --version',
            evidence: 'Found in PATH[0]: C:\\Program Files\\nodejs',
          },
          compatibleInstallations: [
            {
              id: 'node::c:\\program files\\nodejs\\node.exe',
              tool: 'node',
              version: '20.11.0',
              executablePath: 'C:\\Program Files\\nodejs\\node.exe',
              detectionSource: 'SYSTEM_PATH',
              pathIndex: 0,
              isActive: true,
              isVerified: true,
              verificationMethod: 'node.exe --version',
              evidence: 'Found in PATH[0]: C:\\Program Files\\nodejs',
            },
          ],
          allInstallations: [
            {
              id: 'node::c:\\program files\\nodejs\\node.exe',
              tool: 'node',
              version: '20.11.0',
              executablePath: 'C:\\Program Files\\nodejs\\node.exe',
              detectionSource: 'SYSTEM_PATH',
              pathIndex: 0,
              isActive: true,
              isVerified: true,
              verificationMethod: 'node.exe --version',
              evidence: 'Found in PATH[0]: C:\\Program Files\\nodejs',
            },
          ],
          requirement: {
            tool: 'node',
            versionConstraint: '>=18.0.0',
            minVersion: [18, 0, 0],
            sourceFile: `${projectPath}/package.json`,
            rawEvidence: 'engines.node: ">=18.0.0"',
            evidenceType: 'ADVISORY',
            advisoryNote:
              'npm engines field is advisory; it is not universally enforced by all package managers.',
            javaContext: null,
          },
          explanation: {
            headline: 'node 20.11.0 is active and satisfies the requirement',
            detail:
              'The active node executable (20.11.0) meets the declared constraint: >=18.0.0.',
            suggestion: null,
            isAdvisoryOnly: true,
          },
        },
      ],
    };
  }
  return await invoke<ProjectToolchainReport>('resolve_project_toolchain', { projectPath });
}

// -------------------------------------------------------------------------
// Phase 9C-C: Workspace Profile Model API
// -------------------------------------------------------------------------

import {
  WorkspaceProfile,
  WorkspaceProfileValidation,
} from '../types/workspaceProfile';

const mockProfiles: WorkspaceProfile[] = [];

export async function getWorkspaceProfile(
  projectPath: string
): Promise<WorkspaceProfile | null> {
  if (!isTauri()) {
    const canon = projectPath.trim().toLowerCase().replace(/\//g, '\\');
    return (
      mockProfiles.find(
        (p) => p.projectPath.trim().toLowerCase().replace(/\//g, '\\') === canon
      ) || null
    );
  }
  return await invoke<WorkspaceProfile | null>('get_workspace_profile', { projectPath });
}

export async function saveWorkspaceProfile(
  profile: WorkspaceProfile
): Promise<WorkspaceProfile> {
  if (!isTauri()) {
    const canon = profile.projectPath.trim().toLowerCase().replace(/\//g, '\\');
    const idx = mockProfiles.findIndex(
      (p) => p.projectPath.trim().toLowerCase().replace(/\//g, '\\') === canon
    );
    const updated = { ...profile, updatedAt: Math.floor(Date.now() / 1000) };
    if (idx >= 0) {
      mockProfiles[idx] = updated;
    } else {
      mockProfiles.push(updated);
    }
    return updated;
  }
  return await invoke<WorkspaceProfile>('save_workspace_profile', { profile });
}

export async function deleteWorkspaceProfile(
  projectPath: string
): Promise<boolean> {
  if (!isTauri()) {
    const canon = projectPath.trim().toLowerCase().replace(/\//g, '\\');
    const idx = mockProfiles.findIndex(
      (p) => p.projectPath.trim().toLowerCase().replace(/\//g, '\\') === canon
    );
    if (idx >= 0) {
      mockProfiles.splice(idx, 1);
      return true;
    }
    return false;
  }
  return await invoke<boolean>('delete_workspace_profile', { projectPath });
}

export async function listWorkspaceProfiles(): Promise<WorkspaceProfile[]> {
  if (!isTauri()) {
    return [...mockProfiles];
  }
  return await invoke<WorkspaceProfile[]>('list_workspace_profiles');
}

export async function validateWorkspaceProfile(
  projectPath: string
): Promise<WorkspaceProfileValidation> {
  if (!isTauri()) {
    const prof = await getWorkspaceProfile(projectPath);
    if (!prof) {
      throw new Error(`No workspace profile exists for project: ${projectPath}`);
    }
    return {
      profileId: prof.id,
      projectPath: prof.projectPath,
      status: prof.toolBindings.length > 0 ? 'VALID' : 'MISSING_BINDING',
      isValid: prof.toolBindings.length > 0,
      bindingIssues: [],
      overrideIssues: [],
      summary:
        prof.toolBindings.length > 0
          ? `Workspace profile valid with ${prof.toolBindings.length} bound tool(s).`
          : 'Profile has no toolchain bindings.',
    };
  }
  return await invoke<WorkspaceProfileValidation>('validate_workspace_profile', { projectPath });
}

// ----------------- PHASE 9C-D1: WORKSPACE EXECUTION PLAN IPC -----------------

import {
  WorkspaceExecutionPlan,
  WorkspaceEnvironmentPreview,
} from '../types/workspaceEnvironment';

export async function getWorkspaceExecutionPlan(
  projectPath: string,
  actionOrScript?: string
): Promise<WorkspaceExecutionPlan> {
  if (!isTauri()) {
    const prof = await getWorkspaceProfile(projectPath);
    if (!prof) {
      throw new Error(`No workspace profile configured for '${projectPath}'`);
    }
    return {
      projectPath,
      profileId: prof.id,
      launchKind: 'PACKAGE_MANAGER_SCRIPT',
      executable: 'cmd',
      arguments: ['/C', 'npm', 'run', actionOrScript || 'dev'],
      cwd: projectPath,
      derivedPathEntries: ['C:\\mock\\node20', 'C:\\Windows\\System32'],
      nonSecretEnvironment: {},
      protectedSecretKeys: [],
      toolBindings: prof.toolBindings.map((b) => ({
        tool: b.tool,
        installationId: b.installationId,
        executablePath: b.executablePath,
        expectedVersion: b.version,
        verifiedVersion: b.version,
        driftStatus: 'EXACT_MATCH',
        derivedBinDir: 'C:\\mock\\node20',
        isActive: b.enabled,
      })),
      blockedOverrides: [],
      verificationPlan: {
        runtimeJdkEnforced: false,
        gradleBuildToolchainNote: null,
        pythonVirtualEnv: null,
        pythonHomeCleared: false,
        nodeModulesBinPrepended: true,
        secretKeysCount: 0,
        protectedSecretsCount: 0,
        warnings: [],
      },
      preflightStatus: 'READY',
      isExecutable: true,
      summaryMessage: `Execution plan for '${actionOrScript || 'dev'}' validated successfully (mock).`,
      createdAt: Math.floor(Date.now() / 1000),
    };
  }
  return await invoke<WorkspaceExecutionPlan>('get_workspace_execution_plan', {
    projectPath,
    actionOrScript: actionOrScript || null,
  });
}

export async function previewWorkspaceExecutionPlan(
  projectPath: string,
  actionOrScript?: string
): Promise<WorkspaceEnvironmentPreview> {
  if (!isTauri()) {
    const prof = await getWorkspaceProfile(projectPath);
    if (!prof) {
      throw new Error(`No workspace profile configured for '${projectPath}'`);
    }
    return {
      projectName: prof.projectName,
      projectPath,
      isExecutable: true,
      preflightStatus: 'READY',
      boundTools: prof.toolBindings.map((b) => `${b.tool} (${b.version || 'unverified'})`),
      pathAdditions: ['C:\\mock\\node20'],
      nonSecretOverrides: {},
      protectedSecretKeys: [],
      blockedOverrides: [],
      warnings: [],
      summaryMessage: `Execution plan ready for '${actionOrScript || 'dev'}'.`,
    };
  }
  return await invoke<WorkspaceEnvironmentPreview>('preview_workspace_execution_plan', {
    projectPath,
    actionOrScript: actionOrScript || null,
  });
}

// ----------------- PHASE 9C-D2: WORKSPACE PROCESS MANAGER IPC -----------------

export async function startWorkspaceExecution(
  projectPath: string,
  actionOrScript?: string,
  sessionSecrets?: Record<string, string>
): Promise<WorkspaceProcessStatus> {
  if (!isTauri()) {
    return {
      sessionId: `mock-ws-proc-${Date.now()}`,
      projectPath,
      profileId: 'mock-profile',
      actionOrScript: actionOrScript || 'dev',
      launchKind: 'PACKAGE_MANAGER_SCRIPT',
      executable: 'cmd',
      arguments: ['/C', 'npm', 'run', actionOrScript || 'dev'],
      cwd: projectPath,
      pid: 12345,
      state: 'RUNNING',
      exitCode: null,
      startedAt: Math.floor(Date.now() / 1000),
      finishedAt: null,
      totalStdoutLines: 1,
      totalStderrLines: 0,
      summaryMessage: `Process started for '${actionOrScript || 'dev'}' (mock).`,
    };
  }
  return await invoke<WorkspaceProcessStatus>('start_workspace_execution', {
    projectPath,
    actionOrScript: actionOrScript || null,
    sessionSecrets: sessionSecrets || null,
  });
}

export async function getWorkspaceProcessStatus(
  sessionId: string
): Promise<WorkspaceProcessStatus> {
  if (!isTauri()) {
    return {
      sessionId,
      projectPath: 'C:\\mock\\project',
      profileId: 'mock-profile',
      actionOrScript: 'dev',
      launchKind: 'PACKAGE_MANAGER_SCRIPT',
      executable: 'cmd',
      arguments: ['/C', 'npm', 'run', 'dev'],
      cwd: 'C:\\mock\\project',
      pid: 12345,
      state: 'RUNNING',
      exitCode: null,
      startedAt: Math.floor(Date.now() / 1000),
      finishedAt: null,
      totalStdoutLines: 2,
      totalStderrLines: 0,
      summaryMessage: 'Running (mock)',
    };
  }
  return await invoke<WorkspaceProcessStatus>('get_workspace_process_status', {
    sessionId,
  });
}

export async function getWorkspaceProcessOutput(
  sessionId: string,
  sinceLine?: number
): Promise<WorkspaceProcessOutput> {
  if (!isTauri()) {
    return {
      sessionId,
      lines: [
        {
          lineNumber: 1,
          timestamp: Math.floor(Date.now() / 1000),
          text: '[mock] Process output ready',
          isStderr: false,
        },
      ],
      nextLineNumber: 2,
      isTruncated: false,
      currentState: 'RUNNING',
      exitCode: null,
    };
  }
  return await invoke<WorkspaceProcessOutput>('get_workspace_process_output', {
    sessionId,
    sinceLine: sinceLine || null,
  });
}

export async function stopWorkspaceProcess(
  sessionId: string
): Promise<WorkspaceProcessStatus> {
  if (!isTauri()) {
    return {
      sessionId,
      projectPath: 'C:\\mock\\project',
      profileId: 'mock-profile',
      actionOrScript: 'dev',
      launchKind: 'PACKAGE_MANAGER_SCRIPT',
      executable: 'cmd',
      arguments: ['/C', 'npm', 'run', 'dev'],
      cwd: 'C:\\mock\\project',
      pid: 12345,
      state: 'STOPPED',
      exitCode: null,
      startedAt: Math.floor(Date.now() / 1000),
      finishedAt: Math.floor(Date.now() / 1000),
      totalStdoutLines: 2,
      totalStderrLines: 0,
      summaryMessage: 'Stopped (mock)',
    };
  }
  return await invoke<WorkspaceProcessStatus>('stop_workspace_process', {
    sessionId,
  });
}

export async function listWorkspaceProcesses(): Promise<WorkspaceProcessStatus[]> {
  if (!isTauri()) {
    return [];
  }
  return await invoke<WorkspaceProcessStatus[]>('list_workspace_processes');
}

export async function getWorkstationFindings(
  projectPath?: string
): Promise<WorkstationFindingsReport> {
  if (!isTauri()) {
    return {
      generatedAt: Math.floor(Date.now() / 1000),
      totalFindings: 0,
      counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      findings: [],
    };
  }
  return await invoke<WorkstationFindingsReport>('get_workstation_findings', {
    projectPath: projectPath || null,
  });
}

export async function getWorkstationIntelligenceSummary(
  projectPath?: string
): Promise<WorkstationIntelligenceSummary> {
  if (!isTauri()) {
    return {
      totalFindings: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 0,
      topFindings: [],
    };
  }
  return await invoke<WorkstationIntelligenceSummary>('get_workstation_intelligence_summary', {
    projectPath: projectPath || null,
  });
}