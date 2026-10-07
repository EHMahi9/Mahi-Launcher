import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Activity,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Layers,
  Terminal,
  HardDrive,
  Copy,
  Search,
  Package,
  Cpu,
  FileCode,
  Check,
  Wrench,
  RotateCcw,
  Plus,
  Trash2,
  Save,
  Lock,
  Unlock,
  Sliders,
} from 'lucide-react';
import {
  DeveloperEnvironmentReport,
  HealthStatus,
  ProjectCompatibilityCheck,
} from '../../types/health';
import {
  RepairPlan,
  RepairExecutionResult,
  RepairHistoryEntry,
  RestorePreview,
} from '../../types/repair';
import {
  ToolInstallation,
  ProjectToolchainReport,
  ResolutionStatus,
} from '../../types/toolchain';
import {
  WorkspaceProfile,
  WorkspaceToolBinding,
  WorkspaceEnvOverride,
  WorkspaceProfileValidation,
  PROTECTED_SECRET_MARKER,
} from '../../types/workspaceProfile';
import {
  runDeveloperEnvironmentAudit,
  auditProjectCompatibility,
  copyTextToClipboard,
  getAvailableRepairs,
  executeDeveloperEnvironmentRepair,
  getRepairHistory,
  getRestoreConfigurationPreview,
  executeRestoreConfiguration,
  getToolchainInstallations,
  resolveProjectToolchain,
  getWorkspaceProfile,
  saveWorkspaceProfile,
  deleteWorkspaceProfile,
  validateWorkspaceProfile,
} from '../../services/tauriApi';
import './DeveloperHealthView.css';

interface DeveloperHealthViewProps {
  onNavigateToPath?: (path: string) => void;
  initialProjectPath?: string;
  initialTab?: TabType;
  targetId?: string | null;
}

type TabType =
  | 'overview'
  | 'repairs'
  | 'tools'
  | 'path'
  | 'versions'
  | 'compatibility'
  | 'toolchain'
  | 'environment'
  | 'storage';

export const DeveloperHealthView: React.FC<DeveloperHealthViewProps> = ({
  onNavigateToPath: _onNavigateToPath,
  initialProjectPath,
  initialTab = 'overview',
  targetId = null,
}) => {
  const [report, setReport] = useState<DeveloperEnvironmentReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Synchronize tab and project when deep-linked
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (initialProjectPath) {
      setInspectProjectPath(initialProjectPath);
    }
  }, [initialProjectPath]);

  // Phase 9B: Repair Center state
  const [repairs, setRepairs] = useState<RepairPlan[]>([]);
  const [repairHistory, setRepairHistory] = useState<RepairHistoryEntry[]>([]);
  const [selectedRepair, setSelectedRepair] = useState<RepairPlan | null>(null);
  const [repairing, setRepairing] = useState<boolean>(false);
  const [repairResult, setRepairResult] = useState<RepairExecutionResult | null>(null);
  const [selectedRestore, setSelectedRestore] = useState<RestorePreview | null>(null);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Auto-select matching repair plan if targetId passed to repairs tab
  useEffect(() => {
    if (targetId && activeTab === 'repairs' && repairs.length > 0 && !selectedRepair) {
      const match = repairs.find(
        (r) => r.id === targetId ||
               r.category.toLowerCase().includes(targetId.toLowerCase()) ||
               r.affectedItem.toLowerCase().includes(targetId.toLowerCase())
      );
      if (match) {
        setSelectedRepair(match);
      }
    }
  }, [targetId, activeTab, repairs, selectedRepair]);

  // Filters & Search
  const [toolSearch, setToolSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [pathFilter, setPathFilter] = useState<'all' | 'warnings' | 'dev'>('all');

  // Live project compatibility auditor state
  const [inspectProjectPath, setInspectProjectPath] = useState<string>(
    initialProjectPath || ''
  );
  const [customProjectCheck, setCustomProjectCheck] = useState<ProjectCompatibilityCheck | null>(
    null
  );
  const [inspectingProject, setInspectingProject] = useState(false);

  // Phase 9C-B: Toolchain Resolution Engine state
  const [toolchainReport, setToolchainReport] = useState<ProjectToolchainReport | null>(null);
  const [allToolchainInstalls, setAllToolchainInstalls] = useState<ToolInstallation[]>([]);

  // Phase 9C-C: Workspace Profile Model state
  const [currentProfile, setCurrentProfile] = useState<WorkspaceProfile | null>(null);
  const [profileValidation, setProfileValidation] = useState<WorkspaceProfileValidation | null>(null);
  const [savingProfile, setSavingProfile] = useState<boolean>(false);
  const [validatingProfile, setValidatingProfile] = useState<boolean>(false);
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvVal, setNewEnvVal] = useState('');
  const [newEnvSecret, setNewEnvSecret] = useState(false);

  const fetchProfileForProject = useCallback(async (path: string) => {
    try {
      const prof = await getWorkspaceProfile(path);
      setCurrentProfile(prof);
      if (prof) {
        const val = await validateWorkspaceProfile(path);
        setProfileValidation(val);
      } else {
        setProfileValidation(null);
      }
    } catch (err) {
      console.error('Failed to load workspace profile:', err);
    }
  }, []);

  const fetchAuditReport = useCallback(async () => {
    setLoading(true);
    try {
      const [auditData, availableRepairs, history, tcReport, tcInstalls] = await Promise.all([
        runDeveloperEnvironmentAudit([inspectProjectPath]),
        getAvailableRepairs(),
        getRepairHistory(),
        resolveProjectToolchain(inspectProjectPath),
        getToolchainInstallations(),
      ]);
      setReport(auditData);
      setRepairs(availableRepairs);
      setRepairHistory(history);
      setToolchainReport(tcReport);
      setAllToolchainInstalls(tcInstalls);
      await fetchProfileForProject(inspectProjectPath);
    } catch (err) {
      console.error('Failed to run developer environment audit or fetch repairs:', err);
    } finally {
      setLoading(false);
    }
  }, [inspectProjectPath, fetchProfileForProject]);

  useEffect(() => {
    fetchAuditReport();
  }, [fetchAuditReport]);

  const handleCopy = async (text: string) => {
    try {
      await copyTextToClipboard(text);
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), 2000);
    } catch (e) {
      console.error('Failed to copy to clipboard', e);
    }
  };

  const handleInspectCustomProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectProjectPath.trim()) return;
    setInspectingProject(true);
    try {
      const [res, tcReport] = await Promise.all([
        auditProjectCompatibility(inspectProjectPath.trim()),
        resolveProjectToolchain(inspectProjectPath.trim()),
      ]);
      setCustomProjectCheck(res);
      setToolchainReport(tcReport);
      await fetchProfileForProject(inspectProjectPath.trim());
    } catch (err) {
      console.error('Failed to audit project compatibility:', err);
    } finally {
      setInspectingProject(false);
    }
  };

  // Phase 9C-C: Workspace Profile Handlers
  const handleCreateProfile = () => {
    const projectName = inspectProjectPath.split(/[\\/]/).filter(Boolean).pop() || 'Workspace';
    const newProf: WorkspaceProfile = {
      id: `profile-${Date.now()}`,
      projectPath: inspectProjectPath,
      projectName,
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
      enabled: true,
      toolBindings: [],
      environmentOverrides: [],
    };
    setCurrentProfile(newProf);
    setProfileValidation(null);
    setActionMessage({
      text: `Initialized new workspace profile for '${projectName}'. Bind your desired toolchains below.`,
      type: 'info',
    });
  };

  const handleBindTool = (inst: ToolInstallation) => {
    if (!currentProfile) return;
    const existingIdx = currentProfile.toolBindings.findIndex((b) => b.tool === inst.tool);
    const newBinding: WorkspaceToolBinding = {
      tool: inst.tool,
      installationId: inst.id,
      executablePath: inst.executablePath,
      version: inst.version,
      enabled: true,
    };
    let updatedBindings = [...currentProfile.toolBindings];
    if (existingIdx >= 0) {
      updatedBindings[existingIdx] = newBinding;
    } else {
      updatedBindings.push(newBinding);
    }
    setCurrentProfile({
      ...currentProfile,
      toolBindings: updatedBindings,
    });
  };

  const handleRemoveBinding = (tool: string) => {
    if (!currentProfile) return;
    setCurrentProfile({
      ...currentProfile,
      toolBindings: currentProfile.toolBindings.filter((b) => b.tool !== tool),
    });
  };

  const handleToggleBinding = (tool: string) => {
    if (!currentProfile) return;
    setCurrentProfile({
      ...currentProfile,
      toolBindings: currentProfile.toolBindings.map((b) =>
        b.tool === tool ? { ...b, enabled: !b.enabled } : b
      ),
    });
  };

  const handleAddEnvOverride = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProfile || !newEnvKey.trim()) return;
    const newOv: WorkspaceEnvOverride = {
      key: newEnvKey.trim(),
      value: newEnvVal,
      enabled: true,
      isSecret: newEnvSecret,
    };
    const updated = currentProfile.environmentOverrides.filter(
      (o) => o.key.toUpperCase() !== newEnvKey.trim().toUpperCase()
    );
    updated.push(newOv);
    setCurrentProfile({
      ...currentProfile,
      environmentOverrides: updated,
    });
    setNewEnvKey('');
    setNewEnvVal('');
    setNewEnvSecret(false);
  };

  const handleRemoveEnvOverride = (key: string) => {
    if (!currentProfile) return;
    setCurrentProfile({
      ...currentProfile,
      environmentOverrides: currentProfile.environmentOverrides.filter((o) => o.key !== key),
    });
  };

  const handleSaveProfile = async () => {
    if (!currentProfile) return;
    setSavingProfile(true);
    setActionMessage(null);
    try {
      const saved = await saveWorkspaceProfile(currentProfile);
      setCurrentProfile(saved);
      const val = await validateWorkspaceProfile(saved.projectPath);
      setProfileValidation(val);
      setActionMessage({
        text: `Workspace profile for '${saved.projectName}' saved successfully.`,
        type: 'success',
      });
    } catch (err: any) {
      setActionMessage({
        text: `Failed to save workspace profile: ${err?.message || String(err)}`,
        type: 'error',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleValidateProfile = async () => {
    if (!currentProfile) return;
    setValidatingProfile(true);
    try {
      const val = await validateWorkspaceProfile(currentProfile.projectPath);
      setProfileValidation(val);
      setActionMessage({
        text: `Profile validation: ${val.status} (${val.summary})`,
        type: val.isValid ? 'success' : 'error',
      });
    } catch (err: any) {
      setActionMessage({
        text: `Validation failed: ${err?.message || String(err)}`,
        type: 'error',
      });
    } finally {
      setValidatingProfile(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!currentProfile) return;
    try {
      await deleteWorkspaceProfile(currentProfile.projectPath);
      setCurrentProfile(null);
      setProfileValidation(null);
      setActionMessage({
        text: 'Workspace profile deleted from MAHI storage.',
        type: 'info',
      });
    } catch (err: any) {
      setActionMessage({
        text: `Failed to delete profile: ${err?.message || String(err)}`,
        type: 'error',
      });
    }
  };

  // Phase 9B: Repair Handlers
  const handleOpenRepairPreview = (repair: RepairPlan) => {
    setSelectedRepair(repair);
    setRepairResult(null);
  };

  const handleExecuteRepair = async (repairId: string) => {
    setRepairing(true);
    setActionMessage(null);
    try {
      const result = await executeDeveloperEnvironmentRepair(repairId);
      setRepairResult(result);
      if (result.success) {
        setActionMessage({
          text: `Repair "${result.affectedItem}" applied successfully and verified. Snapshot saved: ${result.snapshotId}.`,
          type: 'success',
        });
        // Re-fetch report and history to update available repairs and audit status
        const [auditData, availableRepairs, history] = await Promise.all([
          runDeveloperEnvironmentAudit([inspectProjectPath]),
          getAvailableRepairs(),
          getRepairHistory(),
        ]);
        setReport(auditData);
        setRepairs(availableRepairs);
        setRepairHistory(history);
      } else {
        setActionMessage({
          text: `Repair failed: ${result.message}`,
          type: 'error',
        });
      }
    } catch (err: any) {
      setActionMessage({
        text: `Error executing repair: ${err?.message || String(err)}`,
        type: 'error',
      });
    } finally {
      setRepairing(false);
    }
  };

  const handleOpenRestorePreview = async (snapshotId: string) => {
    try {
      const preview = await getRestoreConfigurationPreview(snapshotId);
      setSelectedRestore(preview);
    } catch (err: any) {
      setActionMessage({
        text: `Failed to load restore preview: ${err?.message || String(err)}`,
        type: 'error',
      });
    }
  };

  const handleExecuteRestore = async (snapshotId: string) => {
    setRestoring(true);
    setActionMessage(null);
    try {
      const result = await executeRestoreConfiguration(snapshotId);
      if (result.success) {
        setActionMessage({
          text: `Configuration restored successfully to snapshot: ${snapshotId}.`,
          type: 'success',
        });
        setSelectedRestore(null);
        // Refresh audit report, repairs, history
        const [auditData, availableRepairs, history] = await Promise.all([
          runDeveloperEnvironmentAudit([inspectProjectPath]),
          getAvailableRepairs(),
          getRepairHistory(),
        ]);
        setReport(auditData);
        setRepairs(availableRepairs);
        setRepairHistory(history);
      } else {
        setActionMessage({
          text: `Restore failed: ${result.message}`,
          type: 'error',
        });
      }
    } catch (err: any) {
      setActionMessage({
        text: `Error executing restore: ${err?.message || String(err)}`,
        type: 'error',
      });
    } finally {
      setRestoring(false);
    }
  };

  // Filter tools
  const filteredTools = useMemo(() => {
    if (!report?.tools) return [];
    return report.tools.filter((t) => {
      const matchesSearch =
        t.name.toLowerCase().includes(toolSearch.toLowerCase()) ||
        t.id.toLowerCase().includes(toolSearch.toLowerCase()) ||
        (t.executablePath && t.executablePath.toLowerCase().includes(toolSearch.toLowerCase()));
      const matchesCat =
        selectedCategory === 'ALL' || t.category === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [report?.tools, toolSearch, selectedCategory]);

  // Filter PATH entries
  const filteredPathEntries = useMemo(() => {
    if (!report?.pathDiagnostics?.entries) return [];
    return report.pathDiagnostics.entries.filter((entry) => {
      if (pathFilter === 'warnings') return !entry.exists || entry.isDuplicate;
      if (pathFilter === 'dev') return entry.category === 'Developer Toolchain';
      return true;
    });
  }, [report?.pathDiagnostics?.entries, pathFilter]);

  const getScoreColor = (score: number) => {
    if (score >= 90) return '#10b981';
    if (score >= 70) return '#3b82f6';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  };

  const getSeverityBadge = (severity: HealthStatus) => {
    switch (severity) {
      case 'HEALTHY':
        return (
          <span className="mahi-severity-tag mahi-severity-healthy">
            <CheckCircle2 size={12} /> Healthy
          </span>
        );
      case 'INFO':
        return (
          <span className="mahi-severity-tag mahi-severity-info">
            <Info size={12} /> Info
          </span>
        );
      case 'WARNING':
        return (
          <span className="mahi-severity-tag mahi-severity-warning">
            <AlertTriangle size={12} /> Warning
          </span>
        );
      case 'CRITICAL':
        return (
          <span className="mahi-severity-tag mahi-severity-critical">
            <XCircle size={12} /> Critical
          </span>
        );
    }
  };

  const getResolutionStatusBadge = (status: ResolutionStatus) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span className="mahi-severity-tag mahi-severity-healthy">
            <CheckCircle2 size={12} /> Active Satisfied
          </span>
        );
      case 'COMPATIBLE':
        return (
          <span
            className="mahi-severity-tag mahi-severity-healthy"
            style={{
              background: 'rgba(59, 130, 246, 0.15)',
              color: '#60a5fa',
              border: '1px solid rgba(59, 130, 246, 0.3)',
            }}
          >
            <Check size={12} /> Compatible
          </span>
        );
      case 'MULTIPLE_INSTALLATIONS':
        return (
          <span
            className="mahi-severity-tag mahi-severity-info"
            style={{
              background: 'rgba(168, 85, 247, 0.15)',
              color: '#c084fc',
              border: '1px solid rgba(168, 85, 247, 0.3)',
            }}
          >
            <Layers size={12} /> Multiple Installs
          </span>
        );
      case 'MISMATCH':
        return (
          <span className="mahi-severity-tag mahi-severity-warning">
            <AlertTriangle size={12} /> Mismatch
          </span>
        );
      case 'MISSING':
        return (
          <span className="mahi-severity-tag mahi-severity-critical">
            <XCircle size={12} /> Missing Tool
          </span>
        );
      case 'UNKNOWN':
        return (
          <span className="mahi-severity-tag mahi-severity-info">
            <Info size={12} /> Undetermined
          </span>
        );
    }
  };

  if (loading && !report) {
    return (
      <div className="mahi-health-container">
        <div className="mahi-health-loading">
          <RefreshCw size={36} className="mahi-health-spin" />
          <p>Auditing developer toolchain, PATH diagnostics, and environment variables...</p>
        </div>
      </div>
    );
  }

  const scoreColor = report ? getScoreColor(report.healthScore) : '#10b981';

  return (
    <div className="mahi-health-container">
      {/* Header */}
      <div className="mahi-health-header">
        <div className="mahi-health-title-group">
          <div className="mahi-health-title-row">
            <h1>Developer Environment Health</h1>
            <span className="mahi-health-badge">Environment Audit</span>
          </div>
          <p className="mahi-health-subtitle">
            Workstation health and safety platform: real-time toolchain inventory, PATH diagnostics, multiple-version conflict resolution, and project compatibility analyzer.
          </p>
        </div>
        <div className="mahi-health-actions">
          <button
            type="button"
            className="mahi-health-btn"
            onClick={fetchAuditReport}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'mahi-health-spin' : ''} />
            {loading ? 'Auditing...' : 'Run Audit'}
          </button>
        </div>
      </div>

      {/* Strict Safety Notice */}
      <div className="mahi-health-safety-banner">
        <ShieldCheck size={16} />
        <span>
          <strong>Strict Safety Protocol:</strong> Developer Health operates exclusively in read-only mode. MAHI inspects configurations and manifests without modifying PATH, deleting files, or executing arbitrary commands.
        </span>
      </div>

      {/* Health Overview & Score Grid */}
      {report && (
        <div className="mahi-health-metrics-grid">
          {/* Health Score Card */}
          <div className="mahi-health-score-card">
            <div
              className="mahi-health-score-ring"
              style={{ borderColor: scoreColor, color: scoreColor }}
              title="Heuristic developer environment health indicator (0-100)"
            >
              <span className="mahi-health-score-number">{report.healthScore}</span>
              <span className="mahi-health-score-label">Indicator</span>
            </div>
            <div
              className="mahi-health-stat-pill"
              style={{
                background: `${scoreColor}22`,
                color: scoreColor,
                border: `1px solid ${scoreColor}44`,
              }}
            >
              {report.overallStatus} Workstation
            </div>
            <div style={{ fontSize: '11px', color: '#8fa0bc', marginTop: '8px', lineHeight: 1.35 }}>
              Heuristic developer environment health indicator
            </div>
            <span style={{ fontSize: '10.5px', color: '#64748b', marginTop: '4px' }}>
              Last audited {new Date(report.generatedAt * 1000).toLocaleTimeString()}
            </span>
          </div>

          {/* Metric Badges */}
          <div className="mahi-health-summary-panel">
            <div
              className="mahi-health-stat-box"
              onClick={() => setActiveTab('tools')}
              title="Jump to Toolchain Inventory"
            >
              <div className="count" style={{ color: '#34d399' }}>
                {report.tools.filter((t) => t.isInstalled).length} / {report.tools.length}
              </div>
              <div className="label">Installed Developer Tools</div>
            </div>
            <div
              className="mahi-health-stat-box"
              onClick={() => setActiveTab('path')}
              title="Jump to PATH Diagnostics"
            >
              <div className="count" style={{ color: '#60a5fa' }}>
                {report.pathDiagnostics.developerEntries} / {report.pathDiagnostics.totalEntries}
              </div>
              <div className="label">Developer PATH Entries</div>
            </div>
            <div
              className="mahi-health-stat-box"
              onClick={() => setActiveTab('path')}
              title="Jump to PATH Diagnostics"
            >
              <div
                className="count"
                style={{
                  color: report.pathDiagnostics.missingEntries > 0 ? '#fbbf24' : '#34d399',
                }}
              >
                {report.pathDiagnostics.missingEntries}
              </div>
              <div className="label">Stale / Missing PATH Folders</div>
            </div>
            <div
              className="mahi-health-stat-box"
              onClick={() => setActiveTab('overview')}
              title="Jump to Overview & Findings"
            >
              <div
                className="count"
                style={{
                  color: report.warningCount > 0 ? '#fbbf24' : '#34d399',
                }}
              >
                {report.findings.length}
              </div>
              <div className="label">Diagnostic Findings</div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="mahi-health-tabs-bar">
        <button
          type="button"
          className={`mahi-health-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <Activity size={14} />
          Overview & Findings
          {report && report.findings.length > 0 && (
            <span className="mahi-health-tab-badge">{report.findings.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`mahi-health-tab ${activeTab === 'repairs' ? 'active' : ''}`}
          onClick={() => setActiveTab('repairs')}
        >
          <Wrench size={14} />
          Repair Center
          {repairs.length > 0 && (
            <span
              className="mahi-health-tab-badge"
              style={{ background: '#3b82f6', color: '#fff', fontWeight: 700 }}
            >
              {repairs.length}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`mahi-health-tab ${activeTab === 'tools' ? 'active' : ''}`}
          onClick={() => setActiveTab('tools')}
        >
          <Cpu size={14} />
          Toolchain Inventory
          {report && (
            <span className="mahi-health-tab-badge">
              {report.tools.filter((t) => t.isInstalled).length}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`mahi-health-tab ${activeTab === 'path' ? 'active' : ''}`}
          onClick={() => setActiveTab('path')}
        >
          <Terminal size={14} />
          PATH Diagnostics
          {report && report.pathDiagnostics.missingEntries > 0 && (
            <span className="mahi-health-tab-badge" style={{ background: '#f59e0b', color: '#000' }}>
              {report.pathDiagnostics.missingEntries}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`mahi-health-tab ${activeTab === 'versions' ? 'active' : ''}`}
          onClick={() => setActiveTab('versions')}
        >
          <Layers size={14} />
          Multiple Versions
          {report && report.multipleVersions.length > 0 && (
            <span className="mahi-health-tab-badge">{report.multipleVersions.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`mahi-health-tab ${activeTab === 'compatibility' ? 'active' : ''}`}
          onClick={() => setActiveTab('compatibility')}
        >
          <FileCode size={14} />
          Project Compatibility
        </button>
        <button
          type="button"
          className={`mahi-health-tab ${activeTab === 'toolchain' ? 'active' : ''}`}
          onClick={() => setActiveTab('toolchain')}
        >
          <Sliders size={14} />
          Toolchain & Profiles
          {toolchainReport && (toolchainReport.missingCount > 0 || toolchainReport.mismatchCount > 0) && (
            <span className="mahi-health-tab-badge" style={{ background: '#f59e0b', color: '#000' }}>
              {toolchainReport.missingCount + toolchainReport.mismatchCount}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`mahi-health-tab ${activeTab === 'environment' ? 'active' : ''}`}
          onClick={() => setActiveTab('environment')}
        >
          <Package size={14} />
          Environment Variables
        </button>
        <button
          type="button"
          className={`mahi-health-tab ${activeTab === 'storage' ? 'active' : ''}`}
          onClick={() => setActiveTab('storage')}
        >
          <HardDrive size={14} />
          Developer Storage Footprint
        </button>
      </div>

      {/* Action Notification Banner */}
      {actionMessage && (
        <div
          style={{
            margin: '0 0 16px 0',
            padding: '12px 16px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background:
              actionMessage.type === 'success'
                ? 'rgba(16, 185, 129, 0.15)'
                : actionMessage.type === 'error'
                ? 'rgba(239, 68, 68, 0.15)'
                : 'rgba(59, 130, 246, 0.15)',
            border:
              actionMessage.type === 'success'
                ? '1px solid rgba(16, 185, 129, 0.4)'
                : actionMessage.type === 'error'
                ? '1px solid rgba(239, 68, 68, 0.4)'
                : '1px solid rgba(59, 130, 246, 0.4)',
            color:
              actionMessage.type === 'success'
                ? '#34d399'
                : actionMessage.type === 'error'
                ? '#f87171'
                : '#60a5fa',
            fontSize: '13px',
          }}
        >
          <span>{actionMessage.text}</span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontWeight: 600,
              padding: '2px 8px',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Tab Panels */}
      {report && (
        <div className="mahi-health-content-panel">
          {/* TAB 1: Overview & Findings */}
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Quick Navigation Bar */}
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(15, 23, 42, 0.45)',
                  border: '1px solid rgba(64, 128, 255, 0.15)',
                  fontSize: '12px',
                  color: '#94a3b8',
                }}
              >
                <span style={{ fontWeight: 600, color: '#e2e8f0' }}>Quick Access:</span>
                <button
                  type="button"
                  onClick={() => setActiveTab('toolchain')}
                  className="mahi-health-btn"
                  style={{ padding: '4px 10px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <Sliders size={12} /> Toolchain Resolver & Workspace Profiles
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('repairs')}
                  className="mahi-health-btn"
                  style={{ padding: '4px 10px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <Wrench size={12} /> Repair Center ({repairs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('path')}
                  className="mahi-health-btn"
                  style={{ padding: '4px 10px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <Terminal size={12} /> PATH Diagnostics
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('storage')}
                  className="mahi-health-btn"
                  style={{ padding: '4px 10px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <HardDrive size={12} /> Storage Footprint
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '15px', fontWeight: 600 }}>Active Diagnostic Findings</h2>
                <span style={{ fontSize: '12px', color: '#8fa0bc' }}>
                  {report.findings.length} findings categorized by priority
                </span>
              </div>

              {report.findings.length === 0 ? (
                <div className="mahi-health-card" style={{ alignItems: 'center', padding: '32px' }}>
                  <CheckCircle2 size={36} color="#10b981" />
                  <p style={{ marginTop: '8px', color: '#34d399', fontWeight: 600 }}>
                    Workstation Environment in Peak Health
                  </p>
                  <p style={{ fontSize: '12px', color: '#8fa0bc' }}>
                    No stale PATH entries, missing required toolchains, or conflicting environment variables detected.
                  </p>
                </div>
              ) : (
                report.findings.map((f) => (
                  <div key={f.id} className="mahi-finding-item">
                    <div className="mahi-finding-header">
                      <div className="mahi-finding-title-row">
                        {getSeverityBadge(f.severity)}
                        <span className="mahi-finding-title">{f.title}</span>
                      </div>
                      <span className="mahi-health-mono">{f.category}</span>
                    </div>

                    <div className="mahi-finding-evidence">
                      Evidence: {f.evidence}
                    </div>

                    <div className="mahi-finding-explanation">
                      {f.explanation}
                    </div>

                    <div className="mahi-finding-action" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Info size={14} />
                        <span>Suggested Action: {f.suggestedAction}</span>
                      </div>
                      {repairs.some((r) => r.available && (f.title.includes(r.affectedItem) || f.category.includes(r.category))) && (
                        <button
                          type="button"
                          onClick={() => {
                            const rep = repairs.find((r) => r.available && (f.title.includes(r.affectedItem) || f.category.includes(r.category)));
                            if (rep) {
                              setActiveTab('repairs');
                              handleOpenRepairPreview(rep);
                            }
                          }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#00e5ff',
                            color: '#030712',
                            border: 'none',
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <Wrench size={12} />
                          Review Repair
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 2: Toolchain Inventory */}
          {activeTab === 'tools' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Tool Search & Filter Bar */}
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
                  <Search
                    size={14}
                    style={{ position: 'absolute', left: '10px', top: '10px', color: '#8fa0bc' }}
                  />
                  <input
                    type="text"
                    placeholder="Search tool name, command, or executable path..."
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px 8px 32px',
                      background: 'rgba(10, 24, 44, 0.7)',
                      border: '1px solid rgba(64, 128, 255, 0.2)',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  {['ALL', 'RUNTIME', 'PACKAGE_MANAGER', 'BUILD_TOOL', 'VCS', 'EDITOR', 'SHELL'].map(
                    (cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCategory(cat)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          background:
                            selectedCategory === cat
                              ? 'rgba(0, 229, 255, 0.16)'
                              : 'rgba(10, 24, 44, 0.6)',
                          color: selectedCategory === cat ? '#00e5ff' : '#8fa0bc',
                          border: `1px solid ${
                            selectedCategory === cat
                              ? 'rgba(0, 229, 255, 0.35)'
                              : 'rgba(64, 128, 255, 0.15)'
                          }`,
                        }}
                      >
                        {cat.replace('_', ' ')}
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Table */}
              <div className="mahi-health-table-wrap">
                <table className="mahi-health-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Tool</th>
                      <th>Category</th>
                      <th>Version</th>
                      <th>Executable Path</th>
                      <th>Detection Method</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTools.map((t) => (
                      <tr key={t.id}>
                        <td>
                          {t.isInstalled ? (
                            <span className="mahi-severity-tag mahi-severity-healthy">
                              <CheckCircle2 size={12} /> Installed
                            </span>
                          ) : (
                            <span className="mahi-severity-tag mahi-severity-info">
                              <Info size={12} /> Missing
                            </span>
                          )}
                        </td>
                        <td>
                          <strong>{t.name}</strong>
                          <div style={{ fontSize: '11px', color: '#8fa0bc' }}>id: {t.id}</div>
                        </td>
                        <td>
                          <span className="mahi-health-mono">{t.category}</span>
                        </td>
                        <td>
                          {t.version ? (
                            <span className="mahi-health-mono" style={{ color: '#67e8f9' }}>
                              {t.version}
                            </span>
                          ) : (
                            <span style={{ color: '#64748b' }}>—</span>
                          )}
                        </td>
                        <td>
                          {t.executablePath ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span
                                className="mahi-health-mono"
                                style={{
                                  maxWidth: '260px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={t.executablePath}
                              >
                                {t.executablePath}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopy(t.executablePath!)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#8fa0bc',
                                  cursor: 'pointer',
                                }}
                                title="Copy full path"
                              >
                                {copiedText === t.executablePath ? (
                                  <Check size={12} color="#10b981" />
                                ) : (
                                  <Copy size={12} />
                                )}
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: '#64748b' }}>—</span>
                          )}
                        </td>
                        <td>
                          <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
                            {t.detectionMethod}
                          </span>
                        </td>
                        <td>
                          {t.notes && (
                            <span style={{ fontSize: '11.5px', color: '#fbbf24' }}>
                              {t.notes}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: PATH Diagnostics */}
          {activeTab === 'path' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Conflict alerts */}
              {report.pathDiagnostics.conflicts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#60a5fa' }}>
                    Shadowed Executables in PATH ({report.pathDiagnostics.conflicts.length})
                  </h3>
                  {report.pathDiagnostics.conflicts.map((c) => (
                    <div key={c.executable} className="mahi-version-group-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <strong>{c.executable}</strong>
                        <span className="mahi-severity-tag mahi-severity-info">
                          Precedence Conflict
                        </span>
                      </div>
                      <p style={{ fontSize: '12.5px', color: '#cbd5e1' }}>{c.explanation}</p>
                      <div className="mahi-version-instance-row active-instance">
                        <div>
                          <span style={{ fontWeight: 600, color: '#34d399' }}>Active Binary: </span>
                          <span className="mahi-health-mono">{c.activePath}</span>
                        </div>
                        {c.activeVersion && (
                          <span className="mahi-health-mono" style={{ color: '#34d399' }}>
                            {c.activeVersion}
                          </span>
                        )}
                      </div>
                      {c.shadowedPaths.map((s, idx) => (
                        <div key={idx} className="mahi-version-instance-row">
                          <div>
                            <span style={{ color: '#8fa0bc' }}>
                              Shadowed (index {s.pathIndex}):{' '}
                            </span>
                            <span className="mahi-health-mono">{s.path}</span>
                          </div>
                          {s.version && <span className="mahi-health-mono">{s.version}</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Path Filter Buttons */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setPathFilter('all')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background:
                      pathFilter === 'all' ? 'rgba(0, 229, 255, 0.16)' : 'rgba(10, 24, 44, 0.6)',
                    color: pathFilter === 'all' ? '#00e5ff' : '#8fa0bc',
                    border: '1px solid rgba(64, 128, 255, 0.2)',
                  }}
                >
                  All PATH Directories ({report.pathDiagnostics.totalEntries})
                </button>
                <button
                  type="button"
                  onClick={() => setPathFilter('dev')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background:
                      pathFilter === 'dev' ? 'rgba(0, 229, 255, 0.16)' : 'rgba(10, 24, 44, 0.6)',
                    color: pathFilter === 'dev' ? '#00e5ff' : '#8fa0bc',
                    border: '1px solid rgba(64, 128, 255, 0.2)',
                  }}
                >
                  Developer Toolchain Only ({report.pathDiagnostics.developerEntries})
                </button>
                <button
                  type="button"
                  onClick={() => setPathFilter('warnings')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background:
                      pathFilter === 'warnings'
                        ? 'rgba(245, 158, 11, 0.18)'
                        : 'rgba(10, 24, 44, 0.6)',
                    color: pathFilter === 'warnings' ? '#fbbf24' : '#8fa0bc',
                    border: '1px solid rgba(64, 128, 255, 0.2)',
                  }}
                >
                  Issues / Stale ({report.pathDiagnostics.missingEntries + report.pathDiagnostics.duplicateEntries})
                </button>
              </div>

              {/* PATH Entries Table */}
              <div className="mahi-health-table-wrap">
                <table className="mahi-health-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>#</th>
                      <th>Directory Path</th>
                      <th>Category</th>
                      <th>Status</th>
                      <th>Details / Diagnostic Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPathEntries.map((e) => (
                      <tr key={e.index}>
                        <td style={{ color: '#8fa0bc' }}>{e.index}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              className="mahi-health-mono"
                              style={{ color: e.exists ? '#f0f4fc' : '#f87171' }}
                            >
                              {e.path}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(e.path)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#8fa0bc',
                                cursor: 'pointer',
                              }}
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </td>
                        <td>
                          <span className="mahi-health-mono">{e.category}</span>
                        </td>
                        <td>
                          {e.exists ? (
                            <span className="mahi-severity-tag mahi-severity-healthy">Valid</span>
                          ) : (
                            <span className="mahi-severity-tag mahi-severity-warning">Missing</span>
                          )}
                        </td>
                        <td>
                          {e.issue ? (
                            <span style={{ color: '#fbbf24', fontSize: '12px' }}>{e.issue}</span>
                          ) : (
                            <span style={{ color: '#64748b', fontSize: '12px' }}>
                              {e.detectedTool ? `Associated with ${e.detectedTool}` : 'Normal'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: Multiple Versions */}
          {activeTab === 'versions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ fontSize: '13px', color: '#8fa0bc' }}>
                Detects independent installations of Node, Python, Java, Git, and Rust. Classifies whether versions are managed cleanly (e.g., Python launcher or fnm) or risk unexpected build tool precedence.
              </p>

              {report.multipleVersions.length === 0 ? (
                <div className="mahi-health-card">
                  <p style={{ color: '#8fa0bc' }}>
                    No multiple version conflicts detected. Single active toolchains installed for all ecosystems.
                  </p>
                </div>
              ) : (
                report.multipleVersions.map((mv) => (
                  <div key={mv.toolId} className="mahi-version-group-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <h3 style={{ fontSize: '15px', fontWeight: 600 }}>{mv.toolName}</h3>
                        {getSeverityBadge(mv.status)}
                      </div>
                      <span style={{ fontSize: '12px', color: '#8fa0bc' }}>{mv.classification}</span>
                    </div>

                    <p style={{ fontSize: '13px', color: '#cbd5e1' }}>{mv.explanation}</p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {mv.versions.map((ver, idx) => (
                        <div
                          key={idx}
                          className={`mahi-version-instance-row ${ver.isActive ? 'active-instance' : ''}`}
                        >
                          <div>
                            <span
                              style={{
                                fontWeight: 600,
                                color: ver.isActive ? '#34d399' : '#cbd5e1',
                                marginRight: '8px',
                              }}
                            >
                              Version {ver.version} {ver.isActive && '(Active Default)'}
                            </span>
                            <span className="mahi-health-mono" style={{ fontSize: '11px' }}>
                              {ver.path}
                            </span>
                          </div>
                          <span style={{ fontSize: '11px', color: '#8fa0bc' }}>{ver.source}</span>
                        </div>
                      ))}
                    </div>

                    <div className="mahi-finding-action">
                      <Info size={14} />
                      <span>{mv.suggestedAction}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 5: Project Compatibility */}
          {activeTab === 'compatibility' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Project Path Form */}
              <form onSubmit={handleInspectCustomProject} style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  placeholder="Enter project folder path to audit (e.g. C:\Projects\my-app)..."
                  value={inspectProjectPath}
                  onChange={(e) => setInspectProjectPath(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: 'rgba(10, 24, 44, 0.7)',
                    border: '1px solid rgba(64, 128, 255, 0.2)',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '13px',
                  }}
                />
                <button
                  type="submit"
                  className="mahi-health-btn"
                  disabled={inspectingProject}
                >
                  {inspectingProject ? 'Checking...' : 'Inspect Manifests'}
                </button>
              </form>

              {/* Display project checks */}
              {(customProjectCheck
                ? [customProjectCheck]
                : report.projectCompatibility
              ).map((pCheck, idx) => (
                <div key={idx} className="mahi-health-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ fontSize: '15px', fontWeight: 600 }}>{pCheck.projectName}</h3>
                      <span className="mahi-health-mono" style={{ fontSize: '11px' }}>
                        {pCheck.projectPath}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="mahi-health-mono">{pCheck.ecosystem}</span>
                      {getSeverityBadge(pCheck.overallStatus)}
                    </div>
                  </div>

                  <p style={{ fontSize: '13px', color: '#cbd5e1' }}>{pCheck.summary}</p>

                  <div className="mahi-health-table-wrap">
                    <table className="mahi-health-table">
                      <thead>
                        <tr>
                          <th>Requirement Target</th>
                          <th>Project Requires</th>
                          <th>Workstation Status</th>
                          <th>Match</th>
                          <th>Manifest Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pCheck.requirements.map((req, rIdx) => (
                          <tr key={rIdx}>
                            <td>
                              <strong>{req.target}</strong>
                            </td>
                            <td>
                              <span className="mahi-health-mono" style={{ color: '#fbbf24' }}>
                                {req.required}
                              </span>
                            </td>
                            <td>
                              {req.machineInstalled ? (
                                <span className="mahi-health-mono" style={{ color: '#34d399' }}>
                                  {req.machineInstalled}
                                </span>
                              ) : (
                                <span style={{ color: '#ef4444' }}>Not Found</span>
                              )}
                            </td>
                            <td>
                              {req.satisfied === true ? (
                                <span className="mahi-severity-tag mahi-severity-healthy">
                                  <Check size={12} /> Satisfied
                                </span>
                              ) : req.satisfied === false ? (
                                <span className="mahi-severity-tag mahi-severity-warning">
                                  <AlertTriangle size={12} /> Mismatch
                                </span>
                              ) : (
                                <span className="mahi-severity-tag mahi-severity-info">
                                  Unable to determine
                                </span>
                              )}
                            </td>
                            <td>
                              <span style={{ fontSize: '12px', color: '#8fa0bc' }}>
                                {req.notes}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB: Toolchain Resolver (Phase 9C-B) */}
          {activeTab === 'toolchain' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <div>
                  <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
                    Project Toolchain Resolution
                  </h2>
                  <p style={{ fontSize: '13px', color: '#8fa0bc', margin: '4px 0 0 0' }}>
                    Read-only resolver matching project manifests to detected workstation toolchains. Pure matching — does not mutate PATH or launch processes.
                  </p>
                </div>
              </div>

              {/* Inspect Project Form */}
              <form onSubmit={handleInspectCustomProject} className="mahi-health-inspect-bar">
                <input
                  type="text"
                  className="mahi-health-input"
                  placeholder="Enter absolute project directory (e.g. C:\Projects\my-app)..."
                  value={inspectProjectPath}
                  onChange={(e) => setInspectProjectPath(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="submit"
                  className="mahi-health-btn"
                  disabled={inspectingProject || !inspectProjectPath.trim()}
                >
                  <Search size={14} className={inspectingProject ? 'mahi-health-spin' : ''} />
                  {inspectingProject ? 'Resolving...' : 'Resolve Toolchains'}
                </button>
              </form>

              {/* Status Summary Banner */}
              {toolchainReport && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '12px',
                  }}
                >
                  <div className="mahi-health-stat-box">
                    <div className="count" style={{ color: '#60a5fa' }}>
                      {toolchainReport.requirementsFound}
                    </div>
                    <div className="label">Project Requirements Declared</div>
                  </div>
                  <div className="mahi-health-stat-box">
                    <div className="count" style={{ color: '#34d399' }}>
                      {toolchainReport.compatibleCount}
                    </div>
                    <div className="label">Active / Compatible</div>
                  </div>
                  <div className="mahi-health-stat-box">
                    <div
                      className="count"
                      style={{
                        color: toolchainReport.mismatchCount > 0 ? '#fbbf24' : '#94a3b8',
                      }}
                    >
                      {toolchainReport.mismatchCount}
                    </div>
                    <div className="label">Version Mismatches</div>
                  </div>
                  <div className="mahi-health-stat-box">
                    <div
                      className="count"
                      style={{
                        color: toolchainReport.missingCount > 0 ? '#ef4444' : '#94a3b8',
                      }}
                    >
                      {toolchainReport.missingCount}
                    </div>
                    <div className="label">Missing Tools</div>
                  </div>
                </div>
              )}

              {/* Resolution Table */}
              {toolchainReport && (
                <div className="mahi-health-table-wrap">
                  <table className="mahi-health-table">
                    <thead>
                      <tr>
                        <th>Toolchain</th>
                        <th>Project Requirement</th>
                        <th>Active Workstation Tool</th>
                        <th>Resolution Status</th>
                        <th>Resolution Explanation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {toolchainReport.results
                        .filter((r) => r.requirement !== null || r.activeInstallation !== null)
                        .map((res) => (
                          <tr key={res.tool}>
                            <td>
                              <strong style={{ textTransform: 'capitalize' }}>{res.tool}</strong>
                              {res.allInstallations.length > 1 && (
                                <div style={{ fontSize: '11px', color: '#c084fc' }}>
                                  {res.allInstallations.length} installations found
                                </div>
                              )}
                            </td>
                            <td>
                              {res.requirement ? (
                                <div>
                                  <span className="mahi-health-mono" style={{ color: '#fbbf24', fontWeight: 600 }}>
                                    {res.requirement.versionConstraint || 'Any'}
                                  </span>
                                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                                    <span
                                      style={{
                                        fontSize: '10px',
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        background: 'rgba(255, 255, 255, 0.08)',
                                        color: '#94a3b8',
                                      }}
                                    >
                                      {res.requirement.evidenceType}
                                    </span>
                                    {res.requirement.javaContext && (
                                      <span
                                        style={{
                                          fontSize: '10px',
                                          padding: '1px 5px',
                                          borderRadius: '3px',
                                          background: 'rgba(56, 189, 248, 0.15)',
                                          color: '#38bdf8',
                                        }}
                                      >
                                        {res.requirement.javaContext}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                    {res.requirement.rawEvidence}
                                  </div>
                                </div>
                              ) : (
                                <span style={{ color: '#64748b' }}>None declared</span>
                              )}
                            </td>
                            <td>
                              {res.activeInstallation ? (
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span className="mahi-health-mono" style={{ color: '#34d399', fontWeight: 600 }}>
                                      {res.activeInstallation.version || 'installed'}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: '10px',
                                        padding: '1px 4px',
                                        borderRadius: '3px',
                                        background: 'rgba(52, 211, 153, 0.15)',
                                        color: '#34d399',
                                      }}
                                    >
                                      ACTIVE
                                    </span>
                                  </div>
                                  <span
                                    className="mahi-health-mono"
                                    style={{ fontSize: '10.5px', color: '#94a3b8', wordBreak: 'break-all' }}
                                    title={res.activeInstallation.executablePath}
                                  >
                                    {res.activeInstallation.executablePath}
                                  </span>
                                  <div style={{ fontSize: '10.5px', color: '#64748b' }}>
                                    Source: {res.activeInstallation.detectionSource}
                                  </div>
                                </div>
                              ) : (
                                <span style={{ color: '#ef4444' }}>Not installed</span>
                              )}
                            </td>
                            <td>{getResolutionStatusBadge(res.status)}</td>
                            <td>
                              <div style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 500 }}>
                                {res.explanation.headline}
                              </div>
                              <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '2px' }}>
                                {res.explanation.detail}
                              </div>
                              {res.explanation.suggestion && (
                                <div style={{ fontSize: '11.5px', color: '#fbbf24', marginTop: '3px' }}>
                                  💡 {res.explanation.suggestion}
                                </div>
                              )}
                              {res.explanation.isAdvisoryOnly && (
                                <div style={{ fontSize: '10.5px', color: '#a78bfa', marginTop: '3px' }}>
                                  ℹ️ Advisory notice: requirement is not strictly enforced by package managers.
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Workspace Profile Model Card (Phase 9C-C) */}
              <div
                className="mahi-health-card"
                style={{
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  marginTop: '8px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '10px',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Sliders size={16} style={{ color: '#38bdf8' }} />
                      <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>
                        Workspace Profile Model
                      </h3>
                      {currentProfile ? (
                        profileValidation ? (
                          <span
                            className="mahi-severity-tag"
                            style={{
                              background: profileValidation.isValid
                                ? 'rgba(52, 211, 153, 0.15)'
                                : 'rgba(239, 68, 68, 0.15)',
                              color: profileValidation.isValid ? '#34d399' : '#f87171',
                              borderColor: profileValidation.isValid
                                ? 'rgba(52, 211, 153, 0.3)'
                                : 'rgba(239, 68, 68, 0.3)',
                            }}
                          >
                            {profileValidation.status}
                          </span>
                        ) : (
                          <span className="mahi-severity-tag mahi-severity-info">UNVALIDATED</span>
                        )
                      ) : (
                        <span
                          className="mahi-severity-tag mahi-severity-info"
                          style={{ color: '#94a3b8' }}
                        >
                          NO PROFILE
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: '12px', color: '#8fa0bc', margin: '4px 0 0 0' }}>
                      MAHI-owned configuration binding verified toolchain installations and workspace environment overrides to this project.
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {!currentProfile ? (
                      <button
                        type="button"
                        className="mahi-health-btn mahi-health-btn-primary"
                        onClick={handleCreateProfile}
                      >
                        <Plus size={14} /> Create Workspace Profile
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="mahi-health-btn"
                          onClick={handleValidateProfile}
                          disabled={validatingProfile}
                        >
                          <RefreshCw
                            size={13}
                            className={validatingProfile ? 'mahi-health-spin' : ''}
                          />
                          {validatingProfile ? 'Validating...' : 'Validate'}
                        </button>
                        <button
                          type="button"
                          className="mahi-health-btn mahi-health-btn-primary"
                          onClick={handleSaveProfile}
                          disabled={savingProfile}
                        >
                          <Save
                            size={13}
                            className={savingProfile ? 'mahi-health-spin' : ''}
                          />
                          {savingProfile ? 'Saving...' : 'Save Profile'}
                        </button>
                        <button
                          type="button"
                          className="mahi-health-btn"
                          style={{
                            borderColor: 'rgba(239, 68, 68, 0.3)',
                            color: '#f87171',
                          }}
                          onClick={handleDeleteProfile}
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {currentProfile && (
                  <div
                    style={{
                      marginTop: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '16px',
                    }}
                  >
                    {/* Validation Summary Banner */}
                    {profileValidation && (
                      <div
                        style={{
                          padding: '10px 14px',
                          borderRadius: '6px',
                          background: profileValidation.isValid
                            ? 'rgba(52, 211, 153, 0.08)'
                            : 'rgba(239, 68, 68, 0.08)',
                          border: `1px solid ${
                            profileValidation.isValid
                              ? 'rgba(52, 211, 153, 0.25)'
                              : 'rgba(239, 68, 68, 0.25)'
                          }`,
                          fontSize: '12px',
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            color: profileValidation.isValid ? '#34d399' : '#f87171',
                            marginBottom: '2px',
                          }}
                        >
                          Status: {profileValidation.status} — {profileValidation.summary}
                        </div>
                        {profileValidation.bindingIssues.map((issue, idx) => (
                          <div
                            key={idx}
                            style={{
                              color:
                                issue.severity === 'CRITICAL' ? '#f87171' : '#fbbf24',
                              marginTop: '2px',
                            }}
                          >
                            • [{issue.tool}] {issue.message}
                          </div>
                        ))}
                        {profileValidation.overrideIssues.map((issue, idx) => (
                          <div
                            key={idx}
                            style={{ color: '#f87171', marginTop: '2px' }}
                          >
                            • [Env: {issue.key}] {issue.message}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Bound Toolchains */}
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '8px',
                        }}
                      >
                        <h4 style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>
                          Bound Toolchains ({currentProfile.toolBindings.length})
                        </h4>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                          Explicit user binding to verified local installations
                        </span>
                      </div>

                      {currentProfile.toolBindings.length === 0 ? (
                        <div
                          style={{
                            padding: '12px',
                            background: 'rgba(255,255,255,0.02)',
                            borderRadius: '6px',
                            fontSize: '12px',
                            color: '#94a3b8',
                          }}
                        >
                          No toolchains bound yet. Select candidates below to bind them.
                        </div>
                      ) : (
                        <div className="mahi-health-table-wrap">
                          <table className="mahi-health-table">
                            <thead>
                              <tr>
                                <th>Tool</th>
                                <th>Bound Version</th>
                                <th>Executable Path</th>
                                <th>Status</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentProfile.toolBindings.map((b) => (
                                <tr key={b.tool}>
                                  <td>
                                    <strong style={{ textTransform: 'capitalize' }}>
                                      {b.tool}
                                    </strong>
                                  </td>
                                  <td>
                                    <span
                                      className="mahi-health-mono"
                                      style={{ color: '#38bdf8' }}
                                    >
                                      {b.version || 'unknown'}
                                    </span>
                                  </td>
                                  <td>
                                    <span
                                      className="mahi-health-mono"
                                      style={{ fontSize: '11px' }}
                                    >
                                      {b.executablePath}
                                    </span>
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="mahi-health-btn"
                                      style={{ padding: '2px 8px', fontSize: '11px' }}
                                      onClick={() => handleToggleBinding(b.tool)}
                                    >
                                      {b.enabled ? '✓ Enabled' : 'Disabled'}
                                    </button>
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="mahi-health-btn"
                                      style={{
                                        padding: '2px 8px',
                                        fontSize: '11px',
                                        color: '#f87171',
                                      }}
                                      onClick={() => handleRemoveBinding(b.tool)}
                                    >
                                      Unbind
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Quick Bind Candidates */}
                      {allToolchainInstalls.length > 0 && (
                        <div style={{ marginTop: '10px' }}>
                          <div
                            style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              color: '#cbd5e1',
                              marginBottom: '6px',
                            }}
                          >
                            Available Workstation Candidates to Bind:
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {allToolchainInstalls.map((inst) => {
                              const isBound = currentProfile.toolBindings.some(
                                (b) =>
                                  b.tool === inst.tool &&
                                  b.executablePath.toLowerCase() ===
                                    inst.executablePath.toLowerCase()
                              );
                              return (
                                <button
                                  key={inst.id}
                                  type="button"
                                  className="mahi-health-btn"
                                  style={{
                                    fontSize: '11px',
                                    padding: '3px 8px',
                                    background: isBound
                                      ? 'rgba(52, 211, 153, 0.15)'
                                      : 'rgba(255,255,255,0.05)',
                                    borderColor: isBound
                                      ? 'rgba(52, 211, 153, 0.4)'
                                      : 'rgba(255,255,255,0.1)',
                                    color: isBound ? '#34d399' : '#cbd5e1',
                                  }}
                                  onClick={() => handleBindTool(inst)}
                                >
                                  {isBound ? '✓ Bound: ' : '+ Bind '} {inst.tool} (
                                  {inst.version || 'detected'})
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Environment Overrides */}
                    <div
                      style={{
                        borderTop: '1px solid rgba(255,255,255,0.06)',
                        paddingTop: '14px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '8px',
                        }}
                      >
                        <h4 style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>
                          Workspace Environment Overrides (
                          {currentProfile.environmentOverrides.length})
                        </h4>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                          Stored securely in MAHI profile without reading .env
                        </span>
                      </div>

                      {currentProfile.environmentOverrides.length > 0 && (
                        <div
                          className="mahi-health-table-wrap"
                          style={{ marginBottom: '10px' }}
                        >
                          <table className="mahi-health-table">
                            <thead>
                              <tr>
                                <th>Key</th>
                                <th>Value</th>
                                <th>Type</th>
                                <th>Status</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentProfile.environmentOverrides.map((ov) => {
                                const isConfiguredProtected =
                                  ov.isSecret &&
                                  (ov.value === PROTECTED_SECRET_MARKER || !ov.value.trim());
                                const isAvailableSecret =
                                  ov.isSecret &&
                                  ov.value !== PROTECTED_SECRET_MARKER &&
                                  ov.value.trim().length > 0;

                                return (
                                  <tr key={ov.key}>
                                    <td>
                                      <strong>{ov.key}</strong>
                                    </td>
                                    <td>
                                      {isConfiguredProtected ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <span
                                            className="mahi-health-mono"
                                            style={{
                                              color: '#fbbf24',
                                              fontSize: '11px',
                                              background: 'rgba(251, 191, 36, 0.1)',
                                              padding: '1px 6px',
                                              borderRadius: '3px',
                                            }}
                                          >
                                            [PROTECTED_SECRET]
                                          </span>
                                          <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                                            (Value unavailable after reload)
                                          </span>
                                        </div>
                                      ) : isAvailableSecret ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <span className="mahi-health-mono">••••••••••••</span>
                                          <span
                                            style={{
                                              fontSize: '10px',
                                              color: '#34d399',
                                              background: 'rgba(52, 211, 153, 0.1)',
                                              padding: '1px 5px',
                                              borderRadius: '3px',
                                            }}
                                          >
                                            Session Available
                                          </span>
                                        </div>
                                      ) : (
                                        <span className="mahi-health-mono">{ov.value}</span>
                                      )}
                                    </td>
                                    <td>
                                      {isConfiguredProtected ? (
                                        <span
                                          style={{
                                            fontSize: '11px',
                                            color: '#fbbf24',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '3px',
                                          }}
                                          title="Secret is configured but protected on disk; value not loaded into memory"
                                        >
                                          <Lock size={10} /> Secret (Protected)
                                        </span>
                                      ) : isAvailableSecret ? (
                                        <span
                                          style={{
                                            fontSize: '11px',
                                            color: '#38bdf8',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '3px',
                                          }}
                                          title="Secret value entered in current active session"
                                        >
                                          <Lock size={10} /> Secret (Live)
                                        </span>
                                      ) : (
                                        <span
                                          style={{
                                            fontSize: '11px',
                                            color: '#94a3b8',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '3px',
                                          }}
                                        >
                                          <Unlock size={10} /> Plain
                                        </span>
                                      )}
                                    </td>
                                    <td>
                                      <span
                                        style={{
                                          fontSize: '11px',
                                          color: ov.enabled ? '#34d399' : '#94a3b8',
                                        }}
                                      >
                                        {ov.enabled ? 'Enabled' : 'Disabled'}
                                      </span>
                                    </td>
                                    <td>
                                      <button
                                        type="button"
                                        className="mahi-health-btn"
                                        style={{
                                          padding: '2px 6px',
                                          fontSize: '11px',
                                          color: '#f87171',
                                        }}
                                        onClick={() => handleRemoveEnvOverride(ov.key)}
                                      >
                                        Remove
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Add Override Form */}
                      <form
                        onSubmit={handleAddEnvOverride}
                        style={{
                          display: 'flex',
                          gap: '8px',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        <input
                          type="text"
                          className="mahi-health-input"
                          placeholder="KEY (e.g. NODE_ENV)"
                          value={newEnvKey}
                          onChange={(e) => setNewEnvKey(e.target.value)}
                          style={{ flex: 1, minWidth: '130px' }}
                        />
                        <input
                          type={newEnvSecret ? 'password' : 'text'}
                          className="mahi-health-input"
                          placeholder="VALUE"
                          value={newEnvVal}
                          onChange={(e) => setNewEnvVal(e.target.value)}
                          style={{ flex: 1, minWidth: '130px' }}
                        />
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '12px',
                            color: '#cbd5e1',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={newEnvSecret}
                            onChange={(e) => setNewEnvSecret(e.target.checked)}
                          />
                          Secret
                        </label>
                        <button
                          type="submit"
                          className="mahi-health-btn"
                          disabled={!newEnvKey.trim()}
                        >
                          <Plus size={12} /> Add Override
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </div>

              {/* Discovered Toolchain Installations on Workstation */}
              <div className="mahi-health-card" style={{ marginTop: '8px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
                  All Discovered Toolchain Installations ({allToolchainInstalls.length})
                </h3>
                <p style={{ fontSize: '12px', color: '#8fa0bc', marginBottom: '12px' }}>
                  Deduplicated inventory across System PATH, User PATH, Environment Hints, Standard Directories, and Version Managers.
                </p>
                <div className="mahi-health-table-wrap">
                  <table className="mahi-health-table">
                    <thead>
                      <tr>
                        <th>Tool</th>
                        <th>Active</th>
                        <th>Version</th>
                        <th>Executable Path</th>
                        <th>Detection Source</th>
                        <th>Verified Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allToolchainInstalls.map((inst) => (
                        <tr key={inst.id}>
                          <td>
                            <strong style={{ textTransform: 'capitalize' }}>{inst.tool}</strong>
                          </td>
                          <td>
                            {inst.isActive ? (
                              <span
                                style={{
                                  fontSize: '11px',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  background: 'rgba(52, 211, 153, 0.2)',
                                  color: '#34d399',
                                  fontWeight: 700,
                                }}
                              >
                                YES
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', color: '#64748b' }}>No</span>
                            )}
                          </td>
                          <td>
                            <span className="mahi-health-mono" style={{ color: inst.version ? '#38bdf8' : '#94a3b8' }}>
                              {inst.version || 'Unverified'}
                            </span>
                          </td>
                          <td>
                            <span className="mahi-health-mono" style={{ fontSize: '11px' }}>
                              {inst.executablePath}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: '11px', color: '#cbd5e1' }}>
                              {inst.detectionSource}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                              {inst.verificationMethod}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: Environment Variables */}
          {activeTab === 'environment' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ fontSize: '13px', color: '#8fa0bc' }}>
                Audits standard developer environment variables (JAVA_HOME, CARGO_HOME, GOPATH, ANDROID_HOME). Verifies that target directories exist and match resolved executables. Never prints secrets or tokens.
              </p>

              <div className="mahi-health-table-wrap">
                <table className="mahi-health-table">
                  <thead>
                    <tr>
                      <th>Variable</th>
                      <th>Configured Value</th>
                      <th>Directory Exists</th>
                      <th>Matches Active Tool</th>
                      <th>Status</th>
                      <th>Explanation & Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.environmentVariables.map((ev) => (
                      <tr key={ev.name}>
                        <td>
                          <strong>{ev.name}</strong>
                        </td>
                        <td>
                          {ev.isSet ? (
                            <span className="mahi-health-mono">
                              {ev.sanitizedValue || '[EMPTY]'}
                            </span>
                          ) : (
                            <span style={{ color: '#64748b' }}>Not Set</span>
                          )}
                        </td>
                        <td>
                          {ev.isSet ? (
                            ev.targetExists ? (
                              <span className="mahi-severity-tag mahi-severity-healthy">Yes</span>
                            ) : (
                              <span className="mahi-severity-tag mahi-severity-warning">
                                Missing
                              </span>
                            )
                          ) : (
                            <span style={{ color: '#64748b' }}>—</span>
                          )}
                        </td>
                        <td>
                          {ev.matchesActiveTool ? (
                            <span className="mahi-severity-tag mahi-severity-healthy">Aligned</span>
                          ) : ev.isSet ? (
                            <span className="mahi-severity-tag mahi-severity-info">
                              Independent
                            </span>
                          ) : (
                            <span style={{ color: '#64748b' }}>—</span>
                          )}
                        </td>
                        <td>{getSeverityBadge(ev.status)}</td>
                        <td>
                          <div style={{ fontSize: '12px', color: '#cbd5e1' }}>
                            {ev.explanation}
                          </div>
                          <div style={{ fontSize: '11.5px', color: '#38bdf8', marginTop: '2px' }}>
                            {ev.recommendation}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 7: Developer Storage Footprint */}
          {activeTab === 'storage' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ fontSize: '13px', color: '#8fa0bc' }}>
                Summary of developer ecosystem caches (npm, pnpm, cargo, pip, maven, gradle, huggingface). Reuses Storage Intelligence scans in read-only mode.
              </p>

              <div className="mahi-health-table-wrap">
                <table className="mahi-health-table">
                  <thead>
                    <tr>
                      <th>Cache / Ecosystem</th>
                      <th>Disk Location</th>
                      <th>Size</th>
                      <th>Purpose</th>
                      <th>Relocation & Cleanup Potential</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.developerStorage.map((item, idx) => (
                      <tr key={idx}>
                        <td>
                          <strong>{item.name}</strong>
                          <div style={{ fontSize: '11px', color: '#8fa0bc' }}>{item.ecosystem}</div>
                        </td>
                        <td>
                          <span className="mahi-health-mono">{item.path}</span>
                        </td>
                        <td>
                          <span className="mahi-health-mono" style={{ color: '#67e8f9' }}>
                            {item.formattedSize}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
                            {item.purpose}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontSize: '12px', color: '#34d399' }}>
                            {item.cleanupPotential}
                          </div>
                          <div style={{ fontSize: '11px', color: '#38bdf8', marginTop: '2px' }}>
                            {item.relocationPotential}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 8: Safe Repair Center */}
          {activeTab === 'repairs' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Repair Center Header & Guarantee Notice */}
              <div
                style={{
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  borderRadius: '8px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#60a5fa', fontWeight: 600 }}>
                  <ShieldCheck size={18} />
                  <span>Controlled Repair Protocol & Safety Guarantees</span>
                </div>
                <p style={{ fontSize: '12.5px', color: '#cbd5e1', margin: 0, lineHeight: 1.5 }}>
                  Repairs in MAHI follow strict workstation safety bounds: only User PATH and allowlisted developer environment variables in <code className="mahi-health-mono" style={{ color: '#93c5fd' }}>HKCU\Environment</code> are modified. Windows System PATH (<code className="mahi-health-mono" style={{ color: '#f87171' }}>HKLM</code>) is strictly untouched. Every action creates an isolated recovery snapshot before mutation, performs post-repair verification, and provides 1-click restore.
                </p>
                <div style={{ fontSize: '11.5px', color: '#94a3b8', fontStyle: 'italic' }}>
                  * Notice: New processes will use repaired environment configurations immediately. Running processes may retain their previous environment until restarted.
                </div>
              </div>

              {/* Available Repairs List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#f0f4fc', margin: 0 }}>
                    Available Repairs ({repairs.length})
                  </h3>
                  <span style={{ fontSize: '12px', color: '#8fa0bc' }}>
                    Require explicit user confirmation & pre-mutation re-validation
                  </span>
                </div>

                {repairs.length === 0 ? (
                  <div
                    className="mahi-health-card"
                    style={{ alignItems: 'center', padding: '36px', textAlign: 'center' }}
                  >
                    <CheckCircle2 size={36} color="#10b981" />
                    <p style={{ marginTop: '12px', color: '#34d399', fontWeight: 600, fontSize: '15px' }}>
                      No Pending Repairs Detected
                    </p>
                    <p style={{ fontSize: '12.5px', color: '#8fa0bc', maxWidth: '480px' }}>
                      Your User PATH has no duplicate or stale entries, and all allowlisted developer variables are either correctly configured or independent.
                    </p>
                  </div>
                ) : (
                  repairs.map((r) => (
                    <div key={r.id} className="mahi-repair-card">
                      <div className="mahi-repair-header">
                        <div className="mahi-repair-title-group">
                          <span className="mahi-repair-title">{r.affectedItem}</span>
                          <span
                            className={
                              r.risk === 'LOW'
                                ? 'mahi-repair-risk-low'
                                : 'mahi-repair-risk-med'
                            }
                          >
                            {r.risk} Risk
                          </span>
                        </div>
                        <span
                          className={`mahi-repair-status-badge ${
                            r.available
                              ? 'mahi-status-available'
                              : 'mahi-status-unavailable'
                          }`}
                        >
                          {r.available ? 'AVAILABLE' : 'UNAVAILABLE'}
                        </span>
                      </div>

                      <div style={{ fontSize: '12.5px', color: '#94a3b8' }}>
                        <strong style={{ color: '#cbd5e1' }}>Evidence: </strong>
                        {r.evidence}
                      </div>

                      <div style={{ fontSize: '12.5px', color: '#cbd5e1', lineHeight: 1.45 }}>
                        {r.reason}
                      </div>

                      {/* Before / After Diff Preview */}
                      <div className="mahi-repair-diff-grid">
                        <div className="mahi-diff-box">
                          <span className="mahi-diff-label" style={{ color: '#f87171' }}>
                            Current Value (Before)
                          </span>
                          <span className="mahi-health-mono" style={{ color: '#fca5a5', fontSize: '11px', wordBreak: 'break-all' }}>
                            {r.currentState || '—'}
                          </span>
                        </div>
                        <div className="mahi-diff-box">
                          <span className="mahi-diff-label" style={{ color: '#34d399' }}>
                            Proposed Value (After)
                          </span>
                          <span className="mahi-health-mono" style={{ color: '#86efac', fontSize: '11px', wordBreak: 'break-all' }}>
                            {r.proposedState || '—'}
                          </span>
                        </div>
                      </div>

                      <div className="mahi-repair-actions-row">
                        <div style={{ fontSize: '11.5px', color: '#8fa0bc' }}>
                          Target: <code className="mahi-health-mono" style={{ color: '#93c5fd' }}>{r.affectedItem}</code>
                        </div>
                        <button
                          type="button"
                          className="mahi-repair-confirm-btn"
                          onClick={() => handleOpenRepairPreview(r)}
                        >
                          <Wrench size={13} />
                          Review & Preview Repair
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Repair History & Restore Rollback Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#f0f4fc', margin: 0 }}>
                    Repair History & Recovery Snapshots ({repairHistory.length})
                  </h3>
                  <span style={{ fontSize: '12px', color: '#8fa0bc' }}>
                    Snapshots stored under %APPDATA%\MAHI\repair_center\snapshots
                  </span>
                </div>

                {repairHistory.length === 0 ? (
                  <div
                    className="mahi-health-card"
                    style={{ padding: '24px', textAlign: 'center', color: '#8fa0bc', fontSize: '13px' }}
                  >
                    No repairs have been executed in this session or stored on disk yet.
                  </div>
                ) : (
                  <div className="mahi-health-table-wrap">
                    <table className="mahi-health-table">
                      <thead>
                        <tr>
                          <th>Timestamp</th>
                          <th>Repair Action</th>
                          <th>Scope & Target</th>
                          <th>Snapshot ID</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {repairHistory.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                                {item.formattedTime || new Date(item.timestamp * 1000).toLocaleString()}
                              </span>
                            </td>
                            <td>
                              <strong>{item.description}</strong>
                              <div style={{ fontSize: '11px', color: '#8fa0bc' }}>
                                {item.category}
                              </div>
                            </td>
                            <td>
                              <span className="mahi-health-mono" style={{ fontSize: '11px' }}>
                                {item.target}
                              </span>
                            </td>
                            <td>
                              <span className="mahi-health-mono" style={{ fontSize: '11px', color: '#38bdf8' }}>
                                {item.snapshotId}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`mahi-repair-status-badge ${
                                  item.status === 'COMPLETED'
                                    ? 'mahi-status-completed'
                                    : item.status === 'ROLLED_BACK'
                                    ? 'mahi-status-rolledback'
                                    : 'mahi-status-failed'
                                }`}
                              >
                                {item.status}
                              </span>
                            </td>
                            <td>
                              {item.canRestore && item.status === 'COMPLETED' ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenRestorePreview(item.snapshotId)}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    background: 'rgba(239, 68, 68, 0.15)',
                                    color: '#f87171',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    padding: '4px 10px',
                                    borderRadius: '4px',
                                    fontSize: '11.5px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                  }}
                                >
                                  <RotateCcw size={12} />
                                  Restore Previous
                                </button>
                              ) : (
                                <span style={{ fontSize: '11px', color: '#64748b' }}>Restored</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Repair Confirmation Modal */}
      {selectedRepair && (
        <div className="mahi-repair-modal-overlay">
          <div className="mahi-repair-modal">
            <div className="mahi-repair-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Wrench size={18} color="#00e5ff" />
                <h3 style={{ margin: 0, fontSize: '16px', color: '#f0f4fc' }}>
                  Repair Preview & Confirmation
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRepair(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#8fa0bc',
                  fontSize: '18px',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div className="mahi-repair-modal-body">
              <div>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#f0f4fc' }}>
                  {selectedRepair.affectedItem}
                </h4>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span
                    className={
                      selectedRepair.risk === 'LOW'
                        ? 'mahi-repair-risk-low'
                        : 'mahi-repair-risk-med'
                    }
                  >
                    {selectedRepair.risk} Risk
                  </span>
                  <span style={{ fontSize: '12px', color: '#8fa0bc' }}>
                    Category: {selectedRepair.category}
                  </span>
                </div>
              </div>

              <div style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.45 }}>
                {selectedRepair.reason}
              </div>

              <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                <strong>Evidence: </strong>
                {selectedRepair.evidence}
              </div>

              {/* Exact Before / After Diff */}
              <div className="mahi-repair-diff-grid">
                <div className="mahi-diff-box">
                  <span className="mahi-diff-label" style={{ color: '#f87171' }}>
                    Current Configuration
                  </span>
                  <div
                    className="mahi-health-mono"
                    style={{
                      fontSize: '11px',
                      color: '#fca5a5',
                      whiteSpace: 'pre-wrap',
                      maxHeight: '140px',
                      overflowY: 'auto',
                      padding: '4px',
                    }}
                  >
                    {selectedRepair.currentState}
                  </div>
                </div>
                <div className="mahi-diff-box">
                  <span className="mahi-diff-label" style={{ color: '#34d399' }}>
                    Proposed Configuration
                  </span>
                  <div
                    className="mahi-health-mono"
                    style={{
                      fontSize: '11px',
                      color: '#86efac',
                      whiteSpace: 'pre-wrap',
                      maxHeight: '140px',
                      overflowY: 'auto',
                      padding: '4px',
                    }}
                  >
                    {selectedRepair.proposedState}
                  </div>
                </div>
              </div>

              {/* Safety Pre-conditions & Verification Details */}
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(64, 128, 255, 0.15)',
                  borderRadius: '6px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  fontSize: '12px',
                }}
              >
                <div style={{ color: '#60a5fa', fontWeight: 600 }}>Safety Protocol:</div>
                <div style={{ color: '#cbd5e1' }}>
                  1. Automatic snapshot will be written to disk before registry mutation.
                </div>
                <div style={{ color: '#cbd5e1' }}>
                  2. Pre-mutation re-validation checks if conditions remain true.
                </div>
                <div style={{ color: '#cbd5e1' }}>
                  3. Post-mutation verification tests the registry; triggers rollback on any anomaly.
                </div>
                <div style={{ color: '#cbd5e1' }}>
                  4. Rollback details: {selectedRepair.rollbackPlan}
                </div>
              </div>

              {repairResult && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '6px',
                    background: repairResult.success
                      ? 'rgba(16, 185, 129, 0.15)'
                      : 'rgba(239, 68, 68, 0.15)',
                    border: repairResult.success
                      ? '1px solid rgba(16, 185, 129, 0.4)'
                      : '1px solid rgba(239, 68, 68, 0.4)',
                    color: repairResult.success ? '#34d399' : '#f87171',
                    fontSize: '12.5px',
                  }}
                >
                  <strong>{repairResult.success ? 'Success: ' : 'Failed: '}</strong>
                  {repairResult.message}
                </div>
              )}
            </div>

            <div className="mahi-repair-modal-footer">
              <button
                type="button"
                className="mahi-repair-cancel-btn"
                onClick={() => setSelectedRepair(null)}
                disabled={repairing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mahi-repair-confirm-btn"
                onClick={() => handleExecuteRepair(selectedRepair.id)}
                disabled={repairing || !selectedRepair.available}
              >
                {repairing ? (
                  <>
                    <RefreshCw size={13} className="mahi-health-spin" />
                    Applying & Verifying...
                  </>
                ) : (
                  <>
                    <Check size={13} />
                    Confirm Repair
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Rollback Confirmation Modal */}
      {selectedRestore && (
        <div className="mahi-repair-modal-overlay">
          <div className="mahi-repair-modal">
            <div className="mahi-repair-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <RotateCcw size={18} color="#f87171" />
                <h3 style={{ margin: 0, fontSize: '16px', color: '#f0f4fc' }}>
                  Restore Configuration Preview
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRestore(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#8fa0bc',
                  fontSize: '18px',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div className="mahi-repair-modal-body">
              <div>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#f0f4fc' }}>
                  Restore Snapshot Target: {selectedRestore.target}
                </h4>
                <div style={{ fontSize: '12px', color: '#8fa0bc' }}>
                  Summary: <strong>{selectedRestore.summary}</strong>
                </div>
              </div>

              <div style={{ fontSize: '12.5px', color: '#cbd5e1' }}>
                Target: <code className="mahi-health-mono" style={{ color: '#93c5fd' }}>{selectedRestore.target}</code>
              </div>

              {/* Exact Rollback Diff */}
              <div className="mahi-repair-diff-grid">
                <div className="mahi-diff-box">
                  <span className="mahi-diff-label" style={{ color: '#fbbf24' }}>
                    Active Configuration (Current)
                  </span>
                  <div
                    className="mahi-health-mono"
                    style={{
                      fontSize: '11px',
                      color: '#fef08a',
                      whiteSpace: 'pre-wrap',
                      maxHeight: '140px',
                      overflowY: 'auto',
                      padding: '4px',
                    }}
                  >
                    {selectedRestore.currentValue}
                  </div>
                </div>
                <div className="mahi-diff-box">
                  <span className="mahi-diff-label" style={{ color: '#60a5fa' }}>
                    Snapshot Configuration (Restored)
                  </span>
                  <div
                    className="mahi-health-mono"
                    style={{
                      fontSize: '11px',
                      color: '#bfdbfe',
                      whiteSpace: 'pre-wrap',
                      maxHeight: '140px',
                      overflowY: 'auto',
                      padding: '4px',
                    }}
                  >
                    {selectedRestore.restoredValue}
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '6px',
                  padding: '12px',
                  fontSize: '12px',
                  color: '#fca5a5',
                }}
              >
                <strong>Warning:</strong> Restoring this snapshot will write the exact previous state back to HKCU\Environment and mark the repair record as rolled back.
              </div>
            </div>

            <div className="mahi-repair-modal-footer">
              <button
                type="button"
                className="mahi-repair-cancel-btn"
                onClick={() => setSelectedRestore(null)}
                disabled={restoring}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 18px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                }}
                onClick={() => handleExecuteRestore(selectedRestore.historyEntryId)}
                disabled={restoring}
              >
                {restoring ? (
                  <>
                    <RefreshCw size={13} className="mahi-health-spin" />
                    Restoring...
                  </>
                ) : (
                  <>
                    <RotateCcw size={13} />
                    Confirm Restore
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
