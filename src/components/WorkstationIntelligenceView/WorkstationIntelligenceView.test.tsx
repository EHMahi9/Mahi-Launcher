import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWorkstationFindings,
  getWorkstationIntelligenceSummary,
} from '../../services/tauriApi';
import { WorkstationIntelligenceView, safeEvidenceValue } from './WorkstationIntelligenceView';
import { WorkstationFindingsReport, WorkstationIntelligenceSummary } from '../../types/intelligence';

vi.mock('../../services/tauriApi', () => ({
  getWorkstationFindings: vi.fn(),
  getWorkstationIntelligenceSummary: vi.fn(),
}));

const mockedFindings = vi.mocked(getWorkstationFindings);
const mockedSummary = vi.mocked(getWorkstationIntelligenceSummary);

const makeReport = (findings: WorkstationFindingsReport['findings']): WorkstationFindingsReport => ({
  generatedAt: 1_700_000_000,
  totalFindings: findings.length,
  counts: {
    critical: findings.filter((finding) => finding.severity === 'CRITICAL').length,
    high: findings.filter((finding) => finding.severity === 'HIGH').length,
    medium: findings.filter((finding) => finding.severity === 'MEDIUM').length,
    low: findings.filter((finding) => finding.severity === 'LOW').length,
    info: findings.filter((finding) => finding.severity === 'INFO').length,
  },
  findings,
});

const makeSummary = (report: WorkstationFindingsReport): WorkstationIntelligenceSummary => ({
  totalFindings: report.totalFindings,
  criticalCount: report.counts.critical,
  highCount: report.counts.high,
  mediumCount: report.counts.medium,
  lowCount: report.counts.low,
  infoCount: report.counts.info,
  topFindings: report.findings.slice(0, 5),
});

const findings = [
  {
    id: 'path-missing-entries',
    title: 'Stale PATH entries',
    severity: 'LOW' as const,
    category: 'ENVIRONMENT' as const,
    sourceEngine: 'Developer Health Audit',
    summary: 'One PATH entry no longer exists.',
    explanation: 'An old tool installation left a missing directory behind.',
    recommendation: 'Review the Repair Center before removing it.',
    safeActionKind: 'REVIEW_REPAIR' as const,
    targetId: 'stale_user_path',
    evidence: [{ label: 'Path', value: 'C:\\very\\long\\developer\\path\\that\\must\\wrap' }],
  },
  {
    id: 'storage-heavy-recoverable',
    title: 'Recoverable cache space',
    severity: 'MEDIUM' as const,
    category: 'STORAGE' as const,
    sourceEngine: 'Storage Engine',
    summary: 'Developer caches can be reviewed.',
    explanation: 'Rebuildable artifacts occupy local storage.',
    recommendation: 'Review Storage Intelligence.',
    safeActionKind: 'OPEN_STORAGE_INTELLIGENCE' as const,
    targetId: null,
    evidence: [],
  },
  {
    id: 'project-compat-node',
    title: 'Project Node requirement',
    severity: 'HIGH' as const,
    category: 'PROJECT_COMPATIBILITY' as const,
    sourceEngine: 'Project Compatibility Engine',
    summary: 'The project requirement is not satisfied.',
    explanation: 'The selected project is bound to an unavailable version.',
    recommendation: 'Review the project workspace profile.',
    safeActionKind: 'REVIEW_WORKSPACE_PROFILE' as const,
    targetId: 'D:\\Projects\\Demo',
    evidence: [{ label: 'Machine Version', value: '18' }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  const report = makeReport(findings);
  mockedFindings.mockResolvedValue(report);
  mockedSummary.mockResolvedValue(makeSummary(report));
});

describe('WorkstationIntelligenceView', () => {
  it('renders a healthy state without fabricating findings', async () => {
    const report = makeReport([]);
    mockedFindings.mockResolvedValue(report);
    mockedSummary.mockResolvedValue(makeSummary(report));

    render(<WorkstationIntelligenceView />);

    expect(await screen.findByText('Workstation looks healthy')).toBeInTheDocument();
    expect(screen.queryByText('Stale PATH entries')).not.toBeInTheDocument();
  });

  it('renders findings and expands WHAT, WHY, EVIDENCE, IMPACT, and RECOMMENDATION details', async () => {
    render(<WorkstationIntelligenceView projectPath="D:\\Projects\\Demo" />);

    expect(await screen.findByText('Stale PATH entries')).toBeInTheDocument();
    expect(screen.getByText('Project scope')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /expand stale path entries/i }));

    expect(screen.getByText('What')).toBeInTheDocument();
    expect(screen.getByText('Why it matters')).toBeInTheDocument();
    expect(screen.getByText('Evidence')).toBeInTheDocument();
    expect(screen.getByText('Impact')).toBeInTheDocument();
    expect(screen.getByText('Recommendation')).toBeInTheDocument();
  });

  it('filters by severity and category', async () => {
    render(<WorkstationIntelligenceView />);
    await screen.findByText('Stale PATH entries');

    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'ACTION_REQUIRED' } });
    expect(screen.getByText('Project Node requirement')).toBeInTheDocument();
    expect(screen.queryByText('Stale PATH entries')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'ALL' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'STORAGE' } });
    expect(screen.getByText('Recoverable cache space')).toBeInTheDocument();
    expect(screen.queryByText('Project Node requirement')).not.toBeInTheDocument();
  });

  it('routes safe actions without invoking mutating APIs', async () => {
    const onSafeAction = vi.fn();
    render(<WorkstationIntelligenceView onSafeAction={onSafeAction} />);
    await screen.findByText('Stale PATH entries');

    fireEvent.click(screen.getByRole('button', { name: 'Open Repair Center' }));
    expect(onSafeAction).toHaveBeenCalledWith({
      destination: 'developer-health',
      tab: 'repairs',
      targetId: 'stale_user_path',
      projectPath: null,
    });
  });

  it('shows loading and error states and refreshes through both 10A calls', async () => {
    let resolveReport: ((report: WorkstationFindingsReport) => void) | undefined;
    let resolveSummary: ((summary: WorkstationIntelligenceSummary) => void) | undefined;
    mockedFindings.mockImplementationOnce(() => new Promise((resolve) => { resolveReport = resolve; }));
    mockedSummary.mockImplementationOnce(() => new Promise((resolve) => { resolveSummary = resolve; }));
    render(<WorkstationIntelligenceView />);
    expect(screen.getByText('Reading workstation intelligence...')).toBeInTheDocument();
    const emptyReport = makeReport([]);
    resolveReport?.(emptyReport);
    resolveSummary?.(makeSummary(emptyReport));

    mockedFindings.mockRejectedValueOnce(new Error('IPC unavailable'));
    mockedSummary.mockRejectedValueOnce(new Error('IPC unavailable'));
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Intelligence unavailable')).toBeInTheDocument();
  });

  it('redacts protected evidence labels and preserves long values for normal fields', async () => {
    expect(safeEvidenceValue('API token', 'do-not-render')).toBe('[protected value]');
    const longPath = 'C:\\a\\very\\long\\path\\that\\stays\\available';
    expect(safeEvidenceValue('Path', longPath)).toBe(longPath);
  });
});
