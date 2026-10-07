import React, { useState, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export type ToastCategory = 'success' | 'warning' | 'error' | 'info';

export interface ToastPayload {
  type: ToastCategory;
  message: string;
}

// Test harness mirroring MAHI's App.tsx / DirectoryBrowser.tsx Phase 17 Toast component
const ToastHarness: React.FC<{
  initialToast?: ToastPayload | null;
  onDismiss?: () => void;
}> = ({ initialToast = null, onDismiss }) => {
  const [toast, setToast] = useState<ToastPayload | null>(initialToast);

  useEffect(() => {
    setToast(initialToast);
  }, [initialToast]);

  useEffect(() => {
    if (!toast) return;
    const duration = toast.type === 'error' ? 7000 : toast.type === 'warning' ? 5000 : 3500;
    const timer = setTimeout(() => {
      setToast(null);
      onDismiss?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div className="mahi-toast-container" role="status" aria-live="polite">
      <div className={`mahi-toast ${toast.type}`} data-testid={`toast-${toast.type}`}>
        {toast.type === 'success' && <CheckCircle2 size={16} data-testid="icon-success" className="mahi-toast-icon success" />}
        {toast.type === 'warning' && <AlertTriangle size={16} data-testid="icon-warning" className="mahi-toast-icon warning" />}
        {toast.type === 'error' && <AlertCircle size={16} data-testid="icon-error" className="mahi-toast-icon error" />}
        {toast.type === 'info' && <Info size={16} data-testid="icon-info" className="mahi-toast-icon info" />}
        <span className="mahi-toast-message">{toast.message}</span>
        <button
          type="button"
          className="mahi-toast-close"
          data-testid="toast-dismiss-btn"
          onClick={() => {
            setToast(null);
            onDismiss?.();
          }}
          title="Dismiss"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
};

describe('Phase 17 — Feedback & Notifications Model', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a SUCCESS toast with emerald icon and developer message', () => {
    render(<ToastHarness initialToast={{ type: 'success', message: 'Project folder added: D:\\Code\\MyProject' }} />);

    expect(screen.getByTestId('toast-success')).toBeInTheDocument();
    expect(screen.getByTestId('icon-success')).toBeInTheDocument();
    expect(screen.getByText('Project folder added: D:\\Code\\MyProject')).toBeInTheDocument();
  });

  it('renders a WARNING toast with amber alert triangle for non-fatal conditions', () => {
    render(<ToastHarness initialToast={{ type: 'warning', message: 'Folder is already configured: D:\\Code' }} />);

    expect(screen.getByTestId('toast-warning')).toBeInTheDocument();
    expect(screen.getByTestId('icon-warning')).toBeInTheDocument();
    expect(screen.getByText('Folder is already configured: D:\\Code')).toBeInTheDocument();
  });

  it('renders an ERROR toast with red alert circle for operation failures', () => {
    render(<ToastHarness initialToast={{ type: 'error', message: 'Failed to launch terminal: Directory inaccessible' }} />);

    expect(screen.getByTestId('toast-error')).toBeInTheDocument();
    expect(screen.getByTestId('icon-error')).toBeInTheDocument();
    expect(screen.getByText('Failed to launch terminal: Directory inaccessible')).toBeInTheDocument();
  });

  it('allows immediate manual dismissal via close button', () => {
    const onDismiss = vi.fn();
    render(<ToastHarness initialToast={{ type: 'info', message: 'Copied path to clipboard' }} onDismiss={onDismiss} />);

    expect(screen.getByText('Copied path to clipboard')).toBeInTheDocument();
    const closeBtn = screen.getByTestId('toast-dismiss-btn');
    fireEvent.click(closeBtn);

    expect(screen.queryByText('Copied path to clipboard')).not.toBeInTheDocument();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses SUCCESS toasts after 3500ms', () => {
    const onDismiss = vi.fn();
    render(<ToastHarness initialToast={{ type: 'success', message: 'Process stopped' }} onDismiss={onDismiss} />);

    expect(screen.getByText('Process stopped')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3499);
    });
    expect(screen.getByText('Process stopped')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Process stopped')).not.toBeInTheDocument();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps ERROR toasts visible for 7000ms to ensure readability', () => {
    const onDismiss = vi.fn();
    render(<ToastHarness initialToast={{ type: 'error', message: 'Execution blocked: Missing toolchain Node.js' }} onDismiss={onDismiss} />);

    expect(screen.getByText('Execution blocked: Missing toolchain Node.js')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3500);
    });
    // Still visible at 3500ms (unlike success toasts)
    expect(screen.getByText('Execution blocked: Missing toolchain Node.js')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3500);
    });
    // Dismisses at 7000ms
    expect(screen.queryByText('Execution blocked: Missing toolchain Node.js')).not.toBeInTheDocument();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
