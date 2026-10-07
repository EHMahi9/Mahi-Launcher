import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ExternalLink,
  Info,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  getWorkstationFindings,
  getWorkstationIntelligenceSummary,
} from '../../services/tauriApi';
import {
  FindingCategory,
  FindingSeverity,
  SafeActionKind,
  WorkstationFinding,
  WorkstationFindingsReport,
  WorkstationIntelligenceSummary,
} from '../../types/intelligence';
import { resolveSafeAction, SafeActionNavigationIntent } from '../../utils/safeActionResolver';
import './WorkstationIntelligenceView.css';

export interface WorkstationIntelligenceViewProps {
  projectPath?: string | null;
  onSafeAction?: (intent: SafeActionNavigationIntent) => void;
}

type UserFacingSeverityFilter = 'ALL' | 'ACTION_REQUIRED' | 'ADVISORY' | 'NOTE';
type SeverityFilter = UserFacingSeverityFilter | FindingSeverity;
type CategoryFilter = 'ALL' | FindingCategory;

const severityLabels: Record<FindingSeverity, string> = {
  CRITICAL: 'Action Required',
  HIGH: 'Action Required',
  MEDIUM: 'Advisory',
  LOW: 'Note',
  INFO: 'Note',
};

const categoryLabels: Record<FindingCategory, string> = {
  STORAGE: 'Storage',
  TOOLCHAIN: 'Toolchain',
  ENVIRONMENT: 'Environment',
  PROJECT_COMPATIBILITY: 'Project Compatibility',
  WORKSPACE_PROFILE: 'Workspace Profile',
  SECURITY: 'Security',
  CONFIGURATION: 'Configuration',
};

const actionLabels: Partial<Record<SafeActionKind, string>> = {
  REVIEW_STORAGE: 'Open Storage Diagnostics',
  OPEN_STORAGE_INTELLIGENCE: 'Open Storage Diagnostics',
  REVIEW_REPAIR: 'Open Repair Center',
  REVIEW_TOOLCHAIN: 'Open Toolchain & Profiles',
  REVIEW_WORKSPACE_PROFILE: 'Open Workspace Profile',
  OPEN_PROJECT_WORKSPACE: 'Open Project Workspace',
};

const severityIcons: Record<FindingSeverity, React.ReactNode> = {
  CRITICAL: <CircleAlert size={16} />,
  HIGH: <AlertTriangle size={16} />,
  MEDIUM: <AlertTriangle size={16} />,
  LOW: <Info size={16} />,
  INFO: <Info size={16} />,
};

export const getFindingScope = (finding: WorkstationFinding, projectPath?: string | null) => {
  const projectScoped = finding.category === 'PROJECT_COMPATIBILITY'
    || finding.category === 'WORKSPACE_PROFILE'
    || Boolean(projectPath && finding.targetId === projectPath);
  return projectScoped ? 'PROJECT' : 'GLOBAL';
};

export const getActionLabel = (action: SafeActionKind | null) => (
  action ? actionLabels[action] || 'Review in MAHI' : null
);

export const safeEvidenceValue = (label: string, value: string) => {
  const protectedLabel = /secret|password|token|api[_ -]?key|credential/i.test(label);
  return protectedLabel ? '[protected value]' : value;
};

const formatGeneratedAt = (timestamp: number) => {
  if (!timestamp) return 'Not available';
  return new Date(timestamp * 1000).toLocaleString();
};

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const SummaryMetric: React.FC<{ label: string; value: number; tone: string }> = ({ label, value, tone }) => (
  <div className={`wi-summary-metric ${tone}`}>
    <span className="wi-summary-value">{value}</span>
    <span className="wi-summary-label">{label}</span>
  </div>
);

const FindingCard: React.FC<{
  finding: WorkstationFinding;
  projectPath?: string | null;
  expanded: boolean;
  onToggle: () => void;
  onSafeAction?: (intent: SafeActionNavigationIntent) => void;
}> = ({ finding, projectPath, expanded, onToggle, onSafeAction }) => {
  const scope = getFindingScope(finding, projectPath);
  const actionLabel = getActionLabel(finding.safeActionKind);
  const previewEvidence = finding.evidence.slice(0, 2);

  return (
    <article className={`wi-finding-card wi-severity-${finding.severity.toLowerCase()}`}>
      <div className="wi-finding-card-header">
        <div className="wi-finding-heading">
          <div className="wi-finding-badges">
            <span className={`wi-severity-badge ${finding.severity.toLowerCase()}`}>
              {severityIcons[finding.severity]}
              {severityLabels[finding.severity]}
            </span>
            <span className="wi-category-badge">{categoryLabels[finding.category]}</span>
            <span className={`wi-scope-badge ${scope.toLowerCase()}`}>
              {scope === 'PROJECT' ? 'Project scope' : 'Global workstation'}
            </span>
          </div>
          <h2 title={finding.title}>{finding.title}</h2>
          <p className="wi-finding-summary">{finding.summary}</p>
        </div>
        <button
          type="button"
          className="wi-expand-button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${finding.title}`}
          title={expanded ? 'Collapse details' : 'Expand details'}
        >
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </div>

      <div className="wi-evidence-preview">
        <div className="wi-section-label">Affected area</div>
        <div className="wi-affected-area" title={finding.targetId || finding.sourceEngine}>
          {finding.targetId || finding.sourceEngine}
        </div>
        <div className="wi-section-label">Evidence preview</div>
        <div className="wi-preview-values">
          {previewEvidence.length > 0 ? previewEvidence.map((item) => (
            <span key={`${finding.id}-${item.label}`} className="wi-evidence-chip" title={`${item.label}: ${item.value}`}>
              <strong>{item.label}:</strong> {safeEvidenceValue(item.label, item.value)}
            </span>
          )) : <span className="wi-muted">No evidence supplied.</span>}
        </div>
      </div>

      {expanded && (
        <div className="wi-finding-details">
          <div className="wi-detail-block">
            <span className="wi-section-label">What</span>
            <p>{finding.title}</p>
          </div>
          <div className="wi-detail-block">
            <span className="wi-section-label">Why it matters</span>
            <p>{finding.explanation}</p>
          </div>
          <div className="wi-detail-block">
            <span className="wi-section-label">Evidence</span>
            <div className="wi-evidence-list">
              {finding.evidence.length > 0 ? finding.evidence.map((item) => (
                <div key={`${finding.id}-detail-${item.label}`} className="wi-evidence-row">
                  <span>{item.label}</span>
                  <code title={safeEvidenceValue(item.label, item.value)}>{safeEvidenceValue(item.label, item.value)}</code>
                </div>
              )) : <span className="wi-muted">No evidence supplied.</span>}
            </div>
          </div>
          <div className="wi-detail-block">
            <span className="wi-section-label">Impact</span>
            <p>{finding.summary}</p>
          </div>
          <div className="wi-detail-block wi-recommendation-block">
            <span className="wi-section-label">Recommendation</span>
            <p>{finding.recommendation}</p>
          </div>
        </div>
      )}

      <div className="wi-finding-footer">
        <span className="wi-source">Source: {finding.sourceEngine}</span>
        {actionLabel && finding.safeActionKind && (
          <button
            type="button"
            className="wi-safe-action"
            onClick={() => {
              const intent = resolveSafeAction(finding);
              if (intent) onSafeAction?.(intent);
            }}
          >
            <ExternalLink size={14} />
            {actionLabel}
          </button>
        )}
      </div>
    </article>
  );
};

export const WorkstationIntelligenceView: React.FC<WorkstationIntelligenceViewProps> = ({
  projectPath,
  onSafeAction,
}) => {
  const [report, setReport] = useState<WorkstationFindingsReport | null>(null);
  const [summary, setSummary] = useState<WorkstationIntelligenceSummary | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadIntelligence = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [nextReport, nextSummary] = await Promise.all([
        getWorkstationFindings(projectPath || undefined),
        getWorkstationIntelligenceSummary(projectPath || undefined),
      ]);
      setReport(nextReport);
      setSummary(nextSummary);
      setExpandedIds(new Set());
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void loadIntelligence();
  }, [loadIntelligence]);

  const filteredFindings = useMemo(() => {
    if (!report) return [];
    return report.findings.filter((finding) => {
      let matchesSeverity = true;
      if (severityFilter === 'ALL') {
        matchesSeverity = true;
      } else if (severityFilter === 'ACTION_REQUIRED') {
        matchesSeverity = finding.severity === 'CRITICAL' || finding.severity === 'HIGH';
      } else if (severityFilter === 'ADVISORY') {
        matchesSeverity = finding.severity === 'MEDIUM';
      } else if (severityFilter === 'NOTE') {
        matchesSeverity = finding.severity === 'LOW' || finding.severity === 'INFO';
      } else {
        matchesSeverity = finding.severity === severityFilter;
      }

      const matchesCategory = categoryFilter === 'ALL' || finding.category === categoryFilter;
      return matchesSeverity && matchesCategory;
    });
  }, [categoryFilter, report, severityFilter]);

  const toggleExpanded = (findingId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(findingId)) next.delete(findingId);
      else next.add(findingId);
      return next;
    });
  };

  return (
    <div className="wi-container">
      <header className="wi-header">
        <div className="wi-title-group">
          <div className="wi-icon-wrap"><BrainCircuit size={23} /></div>
          <div>
            <div className="wi-eyebrow"><Activity size={13} /> Workstation Health · Findings Hub</div>
            <h1>Unified findings from your developer workstation</h1>
            <p>Read-only insights correlated from MAHI storage, environment, toolchain, and workspace engines.</p>
          </div>
        </div>
        <button type="button" className="wi-refresh-button" onClick={() => void loadIntelligence(true)} disabled={loading || refreshing}>
          <RefreshCw size={15} className={loading || refreshing ? 'wi-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      <div className="wi-context-banner">
        {projectPath ? <><ShieldCheck size={16} /> Showing global workstation findings plus project findings for <code title={projectPath}>{projectPath}</code></> : <><ShieldCheck size={16} /> Showing global workstation findings. Open a Project Workspace to include project-scoped findings.</>}
      </div>

      {loading && (
        <div className="wi-state-panel" role="status">
          <RefreshCw size={24} className="wi-spin" />
          <h2>Reading workstation intelligence...</h2>
          <p>MAHI is correlating existing local audit results.</p>
        </div>
      )}

      {!loading && error && (
        <div className="wi-state-panel wi-error-panel" role="alert">
          <AlertTriangle size={26} />
          <h2>Intelligence unavailable</h2>
          <p>{error}</p>
          <button type="button" className="wi-refresh-button" onClick={() => void loadIntelligence(true)}>
            <RefreshCw size={15} /> Try again
          </button>
        </div>
      )}

      {!loading && !error && report && summary && (
        <>
          <section className="wi-summary-section" aria-label="Intelligence summary">
            <div className="wi-summary-heading">
              <div>
                <span className="wi-section-label">Current signal</span>
                <h2>{summary.totalFindings} {summary.totalFindings === 1 ? 'finding' : 'findings'} detected</h2>
              </div>
              <span className="wi-generated">Updated {formatGeneratedAt(report.generatedAt)}</span>
            </div>
            <div className="wi-summary-grid">
              <SummaryMetric label="Total Findings" value={summary.totalFindings} tone="total" />
              <SummaryMetric label="Action Required" value={summary.criticalCount + summary.highCount} tone="critical" />
              <SummaryMetric label="Advisory" value={summary.mediumCount} tone="medium" />
              <SummaryMetric label="Notes" value={summary.lowCount + summary.infoCount} tone="info" />
            </div>
          </section>

          {report.totalFindings === 0 ? (
            <div className="wi-healthy-state">
              <CheckCircle2 size={34} />
              <h2>Workstation looks healthy</h2>
              <p>MAHI found no actionable workstation or project findings in this scope.</p>
            </div>
          ) : (
            <section className="wi-findings-section" aria-label="Workstation findings">
              <div className="wi-filter-bar">
                <div className="wi-filter-group">
                  <label htmlFor="wi-severity-filter">Severity</label>
                  <select id="wi-severity-filter" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}>
                    <option value="ALL">All Severities</option>
                    <option value="ACTION_REQUIRED">Action Required</option>
                    <option value="ADVISORY">Advisory</option>
                    <option value="NOTE">Note</option>
                    <option value="CRITICAL" style={{ display: 'none' }}>Critical</option>
                    <option value="HIGH" style={{ display: 'none' }}>High</option>
                    <option value="MEDIUM" style={{ display: 'none' }}>Medium</option>
                    <option value="LOW" style={{ display: 'none' }}>Low</option>
                    <option value="INFO" style={{ display: 'none' }}>Info</option>
                  </select>
                </div>
                <div className="wi-filter-group">
                  <label htmlFor="wi-category-filter">Category</label>
                  <select id="wi-category-filter" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}>
                    <option value="ALL">All</option>
                    {Object.keys(categoryLabels).map((category) => <option key={category} value={category}>{categoryLabels[category as FindingCategory]}</option>)}
                  </select>
                </div>
                <span className="wi-filter-result">Showing {filteredFindings.length} of {report.totalFindings}</span>
              </div>

              {filteredFindings.length === 0 ? (
                <div className="wi-filter-empty">
                  <Info size={22} />
                  <p>No findings match the selected filters.</p>
                </div>
              ) : (
                <div className="wi-findings-list">
                  {filteredFindings.map((finding) => (
                    <FindingCard
                      key={finding.id}
                      finding={finding}
                      projectPath={projectPath}
                      expanded={expandedIds.has(finding.id)}
                      onToggle={() => toggleExpanded(finding.id)}
                      onSafeAction={onSafeAction}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};
