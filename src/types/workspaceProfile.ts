// Phase 9C-C: Workspace Profile Model — TypeScript types
// Mirrors src-tauri/src/workspace_profile.rs (serde camelCase + SCREAMING_SNAKE_CASE enums)

export type ProfileValidationStatus =
  | 'VALID'
  | 'MISSING_BINDING'
  | 'STALE_EXECUTABLE'
  | 'VERSION_CHANGED'
  | 'PROJECT_MISMATCH'
  | 'UNKNOWN';

export type IssueSeverity = 'WARNING' | 'CRITICAL';

export interface BindingValidationIssue {
  tool: string;
  installationId: string;
  executablePath: string;
  expectedVersion: string | null;
  actualVersion: string | null;
  severity: IssueSeverity;
  message: string;
}

export interface OverrideValidationIssue {
  key: string;
  severity: IssueSeverity;
  message: string;
}

export interface WorkspaceProfileValidation {
  profileId: string;
  projectPath: string;
  status: ProfileValidationStatus;
  isValid: boolean;
  bindingIssues: BindingValidationIssue[];
  overrideIssues: OverrideValidationIssue[];
  summary: string;
}

export interface WorkspaceToolBinding {
  tool: string;
  installationId: string;
  executablePath: string;
  version: string | null;
  enabled: boolean;
}

export const PROTECTED_SECRET_MARKER = '[PROTECTED_SECRET]';

export type SecretStatus =
  | 'NOT_SECRET'
  | 'SECRET_CONFIGURED'
  | 'SECRET_VALUE_AVAILABLE';

export interface WorkspaceEnvOverride {
  key: string;
  value: string;
  enabled: boolean;
  isSecret: boolean;
}

export function getSecretStatus(override: WorkspaceEnvOverride): SecretStatus {
  if (!override.isSecret) {
    return 'NOT_SECRET';
  }
  if (override.value === PROTECTED_SECRET_MARKER || !override.value.trim()) {
    return 'SECRET_CONFIGURED';
  }
  return 'SECRET_VALUE_AVAILABLE';
}

export function isSecretValueAvailable(override: WorkspaceEnvOverride): boolean {
  return getSecretStatus(override) === 'SECRET_VALUE_AVAILABLE';
}

export function isSecretConfigured(override: WorkspaceEnvOverride): boolean {
  return getSecretStatus(override) === 'SECRET_CONFIGURED';
}

export interface WorkspaceProfile {
  id: string;
  projectPath: string;
  projectName: string;
  createdAt: number;
  updatedAt: number;
  enabled: boolean;
  toolBindings: WorkspaceToolBinding[];
  environmentOverrides: WorkspaceEnvOverride[];
}
