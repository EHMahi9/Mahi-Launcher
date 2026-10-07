import {
  CleanupPreview,
  RecoverableSpaceBreakdown,
  StorageDriveReport,
} from '../../types/storage';

export function canExecuteCleanup(preview: CleanupPreview | null, loading: boolean): boolean {
  return !loading && Boolean(preview && preview.targets.length > 0);
}

export function normalizeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeStorageReport(
  report: Partial<StorageDriveReport> | null | undefined
): StorageDriveReport | null {
  if (!report || typeof report !== 'object') {
    return null;
  }

  const recoverableSpace: RecoverableSpaceBreakdown = {
    definitelyReclaimableBytes: Number(report.recoverableSpace?.definitelyReclaimableBytes ?? 0),
    definitelyReclaimableFormatted: report.recoverableSpace?.definitelyReclaimableFormatted ?? '0 B',
    potentiallyReclaimableBytes: Number(report.recoverableSpace?.potentiallyReclaimableBytes ?? 0),
    potentiallyReclaimableFormatted: report.recoverableSpace?.potentiallyReclaimableFormatted ?? '0 B',
    relocatableBytes: Number(report.recoverableSpace?.relocatableBytes ?? 0),
    relocatableFormatted: report.recoverableSpace?.relocatableFormatted ?? '0 B',
    reviewRequiredBytes: Number(report.recoverableSpace?.reviewRequiredBytes ?? 0),
    reviewRequiredFormatted: report.recoverableSpace?.reviewRequiredFormatted ?? '0 B',
  };

  return {
    driveLetter: report.driveLetter ?? 'C',
    totalBytes: Number(report.totalBytes ?? 0),
    usedBytes: Number(report.usedBytes ?? 0),
    freeBytes: Number(report.freeBytes ?? 0),
    freePercentage: Number(report.freePercentage ?? 0),
    usedPercentage: Number(report.usedPercentage ?? 0),
    categories: Array.isArray(report.categories) ? report.categories : [],
    topDirectories: Array.isArray(report.topDirectories) ? report.topDirectories : [],
    largeFiles: Array.isArray(report.largeFiles) ? report.largeFiles : [],
    developerStorage: Array.isArray(report.developerStorage) ? report.developerStorage : [],
    applicationStorage: Array.isArray(report.applicationStorage) ? report.applicationStorage : [],
    relocationCandidates: Array.isArray(report.relocationCandidates) ? report.relocationCandidates : [],
    recoverableSpace,
    recommendations: Array.isArray(report.recommendations) ? report.recommendations : [],
    scanTimestamp: Number(report.scanTimestamp ?? Date.now()),
  };
}
