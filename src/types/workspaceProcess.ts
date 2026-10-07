// Phase 9C-D2: Workspace Process Manager — TypeScript types
// Mirrors src-tauri/src/process_manager.rs (serde camelCase + SCREAMING_SNAKE_CASE enums)

import { LaunchKind } from './workspaceEnvironment';

export type WorkspaceProcessState =
  | 'STARTING'
  | 'RUNNING'
  | 'EXITED'
  | 'FAILED'
  | 'STOPPING'
  | 'STOPPED';

export interface ProcessOutputEntry {
  lineNumber: number;
  timestamp: number;
  text: string;
  isStderr: boolean;
}

export interface WorkspaceProcessStatus {
  sessionId: string;
  projectPath: string;
  profileId: string;
  actionOrScript: string;
  launchKind: LaunchKind;
  executable: string;
  arguments: string[];
  cwd: string;
  pid: number | null;
  state: WorkspaceProcessState;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  totalStdoutLines: number;
  totalStderrLines: number;
  summaryMessage: string;
}

export interface WorkspaceProcessOutput {
  sessionId: string;
  lines: ProcessOutputEntry[];
  nextLineNumber: number;
  isTruncated: boolean;
  currentState: WorkspaceProcessState;
  exitCode: number | null;
}
