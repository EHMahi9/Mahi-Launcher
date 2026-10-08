import React, { useState, useEffect } from 'react';
import { 
  X, 
  Trash2, 
  HardDrive, 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  ShieldCheck, 
  FileCode2,
  FolderGit2,
  Plus,
  HelpCircle,
  Sparkles,
  ExternalLink,
  Activity,
  BrainCircuit,
  Compass,
  Palette,
  RotateCcw
} from 'lucide-react';
import { DebugStorageInfo, CleanStorageResult } from '../../types/project';
import { getDebugStorageInfo, cleanDebugArtifacts } from '../../services/tauriApi';
import {
  AppearanceSettings,
  AccentPresetId,
  GlassIntensity,
  BlurStrength,
  GlowIntensity,
  ACCENT_PRESETS,
  DEFAULT_APPEARANCE,
  loadAppearanceSettings,
  saveAppearanceSettings,
  applyAppearanceToDom
} from '../../types/appearance';
import './SettingsModal.css';

export type SettingsTabId = 'locations' | 'appearance' | 'maintenance' | 'help';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTabId;
  onOpenStorageIntelligence?: () => void;
  onOpenDeveloperHealth?: () => void;
  onOpenWorkstationHealth?: () => void;
  onResetOnboarding?: () => void;
  configuredRoots?: string[];
  onAddProjectFolder?: () => void;
  onRemoveProjectFolder?: (path: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ 
  isOpen, 
  onClose,
  initialTab = 'locations',
  onOpenStorageIntelligence,
  onOpenDeveloperHealth,
  onOpenWorkstationHealth,
  onResetOnboarding,
  configuredRoots = [],
  onAddProjectFolder,
  onRemoveProjectFolder,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [appearance, setAppearance] = useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const [storageInfo, setStorageInfo] = useState<DebugStorageInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<CleanStorageResult | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStorageInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await getDebugStorageInfo();
      setStorageInfo(info);
    } catch (err: any) {
      console.error('Failed to get storage info:', err);
      setError(err?.message || 'Failed to inspect debug storage');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setCleanResult(null);
      setConfirmPrompt(false);
      setAppearance(loadAppearanceSettings());
      fetchStorageInfo();
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const handleUpdateAppearance = (partial: Partial<AppearanceSettings>) => {
    const next: AppearanceSettings = { ...appearance, ...partial };
    setAppearance(next);
    applyAppearanceToDom(next);
    saveAppearanceSettings(next);
  };

  const handleResetAppearance = () => {
    setAppearance(DEFAULT_APPEARANCE);
    applyAppearanceToDom(DEFAULT_APPEARANCE);
    saveAppearanceSettings(DEFAULT_APPEARANCE);
  };

  const handleClean = async () => {
    setCleaning(true);
    setError(null);
    try {
      const res = await cleanDebugArtifacts();
      setCleanResult(res);
      setConfirmPrompt(false);
      // Re-fetch storage info to reflect 0 MB
      await fetchStorageInfo();
    } catch (err: any) {
      console.error('Failed to clean debug artifacts:', err);
      setError(err?.message || 'Failed to clean debug artifacts');
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="mahi-settings-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="mahi-settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="mahi-settings-header">
          <div className="mahi-settings-title-group">
            <div className="mahi-settings-icon-badge">
              {activeTab === 'appearance' ? (
                <Palette size={18} />
              ) : activeTab === 'help' ? (
                <HelpCircle size={18} />
              ) : (
                <HardDrive size={18} />
              )}
            </div>
            <div>
              <h2 className="mahi-settings-title">MAHI Settings & Preferences</h2>
              <span className="mahi-settings-subtitle">Workspace Configuration, Maintenance & Quick Help</span>
            </div>
          </div>
          <button 
            type="button" 
            className="mahi-settings-close-btn" 
            onClick={onClose}
            title="Close Settings (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Subheader Tab Bar */}
        <div className="mahi-settings-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'locations'}
            className={`mahi-settings-tab ${activeTab === 'locations' ? 'active' : ''}`}
            onClick={() => setActiveTab('locations')}
          >
            <FolderGit2 size={13} />
            <span>Locations</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'appearance'}
            className={`mahi-settings-tab ${activeTab === 'appearance' ? 'active' : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            <Palette size={13} />
            <span>Appearance</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'maintenance'}
            className={`mahi-settings-tab ${activeTab === 'maintenance' ? 'active' : ''}`}
            onClick={() => setActiveTab('maintenance')}
          >
            <HardDrive size={13} />
            <span>Maintenance</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'help'}
            className={`mahi-settings-tab ${activeTab === 'help' ? 'active' : ''}`}
            onClick={() => setActiveTab('help')}
          >
            <HelpCircle size={13} />
            <span>Help & About</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="mahi-settings-body">
          {/* TAB 1: Locations & Discovery */}
          {activeTab === 'locations' && (
            <>
              <div className="mahi-settings-section">
                <div className="mahi-settings-section-header">
                  <div className="mahi-section-heading">
                    <FolderGit2 size={16} className="section-icon" />
                    <h3>Project Scan Roots</h3>
                  </div>
                  {onAddProjectFolder && (
                    <button
                      type="button"
                      className="mahi-settings-refresh-btn"
                      onClick={onAddProjectFolder}
                      title="Add folder to project discovery"
                    >
                      <Plus size={13} />
                      <span>Add Folder</span>
                    </button>
                  )}
                </div>

                <p className="mahi-settings-desc">
                  MAHI discovers Git repositories and software projects in these directories (scanned up to 3 folders deep).
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                  {configuredRoots && configuredRoots.length > 0 ? (
                    configuredRoots.map((root) => (
                      <div
                        key={root}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          background: 'rgba(14, 30, 54, 0.6)',
                          border: '1px solid rgba(64, 128, 255, 0.15)',
                          borderRadius: '6px',
                          fontSize: '12px',
                          color: '#e2e8f0',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '420px' }} title={root}>
                          {root}
                        </span>
                        {onRemoveProjectFolder && (
                          <button
                            type="button"
                            onClick={() => onRemoveProjectFolder(root)}
                            title="Remove scan root"
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#f87171',
                              cursor: 'pointer',
                              padding: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              borderRadius: '4px',
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: '12px', color: '#8ea0bc', padding: '6px 0', fontStyle: 'italic' }}>
                      No custom scan roots configured. Standard locations (Documents, Desktop, C:\Projects) are scanned automatically.
                    </div>
                  )}
                </div>
              </div>

              {/* Onboarding Guide Replay Section */}
              {onResetOnboarding && (
                <div className="mahi-settings-section" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '16px' }}>
                  <div className="mahi-settings-section-header">
                    <div className="mahi-section-heading">
                      <Sparkles size={16} className="section-icon" />
                      <h3>Onboarding Walkthrough</h3>
                    </div>
                    <button
                      type="button"
                      className="mahi-settings-refresh-btn"
                      onClick={onResetOnboarding}
                      title="Replay onboarding walkthrough"
                    >
                      <Sparkles size={13} />
                      <span>Re-run Walkthrough</span>
                    </button>
                  </div>
                  <p className="mahi-settings-desc">
                    Re-open the initial setup guide to reconfigure recommended developer paths and discover projects.
                  </p>
                </div>
              )}
            </>
          )}

          {/* TAB 2: Appearance & Visual Identity */}
          {activeTab === 'appearance' && (
            <>
              {/* Section 1: Color Identity Presets */}
              <div className="mahi-settings-section">
                <div className="mahi-settings-section-header">
                  <div className="mahi-section-heading">
                    <Palette size={16} className="section-icon" />
                    <h3>Accent Color Theme</h3>
                  </div>
                </div>
                <p className="mahi-settings-desc">
                  Select a signature color identity for workspace highlights, active indicators, and luminous borders.
                </p>

                <div className="mahi-appearance-presets-grid">
                  {(Object.keys(ACCENT_PRESETS) as AccentPresetId[]).map((presetKey) => {
                    const p = ACCENT_PRESETS[presetKey];
                    const isSelected = appearance.preset === presetKey;
                    return (
                      <button
                        key={presetKey}
                        type="button"
                        className={`mahi-preset-btn ${isSelected ? 'active' : ''}`}
                        onClick={() => handleUpdateAppearance({ preset: presetKey })}
                      >
                        <span 
                          className="mahi-preset-dot" 
                          style={{ backgroundColor: p.primary, boxShadow: `0 0 8px ${p.primary}` }} 
                        />
                        <span>{p.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 2: Glass Surface Translucency */}
              <div className="mahi-settings-section">
                <div className="mahi-appearance-setting-row">
                  <div className="mahi-setting-meta">
                    <div className="mahi-setting-title">Glass Surface Intensity</div>
                    <div className="mahi-setting-desc">Adjust the translucency level of cards, panels, and sidebars.</div>
                  </div>
                  <div className="mahi-segmented-group">
                    {(['low', 'medium', 'high'] as GlassIntensity[]).map((intensity) => (
                      <button
                        key={intensity}
                        type="button"
                        className={`mahi-segmented-btn ${appearance.glassIntensity === intensity ? 'active' : ''}`}
                        onClick={() => handleUpdateAppearance({ glassIntensity: intensity })}
                      >
                        {intensity.charAt(0).toUpperCase() + intensity.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Section 3: Backdrop Blur Strength */}
              <div className="mahi-settings-section">
                <div className="mahi-appearance-setting-row">
                  <div className="mahi-setting-meta">
                    <div className="mahi-setting-title">Backdrop Blur Strength</div>
                    <div className="mahi-setting-desc">Control diffusion depth across background layers.</div>
                  </div>
                  <div className="mahi-segmented-group">
                    {(['subtle', 'standard', 'deep'] as BlurStrength[]).map((blur) => (
                      <button
                        key={blur}
                        type="button"
                        className={`mahi-segmented-btn ${appearance.blurStrength === blur ? 'active' : ''}`}
                        onClick={() => handleUpdateAppearance({ blurStrength: blur })}
                      >
                        {blur.charAt(0).toUpperCase() + blur.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Section 4: Luminous Glow */}
              <div className="mahi-settings-section">
                <div className="mahi-appearance-setting-row">
                  <div className="mahi-setting-meta">
                    <div className="mahi-setting-title">Luminous Glow Highlight</div>
                    <div className="mahi-setting-desc">Radiant accent bloom on active elements, buttons, and cards.</div>
                  </div>
                  <div className="mahi-segmented-group">
                    {(['off', 'subtle', 'vibrant'] as GlowIntensity[]).map((glow) => (
                      <button
                        key={glow}
                        type="button"
                        className={`mahi-segmented-btn ${appearance.glowIntensity === glow ? 'active' : ''}`}
                        onClick={() => handleUpdateAppearance({ glowIntensity: glow })}
                      >
                        {glow.charAt(0).toUpperCase() + glow.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Section 5: Glass Preview & Reset */}
              <div className="mahi-settings-section">
                <div className="mahi-appearance-preview-card">
                  <div className="mahi-appearance-preview-header">
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>Live Glass Surface Preview</span>
                    <span className="mahi-preview-badge">Active Atmosphere</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '11.5px', color: '#94a3b8', lineHeight: 1.4 }}>
                    Translucent surface layers, specular highlights, and soft luminous borders active across MAHI workspace views.
                  </p>
                </div>

                <div className="mahi-appearance-reset-row">
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Restores the canonical MAHI Blue developer appearance.</span>
                  <button
                    type="button"
                    className="mahi-reset-appearance-btn"
                    onClick={handleResetAppearance}
                  >
                    <RotateCcw size={12} />
                    <span>Reset to MAHI Default</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* TAB 3: Maintenance & Storage */}
          {activeTab === 'maintenance' && (
            <>
              {onOpenStorageIntelligence && (
                <div 
                  style={{
                    background: 'rgba(0, 210, 255, 0.08)',
                    border: '1px solid rgba(0, 210, 255, 0.25)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    marginBottom: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer'
                  }}
                  onClick={() => {
                    onClose();
                    onOpenStorageIntelligence();
                  }}
                >
                  <div>
                    <div style={{ color: '#00d2ff', fontWeight: 700, fontSize: '13px' }}>
                      MAHI Storage Diagnostics Engine
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: '11px', marginTop: '2px' }}>
                      Analyze drive utilization, developer toolchain caches & safe C→D relocation recommendations.
                    </div>
                  </div>
                  <button 
                    type="button" 
                    style={{
                      background: '#00d2ff',
                      color: '#0f172a',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '6px 12px',
                      fontWeight: 700,
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
                  >
                    Open Engine
                  </button>
                </div>
              )}

              {/* Rust & Tauri Debug Artifacts Section */}
              <div className="mahi-settings-section">
                <div className="mahi-settings-section-header">
                  <div className="mahi-section-heading">
                    <FileCode2 size={16} className="section-icon" />
                    <h3>Rust & Tauri Debug Artifacts</h3>
                  </div>
                  <button
                    type="button"
                    className="mahi-settings-refresh-btn"
                    onClick={fetchStorageInfo}
                    disabled={loading || cleaning}
                    title="Refresh storage size"
                  >
                    <RefreshCw size={13} className={loading ? 'spinning' : ''} />
                    <span>Refresh</span>
                  </button>
                </div>

                <p className="mahi-settings-desc">
                  During local development and testing, Rust compiles debug builds into <code>src-tauri/target/debug</code>. 
                  Cleaning these reclaimed artifacts does <strong>not</strong> affect source code, node_modules, or production release bundles.
                </p>

                {/* Storage Info Card */}
                <div className="mahi-storage-card">
                  <div className="mahi-storage-metric">
                    <span className="storage-metric-label">Debug Compilation Size</span>
                    <div className="storage-metric-value-row">
                      <span className="storage-metric-num">
                        {loading ? 'Calculating...' : storageInfo ? `${storageInfo.sizeMb} MB` : '0 MB'}
                      </span>
                      {storageInfo && storageInfo.sizeGb > 0.05 && (
                        <span className="storage-metric-gb">({storageInfo.sizeGb} GB)</span>
                      )}
                    </div>
                  </div>

                  <div className="mahi-storage-status">
                    {storageInfo?.exists && storageInfo.sizeBytes > 0 ? (
                      <span className="storage-badge warning">
                        <AlertTriangle size={12} />
                        Artifacts Present
                      </span>
                    ) : (
                      <span className="storage-badge clean">
                        <ShieldCheck size={12} />
                        Clean & Lean
                      </span>
                    )}
                  </div>
                </div>

                {/* Safety Notice */}
                <div className="mahi-safety-callout">
                  <ShieldCheck size={14} className="safety-icon" />
                  <span>
                    Safe Action: Targets strictly <code>target/debug</code>. Releases, installers, and project sources are completely untouched.
                  </span>
                </div>

                {/* Error Notification */}
                {error && (
                  <div className="mahi-settings-error">
                    <AlertTriangle size={14} />
                    <span>{error}</span>
                  </div>
                )}

                {/* Success Result */}
                {cleanResult && (
                  <div className="mahi-settings-success">
                    <CheckCircle2 size={14} />
                    <span>{cleanResult.message || `Reclaimed ${cleanResult.recoveredMb} MB of disk space.`}</span>
                  </div>
                )}

                {/* Action Buttons / Confirmation */}
                <div className="mahi-settings-actions">
                  {!confirmPrompt ? (
                    <button
                      type="button"
                      className="mahi-clean-btn"
                      disabled={loading || cleaning || !storageInfo?.exists || storageInfo.sizeBytes === 0}
                      onClick={() => setConfirmPrompt(true)}
                    >
                      <Trash2 size={14} />
                      <span>Clean Rust/Tauri Debug Artifacts</span>
                    </button>
                  ) : (
                    <div className="mahi-confirm-box">
                      <div className="mahi-confirm-text">
                        <AlertTriangle size={15} />
                        <span>Delete <code>target/debug</code> compilation cache?</span>
                      </div>
                      <div className="mahi-confirm-buttons">
                        <button
                          type="button"
                          className="mahi-confirm-yes-btn"
                          onClick={handleClean}
                          disabled={cleaning}
                        >
                          {cleaning ? 'Cleaning...' : 'Yes, Delete Debug Artifacts'}
                        </button>
                        <button
                          type="button"
                          className="mahi-confirm-cancel-btn"
                          onClick={() => setConfirmPrompt(false)}
                          disabled={cleaning}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* TAB 3: Shortcuts, Help & About */}
          {activeTab === 'help' && (
            <>
              {/* Keyboard Shortcuts Table */}
              <div className="mahi-settings-section">
                <div className="mahi-settings-section-header">
                  <div className="mahi-section-heading">
                    <Compass size={16} className="section-icon" />
                    <h3>Keyboard Shortcuts</h3>
                  </div>
                </div>

                <div className="mahi-shortcuts-table">
                  <div className="mahi-shortcut-row">
                    <span className="mahi-shortcut-label">Toggle & Focus Global Launcher</span>
                    <div className="mahi-shortcut-keys">
                      <span className="mahi-kbd">Alt</span>
                      <span>+</span>
                      <span className="mahi-kbd">Space</span>
                    </div>
                  </div>
                  <div className="mahi-shortcut-row">
                    <span className="mahi-shortcut-label">Hide MAHI or Dismiss Modals</span>
                    <div className="mahi-shortcut-keys">
                      <span className="mahi-kbd">Esc</span>
                    </div>
                  </div>
                  <div className="mahi-shortcut-row">
                    <span className="mahi-shortcut-label">Open New Filesystem Tab</span>
                    <div className="mahi-shortcut-keys">
                      <span className="mahi-kbd">Ctrl</span>
                      <span>+</span>
                      <span className="mahi-kbd">T</span>
                    </div>
                  </div>
                  <div className="mahi-shortcut-row">
                    <span className="mahi-shortcut-label">Close Active Filesystem Tab</span>
                    <div className="mahi-shortcut-keys">
                      <span className="mahi-kbd">Ctrl</span>
                      <span>+</span>
                      <span className="mahi-kbd">W</span>
                    </div>
                  </div>
                  <div className="mahi-shortcut-row">
                    <span className="mahi-shortcut-label">Cycle Explorer Tabs</span>
                    <div className="mahi-shortcut-keys">
                      <span className="mahi-kbd">Ctrl</span>
                      <span>+</span>
                      <span className="mahi-kbd">Tab</span>
                    </div>
                  </div>
                  <div className="mahi-shortcut-row">
                    <span className="mahi-shortcut-label">Open Selected Result in VS Code</span>
                    <div className="mahi-shortcut-keys">
                      <span className="mahi-kbd">Enter</span>
                    </div>
                  </div>
                  <div className="mahi-shortcut-row">
                    <span className="mahi-shortcut-label">Navigate Search Results</span>
                    <div className="mahi-shortcut-keys">
                      <span className="mahi-kbd">↑</span>
                      <span>/</span>
                      <span className="mahi-kbd">↓</span>
                    </div>
                  </div>
                  <div className="mahi-shortcut-row">
                    <span className="mahi-shortcut-label">Filesystem Copy / Cut / Paste</span>
                    <div className="mahi-shortcut-keys">
                      <span className="mahi-kbd">Ctrl</span>
                      <span>+</span>
                      <span className="mahi-kbd">C / X / V</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contextual Diagnosis Jump Links */}
              <div className="mahi-settings-section">
                <div className="mahi-settings-section-header">
                  <div className="mahi-section-heading">
                    <Activity size={16} className="section-icon" />
                    <h3>Diagnostic Surfaces</h3>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {onOpenWorkstationHealth && (
                    <button
                      type="button"
                      className="mahi-nav-link-btn"
                      onClick={() => {
                        onClose();
                        onOpenWorkstationHealth();
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <BrainCircuit size={15} color="#00d2ff" />
                        <span>Workstation Health & Correlated Findings</span>
                      </div>
                      <ExternalLink size={13} color="#8ea0bc" />
                    </button>
                  )}

                  {onOpenDeveloperHealth && (
                    <button
                      type="button"
                      className="mahi-nav-link-btn"
                      onClick={() => {
                        onClose();
                        onOpenDeveloperHealth();
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Activity size={15} color="#34d399" />
                        <span>Developer Environment & Toolchain Resolver</span>
                      </div>
                      <ExternalLink size={13} color="#8ea0bc" />
                    </button>
                  )}
                </div>
              </div>

              {/* About MAHI Section */}
              <div className="mahi-settings-section">
                <div className="mahi-settings-section-header">
                  <div className="mahi-section-heading">
                    <ShieldCheck size={16} className="section-icon" />
                    <h3>About MAHI</h3>
                  </div>
                </div>

                <div className="mahi-about-card">
                  <div className="mahi-about-grid">
                    <div className="mahi-about-item">
                      <span className="mahi-about-label">Product Version</span>
                      <span className="mahi-about-value">v0.1.0 (V1 Release Candidate)</span>
                    </div>
                    <div className="mahi-about-item">
                      <span className="mahi-about-label">Operating System</span>
                      <span className="mahi-about-value">Windows 11 (x86_64)</span>
                    </div>
                    <div className="mahi-about-item">
                      <span className="mahi-about-label">Desktop Engine</span>
                      <span className="mahi-about-value">Tauri 2 (Rust + WebView2)</span>
                    </div>
                    <div className="mahi-about-item">
                      <span className="mahi-about-label">Safety Contract</span>
                      <span className="mahi-about-value">Non-Destructive & Memory-Only Secrets</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="mahi-settings-footer">
          <span className="mahi-settings-footer-note">
            MAHI Developer Workspace · Windows Native Integration
          </span>
          <button type="button" className="mahi-settings-done-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
