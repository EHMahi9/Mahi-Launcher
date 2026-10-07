import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceProcessView } from './WorkspaceProcessView';
import {
  getWorkspaceProcessStatus,
  getWorkspaceProcessOutput,
  stopWorkspaceProcess,
  extractLocalhostUrls
} from '../../services/tauriApi';
import { WorkspaceProcessStatus } from '../../types/workspaceProcess';

vi.mock('../../services/tauriApi', () => ({
  getWorkspaceProcessStatus: vi.fn(),
  getWorkspaceProcessOutput: vi.fn(),
  stopWorkspaceProcess: vi.fn(),
  copyTextToClipboard: vi.fn(),
  extractLocalhostUrls: vi.fn(),
  openExternalUrl: vi.fn(),
}));

const mockedGetStatus = vi.mocked(getWorkspaceProcessStatus);
const mockedGetOutput = vi.mocked(getWorkspaceProcessOutput);
const mockedStopProcess = vi.mocked(stopWorkspaceProcess);
const mockedExtractUrls = vi.mocked(extractLocalhostUrls);

const mockRunningStatus: WorkspaceProcessStatus = {
  sessionId: 'session-demo-777',
  projectPath: 'D:/Projects/Demo',
  profileId: 'profile-demo',
  actionOrScript: 'dev',
  launchKind: 'PACKAGE_MANAGER_SCRIPT',
  executable: 'npm',
  arguments: ['run', 'dev'],
  cwd: 'D:/Projects/Demo',
  pid: 1234,
  state: 'RUNNING',
  exitCode: null,
  startedAt: Math.floor(Date.now() / 1000) - 10,
  finishedAt: null,
  totalStdoutLines: 2,
  totalStderrLines: 0,
  summaryMessage: 'Running',
};

describe('WorkspaceProcessView (Phase 16 — Workspace & Execution UX)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetStatus.mockResolvedValue(mockRunningStatus);
    mockedGetOutput.mockResolvedValue({
      sessionId: 'session-demo-777',
      lines: [
        { lineNumber: 1, timestamp: 1700000000, text: 'Vite dev server running at:', isStderr: false },
        { lineNumber: 2, timestamp: 1700000001, text: '  > Local: http://localhost:5173/', isStderr: false },
      ],
      nextLineNumber: 3,
      isTruncated: false,
      currentState: 'RUNNING',
      exitCode: null,
    });
    mockedExtractUrls.mockReturnValue([]);
  });

  it('renders running session status, PID, duration, and terminal lines', async () => {
    render(
      <WorkspaceProcessView
        sessionId="session-demo-777"
        initialStatus={mockRunningStatus}
      />
    );

    expect(screen.getByText('dev')).toBeTruthy();
    expect(screen.getByText('RUNNING')).toBeTruthy();
    expect(screen.getByText('PID: 1234')).toBeTruthy();
    expect(screen.getByText('Isolated Process Session')).toBeTruthy();

    expect(await screen.findByText(/Vite dev server running at:/)).toBeTruthy();
  });

  it('stops process safely on clicking Stop', async () => {
    mockedStopProcess.mockResolvedValue({
      ...mockRunningStatus,
      state: 'STOPPED',
      exitCode: null,
      finishedAt: Math.floor(Date.now() / 1000),
    });

    render(
      <WorkspaceProcessView
        sessionId="session-demo-777"
        initialStatus={mockRunningStatus}
      />
    );

    const stopBtn = screen.getByRole('button', { name: /Stop/i });
    fireEvent.click(stopBtn);

    expect(mockedStopProcess).toHaveBeenCalledWith('session-demo-777');
  });

  it('displays finished status and exit code when process finishes', async () => {
    const exitedStatus: WorkspaceProcessStatus = {
      ...mockRunningStatus,
      state: 'EXITED',
      exitCode: 0,
      finishedAt: Math.floor(Date.now() / 1000),
    };
    mockedGetStatus.mockResolvedValue(exitedStatus);

    render(
      <WorkspaceProcessView
        sessionId="session-demo-777"
        initialStatus={exitedStatus}
      />
    );

    expect(screen.getByText('EXITED')).toBeTruthy();
    expect(await screen.findByText(/Process completed successfully \(Exit code: 0\)/)).toBeTruthy();
  });
});
