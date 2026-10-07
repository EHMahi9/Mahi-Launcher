import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingView } from './OnboardingView';

describe('OnboardingView', () => {
  it('renders welcome title, subtitle, and primary actions', () => {
    const handleAdd = vi.fn().mockResolvedValue(undefined);
    const handleSkip = vi.fn();
    const handleRescan = vi.fn().mockResolvedValue(undefined);

    render(
      <OnboardingView
        configuredRoots={[]}
        isScanning={false}
        onAddFolder={handleAdd}
        onSkip={handleSkip}
        onRescan={handleRescan}
      />
    );

    expect(screen.getByText('Welcome to MAHI')).toBeTruthy();
    expect(screen.getByText('Connect Your Workspaces')).toBeTruthy();
    expect(screen.getByText('Add Project Folder')).toBeTruthy();
    expect(screen.getByText('Skip for now')).toBeTruthy();
  });

  it('triggers onAddFolder when Add Project Folder is clicked', async () => {
    const handleAdd = vi.fn().mockResolvedValue(undefined);
    const handleSkip = vi.fn();
    const handleRescan = vi.fn().mockResolvedValue(undefined);

    render(
      <OnboardingView
        configuredRoots={[]}
        isScanning={false}
        onAddFolder={handleAdd}
        onSkip={handleSkip}
        onRescan={handleRescan}
      />
    );

    const btn = screen.getByText('Add Project Folder');
    fireEvent.click(btn);
    expect(handleAdd).toHaveBeenCalledTimes(1);
  });

  it('triggers onSkip when Skip for now is clicked', () => {
    const handleAdd = vi.fn().mockResolvedValue(undefined);
    const handleSkip = vi.fn();
    const handleRescan = vi.fn().mockResolvedValue(undefined);

    render(
      <OnboardingView
        configuredRoots={[]}
        isScanning={false}
        onAddFolder={handleAdd}
        onSkip={handleSkip}
        onRescan={handleRescan}
      />
    );

    const skipBtn = screen.getByText('Skip for now');
    fireEvent.click(skipBtn);
    expect(handleSkip).toHaveBeenCalledTimes(1);
  });

  it('renders scanning indicator when isScanning is true', () => {
    const handleAdd = vi.fn().mockResolvedValue(undefined);
    const handleSkip = vi.fn();
    const handleRescan = vi.fn().mockResolvedValue(undefined);

    render(
      <OnboardingView
        configuredRoots={[]}
        isScanning={true}
        onAddFolder={handleAdd}
        onSkip={handleSkip}
        onRescan={handleRescan}
      />
    );

    expect(screen.getByText(/Scanning directories for developer projects/i)).toBeTruthy();
  });

  it('renders warning banner and allows Add Another Folder / Rescan when roots exist but 0 projects', () => {
    const handleAdd = vi.fn().mockResolvedValue(undefined);
    const handleSkip = vi.fn();
    const handleRescan = vi.fn().mockResolvedValue(undefined);

    render(
      <OnboardingView
        configuredRoots={['C:\\test-root']}
        isScanning={false}
        onAddFolder={handleAdd}
        onSkip={handleSkip}
        onRescan={handleRescan}
      />
    );

    expect(screen.getByText(/No supported projects found in configured folders/i)).toBeTruthy();
    expect(screen.getByText('Add Another Folder')).toBeTruthy();
    expect(screen.getByText('Rescan')).toBeTruthy();
    expect(screen.getByText('Continue to Home')).toBeTruthy();
  });
});
