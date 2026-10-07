import { DeveloperStorageItem } from './storage';

export type HealthStatus = 'HEALTHY' | 'INFO' | 'WARNING' | 'CRITICAL';

export type DeveloperToolCategory =
  | 'VCS'
  | 'RUNTIME'
  | 'PACKAGE_MANAGER'
  | 'BUILD_TOOL'
  | 'CONTAINER'
  | 'EDITOR'
  | 'SHELL'
  | 'PLATFORM';

export interface DeveloperTool {
  id: string;
  name: string;
  category: DeveloperToolCategory;
  status: HealthStatus;
  isInstalled: boolean;
  version?: string;
  executablePath?: string;
  detectionMethod: string;
  shadowedCount: number;
  notes?: string;
}

export interface PathEntryDiagnostic {
  path: string;
  index: number;
  exists: boolean;
  isDuplicate: boolean;
  category: string;
  detectedTool?: string;
  status: HealthStatus;
  issue?: string;
}

export interface ShadowedPathInstance {
  path: string;
  version?: string;
  pathIndex: number;
}

export interface PathConflictDiagnostic {
  executable: string;
  activePath: string;
  activeVersion?: string;
  shadowedPaths: ShadowedPathInstance[];
  explanation: string;
  severity: HealthStatus;
}

export interface PathDiagnosticsReport {
  totalEntries: number;
  validEntries: number;
  missingEntries: number;
  duplicateEntries: number;
  developerEntries: number;
  entries: PathEntryDiagnostic[];
  conflicts: PathConflictDiagnostic[];
  overallStatus: HealthStatus;
}

export interface ToolVersionInstance {
  version: string;
  path: string;
  source: string;
  isActive: boolean;
}

export interface MultipleVersionReport {
  toolId: string;
  toolName: string;
  versions: ToolVersionInstance[];
  activeVersion?: string;
  status: HealthStatus;
  classification: string;
  explanation: string;
  suggestedAction: string;
}

export interface CompatibilityRequirement {
  target: string;
  required: string;
  machineInstalled?: string;
  satisfied?: boolean | null;
  status: HealthStatus;
  notes: string;
}

export interface ProjectCompatibilityCheck {
  projectPath: string;
  projectName: string;
  ecosystem: string;
  requirements: CompatibilityRequirement[];
  overallStatus: HealthStatus;
  summary: string;
}

export interface EnvironmentVariableAudit {
  name: string;
  isSet: boolean;
  sanitizedValue?: string;
  targetExists: boolean;
  matchesActiveTool: boolean;
  status: HealthStatus;
  explanation: string;
  recommendation: string;
}

export interface DeveloperFinding {
  id: string;
  title: string;
  category: 'toolchain' | 'path' | 'versions' | 'compatibility' | 'environment' | 'storage' | string;
  severity: HealthStatus;
  evidence: string;
  explanation: string;
  suggestedAction: string;
}

export interface DeveloperEnvironmentReport {
  generatedAt: number;
  healthScore: number;
  overallStatus: HealthStatus;
  healthyCount: number;
  infoCount: number;
  warningCount: number;
  criticalCount: number;
  tools: DeveloperTool[];
  pathDiagnostics: PathDiagnosticsReport;
  multipleVersions: MultipleVersionReport[];
  projectCompatibility: ProjectCompatibilityCheck[];
  environmentVariables: EnvironmentVariableAudit[];
  developerStorage: DeveloperStorageItem[];
  findings: DeveloperFinding[];
}
