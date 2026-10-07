import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DirectoryBrowser } from '../DirectoryBrowser/DirectoryBrowser';
import { DriveView } from '../DriveView/DriveView';
import { ProjectWorkspacePanel } from '../ProjectWorkspacePanel/ProjectWorkspacePanel';
import { DeveloperHealthView } from '../DeveloperHealthView/DeveloperHealthView';
import * as tauriApi from '../../services/tauriApi';

describe('Phase 19 — Reliability & Recovery UX', () => {
  it('DirectoryBrowser provides Retry affordance on directory read error', () => {
    const handleRefresh = vi.fn();
    const handleGoUp = vi.fn();
    const handleOpenThisPc = vi.fn();

    render(
      <DirectoryBrowser
        currentPath="C:/Inaccessible/Folder"
        data={null}
        loading={false}
        error="Access is denied (OS Error 5)"
        canGoBack={false}
        canGoForward={false}
        viewMode="details"
        sortField="name"
        sortDirection="asc"
        selectedPaths={[]}
        showPreview={false}
        onNavigate={vi.fn()}
        onGoBack={vi.fn()}
        onGoForward={vi.fn()}
        onGoUp={handleGoUp}
        onRefresh={handleRefresh}
        onOpenThisPc={handleOpenThisPc}
        onOpenFile={vi.fn()}
        onViewModeChange={vi.fn()}
        onSortChange={vi.fn()}
        onSelectionChange={vi.fn()}
        onPreviewToggle={vi.fn()}
      />
    );

    expect(screen.getByText('Unable to access directory')).toBeDefined();
    expect(screen.getByText('Access is denied (OS Error 5)')).toBeDefined();

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeDefined();
    fireEvent.click(retryBtn);
    expect(handleRefresh).toHaveBeenCalledTimes(1);
  });

  it('DriveView renders dedicated empty recovery state and Scan Drives button when 0 drives detected', () => {
    const handleRefresh = vi.fn();

    render(
      <DriveView
        drives={[]}
        loading={false}
        onRefresh={handleRefresh}
        onOpenDrive={vi.fn()}
      />
    );

    expect(screen.getByText('No storage drives detected')).toBeDefined();
    const scanBtn = screen.getByRole('button', { name: /scan drives/i });
    expect(scanBtn).toBeDefined();
    fireEvent.click(scanBtn);
    expect(handleRefresh).toHaveBeenCalledTimes(1);
  });

  it('ProjectWorkspacePanel renders Retry and Return buttons on project metadata resolution error', async () => {
    vi.spyOn(tauriApi, 'getProjectDetails').mockRejectedValueOnce(new Error('Project path no longer exists on disk'));
    vi.spyOn(tauriApi, 'getProjectWorkspaceConfig').mockResolvedValueOnce({ pinnedScripts: [], envOverrides: [] });
    vi.spyOn(tauriApi, 'getWorkspaceProfile').mockResolvedValueOnce(null);
    vi.spyOn(tauriApi, 'getRunningProcesses').mockResolvedValueOnce([]);
    vi.spyOn(tauriApi, 'listWorkspaceProcesses').mockResolvedValueOnce([]);

    const handleBack = vi.fn();

    render(
      <ProjectWorkspacePanel
        projectPath="D:/Deleted/Project"
        onBack={handleBack}
        onOpenInVsCode={vi.fn()}
        onOpenInTerminal={vi.fn()}
        onOpenInExplorer={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Unable to load project workspace')).toBeDefined();
    });

    expect(screen.getByText(/Project path no longer exists on disk/i)).toBeDefined();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeDefined();

    const returnBtn = screen.getByRole('button', { name: /return/i });
    expect(returnBtn).toBeDefined();
    fireEvent.click(returnBtn);
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it('DeveloperHealthView surfaces clear error container with Run Audit Again button when audit fails', async () => {
    vi.spyOn(tauriApi, 'runDeveloperEnvironmentAudit').mockRejectedValueOnce(new Error('WMI query failed / environment unreachable'));
    vi.spyOn(tauriApi, 'getAvailableRepairs').mockResolvedValueOnce([]);
    vi.spyOn(tauriApi, 'getRepairHistory').mockResolvedValueOnce([]);
    vi.spyOn(tauriApi, 'resolveProjectToolchain').mockResolvedValueOnce({} as any);
    vi.spyOn(tauriApi, 'getToolchainInstallations').mockResolvedValueOnce([]);
    vi.spyOn(tauriApi, 'getWorkspaceProfile').mockResolvedValueOnce(null);

    render(
      <DeveloperHealthView />
    );

    await waitFor(() => {
      expect(screen.getByText('Environment Audit Failed')).toBeDefined();
    });

    expect(screen.getByText(/WMI query failed \/ environment unreachable/i)).toBeDefined();
    const retryBtn = screen.getByRole('button', { name: /run audit again/i });
    expect(retryBtn).toBeDefined();
  });
});
