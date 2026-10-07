import React, { useState, useEffect, useCallback } from 'react';
import {
  Play,
  X,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Terminal,
  Layers,
  Key,
  Folder,
  Cpu,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';
import {
  WorkspaceExecutionPlan,
  PreflightStatus,
  ToolDriftStatus
} from '../../types/workspaceEnvironment';
import {
  getWorkspaceExecutionPlan,
  startWorkspaceExecution
} from '../../services/tauriApi';
import { WorkspaceProcessStatus } from '../../types/workspaceProcess';
import './ExecutionPreviewModal.css';

interface ExecutionPreviewModalProps {
  isOpen: boolean;
  projectPath: string;
  projectName?: string;
  actionOrScript: string;
  onClose: () => void;
  onLaunched: (sessionStatus: WorkspaceProcessStatus) => void;
}

export const ExecutionPreviewModal: React.FC<ExecutionPreviewModalProps> = ({
  isOpen,
  projectPath,
  projectName,
  actionOrScript,
  onClose,
  onLaunched,
}) => {
  const [plan, setPlan] = useState<WorkspaceExecutionPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // Ephemeral in-memory secrets provided by user for this session only
  const [sessionSecrets, setSessionSecrets] = useState<Record<string, string>>({});
  const [showPathEntries, setShowPathEntries] = useState(false);
  const [showEnvVars, setShowEnvVars] = useState(true);

  // Fetch plan from D1 engine
  const fetchPlan = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLaunchError(null);
    try {
      const p = await getWorkspaceExecutionPlan(
        projectPath,
        actionOrScript
      );
      setPlan(p);
    } catch (err: any) {
      console.error('Failed to get workspace execution plan:', err);
      setError(err?.message || String(err) || 'Failed to generate execution plan');
    } finally {
      setLoading(false);
    }
  }, [projectPath, actionOrScript]);

  useEffect(() => {
    if (isOpen) {
      setSessionSecrets({});
      fetchPlan();
    }
  }, [isOpen, projectPath, actionOrScript, fetchPlan]);

  if (!isOpen) return null;

  // Handle secret input changes (in-memory session values)
  const handleSecretChange = (key: string, val: string) => {
    const updated = { ...sessionSecrets, [key]: val };
    setSessionSecrets(updated);
  };

  // Handle spawn confirmation
  const handleConfirmRun = async () => {
    if (!plan || !plan.isExecutable || plan.preflightStatus !== 'READY') return;
    setIsLaunching(true);
    setLaunchError(null);
    try {
      const status = await startWorkspaceExecution(
        projectPath,
        actionOrScript,
        sessionSecrets
      );
      onLaunched(status);
      onClose();
    } catch (err: any) {
      console.error('Failed to start workspace execution:', err);
      setLaunchError(err?.message || String(err) || 'Failed to spawn workspace process');
    } finally {
      setIsLaunching(false);
    }
  };

  // Format preflight status tag
  const renderPreflightStatusBadge = (status: PreflightStatus) => {
    switch (status) {
      case 'READY':
        return (
          <div className="mahi-preflight-badge ready">
            <CheckCircle2 size={15} />
            <span>Ready for Execution</span>
          </div>
        );
      case 'BLOCKED_VERSION_DRIFT':
        return (
          <div className="mahi-preflight-badge blocked">
            <AlertTriangle size={15} />
            <span>Blocked: Version Drift Detected</span>
          </div>
        );
      case 'BLOCKED_AMBIGUOUS_RESOLUTION':
        return (
          <div className="mahi-preflight-badge blocked">
            <AlertCircle size={15} />
            <span>Blocked: Ambiguous Tool Resolution</span>
          </div>
        );
      case 'BLOCKED_SECRET_UNAVAILABLE':
        return (
          <div className="mahi-preflight-badge amber">
            <Key size={15} />
            <span>Blocked: Ephemeral Secret Required</span>
          </div>
        );
      case 'BLOCKED_MISSING_TOOL':
        return (
          <div className="mahi-preflight-badge blocked">
            <Cpu size={15} />
            <span>Blocked: Missing Toolchain</span>
          </div>
        );
      case 'BLOCKED_MISSING_PROJECT':
        return (
          <div className="mahi-preflight-badge blocked">
            <Folder size={15} />
            <span>Blocked: Project Not Found</span>
          </div>
        );
      case 'BLOCKED_DISABLED_PROFILE':
        return (
          <div className="mahi-preflight-badge blocked">
            <ShieldAlert size={15} />
            <span>Blocked: Profile Disabled</span>
          </div>
        );
      case 'BLOCKED_UNAPPROVED_ACTION':
        return (
          <div className="mahi-preflight-badge blocked">
            <ShieldAlert size={15} />
            <span>Blocked: Unapproved Action</span>
          </div>
        );
      default:
        return (
          <div className="mahi-preflight-badge blocked">
            <AlertCircle size={15} />
            <span>{status.replace(/_/g, ' ')}</span>
          </div>
        );
    }
  };

  const renderDriftBadge = (drift: ToolDriftStatus) => {
    switch (drift) {
      case 'EXACT_MATCH':
        return <span className="mahi-drift-pill exact">Verified Match</span>;
      case 'VERSION_DRIFT':
        return <span className="mahi-drift-pill drift">Version Drift</span>;
      case 'MISSING':
        return <span className="mahi-drift-pill missing">Missing</span>;
      case 'UNVERIFIED':
        return <span className="mahi-drift-pill unverified">Unverified</span>;
      default:
        return <span className="mahi-drift-pill">{drift}</span>;
    }
  };

  return (
    <div className="mahi-modal-overlay" onClick={onClose}>
      <div className="mahi-preview-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mahi-preview-header">
          <div className="mahi-preview-title-box">
            <div className="mahi-preview-icon">
              <Terminal size={18} />
            </div>
            <div>
              <h2>Execution Preflight Preview</h2>
              <div className="mahi-preview-subtitle">
                <span className="mahi-preview-action-name">{actionOrScript}</span>
                <span className="mahi-preview-sep">•</span>
                <span className="mahi-preview-proj-name">{projectName || projectPath}</span>
              </div>
            </div>
          </div>
          <button type="button" className="mahi-preview-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="mahi-preview-body">
          {loading ? (
            <div className="mahi-preview-loading">
              <RefreshCw size={28} className="mahi-spin" />
              <p>Analyzing workspace execution plan & preflight gates...</p>
            </div>
          ) : error ? (
            <div className="mahi-preview-error-state">
              <AlertCircle size={32} className="error-icon" />
              <h3>Failed to build execution plan</h3>
              <p>{error}</p>
              <button
                type="button"
                className="mahi-preview-btn secondary"
                onClick={() => fetchPlan()}
              >
                <RefreshCw size={14} />
                <span>Retry Evaluation</span>
              </button>
            </div>
          ) : plan ? (
            <div className="mahi-preview-content">
              {/* Preflight Status Bar */}
              <div
                className={`mahi-preflight-banner ${
                  plan.preflightStatus === 'READY' ? 'ready' : 'blocked'
                }`}
              >
                <div className="mahi-preflight-banner-top">
                  {renderPreflightStatusBadge(plan.preflightStatus)}
                  <span className="mahi-preflight-kind-tag">
                    {plan.launchKind.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="mahi-preflight-summary">{plan.summaryMessage}</p>

                {/* Preflight Resolution Guidance when blocked */}
                {plan.preflightStatus !== 'READY' && (
                  <div className="mahi-preview-resolution-hint">
                    <span className="hint-label">How to resolve:</span>
                    <span className="hint-text">
                      {plan.preflightStatus === 'BLOCKED_VERSION_DRIFT' || plan.preflightStatus === 'BLOCKED_MISSING_TOOL'
                        ? 'Check your active runtime installations in Developer Environment · Toolchain & Profiles.'
                        : plan.preflightStatus === 'BLOCKED_DISABLED_PROFILE'
                        ? 'Enable this project profile under Developer Environment · Workspace Profiles.'
                        : plan.preflightStatus === 'BLOCKED_SECRET_UNAVAILABLE'
                        ? 'Enter the required ephemeral secret value below to authorize this execution session.'
                        : 'Review project configuration and toolchain requirements in Developer Environment.'}
                    </span>
                  </div>
                )}

                {/* Warnings / Special Notes */}
                {plan.verificationPlan.warnings.length > 0 && (
                  <div className="mahi-preview-warnings-box">
                    <div className="warnings-title">
                      <AlertTriangle size={13} />
                      <span>Preflight Warnings</span>
                    </div>
                    <ul>
                      {plan.verificationPlan.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Launch Specification Card */}
              <div className="mahi-preview-section">
                <div className="mahi-preview-section-title">
                  <Terminal size={14} />
                  <span>Execution Command & Working Directory</span>
                </div>
                <div className="mahi-spec-grid">
                  <div className="mahi-spec-item">
                    <span className="spec-label">Target Executable:</span>
                    <span className="spec-val code-font">{plan.executable}</span>
                  </div>
                  <div className="mahi-spec-item">
                    <span className="spec-label">Arguments:</span>
                    <span className="spec-val code-font">
                      {plan.arguments.length > 0
                        ? plan.arguments.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')
                        : '(none)'}
                    </span>
                  </div>
                  <div className="mahi-spec-item">
                    <span className="spec-label">Working Directory (CWD):</span>
                    <span className="spec-val code-font">{plan.cwd}</span>
                  </div>
                </div>
              </div>

              {/* Toolchain Bindings */}
              {plan.toolBindings.length > 0 && (
                <div className="mahi-preview-section">
                  <div className="mahi-preview-section-title">
                    <Cpu size={14} />
                    <span>Selected Toolchain Bindings</span>
                  </div>
                  <div className="mahi-bindings-list">
                    {plan.toolBindings.map((binding, idx) => (
                      <div key={idx} className="mahi-binding-card">
                        <div className="mahi-binding-header">
                          <span className="tool-name">{binding.tool.toUpperCase()}</span>
                          {renderDriftBadge(binding.driftStatus)}
                        </div>
                        <div className="mahi-binding-meta">
                          <div className="meta-row">
                            <span className="meta-lbl">Path:</span>
                            <span className="meta-val code-font">{binding.executablePath}</span>
                          </div>
                          <div className="meta-row">
                            <span className="meta-lbl">Expected Version:</span>
                            <span className="meta-val">
                              {binding.expectedVersion || 'Any / Unpinned'}
                            </span>
                          </div>
                          {binding.verifiedVersion && (
                            <div className="meta-row">
                              <span className="meta-lbl">Verified Version:</span>
                              <span className="meta-val">{binding.verifiedVersion}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Environment Overrides & Ephemeral Secrets */}
              <div className="mahi-preview-section">
                <div
                  className="mahi-preview-section-title clickable"
                  onClick={() => setShowEnvVars(!showEnvVars)}
                >
                  <Key size={14} />
                  <span>
                    Environment Overrides (
                    {Object.keys(plan.nonSecretEnvironment).length +
                      plan.protectedSecretKeys.length}
                    )
                  </span>
                  {showEnvVars ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>

                {showEnvVars && (
                  <div className="mahi-env-container">
                    {/* Non-secret Overrides */}
                    {Object.entries(plan.nonSecretEnvironment).map(([k, v]) => (
                      <div key={k} className="mahi-env-row">
                        <span className="env-key code-font">{k}</span>
                        <span className="env-eq">=</span>
                        <span className="env-val code-font">{v}</span>
                        <span className="env-badge normal">Plaintext</span>
                      </div>
                    ))}

                    {/* Protected Secrets */}
                    {plan.protectedSecretKeys.map((secretKey) => {
                      const hasSessionVal =
                        !!sessionSecrets[secretKey] &&
                        sessionSecrets[secretKey].trim().length > 0;
                      return (
                        <div key={secretKey} className="mahi-secret-row">
                          <div className="mahi-secret-header">
                            <Key size={13} className="key-icon" />
                            <span className="secret-key code-font">{secretKey}</span>
                            {hasSessionVal ? (
                              <span className="secret-badge available">
                                <ShieldCheck size={11} />
                                Available (Session Only)
                              </span>
                            ) : (
                              <span className="secret-badge required">
                                <ShieldAlert size={11} />
                                Ephemeral Value Required
                              </span>
                            )}
                          </div>
                          <div className="mahi-secret-input-box">
                            <input
                              type="password"
                              placeholder={`Enter session value for ${secretKey}...`}
                              value={sessionSecrets[secretKey] || ''}
                              onChange={(e) => handleSecretChange(secretKey, e.target.value)}
                              className="mahi-secret-input"
                            />
                            <span className="mahi-secret-hint">
                              Held in memory only. Never written to disk or logs.
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {Object.keys(plan.nonSecretEnvironment).length === 0 &&
                      plan.protectedSecretKeys.length === 0 && (
                        <div className="mahi-empty-env-hint">
                          No custom environment overrides configured.
                        </div>
                      )}
                  </div>
                )}
              </div>

              {/* Derived Synthesized PATH Entries */}
              <div className="mahi-preview-section">
                <div
                  className="mahi-preview-section-title clickable"
                  onClick={() => setShowPathEntries(!showPathEntries)}
                >
                  <Layers size={14} />
                  <span>Runtime PATH Additions ({plan.derivedPathEntries.length})</span>
                  {showPathEntries ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>

                {showPathEntries && (
                  <div className="mahi-path-list code-font">
                    {plan.derivedPathEntries.map((p, idx) => (
                      <div key={idx} className="mahi-path-entry">
                        <span className="path-idx">{idx + 1}.</span>
                        <span className="path-text">{p}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Launch Error Banner */}
              {launchError && (
                <div className="mahi-launch-error-banner">
                  <AlertCircle size={16} />
                  <span>{launchError}</span>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div className="mahi-preview-footer">
          <button
            type="button"
            className="mahi-preview-btn secondary"
            onClick={onClose}
            disabled={isLaunching}
          >
            Cancel
          </button>

          <button
            type="button"
            className={`mahi-preview-btn primary ${
              plan && plan.isExecutable && plan.preflightStatus === 'READY' ? '' : 'disabled'
            }`}
            disabled={!plan || !plan.isExecutable || plan.preflightStatus !== 'READY' || isLaunching}
            onClick={handleConfirmRun}
          >
            {isLaunching ? (
              <>
                <RefreshCw size={14} className="mahi-spin" />
                <span>Launching Process...</span>
              </>
            ) : (
              <>
                <Play size={14} fill="currentColor" />
                <span>Confirm & Run</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
