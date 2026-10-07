import React, { useState } from 'react';
import { 
  FolderPlus, 
  Sparkles, 
  RefreshCw, 
  AlertCircle, 
  ArrowRight,
  Code2,
  Terminal,
  Cpu,
  Layers
} from 'lucide-react';
import './OnboardingView.css';

interface OnboardingViewProps {
  configuredRoots: string[];
  isScanning: boolean;
  scanError?: string | null;
  onAddFolder: () => Promise<void>;
  onSkip: () => void;
  onRescan: () => Promise<void>;
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({
  configuredRoots,
  isScanning,
  scanError,
  onAddFolder,
  onSkip,
  onRescan,
}) => {
  const [addingFolder, setAddingFolder] = useState(false);

  const handleAddFolderClick = async () => {
    setAddingFolder(true);
    try {
      await onAddFolder();
    } finally {
      setAddingFolder(false);
    }
  };

  const hasConfiguredRoots = configuredRoots.length > 0;

  return (
    <div className="mahi-onboarding-container">
      <div className="mahi-onboarding-glow" aria-hidden="true" />

      <div className="mahi-onboarding-card">
        {/* Header Badge & Brand */}
        <div className="onboarding-brand-badge">
          <div className="onboarding-sparkle-icon">
            <Sparkles size={16} />
          </div>
          <span className="onboarding-badge-text">Developer Workstation</span>
        </div>

        <h1 className="onboarding-main-title">Welcome to MAHI</h1>
        <p className="onboarding-subtitle">
          Your native Windows control room for local developer workspaces, active processes, and toolchains.
        </p>

        {/* Primary Setup Panel */}
        <div className="onboarding-setup-box">
          <div className="setup-box-header">
            <div className="setup-box-icon">
              <Layers size={18} />
            </div>
            <div>
              <h3 className="setup-box-title">Connect Your Workspaces</h3>
              <p className="setup-box-desc">
                Select the folder where your code repositories live. MAHI scans local directory manifests to automatically index your projects.
              </p>
            </div>
          </div>

          {/* Supported Technologies Strip */}
          <div className="onboarding-ecosystem-pills">
            <span className="ecosystem-pill"><Code2 size={12} /> Node.js</span>
            <span className="ecosystem-pill"><Cpu size={12} /> Rust & Cargo</span>
            <span className="ecosystem-pill"><Terminal size={12} /> Python</span>
            <span className="ecosystem-pill">Go</span>
            <span className="ecosystem-pill">Java</span>
            <span className="ecosystem-pill">Git Repos</span>
          </div>

          {/* Scanning In Progress State */}
          {(isScanning || addingFolder) && (
            <div className="onboarding-status-banner scanning">
              <RefreshCw size={16} className="mahi-spin" />
              <span>Scanning directories for developer projects...</span>
            </div>
          )}

          {/* No Projects Discovered Banner (When a root was added but 0 projects found) */}
          {!isScanning && !addingFolder && hasConfiguredRoots && (
            <div className="onboarding-status-banner warning">
              <AlertCircle size={16} />
              <div className="status-banner-text">
                <strong>No supported projects found in configured folders.</strong>
                <span>MAHI looks for package.json, Cargo.toml, pyproject.toml, go.mod, pom.xml, or .git. Select another folder or continue to Home.</span>
              </div>
            </div>
          )}

          {scanError && (
            <div className="onboarding-status-banner error">
              <AlertCircle size={16} />
              <span>{scanError}</span>
            </div>
          )}

          {/* Primary & Secondary Action Row */}
          <div className="onboarding-action-row">
            <button
              type="button"
              className="onboarding-btn primary"
              onClick={handleAddFolderClick}
              disabled={isScanning || addingFolder}
            >
              <FolderPlus size={16} />
              <span>{hasConfiguredRoots ? 'Add Another Folder' : 'Add Project Folder'}</span>
              <ArrowRight size={14} className="btn-arrow" />
            </button>

            {hasConfiguredRoots && (
              <button
                type="button"
                className="onboarding-btn secondary"
                onClick={onRescan}
                disabled={isScanning || addingFolder}
              >
                <RefreshCw size={14} className={isScanning ? 'mahi-spin' : ''} />
                <span>Rescan</span>
              </button>
            )}

            <button
              type="button"
              className="onboarding-btn text"
              onClick={onSkip}
              disabled={isScanning || addingFolder}
            >
              <span>{hasConfiguredRoots ? 'Continue to Home' : 'Skip for now'}</span>
            </button>
          </div>
        </div>

        {/* Value Proposition Highlights Strip */}
        <div className="onboarding-feature-strip">
          <div className="feature-item">
            <div className="feature-dot" />
            <div>
              <span className="feature-title">Instant Launch</span>
              <span className="feature-desc">Open in VS Code, Terminal, or Explorer</span>
            </div>
          </div>
          <div className="feature-item">
            <div className="feature-dot" />
            <div>
              <span className="feature-title">Process Manager</span>
              <span className="feature-desc">Live output streaming & port detection</span>
            </div>
          </div>
          <div className="feature-item">
            <div className="feature-dot" />
            <div>
              <span className="feature-title">Zero Machine Changes</span>
              <span className="feature-desc">Read-only scanner with safe manual actions</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
