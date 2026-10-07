import { describe, expect, it } from 'vitest';
import { WorkstationFinding } from '../types/intelligence';
import { resolveSafeAction } from './safeActionResolver';

const makeFinding = (
  safeActionKind: WorkstationFinding['safeActionKind'],
  targetId: string | null = null,
): WorkstationFinding => ({
  id: 'test-finding',
  title: 'Test finding',
  severity: 'INFO',
  category: 'CONFIGURATION',
  sourceEngine: 'Test',
  summary: 'Test',
  explanation: 'Test',
  recommendation: 'Test',
  safeActionKind,
  targetId,
  evidence: [],
});

describe('resolveSafeAction', () => {
  it('maps review actions to existing destinations without execution data', () => {
    expect(resolveSafeAction(makeFinding('REVIEW_REPAIR', 'repair-1'))).toEqual({
      destination: 'developer-health',
      tab: 'repairs',
      targetId: 'repair-1',
      projectPath: null,
    });
    expect(resolveSafeAction(makeFinding('REVIEW_TOOLCHAIN', 'node'))).toEqual({
      destination: 'developer-health',
      tab: 'toolchain',
      targetId: 'node',
      projectPath: null,
    });
  });

  it('routes workspace profile findings to the profile workflow with project scope', () => {
    expect(resolveSafeAction(makeFinding('REVIEW_WORKSPACE_PROFILE', 'D:\\Projects\\Demo'))).toEqual({
      destination: 'developer-health',
      tab: 'toolchain',
      targetId: 'D:\\Projects\\Demo',
      projectPath: 'D:\\Projects\\Demo',
    });
  });

  it('rejects actions that require a missing target', () => {
    expect(resolveSafeAction(makeFinding('OPEN_PROJECT_WORKSPACE'))).toBeNull();
    expect(resolveSafeAction(makeFinding('REVIEW_WORKSPACE_PROFILE', '   '))).toBeNull();
    expect(resolveSafeAction(makeFinding(null))).toBeNull();
  });
});
