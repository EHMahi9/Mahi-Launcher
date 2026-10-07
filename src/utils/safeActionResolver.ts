import { SafeActionKind, WorkstationFinding } from '../types/intelligence';

export type SafeActionDestination = 'storage' | 'developer-health' | 'workspace';
export type SafeActionTab = 'overview' | 'repairs' | 'toolchain';

export interface SafeActionNavigationIntent {
  destination: SafeActionDestination;
  tab?: SafeActionTab;
  targetId: string | null;
  projectPath: string | null;
}

const hasTarget = (finding: WorkstationFinding) => Boolean(finding.targetId?.trim());

export function resolveSafeAction(finding: WorkstationFinding): SafeActionNavigationIntent | null {
  const action = finding.safeActionKind;

  if (!action) return null;

  switch (action) {
    case 'REVIEW_STORAGE':
    case 'OPEN_STORAGE_INTELLIGENCE':
      return {
        destination: 'storage',
        tab: 'overview',
        targetId: finding.targetId,
        projectPath: null,
      };
    case 'REVIEW_REPAIR':
      return {
        destination: 'developer-health',
        tab: 'repairs',
        targetId: finding.targetId,
        projectPath: null,
      };
    case 'REVIEW_TOOLCHAIN':
      return {
        destination: 'developer-health',
        tab: 'toolchain',
        targetId: finding.targetId,
        projectPath: null,
      };
    case 'REVIEW_WORKSPACE_PROFILE':
      if (!hasTarget(finding)) return null;
      return {
        destination: 'developer-health',
        tab: 'toolchain',
        targetId: finding.targetId,
        projectPath: finding.targetId,
      };
    case 'OPEN_PROJECT_WORKSPACE':
      if (!hasTarget(finding)) return null;
      return {
        destination: 'workspace',
        targetId: finding.targetId,
        projectPath: finding.targetId,
      };
    default:
      return null;
  }
}

export function resolveSafeActionKind(
  action: SafeActionKind | null,
  targetId: string | null,
): SafeActionNavigationIntent | null {
  return resolveSafeAction({
    id: 'navigation-intent',
    title: 'Navigation intent',
    severity: 'INFO',
    category: 'CONFIGURATION',
    sourceEngine: 'Workstation Intelligence',
    summary: '',
    explanation: '',
    recommendation: '',
    safeActionKind: action,
    targetId,
    evidence: [],
  });
}
