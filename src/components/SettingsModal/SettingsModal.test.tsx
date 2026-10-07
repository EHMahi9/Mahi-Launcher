import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';

// Mock tauriApi storage functions
vi.mock('../../services/tauriApi', () => ({
  getDebugStorageInfo: vi.fn().mockResolvedValue({
    exists: true,
    sizeBytes: 104857600,
    sizeMb: 100,
    sizeGb: 0.1,
  }),
  cleanDebugArtifacts: vi.fn().mockResolvedValue({
    success: true,
    recoveredBytes: 104857600,
    recoveredMb: 100,
    message: 'Reclaimed 100 MB of disk space.',
  }),
  isTauri: vi.fn().mockReturnValue(false),
}));

describe('Phase 18 — SettingsModal & Help View', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders SettingsModal with Locations tab active by default', () => {
    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        configuredRoots={['D:\\Code\\Projects', 'C:\\Dev\\Apps']}
      />
    );

    expect(screen.getByText('MAHI Settings & Preferences')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Locations/i })).toHaveClass('active');
    expect(screen.getByText('Project Scan Roots')).toBeInTheDocument();
    expect(screen.getByText('D:\\Code\\Projects')).toBeInTheDocument();
    expect(screen.getByText('C:\\Dev\\Apps')).toBeInTheDocument();
  });

  it('switches to Maintenance tab and renders debug storage info and clean button', async () => {
    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        onOpenStorageIntelligence={vi.fn()}
      />
    );

    const maintenanceTab = screen.getByRole('tab', { name: /Maintenance/i });
    fireEvent.click(maintenanceTab);

    expect(maintenanceTab).toHaveClass('active');
    expect(screen.getByText('Rust & Tauri Debug Artifacts')).toBeInTheDocument();
    expect(screen.getByText('MAHI Storage Diagnostics Engine')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('100 MB')).toBeInTheDocument();
    });

    const cleanBtn = screen.getByText('Clean Rust/Tauri Debug Artifacts');
    expect(cleanBtn).toBeInTheDocument();
  });

  it('switches to Help & About tab and renders keyboard shortcuts and version info', () => {
    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        initialTab="help"
        onOpenWorkstationHealth={vi.fn()}
        onOpenDeveloperHealth={vi.fn()}
      />
    );

    expect(screen.getByRole('tab', { name: /Help & About/i })).toHaveClass('active');
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Toggle & Focus Global Launcher')).toBeInTheDocument();
    expect(screen.getByText('Open New Filesystem Tab')).toBeInTheDocument();
    expect(screen.getByText('About MAHI')).toBeInTheDocument();
    expect(screen.getByText('v0.1.0 (V1 Release Candidate)')).toBeInTheDocument();
    expect(screen.getByText('Windows 11 (x86_64)')).toBeInTheDocument();
  });

  it('triggers onAddProjectFolder and onRemoveProjectFolder callbacks', () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();

    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        configuredRoots={['D:\\Code\\Projects']}
        onAddProjectFolder={onAdd}
        onRemoveProjectFolder={onRemove}
      />
    );

    const addBtn = screen.getByTitle('Add folder to project discovery');
    fireEvent.click(addBtn);
    expect(onAdd).toHaveBeenCalledTimes(1);

    const removeBtn = screen.getByTitle('Remove scan root');
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith('D:\\Code\\Projects');
  });

  it('triggers onResetOnboarding when re-running onboarding walkthrough', () => {
    const onReset = vi.fn();

    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        onResetOnboarding={onReset}
      />
    );

    const resetBtn = screen.getByTitle('Replay onboarding walkthrough');
    fireEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('navigates to diagnostic surfaces from Help tab', () => {
    const onClose = vi.fn();
    const onOpenWorkstationHealth = vi.fn();
    const onOpenDeveloperHealth = vi.fn();

    render(
      <SettingsModal
        isOpen={true}
        onClose={onClose}
        initialTab="help"
        onOpenWorkstationHealth={onOpenWorkstationHealth}
        onOpenDeveloperHealth={onOpenDeveloperHealth}
      />
    );

    const wsBtn = screen.getByText('Workstation Health & Correlated Findings');
    fireEvent.click(wsBtn);
    expect(onClose).toHaveBeenCalled();
    expect(onOpenWorkstationHealth).toHaveBeenCalled();

    const devBtn = screen.getByText('Developer Environment & Toolchain Resolver');
    fireEvent.click(devBtn);
    expect(onOpenDeveloperHealth).toHaveBeenCalled();
  });
});
