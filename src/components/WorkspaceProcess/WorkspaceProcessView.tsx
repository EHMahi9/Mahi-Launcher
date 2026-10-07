import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Terminal,
  Square,
  Copy,
  Check,
  Clock,
  Cpu,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ArrowDown,
  Trash2,
  ExternalLink,
  Globe
} from 'lucide-react';
import {
  WorkspaceProcessStatus,
  ProcessOutputEntry,
  WorkspaceProcessState
} from '../../types/workspaceProcess';
import {
  getWorkspaceProcessStatus,
  getWorkspaceProcessOutput,
  stopWorkspaceProcess,
  copyTextToClipboard,
  extractLocalhostUrls,
  openExternalUrl
} from '../../services/tauriApi';
import './WorkspaceProcessView.css';

interface WorkspaceProcessViewProps {
  sessionId: string;
  initialStatus?: WorkspaceProcessStatus;
  onClose?: () => void;
}

export const WorkspaceProcessView: React.FC<WorkspaceProcessViewProps> = ({
  sessionId,
  initialStatus,
  onClose,
}) => {
  const [status, setStatus] = useState<WorkspaceProcessStatus | null>(initialStatus || null);
  const [lines, setLines] = useState<ProcessOutputEntry[]>([]);
  const [nextLineNumber, setNextLineNumber] = useState<number>(0);
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [copiedSession, setCopiedSession] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const isPollingRef = useRef(false);

  // Poll status and delta output
  const pollProcess = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;
    try {
      // 1. Fetch live status
      const updatedStatus = await getWorkspaceProcessStatus(sessionId);
      setStatus(updatedStatus);

      // 2. Fetch incremental output delta
      const outputDelta = await getWorkspaceProcessOutput(sessionId, nextLineNumber);
      if (outputDelta.lines && outputDelta.lines.length > 0) {
        setLines((prev) => {
          // Append only lines with higher lineNumber to prevent duplicates
          const newEntries = outputDelta.lines.filter(
            (nl) => !prev.some((pl) => pl.lineNumber === nl.lineNumber)
          );
          return [...prev, ...newEntries];
        });
      }
      setNextLineNumber(outputDelta.nextLineNumber);
    } catch (err) {
      console.warn('Process poll error (safe):', err);
    } finally {
      isPollingRef.current = false;
    }
  }, [sessionId, nextLineNumber]);

  // Active polling interval
  useEffect(() => {
    // Initial fetch
    pollProcess();

    // Poll every 400ms while running or starting
    const interval = setInterval(() => {
      if (
        !status ||
        status.state === 'RUNNING' ||
        status.state === 'STARTING' ||
        status.state === 'STOPPING'
      ) {
        pollProcess();
      }
    }, 450);

    return () => clearInterval(interval);
  }, [pollProcess, status?.state]);

  // Live duration timer
  useEffect(() => {
    if (!status) return;

    if (status.state === 'RUNNING' || status.state === 'STARTING' || status.state === 'STOPPING') {
      const startMs = status.startedAt * 1000;
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));

      const timer = setInterval(() => {
        setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
      }, 1000);

      return () => clearInterval(timer);
    } else if (status.finishedAt) {
      const totalSec = Math.max(0, status.finishedAt - status.startedAt);
      setElapsedSeconds(totalSec);
    }
  }, [status?.startedAt, status?.finishedAt, status?.state]);

  // Auto-scroll handler
  useEffect(() => {
    if (autoScroll && terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [lines.length, autoScroll]);

  // Scroll event listener to detect manual scroll-up
  const handleScroll = () => {
    if (!terminalBodyRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalBodyRef.current;
    const isAtBottom = scrollHeight - (scrollTop + clientHeight) < 30;
    setAutoScroll(isAtBottom);
  };

  const handleScrollToBottom = () => {
    if (!terminalBodyRef.current) return;
    terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    setAutoScroll(true);
  };

  // Stop process handler
  const handleStop = async () => {
    if (!status) return;
    setIsStopping(true);
    setStopError(null);
    try {
      const stopped = await stopWorkspaceProcess(sessionId);
      setStatus(stopped);
      // Immediate output refresh
      await pollProcess();
    } catch (err: any) {
      console.error('Failed to stop workspace process:', err);
      setStopError(err?.message || String(err) || 'Failed to stop process');
    } finally {
      setIsStopping(false);
    }
  };

  // Copy session ID
  const handleCopySessionId = async () => {
    try {
      await copyTextToClipboard(sessionId);
      setCopiedSession(true);
      setTimeout(() => setCopiedSession(false), 2000);
    } catch (err) {
      console.error('Failed to copy session ID:', err);
    }
  };

  // Copy full logs
  const handleCopyLogs = async () => {
    try {
      const fullText = lines.map((l) => l.text).join('\n');
      await copyTextToClipboard(fullText);
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 2000);
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  };

  // Clear local log display
  const handleClearDisplay = () => {
    setLines([]);
  };

  // Detect localhost URLs in terminal output
  const detectedUrls = extractLocalhostUrls(lines.map((l) => l.text)) || [];

  // Format elapsed time (hh:mm:ss)
  const formatDuration = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    if (hrs > 0) return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    return `${pad(mins)}:${pad(secs)}`;
  };

  const renderStateBadge = (state: WorkspaceProcessState) => {
    switch (state) {
      case 'RUNNING':
        return (
          <div className="mahi-proc-badge running">
            <span className="dot pulse" />
            <span>RUNNING</span>
          </div>
        );
      case 'STARTING':
        return (
          <div className="mahi-proc-badge starting">
            <RefreshCw size={11} className="mahi-spin" />
            <span>STARTING</span>
          </div>
        );
      case 'EXITED':
        return (
          <div className="mahi-proc-badge exited">
            <CheckCircle2 size={11} />
            <span>EXITED</span>
          </div>
        );
      case 'FAILED':
        return (
          <div className="mahi-proc-badge failed">
            <AlertCircle size={11} />
            <span>FAILED</span>
          </div>
        );
      case 'STOPPING':
        return (
          <div className="mahi-proc-badge stopping">
            <RefreshCw size={11} className="mahi-spin" />
            <span>STOPPING</span>
          </div>
        );
      case 'STOPPED':
        return (
          <div className="mahi-proc-badge stopped">
            <Square size={10} fill="currentColor" />
            <span>STOPPED</span>
          </div>
        );
      default:
        return <div className="mahi-proc-badge">{state}</div>;
    }
  };

  const isTerminalState =
    status?.state === 'EXITED' ||
    status?.state === 'FAILED' ||
    status?.state === 'STOPPED';

  return (
    <div className="mahi-workspace-process-card">
      {/* Session Top Bar */}
      <div className="mahi-proc-topbar">
        <div className="mahi-proc-identity">
          <div className="mahi-proc-icon">
            <Terminal size={15} />
          </div>
          <div className="mahi-proc-meta">
            <div className="mahi-proc-title-row">
              <span className="mahi-proc-action-label">
                {status?.actionOrScript || 'Workspace Action'}
              </span>
              {status && renderStateBadge(status.state)}
              {status?.pid && (
                <span className="mahi-proc-pid-pill">
                  <Cpu size={10} />
                  <span>PID: {status.pid}</span>
                </span>
              )}
            </div>
            <div className="mahi-proc-session-row">
              <span className="session-label">Isolated Process Session</span>
              <button
                type="button"
                className="mahi-copy-session-btn"
                onClick={handleCopySessionId}
                title={`Session ID: ${sessionId} (click to copy)`}
              >
                {copiedSession ? <Check size={11} /> : <Copy size={11} />}
                <span>{copiedSession ? 'Copied' : 'Session ID'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Process Controls */}
        <div className="mahi-proc-controls">
          <div className="mahi-proc-stats">
            <div className="stat-item" title="Elapsed runtime">
              <Clock size={12} />
              <span>{formatDuration(elapsedSeconds)}</span>
            </div>
            {status?.exitCode !== null && status?.exitCode !== undefined && (
              <div
                className={`stat-item exit-code ${status.exitCode === 0 ? 'success' : 'error'}`}
                title={`Process Exit Code: ${status.exitCode}`}
              >
                <span>Exit: {status.exitCode}</span>
              </div>
            )}
          </div>

          <button
            type="button"
            className="mahi-proc-btn stop"
            disabled={isTerminalState || isStopping}
            onClick={handleStop}
            title={isTerminalState ? 'Process already finished' : 'Stop Process Tree'}
          >
            {isStopping ? (
              <RefreshCw size={12} className="mahi-spin" />
            ) : (
              <Square size={12} fill="currentColor" />
            )}
            <span>Stop</span>
          </button>

          {onClose && (
            <button
              type="button"
              className="mahi-proc-btn close"
              onClick={onClose}
              title="Close process view"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Detected Localhost URLs */}
      {detectedUrls.length > 0 && (
        <div className="mahi-proc-url-banner">
          <Globe size={13} className="globe-icon" />
          <span className="url-label">Available Service:</span>
          <span className="url-link code-font">{detectedUrls[0]}</span>
          <button
            type="button"
            className="open-browser-btn"
            onClick={() => openExternalUrl(detectedUrls[0])}
            title="Open in default browser"
          >
            <ExternalLink size={12} />
            <span>Open Browser</span>
          </button>
        </div>
      )}

      {/* Error Message if Stop failed */}
      {stopError && (
        <div className="mahi-proc-error-strip">
          <AlertCircle size={13} />
          <span>{stopError}</span>
        </div>
      )}

      {/* Terminal Output Stream Area */}
      <div className="mahi-terminal-wrapper">
        <div className="mahi-terminal-toolbar">
          <div className="toolbar-left">
            <span className="terminal-title">Standard Output & Diagnostics</span>
            <span className="line-count">
              {lines.length} {lines.length === 1 ? 'line' : 'lines'}
            </span>
          </div>
          <div className="toolbar-right">
            <button
              type="button"
              className="terminal-tool-btn"
              onClick={handleCopyLogs}
              title="Copy Output"
            >
              {copiedLogs ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedLogs ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              type="button"
              className="terminal-tool-btn"
              onClick={handleClearDisplay}
              title="Clear Local Display"
            >
              <Trash2 size={12} />
              <span>Clear</span>
            </button>
          </div>
        </div>

        <div
          className="mahi-terminal-body code-font"
          ref={terminalBodyRef}
          onScroll={handleScroll}
        >
          {lines.length === 0 ? (
            <div className="terminal-placeholder">
              <p>Waiting for child process output...</p>
            </div>
          ) : (
            lines.map((entry) => {
              const isSystem = entry.text.startsWith('[mahi]');
              return (
                <div
                  key={entry.lineNumber}
                  className={`terminal-line ${entry.isStderr ? 'stderr' : ''} ${
                    isSystem ? 'system' : ''
                  }`}
                >
                  <span className="line-num">{entry.lineNumber}</span>
                  <span className="line-text">{entry.text}</span>
                  {entry.isStderr && <span className="stderr-tag">stderr</span>}
                </div>
              );
            })
          )}
        </div>

        {/* Scroll To Bottom Float Button */}
        {!autoScroll && lines.length > 0 && (
          <button
            type="button"
            className="mahi-scroll-bottom-btn"
            onClick={handleScrollToBottom}
            title="Scroll to latest output"
          >
            <ArrowDown size={13} />
            <span>Scroll to Bottom</span>
          </button>
        )}
      </div>

      {/* Terminal Exit Footer */}
      {isTerminalState && status && (
        <div
          className={`mahi-proc-exit-bar ${
            status.exitCode === 0 ? 'success' : status.state === 'STOPPED' ? 'stopped' : 'failed'
          }`}
        >
          {status.exitCode === 0 ? (
            <>
              <CheckCircle2 size={14} />
              <span>Process completed successfully (Exit code: 0)</span>
            </>
          ) : status.state === 'STOPPED' ? (
            <>
              <Square size={12} fill="currentColor" />
              <span>Process stopped by user request</span>
            </>
          ) : (
            <>
              <AlertCircle size={14} />
              <span>
                Process exited with failure (Exit code: {status.exitCode ?? 'Unknown'})
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
};
