import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExecutionPreviewModal } from './ExecutionPreviewModal';
import { getWorkspaceExecutionPlan, startWorkspaceExecution } from '../../services/tauriApi';
import { WorkspaceExecutionPlan } from '../../types/workspaceEnvironment';

vi.mock('../../services/tauriApi', () => ({
  getWorkspaceExecutionPlan: vi.fn(),
  startWorkspaceExecution: vi.fn(),
}));

const mockedGetPlan = vi.mocked(getWorkspaceExecutionPlan);
const mockedStartExecution = vi.mocked(startWorkspaceExecution);

const mockReadyPlan: WorkspaceExecutionPlan = {
  projectPath: 'D:/Projects/Demo',
  profileId: 'profile-demo',
  launchKind: 'PACKAGE_MANAGER_SCRIPT',
  executable: 'npm',
  arguments: ['run', 'dev'],
  cwd: 'D:/Projects/Demo',
  derivedPathEntries: ['C:/nodejs/bin', 'D:/Projects/Demo/node_modules/.bin'],
  nonSecretEnvironment: { PORT: '3000' },
  protectedSecretKeys: [],
  toolBindings: [
    {
      tool: 'node',
      installationId: 'node-20',
      executablePath: 'C:/nodejs/node.exe',
      expectedVersion: '20.11.0',
      verifiedVersion: '20.11.0',
      driftStatus: 'EXACT_MATCH',
      derivedBinDir: 'C:/nodejs',
      isActive: true,
    },
  ],
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
  summaryMessage: 'Ready to execute \'npm run dev\' using Node.js 20.11.0',
  createdAt: 1700000000,
};

describe('ExecutionPreviewModal (Phase 16 — Workspace & Execution UX)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders preflight preview with ready status, toolchain binding, and runs on confirm', async () => {
    mockedGetPlan.mockResolvedValue(mockReadyPlan);
    const onLaunched = vi.fn();
    const onClose = vi.fn();

    render(
      <ExecutionPreviewModal
        isOpen={true}
        projectPath="D:/Projects/Demo"
        projectName="DemoProject"
        actionOrScript="dev"
        onClose={onClose}
        onLaunched={onLaunched}
      />
    );

    expect(await screen.findByText('Ready for Execution')).toBeTruthy();
    expect(screen.getByText("Ready to execute 'npm run dev' using Node.js 20.11.0")).toBeTruthy();
    expect(screen.getByText('Execution Command & Working Directory')).toBeTruthy();
    expect(screen.getByText('npm')).toBeTruthy();
    expect(screen.getByText('NODE')).toBeTruthy();
    expect(screen.getByText('Verified Match')).toBeTruthy();

    mockedStartExecution.mockResolvedValue({
      sessionId: 'session-123',
      projectPath: 'D:/Projects/Demo',
      profileId: 'profile-demo',
      actionOrScript: 'dev',
      launchKind: 'PACKAGE_MANAGER_SCRIPT',
      executable: 'npm',
      arguments: ['run', 'dev'],
      cwd: 'D:/Projects/Demo',
      pid: 4567,
      state: 'RUNNING',
      exitCode: null,
      startedAt: 1700000000,
      finishedAt: null,
      totalStdoutLines: 0,
      totalStderrLines: 0,
      summaryMessage: 'Running',
    });

    const confirmBtn = screen.getByRole('button', { name: /Confirm & Run/i });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    expect(mockedStartExecution).toHaveBeenCalledWith(
      'D:/Projects/Demo',
      'dev',
      {}
    );
  });

  it('renders blocked preflight with resolution guidance and disables execution', async () => {
    const blockedPlan: WorkspaceExecutionPlan = {
      ...mockReadyPlan,
      preflightStatus: 'BLOCKED_VERSION_DRIFT',
      isExecutable: false,
      summaryMessage: 'Node.js version mismatch between expected 18.x and actual 20.x',
    };
    mockedGetPlan.mockResolvedValue(blockedPlan);

    render(
      <ExecutionPreviewModal
        isOpen={true}
        projectPath="D:/Projects/Demo"
        projectName="DemoProject"
        actionOrScript="dev"
        onClose={vi.fn()}
        onLaunched={vi.fn()}
      />
    );

    expect(await screen.findByText('Blocked: Version Drift Detected')).toBeTruthy();
    expect(screen.getByText(/Check your active runtime installations in Developer Environment/i)).toBeTruthy();

    const confirmBtn = screen.getByRole('button', { name: /Confirm & Run/i });
    expect(confirmBtn).toBeDisabled();
  });

  it('prompts for ephemeral secret values when protected secret keys are required', async () => {
    const secretPlan: WorkspaceExecutionPlan = {
      ...mockReadyPlan,
      protectedSecretKeys: ['API_KEY'],
    };
    mockedGetPlan.mockResolvedValue(secretPlan);

    render(
      <ExecutionPreviewModal
        isOpen={true}
        projectPath="D:/Projects/Demo"
        projectName="DemoProject"
        actionOrScript="dev"
        onClose={vi.fn()}
        onLaunched={vi.fn()}
      />
    );

    expect(await screen.findByText('API_KEY')).toBeTruthy();
    expect(screen.getByText('Ephemeral Value Required')).toBeTruthy();

    const secretInput = screen.getByPlaceholderText('Enter session value for API_KEY...');
    fireEvent.change(secretInput, { target: { value: 'secret-token-xyz' } });

    expect(screen.getByText('Available (Session Only)')).toBeTruthy();
  });
});
