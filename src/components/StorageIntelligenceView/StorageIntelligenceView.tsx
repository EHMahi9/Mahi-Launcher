import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  HardDrive,
  RefreshCw,
  ShieldCheck,
  FolderOpen,
  ArrowRight,
  Info,
  CheckCircle2,
  FolderGit2,
  Layers,
  Database,
  Trash2,
  History,
  AlertTriangle,
  X,
  Clock,
  MoveRight,
  RotateCcw,
} from 'lucide-react';
import {
  StorageDriveReport,
  StorageItemClassification,
  CleanupPreview,
  CleanupExecutionResult,
  CleanupHistoryEntry,
  GuidedRelocationCandidate,
  RelocationPreview,
  RelocationResult,
  RelocationHistoryEntry,
  RelocationProgressPayload,
} from '../../types/storage';
import {
  getCleanupPreview,
  executeSafeCleanup,
  getCleanupHistory,
  detectGuidedRelocationCandidates,
  getRelocationPreview,
  executeGuidedRelocation,
  getRelocationHistory,
  cancelRelocation,
  listenToRelocationProgress,
  executeRelocationRestore,
} from '../../services/tauriApi';
import { canExecuteCleanup, normalizeArray, normalizeStorageReport } from './cleanupUtils';
import './StorageIntelligenceView.css';

const EMPTY_STORAGE_REPORT: StorageDriveReport = {
  driveLetter: 'C',
  totalBytes: 0,
  usedBytes: 0,
  freeBytes: 0,
  freePercentage: 0,
  usedPercentage: 0,
  categories: [],
  topDirectories: [],
  largeFiles: [],
  developerStorage: [],
  applicationStorage: [],
  relocationCandidates: [],
  recoverableSpace: {
    definitelyReclaimableBytes: 0,
    definitelyReclaimableFormatted: '0 B',
    potentiallyReclaimableBytes: 0,
    potentiallyReclaimableFormatted: '0 B',
    relocatableBytes: 0,
    relocatableFormatted: '0 B',
    reviewRequiredBytes: 0,
    reviewRequiredFormatted: '0 B',
  },
  recommendations: [],
  scanTimestamp: 0,
};

interface StorageIntelligenceViewProps {
  reports: Record<string, StorageDriveReport>;
  availableDrives: string[];
  activeDrive: string;
  onSelectDrive: (drive: string) => void;
  onRefresh: (drive: string) => void;
  refreshing: boolean;
  onNavigateToPath?: (path: string) => void;
  initialTab?: 'overview' | 'cleanup' | 'recommendations' | 'developer' | 'relocation' | 'history';
}

export const StorageIntelligenceView: React.FC<StorageIntelligenceViewProps> = ({
  reports,
  availableDrives,
  activeDrive,
  onSelectDrive,
  onRefresh,
  refreshing,
  onNavigateToPath,
  initialTab = 'overview',
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'cleanup' | 'recommendations' | 'developer' | 'relocation' | 'history'>(initialTab);
  const [selectedClassificationFilter, setSelectedClassificationFilter] = useState<string>('ALL');

  // Phase 8B: Selection & Cleanup State
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [confirmBeforeCleanup, setConfirmBeforeCleanup] = useState<boolean>(true);
  const [previewModalOpen, setPreviewModalOpen] = useState<boolean>(false);
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState<boolean>(false);
  const [cleanupResult, setCleanupResult] = useState<CleanupExecutionResult | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [cleanupHistory, setCleanupHistory] = useState<CleanupHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  // Phase 8E: Recovery State
  const [restorePreviewEntry, setRestorePreviewEntry] = useState<RelocationHistoryEntry | null>(null);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [restoreResult, setRestoreResult] = useState<RelocationResult | null>(null);

  // Phase 8C: Guided Relocation State
  const [relocationCandidatesList, setRelocationCandidatesList] = useState<GuidedRelocationCandidate[]>([]);
  const [relocationLoading, setRelocationLoading] = useState<boolean>(false);
  const [selectedCandidate, setSelectedCandidate] = useState<GuidedRelocationCandidate | null>(null);
  const [relocationPreviewModal, setRelocationPreviewModal] = useState<RelocationPreview | null>(null);
  const [relocationPreviewLoading, setRelocationPreviewLoading] = useState<boolean>(false);
  const [relocationExecuting, setRelocationExecuting] = useState<boolean>(false);
  const [relocationResult, setRelocationResult] = useState<RelocationResult | null>(null);
  const [relocationHistory, setRelocationHistory] = useState<RelocationHistoryEntry[]>([]);
  const [relocationHistoryLoading, setRelocationHistoryLoading] = useState<boolean>(false);
  const [confirmEnvChanges, setConfirmEnvChanges] = useState<boolean>(true);
  const [customDestination, setCustomDestination] = useState<string>('');
  const [activeRelocationTab, setActiveRelocationTab] = useState<'advisor' | 'history'>('advisor');
  const [relocationProgress, setRelocationProgress] = useState<RelocationProgressPayload | null>(null);
  const [relocationCancelling, setRelocationCancelling] = useState<boolean>(false);

  const report = useMemo(
    () => normalizeStorageReport(reports[activeDrive] || reports['C'] || null),
    [reports, activeDrive]
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listenToRelocationProgress((payload) => {
      setRelocationProgress(payload);
    }).then(fn => { unlisten = fn; });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Load history on mount or when switching to history tab
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const hist = await getCleanupHistory();
      setCleanupHistory(normalizeArray(hist));
    } catch (err) {
      console.error('Failed to load cleanup history:', err);
      setCleanupHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Phase 8C: Load relocation candidates
  const loadRelocationCandidates = useCallback(async () => {
    setRelocationLoading(true);
    try {
      const candidates = await detectGuidedRelocationCandidates();
      setRelocationCandidatesList(normalizeArray(candidates));
    } catch (err) {
      console.error('Failed to detect relocation candidates:', err);
      setRelocationCandidatesList([]);
    } finally {
      setRelocationLoading(false);
    }
  }, []);

  // Phase 8C: Load relocation history
  const loadRelocationHistory = useCallback(async () => {
    setRelocationHistoryLoading(true);
    try {
      const hist = await getRelocationHistory();
      setRelocationHistory(normalizeArray(hist));
    } catch (err) {
      console.error('Failed to load relocation history:', err);
      setRelocationHistory([]);
    } finally {
      setRelocationHistoryLoading(false);
    }
  }, []);

  // Phase 8C: Open review modal for a candidate
  const handleReviewMove = async (candidate: GuidedRelocationCandidate) => {
    setSelectedCandidate(candidate);
    const dest = customDestination || candidate.suggestedDestination;
    setCustomDestination(dest);
    setRelocationPreviewLoading(true);
    try {
      const preview = await getRelocationPreview(candidate.id, dest);
      setRelocationPreviewModal(preview);
    } catch (err) {
      console.error('Failed to get relocation preview:', err);
    } finally {
      setRelocationPreviewLoading(false);
    }
  };

  // Phase 8C: Execute guided relocation
  const handleExecuteRelocation = async () => {
    if (!relocationPreviewModal || !selectedCandidate) return;
    setRelocationExecuting(true);
    setRelocationProgress(null);
    setRelocationCancelling(false);
    try {
      const result = await executeGuidedRelocation(
        relocationPreviewModal.candidateId,
        relocationPreviewModal.destinationPath,
        confirmEnvChanges
      );
      setRelocationResult(result);
      setRelocationPreviewModal(null);
      setSelectedCandidate(null);
      if (result.success) {
        // Refresh candidates and history
        loadRelocationCandidates();
        loadRelocationHistory();
        onRefresh(activeDrive);
      }
    } catch (err) {
      console.error('Relocation execution failed:', err);
    } finally {
      setRelocationExecuting(false);
      setRelocationCancelling(false);
    }
  };

  const [restoreConfirmEnv, setRestoreConfirmEnv] = useState<boolean>(true);

  const handleReviewRestore = (entry: RelocationHistoryEntry) => {
    if (!entry.isRecoverable) return;
    setRestorePreviewEntry(entry);
    setRestoreResult(null);
    setRestoreConfirmEnv(Boolean(entry.envChangesMade && entry.envChangesMade.length > 0));
  };

  const handleCloseRestoreModal = () => {
    if (restoring) return;
    setRestorePreviewEntry(null);
    setRestoreResult(null);
    setRelocationProgress(null);
  };

  const handleExecuteRestore = async () => {
    if (!restorePreviewEntry) return;
    try {
      setRestoring(true);
      setRelocationProgress(null);
      const result = await executeRelocationRestore(restorePreviewEntry.id, restoreConfirmEnv);
      setRestoreResult(result);
      // Keep restorePreviewEntry active so user can review the result
      loadRelocationHistory();
    } catch (err: any) {
      alert("Restore failed: " + err);
    } finally {
      setRestoring(false);
    }
  };

  const handleCancelRelocation = async () => {
    if (relocationPreviewModal?.candidateId) {
      setRelocationCancelling(true);
      try {
        await cancelRelocation(relocationPreviewModal.candidateId);
      } catch (err) {
        console.error('Failed to cancel relocation:', err);
        setRelocationCancelling(false);
      }
    }
  };

  useEffect(() => {
    loadHistory();
    loadRelocationCandidates();
    loadRelocationHistory();
  }, [loadHistory, loadRelocationCandidates, loadRelocationHistory]);


  const {
    driveLetter,
    totalBytes,
    usedBytes,
    freeBytes,
    usedPercentage,
    freePercentage,
    categories,
    developerStorage,
    recoverableSpace,
    recommendations,
  } = report ?? EMPTY_STORAGE_REPORT;

  const formatGb = (bytes: number) => {
    return (bytes / (1024 * 1024 * 1024)).toFixed(1);
  };

  const getClassificationBadge = (classification: StorageItemClassification) => {
    switch (classification) {
      case 'SAFE_TO_CLEAN':
        return <span className="si-badge safe">SAFE TO CLEAN</span>;
      case 'RELOCATABLE':
        return <span className="si-badge relocatable">RELOCATABLE</span>;
      case 'REVIEW_REQUIRED':
        return <span className="si-badge review">REVIEW REQUIRED</span>;
      case 'SYSTEM_MANAGED':
        return <span className="si-badge system">SYSTEM MANAGED</span>;
      case 'DO_NOT_TOUCH':
        return <span className="si-badge danger">DO NOT TOUCH</span>;
      default:
        return <span className="si-badge unknown">UNKNOWN</span>;
    }
  };


  // Safe to Clean Candidates (ONLY SAFE_TO_CLEAN)
  const safeCleanupCandidates = useMemo(() => {
    const list: Array<{
      id: string;
      title: string;
      category: string;
      bytes: number;
      formattedSize: string;
      path: string;
      reason: string;
      isRebuildable: boolean;
    }> = [];

    // From Developer Storage
    developerStorage.forEach((d, idx) => {
      if (d.classification === 'SAFE_TO_CLEAN') {
        list.push({
          id: `dev-${idx}-${d.path}`,
          title: d.name,
          category: d.ecosystem,
          bytes: d.bytes,
          formattedSize: d.formattedSize,
          path: d.path,
          reason: `${d.purpose} Rebuildable: ${d.isRebuildable ? 'Yes' : 'No'}.`,
          isRebuildable: d.isRebuildable,
        });
      }
    });

    // From Recommendations
    recommendations.forEach((r) => {
      if (r.classification === 'SAFE_TO_CLEAN' && !list.some((item) => item.path === r.path)) {
        list.push({
          id: r.id,
          title: r.title,
          category: r.category,
          bytes: r.bytes,
          formattedSize: r.formattedSize,
          path: r.path,
          reason: r.why,
          isRebuildable: true,
        });
      }
    });

    return list;
  }, [developerStorage, recommendations]);

  const toggleSelectPath = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const selectAllSafe = () => {
    if (selectedPaths.size === safeCleanupCandidates.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(safeCleanupCandidates.map((c) => c.path)));
    }
  };

  const selectedBytesTotal = useMemo(() => {
    let sum = 0;
    safeCleanupCandidates.forEach((c) => {
      if (selectedPaths.has(c.path)) {
        sum += c.bytes;
      }
    });
    return sum;
  }, [safeCleanupCandidates, selectedPaths]);

  if (!report) {
    return (
      <div className="si-view-empty">
        <RefreshCw size={24} className="si-spin" />
        <p>Scanning storage intelligence metadata...</p>
      </div>
    );
  }

  // Handle Preview Request
  const handleOpenPreview = async () => {
    if (selectedPaths.size === 0) return;
    setCleanupLoading(true);
    setCleanupError(null);
    try {
      const preview = await getCleanupPreview(Array.from(selectedPaths));
      setCleanupPreview(preview);
      setPreviewModalOpen(true);
    } catch (err: any) {
      console.error('Failed to generate preview:', err);
      setCleanupError(err?.message || String(err) || 'Failed to generate cleanup preview');
    } finally {
      setCleanupLoading(false);
    }
  };

  // Execute Safe Cleanup
  const handleExecuteCleanup = async () => {
    if (!cleanupPreview || cleanupPreview.targets.length === 0) return;
    setCleanupLoading(true);
    setCleanupError(null);
    try {
      const pathsToClean = cleanupPreview.targets.map((t) => t.path);
      const res = await executeSafeCleanup(pathsToClean);
      setCleanupResult(res);
      setPreviewModalOpen(false);
      setSelectedPaths(new Set());
      // Refresh storage drive and reload history
      onRefresh(activeDrive);
      loadHistory();
    } catch (err: any) {
      console.error('Cleanup execution failed:', err);
      setCleanupError(err?.message || String(err) || 'Cleanup execution failed');
    } finally {
      setCleanupLoading(false);
    }
  };

  const filteredRecommendations = recommendations.filter((r) => {
    if (selectedClassificationFilter === 'ALL') return true;
    return r.classification === selectedClassificationFilter;
  });

  return (
    <div className="si-container">
      {/* Top Banner & Drive Selector */}
      <header className="si-header">
        <div className="si-title-group">
          <div className="si-icon-wrap">
            <HardDrive size={22} className="si-icon-brand" />
          </div>
          <div>
            <div className="si-header-badge">
              <ShieldCheck size={13} />
              <span>STORAGE INTELLIGENCE</span>
            </div>
            <h1 className="si-title">Storage Intelligence, Safe Cleanup &amp; Guided Relocation</h1>
            <p className="si-subtitle">
              Verified safe-to-clean targets, plus guided C→D relocation for developer caches and AI model storage.
            </p>
          </div>
        </div>

        <div className="si-actions-bar">
          <div className="si-drive-pills">
            {availableDrives.map((d) => (
              <button
                key={d}
                type="button"
                className={`si-drive-pill ${d === activeDrive ? 'active' : ''}`}
                onClick={() => onSelectDrive(d)}
              >
                <HardDrive size={14} />
                <span>{d}: Drive</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            className="si-btn-refresh"
            onClick={() => onRefresh(activeDrive)}
            disabled={refreshing || cleanupLoading}
            title="Rescan drive storage metadata"
          >
            <RefreshCw size={14} className={refreshing ? 'si-spin' : ''} />
            <span>{refreshing ? 'Scanning...' : 'Rescan'}</span>
          </button>
        </div>
      </header>

      {/* Hero Drive Usage Gauge */}
      <section className="si-hero-card">
        <div className="si-gauge-header">
          <div className="si-gauge-title">
            <span className="si-drive-letter">{driveLetter}:</span>
            <span className="si-drive-status">
              {usedPercentage > 85 ? 'Critically Full' : usedPercentage > 70 ? 'Moderate Capacity' : 'Healthy'}
            </span>
          </div>
          <div className="si-gauge-readout">
            <span className="si-gauge-percent">{usedPercentage}%</span>
            <span className="si-gauge-used">used</span>
          </div>
        </div>

        {/* Visual Usage Bar */}
        <div className="si-bar-track">
          <div
            className={`si-bar-fill ${usedPercentage > 85 ? 'fill-red' : usedPercentage > 70 ? 'fill-orange' : 'fill-blue'}`}
            style={{ width: `${Math.min(100, Math.max(2, usedPercentage))}%` }}
          />
        </div>

        <div className="si-gauge-metrics">
          <div className="si-gauge-item">
            <span className="lbl">Used Space</span>
            <span className="val">{formatGb(usedBytes)} GB</span>
          </div>
          <div className="si-gauge-item">
            <span className="lbl">Free Space</span>
            <span className="val accent-green">{formatGb(freeBytes)} GB</span>
          </div>
          <div className="si-gauge-item">
            <span className="lbl">Total Capacity</span>
            <span className="val">{formatGb(totalBytes)} GB</span>
          </div>
          <div className="si-gauge-item">
            <span className="lbl">Available %</span>
            <span className="val">{freePercentage}%</span>
          </div>
        </div>
      </section>

      {/* Cleanup Result Banner */}
      {cleanupResult && (
        <div className="si-result-banner">
          <div className="result-banner-left">
            <CheckCircle2 size={20} className="text-green" />
            <div>
              <h4 className="result-title">CLEANUP COMPLETE</h4>
              <p className="result-details">
                Recovered: <strong>{cleanupResult.recoveredFormatted}</strong> &middot; Cleaned: <strong>{cleanupResult.cleanedItems} items</strong>
                {cleanupResult.skippedFiles > 0 && ` · Skipped: ${cleanupResult.skippedFiles} locked files`}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="result-dismiss-btn"
            onClick={() => setCleanupResult(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Cleanup Error Banner */}
      {cleanupError && (
        <div className="si-result-banner error" style={{ borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.08)' }}>
          <div className="result-banner-left">
            <AlertTriangle size={20} className="text-amber" />
            <div>
              <h4 className="result-title" style={{ color: '#ef4444' }}>CLEANUP ISSUE</h4>
              <p className="result-details">{cleanupError}</p>
            </div>
          </div>
          <button
            type="button"
            className="result-dismiss-btn"
            onClick={() => setCleanupError(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Recoverable Space Breakdown Cards (4 Distinct Buckets) */}
      <section className="si-recoverable-grid">
        <div 
          className="si-recov-card definitely clickable"
          onClick={() => setActiveTab('cleanup')}
          title="Click to view Safe Cleanup candidates"
        >
          <div className="recov-header">
            <CheckCircle2 size={16} className="text-green" />
            <span className="recov-title">Definitely Reclaimable</span>
          </div>
          <div className="recov-number text-green">{recoverableSpace.definitelyReclaimableFormatted}</div>
          <p className="recov-desc">
            Rebuildable caches, temporary files, and debug targets that can be purged with zero risk.
          </p>
          <div className="recov-action-link">
            <span>Clean Safe Items &rarr;</span>
          </div>
        </div>

        <div className="si-recov-card potentially">
          <div className="recov-header">
            <Info size={16} className="text-amber" />
            <span className="recov-title">Potentially Reclaimable</span>
          </div>
          <div className="recov-number text-amber">{recoverableSpace.potentiallyReclaimableFormatted}</div>
          <p className="recov-desc">
            Large downloads, stale project archives, and dependencies requiring user review.
          </p>
        </div>

        <div
          className="si-recov-card relocatable clickable"
          onClick={() => setActiveTab('relocation')}
          title="Click to view Guided Relocation Advisor"
        >
          <div className="recov-header">
            <ArrowRight size={16} className="text-purple" />
            <span className="recov-title">Relocatable to D: Drive</span>
          </div>
          <div className="recov-number text-purple">{recoverableSpace.relocatableFormatted}</div>
          <p className="recov-desc">
            Heavy developer caches, Android emulators, and SDKs that can be migrated off C:.
          </p>
          <div className="recov-action-link">
            <span>Guided Relocation &rarr;</span>
          </div>
        </div>

        <div className="si-recov-card review">
          <div className="recov-header">
            <Database size={16} className="text-blue" />
            <span className="recov-title">Requires Review</span>
          </div>
          <div className="recov-number text-blue">{recoverableSpace.reviewRequiredFormatted}</div>
          <p className="recov-desc">
            User files and application data where direct deletion could cause unintended loss.
          </p>
        </div>
      </section>

      {/* Sub Navigation Tabs */}
      <div className="si-tabs">
        <button
          type="button"
          className={`si-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <Layers size={15} />
          <span>Why is {driveLetter}: Full?</span>
        </button>
        <button
          type="button"
          className={`si-tab ${activeTab === 'cleanup' ? 'active' : ''}`}
          onClick={() => setActiveTab('cleanup')}
        >
          <Trash2 size={15} />
          <span>Safe Cleanup ({safeCleanupCandidates.length})</span>
        </button>
        <button
          type="button"
          className={`si-tab ${activeTab === 'recommendations' ? 'active' : ''}`}
          onClick={() => setActiveTab('recommendations')}
        >
          <CheckCircle2 size={15} />
          <span>Recommendations ({recommendations.length})</span>
        </button>
        <button
          type="button"
          className={`si-tab ${activeTab === 'developer' ? 'active' : ''}`}
          onClick={() => setActiveTab('developer')}
        >
          <FolderGit2 size={15} />
          <span>Developer Footprint ({developerStorage.length})</span>
        </button>
        <button
          type="button"
          className={`si-tab ${activeTab === 'relocation' ? 'active' : ''}`}
          onClick={() => setActiveTab('relocation')}
        >
          <MoveRight size={15} />
          <span>C &rarr; D Relocation Advisor ({relocationCandidatesList.length})</span>
        </button>
        <button
          type="button"
          className={`si-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <History size={15} />
          <span>Cleanup History ({cleanupHistory.length})</span>
        </button>
      </div>

      {/* Tab 1: Category Breakdown ("Why is my drive full?") */}
      {activeTab === 'overview' && (
        <div className="si-section-view">
          <div className="si-card-box">
            <div className="si-card-box-header">
              <h3>Storage Breakdown for {driveLetter}:</h3>
              <span className="si-text-muted">Evidence-based classification from system paths and directory structures</span>
            </div>

            <div className="si-category-list">
              {categories.map((cat) => (
                <div key={cat.category} className="si-category-row">
                  <div className="si-cat-meta">
                    <span className="si-cat-name">{cat.label}</span>
                    <span className="si-cat-desc">{cat.description}</span>
                  </div>
                  <div className="si-cat-bar-wrap">
                    <div className="si-cat-bar-track">
                      <div className="si-cat-bar-fill" style={{ width: `${Math.max(2, cat.percentage)}%` }} />
                    </div>
                  </div>
                  <div className="si-cat-size">
                    <span className="size-bold">{cat.formattedSize}</span>
                    <span className="size-pct">{cat.percentage}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: SAFE CLEANUP ENGINE (Phase 8B) */}
      {activeTab === 'cleanup' && (
        <div className="si-section-view">
          <div className="si-card-box">
            <div className="si-card-box-header si-flex-between">
              <div>
                <h3>Safe Cleanup Targets</h3>
                <span className="si-text-muted">
                  Strictly limited to verified rebuildable developer caches and temporary runtime files.
                </span>
              </div>
              <div className="si-settings-toggle-row">
                <label className="si-checkbox-label">
                  <input
                    type="checkbox"
                    checked={confirmBeforeCleanup}
                    onChange={(e) => setConfirmBeforeCleanup(e.target.checked)}
                  />
                  <span>Confirm before every cleanup (Default)</span>
                </label>
              </div>
            </div>

            {safeCleanupCandidates.length === 0 ? (
              <div className="si-empty-box">
                <CheckCircle2 size={24} className="text-green" />
                <p>Drive {driveLetter}: has no safe cleanup targets at this time.</p>
              </div>
            ) : (
              <>
                <div className="si-cleanup-toolbar">
                  <button
                    type="button"
                    className="si-btn-secondary"
                    onClick={selectAllSafe}
                  >
                    {selectedPaths.size === safeCleanupCandidates.length ? 'Deselect All' : 'Select All Safe'}
                  </button>

                  <div className="si-selected-summary">
                    <span>Selected: <strong>{formatGb(selectedBytesTotal)} GB</strong> ({selectedPaths.size} targets)</span>
                  </div>

                  <button
                    type="button"
                    className="si-btn-primary danger"
                    disabled={selectedPaths.size === 0 || cleanupLoading}
                    onClick={handleOpenPreview}
                  >
                    <Trash2 size={14} />
                    <span>Clean Selected ({selectedPaths.size})</span>
                  </button>
                </div>

                <div className="si-cleanup-list">
                  {safeCleanupCandidates.map((cand) => {
                    const isSelected = selectedPaths.has(cand.path);
                    return (
                      <div
                        key={cand.id}
                        className={`si-cleanup-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => toggleSelectPath(cand.path)}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // handled by parent div
                          className="si-cleanup-checkbox"
                        />
                        <div className="si-cleanup-meta">
                          <div className="si-cleanup-name-row">
                            <span className="si-cleanup-name">{cand.title}</span>
                            <span className="si-badge safe">SAFE TO CLEAN</span>
                            <span className="si-tag-eco">{cand.category}</span>
                          </div>
                          <p className="si-cleanup-reason">{cand.reason}</p>
                          <code className="si-cleanup-path">{cand.path}</code>
                        </div>
                        <div className="si-cleanup-size">
                          {cand.formattedSize}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Recommendations */}
      {activeTab === 'recommendations' && (
        <div className="si-section-view">
          <div className="si-filter-bar">
            <span className="filter-lbl">Filter by classification:</span>
            {['ALL', 'SAFE_TO_CLEAN', 'RELOCATABLE', 'REVIEW_REQUIRED', 'SYSTEM_MANAGED'].map((filter) => (
              <button
                key={filter}
                type="button"
                className={`si-filter-chip ${selectedClassificationFilter === filter ? 'active' : ''}`}
                onClick={() => setSelectedClassificationFilter(filter)}
              >
                {filter.replace(/_/g, ' ')}
              </button>
            ))}
          </div>

          <div className="si-recs-grid">
            {filteredRecommendations.length === 0 ? (
              <div className="si-empty-box">No items matching this classification filter.</div>
            ) : (
              filteredRecommendations.map((rec) => (
                <div key={rec.id} className="si-rec-card">
                  <div className="si-rec-card-top">
                    <div className="rec-title-wrap">
                      <span className="rec-cat-tag">{rec.category}</span>
                      <h4 className="rec-card-title">{rec.title}</h4>
                    </div>
                    {getClassificationBadge(rec.classification)}
                  </div>

                  <p className="rec-why">
                    <strong>Why: </strong>
                    {rec.why}
                  </p>

                  <div className="rec-future-box">
                    <div className="future-action-hdr">
                      <ShieldCheck size={13} className="text-cyan" />
                      <span>Recommended Action (Advisor)</span>
                    </div>
                    <p className="future-action-txt">{rec.futureAction}</p>
                  </div>

                  <div className="rec-footer">
                    <span className="rec-path" title={rec.path}>
                      {rec.path}
                    </span>
                    <div className="rec-action-buttons">
                      {rec.isSafeToClean && (
                        <button
                          type="button"
                          className="si-btn-clean-rec"
                          onClick={() => {
                            setSelectedPaths(new Set([rec.path]));
                            setActiveTab('cleanup');
                          }}
                        >
                          <Trash2 size={12} />
                          <span>Clean Target</span>
                        </button>
                      )}
                      {onNavigateToPath && (
                        <button
                          type="button"
                          className="si-btn-link"
                          onClick={() => onNavigateToPath(rec.path)}
                        >
                          <FolderOpen size={13} />
                          <span>Inspect</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Developer Storage */}
      {activeTab === 'developer' && (
        <div className="si-section-view">
          <div className="si-card-box">
            <div className="si-card-box-header">
              <h3>Developer Caches, Build Targets &amp; Registries</h3>
              <span className="si-text-muted">Detected package managers, compilers, and virtual device images</span>
            </div>

            <div className="si-table-responsive">
              <table className="si-table">
                <thead>
                  <tr>
                    <th>Item &amp; Tool</th>
                    <th>Ecosystem</th>
                    <th>Size</th>
                    <th>Rebuildable</th>
                    <th>Classification</th>
                    <th>Recommended Cleanup / Relocation</th>
                  </tr>
                </thead>
                <tbody>
                  {developerStorage.map((item, idx) => (
                    <tr key={idx}>
                      <td>
                        <div className="si-table-name">{item.name}</div>
                        <div className="si-table-path" title={item.path}>{item.path}</div>
                      </td>
                      <td>
                        <span className="si-tag-eco">{item.ecosystem}</span>
                      </td>
                      <td className="si-size-col">{item.formattedSize}</td>
                      <td>
                        <span className={`si-pill-rebuild ${item.isRebuildable ? 'yes' : 'no'}`}>
                          {item.isRebuildable ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td>{getClassificationBadge(item.classification)}</td>
                      <td>
                        <div className="si-action-hint">{item.cleanupPotential}</div>
                        {item.relocationPotential && (
                          <div className="si-reloc-hint">{item.relocationPotential}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Phase 8C — Guided Relocation Advisor */}
      {activeTab === 'relocation' && (
        <div className="si-section-view">
          {/* Relocation Result Banner */}
          {relocationResult && (
            <div className={`si-result-banner ${relocationResult.success ? '' : 'error'}`} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {relocationResult.success ? (
                    <CheckCircle2 size={20} className="text-green" />
                  ) : (
                    <AlertTriangle size={20} className="text-amber" />
                  )}
                  <h4 className="result-title" style={{ margin: 0 }}>
                    {relocationResult.success ? 'RELOCATION COMPLETED' : 'RELOCATION FAILED'}
                  </h4>
                </div>
                <button type="button" className="result-dismiss-btn" onClick={() => setRelocationResult(null)}>
                  <X size={14} />
                </button>
              </div>

              <div className="result-details" style={{ marginLeft: '28px', fontSize: '13px' }}>
                {relocationResult.success ? (
                  <>
                    <p style={{ margin: '4px 0' }}>Moved <strong>{relocationResult.formattedSize}</strong> from <code>{relocationResult.source}</code> to <code>{relocationResult.destination}</code>.</p>
                    <p style={{ margin: '4px 0' }}>Verification: <strong>{relocationResult.verificationPassed ? 'Passed' : 'Unknown / Skipped'}</strong></p>
                    <p style={{ margin: '4px 0' }}>Source directory removed: <strong>Yes</strong></p>
                    {relocationResult.envChangesMade.length > 0 && (
                      <p style={{ margin: '4px 0' }}>Configuration changed: <strong>{relocationResult.envChangesMade.join(', ')}</strong></p>
                    )}
                  </>
                ) : (
                  <>
                    <p style={{ margin: '4px 0', color: 'var(--text-error)' }}>{relocationResult.errors[0] || 'An error occurred during relocation.'}</p>
                    <p style={{ margin: '4px 0' }}>Source <code>{relocationResult.source}</code>: <strong>Intact</strong></p>
                    <p style={{ margin: '4px 0' }}>Destination <code>{relocationResult.destination}</code>: {relocationResult.rollbackPerformed ? <strong>Rolled back (cleaned up)</strong> : <strong>May contain partial files</strong>}</p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Sub-tabs: Advisor | History */}
          <div className="si-reloc-subtabs">
            <button
              type="button"
              className={`si-reloc-subtab ${activeRelocationTab === 'advisor' ? 'active' : ''}`}
              onClick={() => setActiveRelocationTab('advisor')}
            >
              <MoveRight size={14} />
              <span>Relocation Advisor ({relocationCandidatesList.length})</span>
            </button>
            <button
              type="button"
              className={`si-reloc-subtab ${activeRelocationTab === 'history' ? 'active' : ''}`}
              onClick={() => { setActiveRelocationTab('history'); loadRelocationHistory(); }}
            >
              <History size={14} />
              <span>Migration History ({relocationHistory.length})</span>
            </button>
            <button
              type="button"
              className="si-btn-secondary si-reloc-refresh"
              onClick={loadRelocationCandidates}
              disabled={relocationLoading}
            >
              <RefreshCw size={13} className={relocationLoading ? 'si-spin' : ''} />
              <span>{relocationLoading ? 'Scanning...' : 'Rescan'}</span>
            </button>
          </div>

          {/* Advisor Cards */}
          {activeRelocationTab === 'advisor' && (
            <div className="si-card-box">
              <div className="si-card-box-header">
                <h3>C &rarr; D Guided Relocation Advisor</h3>
                <span className="si-text-muted">
                  Each item below is a detected, eligible candidate for guided migration. Only RELOCATABLE items appear here.
                  No data is moved without your explicit confirmation.
                </span>
              </div>

              {relocationLoading ? (
                <div className="si-empty-box">
                  <RefreshCw size={22} className="si-spin" />
                  <p>Scanning for relocatable candidates...</p>
                </div>
              ) : relocationCandidatesList.length === 0 ? (
                <div className="si-empty-box">
                  <CheckCircle2 size={24} className="text-green" />
                  <p>No eligible relocation candidates detected on C: drive at this time.</p>
                  <p className="si-text-muted">Candidates appear when supported tools (Cargo, pnpm, HuggingFace, Android SDK, LM Studio, LDPlayer) store data on C:.</p>
                </div>
              ) : (
                <div className="si-guided-reloc-list">
                  {relocationCandidatesList.map((cand) => (
                    <div key={cand.id} className="si-guided-reloc-card">
                      <div className="guided-reloc-header">
                        <div className="guided-reloc-title-block">
                          <span className="guided-reloc-cat-badge">{cand.categoryLabel}</span>
                          <h4 className="guided-reloc-name">{cand.name}</h4>
                        </div>
                        <div className="guided-reloc-tags">
                          <span className="guided-reloc-size">{cand.formattedSize}</span>
                          <span className={`si-badge-risk ${cand.risk.toLowerCase()}`}>{cand.risk} Risk</span>
                        </div>
                      </div>

                      <div className="guided-reloc-paths">
                        <div className="guided-path-box current">
                          <span className="guided-path-lbl">Current Location (C:)</span>
                          <code className="guided-path-code">{cand.currentPath}</code>
                        </div>
                        <div className="guided-path-arrow">
                          <MoveRight size={20} />
                        </div>
                        <div className="guided-path-box dest">
                          <span className="guided-path-lbl">Suggested Destination (D:)</span>
                          <code className="guided-path-code">{cand.suggestedDestination}</code>
                        </div>
                      </div>

                      <div className="guided-reloc-info-grid">
                        <div className="guided-info-row">
                          <span className="info-lbl">Why Safe:</span>
                          <span className="info-val">{cand.whySafe}</span>
                        </div>
                        <div className="guided-info-row">
                          <span className="info-lbl">Method:</span>
                          <span className="info-val">{cand.method}</span>
                        </div>
                        {cand.envChangesDescription && (
                          <div className="guided-info-row">
                            <span className="info-lbl">⚙ Config Change:</span>
                            <code className="info-val-code">{cand.envChangesDescription}</code>
                          </div>
                        )}
                        <div className="guided-info-row">
                          <span className="info-lbl">Restart Required:</span>
                          <span className={`info-val ${cand.requiresRestart ? 'text-amber' : 'text-green'}`}>
                            {cand.requiresRestart ? 'Yes — app/terminal restart required after migration' : 'No restart needed'}
                          </span>
                        </div>
                      </div>

                      <div className="guided-reloc-recovery-bar">
                        <CheckCircle2 size={14} className="text-green" />
                        <span>Estimated C: recovery: <strong>{cand.formattedSize}</strong></span>
                      </div>

                      <div className="guided-reloc-footer">
                        <button
                          type="button"
                          className="si-btn-review-move"
                          onClick={() => handleReviewMove(cand)}
                          disabled={relocationPreviewLoading}
                        >
                          <MoveRight size={14} />
                          <span>{relocationPreviewLoading && selectedCandidate?.id === cand.id ? 'Loading Preview...' : 'Review Move'}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Relocation History */}
          {activeRelocationTab === 'history' && (
            <div className="si-card-box">
              <div className="si-card-box-header si-flex-between">
                <div>
                  <h3>Migration History</h3>
                  <span className="si-text-muted">Persistent log of all completed and failed guided relocations</span>
                </div>
                <button
                  type="button"
                  className="si-btn-secondary"
                  onClick={loadRelocationHistory}
                  disabled={relocationHistoryLoading}
                >
                  <RefreshCw size={13} className={relocationHistoryLoading ? 'si-spin' : ''} />
                  <span>Refresh</span>
                </button>
              </div>
              {relocationHistory.length === 0 ? (
                <div className="si-empty-box">
                  <Clock size={24} className="si-icon-muted" />
                  <p>No relocations recorded yet. Migration logs will appear here after your first guided move.</p>
                </div>
              ) : (
                <div className="si-history-list">
                  {relocationHistory.map((item) => (
                    <div key={item.id} className={`si-history-item ${item.success ? '' : 'failed'}`} style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '8px' }}>
                      <div className="history-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div className="history-cat-time" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {item.success ? <CheckCircle2 size={16} className="text-green" /> : <AlertTriangle size={16} className="text-amber" />}
                          <span className="history-cat" style={{ fontWeight: 500 }}>{item.category}</span>
                          <span className="history-time" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{item.formattedTime}</span>
                        </div>
                        <span className={`history-reclaimed ${item.success ? 'text-green' : 'text-amber'}`} style={{ fontSize: '12px', fontWeight: 'bold' }}>
                          {item.success ? `+${item.formattedSize} Migrated` : 'Failed'}
                        </span>
                      </div>
                      <div className="history-reloc-paths" style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px', backgroundColor: 'var(--surface-sunken)', padding: '8px', borderRadius: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ minWidth: '40px' }}>From:</span> <code>{item.source}</code>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ minWidth: '40px' }}>To:</span> <code>{item.destination}</code>
                        </div>
                      </div>
                      <div style={{ fontSize: '11px', marginTop: '8px', display: 'flex', gap: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', gap: '16px' }}>
                          <span>Bytes Moved: <strong>{item.bytesMoved}</strong></span>
                          <span>Outcome: <strong>{item.success ? 'Success' : 'Error'}</strong></span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                           {item.isRecoverable ? (
                             <>
                               <span className="text-green">Recoverable</span>
                               <button className="si-btn-outline" onClick={() => handleReviewRestore(item)} style={{ padding: '2px 8px', fontSize: '10px' }}>
                                 Restore
                               </button>
                             </>
                           ) : (
                             <span className="text-amber">Not Recoverable {item.recoveryReason ? '(' + item.recoveryReason + ')' : ''}</span>
                           )}
                        </div>
                      </div>
                      {item.rollbackPerformed && (
                        <div className="history-rollback" style={{ fontSize: '11px', marginTop: '6px', color: 'var(--text-amber)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <RotateCcw size={12} /> Source preserved (rollback performed)
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 6: Cleanup History */}
      {activeTab === 'history' && (
        <div className="si-section-view">
          <div className="si-card-box">
            <div className="si-card-box-header si-flex-between">
              <div>
                <h3>Cleanup History</h3>
                <span className="si-text-muted">Persistent local audit log of reclaimed storage and timestamps</span>
              </div>
              <button
                type="button"
                className="si-btn-secondary"
                onClick={loadHistory}
                disabled={historyLoading}
              >
                <RefreshCw size={13} className={historyLoading ? 'si-spin' : ''} />
                <span>Refresh History</span>
              </button>
            </div>

            {cleanupHistory.length === 0 ? (
              <div className="si-empty-box">
                <Clock size={24} className="si-icon-muted" />
                <p>No cleanups recorded yet. Reclaimed storage logs will appear here.</p>
              </div>
            ) : (
              <div className="si-history-list">
                {cleanupHistory.map((item) => (
                  <div key={item.id} className="si-history-item">
                    <div className="history-top">
                      <div className="history-cat-time">
                        <span className="history-cat">{item.category}</span>
                        <span className="history-time">{item.formattedTime}</span>
                      </div>
                      <span className="history-reclaimed text-green">
                        +{item.formattedSize} Reclaimed
                      </span>
                    </div>
                    <div className="history-summary">
                      {item.targetsSummary.join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation & Preview Modal */}
      {previewModalOpen && cleanupPreview && (
        <div className="si-modal-backdrop" onClick={() => setPreviewModalOpen(false)}>
          <div className="si-modal" onClick={(e) => e.stopPropagation()}>
            <div className="si-modal-header">
              <div className="si-modal-title-wrap">
                <AlertTriangle size={18} className="text-amber" />
                <h3>WHAT WILL BE CLEANED</h3>
              </div>
              <button
                type="button"
                className="si-modal-close"
                onClick={() => setPreviewModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="si-modal-body">
              {cleanupPreview.targetCount > 0 ? (
                <p className="modal-lead">
                  <strong>{cleanupPreview.targetCount}</strong> selected item(s) were verified as <code>SAFE_TO_CLEAN</code>. Blocked items: <strong>{cleanupPreview.warnings.length}</strong>. Source code, project configurations, and personal documents will never be touched.
                </p>
              ) : (
                <p className="modal-lead text-amber">
                  No selected targets were verified as <code>SAFE_TO_CLEAN</code>. Nothing can be removed. Blocked items: <strong>{cleanupPreview.warnings.length}</strong>. Review the reasons below.
                </p>
              )}

              <div className="modal-target-list">
                {cleanupPreview.targets.map((tgt) => (
                  <div key={tgt.id} className="modal-target-row">
                    <div className="modal-target-info">
                      <span className="target-name">{tgt.name}</span>
                      <span className="target-cat">{tgt.category}</span>
                      <code className="target-path">{tgt.path}</code>
                    </div>
                    <span className="target-size">{tgt.formattedSize}</span>
                  </div>
                ))}
              </div>

              <div className="modal-total-row">
                <span className="total-lbl">TOTAL ESTIMATED RECOVERY:</span>
                <span className="total-val text-green">{cleanupPreview.totalFormatted}</span>
              </div>

              {cleanupPreview.warnings.length > 0 && (
                <div className="modal-warnings">
                  {cleanupPreview.warnings.map((w, idx) => (
                    <div key={idx} className="warning-text">&bull; {w}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="si-modal-footer">
              <button
                type="button"
                className="si-btn-secondary"
                onClick={() => setPreviewModalOpen(false)}
                disabled={cleanupLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="si-btn-primary danger"
                onClick={handleExecuteCleanup}
                disabled={!canExecuteCleanup(cleanupPreview, cleanupLoading)}
              >
                <Trash2 size={14} />
                <span>{cleanupLoading ? 'Cleaning Safely...' : cleanupPreview.targets.length === 0 ? 'No Verified Items' : 'Clean Selected Now'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

            {/* Phase 8E: Restore Preview Modal */}
      {restorePreviewEntry && (
        <div className="si-modal-backdrop" onClick={handleCloseRestoreModal}>
          <div className="si-modal" onClick={(e) => e.stopPropagation()}>
            <div className="si-modal-header">
              <div className="si-modal-title-wrap">
                <RotateCcw size={18} className="text-amber" />
                <h3>RESTORE RELOCATED DATA</h3>
              </div>
              <button 
                className="si-modal-close"
                onClick={handleCloseRestoreModal}
                disabled={restoring}
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="si-modal-body">
              {restoreResult ? (
                <div className={`si-result-banner ${restoreResult.success ? "success" : "error"}`} style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    {restoreResult.success ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                    <strong>{restoreResult.success ? 'Restore Successful' : 'Restore Failed'}</strong>
                  </div>
                  <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div><strong>Original Path (Destination):</strong> <code>{restoreResult.destination}</code></div>
                    <div><strong>Relocated Path (Source):</strong> <code>{restoreResult.source}</code></div>
                    <div><strong>Restored Bytes:</strong> {restoreResult.formattedSize} ({restoreResult.bytesMoved.toLocaleString()} bytes)</div>
                    <div><strong>Files Restored:</strong> {restoreResult.filesRestored !== undefined ? restoreResult.filesRestored : 'Verified'}</div>
                    <div><strong>Verification Result:</strong> {restoreResult.verificationPassed ? 'Verified (100% equivalence)' : 'Verification Failed'}</div>
                    {restoreResult.verificationMethod && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginTop: '2px' }}>
                        <strong>Verification Method:</strong> {restoreResult.verificationMethod}
                      </div>
                    )}
                    <div><strong>Configuration Restored:</strong> {restoreResult.configChanged ? 'Yes (MAHI-managed configuration rolled back)' : 'No (Configuration preserved/unchanged)'}</div>
                    <div><strong>Old Relocated Copy Removed:</strong> {restoreResult.oldCopyRemoved ? 'Yes (Cleaned up from D:)' : 'No (Relocated copy preserved on D:)'}</div>
                    <div><strong>Rollback Occurred:</strong> {restoreResult.rollbackPerformed ? 'Yes (Destination rolled back, source preserved)' : 'No'}</div>
                    
                    {restoreResult.errors && restoreResult.errors.length > 0 && (
                      <div style={{ marginTop: '8px', padding: '8px', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                        <strong style={{ color: 'var(--text-amber)' }}>Notices/Errors:</strong>
                        <ul style={{ paddingLeft: '20px', margin: '4px 0 0 0' }}>
                          {restoreResult.errors.map((e: string, i: number) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ marginBottom: '16px' }}>
                    You are about to restore <strong>{restorePreviewEntry.category}</strong> to its original location. 
                  </p>
                  
                  <div className="relocation-preview-paths">
                    <div className="path-box">
                      <span className="path-label">From (Current Location):</span>
                      <code className="path-value">{restorePreviewEntry.destination}</code>
                    </div>
                    <div className="path-action-arrow">
                      <ArrowRight size={16} />
                    </div>
                    <div className="path-box">
                      <span className="path-label">To (Original Location):</span>
                      <code className="path-value">{restorePreviewEntry.source}</code>
                    </div>
                  </div>

                  <div className="relocation-preview-details" style={{ marginTop: '16px' }}>
                    <div className="detail-row">
                      <HardDrive size={14} />
                      <span><strong>{restorePreviewEntry.formattedSize}</strong> will be moved.</span>
                    </div>
                  </div>

                  {restorePreviewEntry.envChangesMade && restorePreviewEntry.envChangesMade.length > 0 && (
                    <div style={{ marginTop: '16px', padding: '10px 12px', background: 'var(--surface-sunken)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                        <input 
                          type="checkbox"
                          checked={restoreConfirmEnv}
                          onChange={(e) => setRestoreConfirmEnv(e.target.checked)}
                          disabled={restoring}
                        />
                        <span>Restore original tool/environment configuration</span>
                      </label>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', paddingLeft: '22px' }}>
                        Changes to revert: {restorePreviewEntry.envChangesMade.join(', ')}
                      </div>
                    </div>
                  )}

                  {restoring && (
                    <div className="relocation-progress-box" style={{ marginTop: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 'bold' }}>{relocationProgress ? relocationProgress.stage : 'Starting...'}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                          {relocationProgress ? (relocationProgress.bytesCopied / 1024 / 1024).toFixed(2) + ' MB / ' + (relocationProgress.totalBytes / 1024 / 1024).toFixed(2) + ' MB' : ''}
                        </span>
                      </div>
                      <div className="progress-bar-bg" style={{ width: '100%', height: '6px', backgroundColor: 'var(--surface-sunken)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div className="progress-bar-fill" style={{ 
                          width: relocationProgress && relocationProgress.totalBytes > 0 ? ((relocationProgress.bytesCopied / relocationProgress.totalBytes) * 100) + '%' : '0%',
                          height: '100%',
                          backgroundColor: 'var(--accent-primary)',
                          transition: 'width 0.2s ease-out'
                        }} />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            
            <div className="si-modal-footer">
              {restoreResult ? (
                <button 
                  className="si-btn-primary"
                  onClick={handleCloseRestoreModal}
                >
                  Close
                </button>
              ) : (
                <>
                  <button 
                    className="si-btn-outline"
                    onClick={() => {
                      if (restoring && relocationProgress && relocationProgress.stage !== 'Finalizing' && relocationProgress.stage !== 'Completed') {
                        handleCancelRelocation();
                      } else {
                        handleCloseRestoreModal();
                      }
                    }}
                  >
                    {restoring ? 'Cancel Restore' : 'Cancel'}
                  </button>
                  <button 
                    className="si-btn-primary"
                    onClick={handleExecuteRestore}
                    disabled={restoring || relocationCancelling}
                  >
                    {restoring ? 'Restoring...' : 'Confirm Restore'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Phase 8C: Relocation Preview & Confirmation Modal */}
      {relocationPreviewModal && selectedCandidate && (
        <div className="si-modal-backdrop" onClick={() => setRelocationPreviewModal(null)}>
          <div className="si-modal si-reloc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="si-modal-header">
              <div className="si-modal-title-wrap">
                <MoveRight size={18} className="text-purple" />
                <h3>REVIEW GUIDED MOVE</h3>
              </div>
              <button type="button" className="si-modal-close" onClick={() => setRelocationPreviewModal(null)}>
                <X size={16} />
              </button>
            </div>

            <div className="si-modal-body">
              <div className="reloc-preview-grid">
                <div className="reloc-preview-row">
                  <span className="rp-lbl">CURRENT</span>
                  <code className="rp-val">{relocationPreviewModal.currentPath}</code>
                </div>
                <div className="reloc-preview-row">
                  <span className="rp-lbl">SIZE</span>
                  <span className="rp-val rp-size">{relocationPreviewModal.formattedSize}</span>
                </div>
                <div className="reloc-preview-row">
                  <span className="rp-lbl">DESTINATION</span>
                  <code className="rp-val">{relocationPreviewModal.destinationPath}</code>
                </div>
                <div className="reloc-preview-row">
                  <span className="rp-lbl">SPACE AVAILABLE</span>
                  <span className={`rp-val ${relocationPreviewModal.hasAdequateSpace ? 'text-green' : 'text-red'}`}>
                    {relocationPreviewModal.destinationFreeFormatted}
                    {!relocationPreviewModal.hasAdequateSpace && ' ⚠ INSUFFICIENT'}
                  </span>
                </div>
                <div className="reloc-preview-row">
                  <span className="rp-lbl">ESTIMATED C: RECOVERY</span>
                  <span className="rp-val text-green">~{relocationPreviewModal.estimatedCRecoveryFormatted}</span>
                </div>
                <div className="reloc-preview-row">
                  <span className="rp-lbl">METHOD</span>
                  <span className="rp-val">{relocationPreviewModal.method}</span>
                </div>
                <div className="reloc-preview-row">
                  <span className="rp-lbl">RISK</span>
                  <span className={`rp-val si-badge-risk ${relocationPreviewModal.risk.toLowerCase()}`}>{relocationPreviewModal.risk}</span>
                </div>
              </div>

              <div className="reloc-preview-explain">
                <div className="reloc-explain-block">
                  <span className="explain-lbl">What changes:</span>
                  <p>{relocationPreviewModal.whatChanges}</p>
                </div>
                <div className="reloc-explain-block">
                  <span className="explain-lbl">What stays the same:</span>
                  <p>{relocationPreviewModal.whatStaysSame}</p>
                </div>
                {relocationPreviewModal.envChangesDescription && (
                  <div className="reloc-explain-block">
                    <span className="explain-lbl">⚙ Configuration change:</span>
                    <code className="explain-code">{relocationPreviewModal.envChangesDescription}</code>
                  </div>
                )}
                {relocationPreviewModal.requiresRestart && (
                  <div className="reloc-explain-restart">
                    <AlertTriangle size={14} className="text-amber" />
                    <span>A terminal or application restart is required after migration for environment changes to take effect.</span>
                  </div>
                )}
              </div>

              {relocationPreviewModal.envChangesDescription && (
                <label className="si-checkbox-label reloc-confirm-env">
                  <input type="checkbox" checked={confirmEnvChanges} onChange={(e) => setConfirmEnvChanges(e.target.checked)} />
                  <span>Apply configuration/environment variable changes automatically</span>
                </label>
              )}

              {relocationPreviewModal.warnings.length > 0 && (
                <div className="modal-warnings">
                  {relocationPreviewModal.warnings.map((w, idx) => (
                    <div key={idx} className="warning-text">&bull; {w}</div>
                  ))}
                </div>
              )}
            </div>
            
            {relocationExecuting && relocationProgress && (
              <div className="reloc-progress-container" style={{ padding: '0 24px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <span>{relocationProgress.stage}</span>
                  {relocationProgress.totalBytes > 0 && (
                    <span>
                      {Math.round((relocationProgress.bytesCopied / 1024 / 1024))} / {Math.round((relocationProgress.totalBytes / 1024 / 1024))} MB 
                      ({Math.round((relocationProgress.bytesCopied / relocationProgress.totalBytes) * 100)}%)
                    </span>
                  )}
                </div>
                {relocationProgress.totalBytes > 0 && (
                  <div style={{ height: '4px', backgroundColor: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ 
                      height: '100%', 
                      backgroundColor: 'var(--accent)', 
                      width: `${Math.min(100, Math.max(0, (relocationProgress.bytesCopied / relocationProgress.totalBytes) * 100))}%`,
                      transition: 'width 0.2s ease-out'
                    }}></div>
                  </div>
                )}
              </div>
            )}

            <div className="si-modal-footer">
              {relocationExecuting ? (
                <button 
                  type="button" 
                  className="si-btn-secondary" 
                  onClick={handleCancelRelocation} 
                  disabled={relocationCancelling || relocationProgress?.stage === 'Finalizing' || relocationProgress?.stage === 'Completed'}
                >
                  {relocationCancelling ? 'Cancelling...' : 'Cancel Relocation'}
                </button>
              ) : (
                <button type="button" className="si-btn-secondary" onClick={() => setRelocationPreviewModal(null)}>
                  Cancel
                </button>
              )}
              <button
                type="button"
                className="si-btn-review-move"
                onClick={handleExecuteRelocation}
                disabled={relocationExecuting || !relocationPreviewModal.hasAdequateSpace}
              >
                <MoveRight size={14} />
                <span>{relocationExecuting ? 'Migrating...' : 'Start Guided Move'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
