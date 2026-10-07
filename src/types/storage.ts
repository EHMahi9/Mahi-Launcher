export type StorageItemClassification = 
  | 'SAFE_TO_CLEAN'
  | 'REVIEW_REQUIRED'
  | 'RELOCATABLE'
  | 'SYSTEM_MANAGED'
  | 'DO_NOT_TOUCH'
  | 'UNKNOWN';

export type RelocationRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface StorageCategorySummary {
  category: string;
  label: string;
  bytes: number;
  formattedSize: string;
  percentage: number;
  itemCount: number;
  description: string;
}

export interface LargeDirectoryItem {
  path: string;
  name: string;
  category: string;
  bytes: number;
  formattedSize: string;
  classification: StorageItemClassification;
  reason: string;
  cleanupPotential: string;
  isSensitiveMasked: boolean;
}

export interface LargeFileItem {
  path: string;
  name: string;
  category: string;
  bytes: number;
  formattedSize: string;
  extension: string;
  classification: StorageItemClassification;
  reason: string;
  isSensitiveMasked: boolean;
}

export interface DeveloperStorageItem {
  name: string;
  path: string;
  ecosystem: string;
  toolOrProject: string;
  bytes: number;
  formattedSize: string;
  exists: boolean;
  purpose: string;
  isRebuildable: boolean;
  cleanupPotential: string;
  relocationPotential: string;
  classification: StorageItemClassification;
}

export interface ApplicationStorageItem {
  name: string;
  installPath: string;
  bytes: number;
  formattedSize: string;
  isRelocatable: boolean;
  suggestedMethod: string;
  classification: StorageItemClassification;
  reason: string;
}

export interface RelocationCandidate {
  title: string;
  currentPath: string;
  suggestedDestination: string;
  bytes: number;
  formattedSize: string;
  method: string;
  risk: RelocationRisk;
  rationale: string;
}

export interface RecoverableSpaceBreakdown {
  definitelyReclaimableBytes: number;
  definitelyReclaimableFormatted: string;
  potentiallyReclaimableBytes: number;
  potentiallyReclaimableFormatted: string;
  relocatableBytes: number;
  relocatableFormatted: string;
  reviewRequiredBytes: number;
  reviewRequiredFormatted: string;
}

export interface RecommendationCard {
  id: string;
  title: string;
  category: string;
  bytes: number;
  formattedSize: string;
  classification: StorageItemClassification;
  risk: RelocationRisk;
  why: string;
  futureAction: string;
  path: string;
  isSafeToClean: boolean;
}

export interface CleanupTargetItem {
  id: string;
  name: string;
  path: string;
  category: string;
  bytes: number;
  formattedSize: string;
  reason: string;
  isRebuildable: boolean;
  classification: StorageItemClassification;
}

export interface CleanupPreview {
  targets: CleanupTargetItem[];
  totalBytes: number;
  totalFormatted: string;
  targetCount: number;
  containsUnsafeItems: boolean;
  warnings: string[];
}

export interface CleanupExecutionResult {
  success: boolean;
  recoveredBytes: number;
  recoveredFormatted: string;
  cleanedItems: number;
  skippedFiles: number;
  errors: string[];
  affectedDrives: string[];
  timestamp: number;
}

export interface CleanupHistoryEntry {
  id: string;
  timestamp: number;
  formattedTime: string;
  category: string;
  bytesReclaimed: number;
  formattedSize: string;
  cleanedItems: number;
  targetsSummary: string[];
}

export interface StorageDriveReport {
  driveLetter: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  freePercentage: number;
  usedPercentage: number;
  categories: StorageCategorySummary[];
  topDirectories: LargeDirectoryItem[];
  largeFiles: LargeFileItem[];
  developerStorage: DeveloperStorageItem[];
  applicationStorage: ApplicationStorageItem[];
  relocationCandidates: RelocationCandidate[];
  recoverableSpace: RecoverableSpaceBreakdown;
  recommendations: RecommendationCard[];
  scanTimestamp: number;
}

export interface StorageIntelligenceOverview {
  availableDrives: string[];
  reports: Record<string, StorageDriveReport>;
  scannedAt: number;
}

// ─────────────────────────────────────────────────────────────
// Phase 8C: Guided Storage Relocation Types
// ─────────────────────────────────────────────────────────────

export type RelocationCategory =
  | 'HUGGING_FACE'
  | 'CARGO_HOME'
  | 'PNPM_STORE'
  | 'ANDROID_SDK'
  | 'LM_STUDIO_MODELS'
  | 'LD_PLAYER'
  | 'PROJECT_ARCHIVE';

export interface GuidedRelocationCandidate {
  id: string;
  name: string;
  category: RelocationCategory;
  categoryLabel: string;
  currentPath: string;
  suggestedDestination: string;
  bytes: number;
  formattedSize: string;
  method: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  whySafe: string;
  whatChanges: string;
  whatStaysSame: string;
  envChangesDescription: string | null;
  requiresRestart: boolean;
  envVarName: string | null;
}

export interface RelocationPreview {
  candidateId: string;
  candidateName: string;
  currentPath: string;
  destinationPath: string;
  bytesToMove: number;
  formattedSize: string;
  destinationDriveFreeBytes: number;
  destinationFreeFormatted: string;
  hasAdequateSpace: boolean;
  whatChanges: string;
  whatStaysSame: string;
  envChangesDescription: string | null;
  requiresRestart: boolean;
  method: string;
  risk: string;
  estimatedCRecoveryFormatted: string;
  warnings: string[];
}

export interface RelocationResult {
  success: boolean;
  candidateId: string;
  source: string;
  destination: string;
  bytesMoved: number;
  formattedSize: string;
  filesRestored?: number;
  verificationMethod?: string;
  configChanged?: boolean;
  oldCopyRemoved?: boolean;
  envChangesMade: string[];
  verificationPassed: boolean;
  rollbackPerformed: boolean;
  errors: string[];
  timestamp: number;
  formattedTime: string;
}

export interface RelocationHistoryEntry {
  id: string;
  timestamp: number;
  formattedTime: string;
  category: string;
  source: string;
  destination: string;
  bytesMoved: number;
  formattedSize: string;
  success: boolean;
  method: string;
  rollbackPerformed: boolean;
  envChangesMade: string[];
  isRecoverable: boolean;
  recoveryReason?: string;
  recoveryStatus?: string;
}

export interface RelocationProgressPayload {
  candidateId: string;
  stage: 'Preparing' | 'Copying' | 'Verifying' | 'Configuring' | 'Finalizing' | 'Completed' | 'Failed' | 'Rolled Back';
  bytesCopied: number;
  totalBytes: number;
}
