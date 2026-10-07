// Phase 9C-D1: Pure Workspace Execution Plan — TypeScript types
// Mirrors src-tauri/src/workspace_environment.rs (serde camelCase + SCREAMING_SNAKE_CASE enums)

export type LaunchKind =
  | 'DIRECT_EXECUTABLE'
  | 'PACKAGE_MANAGER_SCRIPT'
  | 'BUILD_TOOL'
  | 'WORKSPACE_TERMINAL'
  | 'CUSTOM_BINARY';

export type PreflightStatus =
  | 'READY'
  | 'BLOCKED_MISSING_TOOL'
  | 'BLOCKED_VERSION_DRIFT'
  | 'BLOCKED_STALE_BINDING'
  | 'BLOCKED_SECRET_UNAVAILABLE'
  | 'BLOCKED_MISSING_PROJECT'
  | 'BLOCKED_DISABLED_PROFILE'
  | 'BLOCKED_INVALID_OVERRIDE'
  | 'BLOCKED_UNAPPROVED_ACTION'
  | 'BLOCKED_AMBIGUOUS_RESOLUTION'
  | 'ERROR';

export type ToolDriftStatus =
  | 'EXACT_MATCH'
  | 'VERSION_DRIFT'
  | 'MISSING'
  | 'UNVERIFIED';

export interface ToolBindingPlan {
  tool: string;
  installationId: string;
  executablePath: string;
  expectedVersion: string | null;
  verifiedVersion: string | null;
  driftStatus: ToolDriftStatus;
  derivedBinDir: string | null;
  isActive: boolean;
}

export interface VerificationPlan {
  runtimeJdkEnforced: boolean;
  gradleBuildToolchainNote: string | null;
  pythonVirtualEnv: string | null;
  pythonHomeCleared: boolean;
  nodeModulesBinPrepended: boolean;
  secretKeysCount: number;
  protectedSecretsCount: number;
  warnings: string[];
}

export interface WorkspaceExecutionPlan {
  projectPath: string;
  profileId: string;
  launchKind: LaunchKind;
  executable: string;
  arguments: string[];
  cwd: string;
  derivedPathEntries: string[];
  nonSecretEnvironment: Record<string, string>;
  protectedSecretKeys: string[];
  toolBindings: ToolBindingPlan[];
  blockedOverrides: string[];
  verificationPlan: VerificationPlan;
  preflightStatus: PreflightStatus;
  isExecutable: boolean;
  summaryMessage: string;
  createdAt: number;
}

export interface WorkspaceEnvironmentPreview {
  projectName: string;
  projectPath: string;
  isExecutable: boolean;
  preflightStatus: PreflightStatus;
  boundTools: string[];
  pathAdditions: string[];
  nonSecretOverrides: Record<string, string>;
  protectedSecretKeys: string[];
  blockedOverrides: string[];
  warnings: string[];
  summaryMessage: string;
}
