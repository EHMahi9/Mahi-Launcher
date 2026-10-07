// TypeScript definitions for Phase 10A Workstation Intelligence & Findings Engine

export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type FindingCategory =
  | 'STORAGE'
  | 'TOOLCHAIN'
  | 'ENVIRONMENT'
  | 'PROJECT_COMPATIBILITY'
  | 'WORKSPACE_PROFILE'
  | 'SECURITY'
  | 'CONFIGURATION';

export type SafeActionKind =
  | 'REVIEW_STORAGE'
  | 'OPEN_STORAGE_INTELLIGENCE'
  | 'REVIEW_REPAIR'
  | 'REVIEW_TOOLCHAIN'
  | 'REVIEW_WORKSPACE_PROFILE'
  | 'OPEN_PROJECT_WORKSPACE';

export interface FindingEvidenceItem {
  label: string;
  value: string;
}

export interface WorkstationFinding {
  id: string;
  title: string;
  severity: FindingSeverity;
  category: FindingCategory;
  sourceEngine: string;
  summary: string;
  explanation: string;
  recommendation: string;
  safeActionKind: SafeActionKind | null;
  targetId: string | null;
  evidence: FindingEvidenceItem[];
}

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface WorkstationFindingsReport {
  generatedAt: number;
  totalFindings: number;
  counts: SeverityCounts;
  findings: WorkstationFinding[];
}

export interface WorkstationIntelligenceSummary {
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  topFindings: WorkstationFinding[];
}
