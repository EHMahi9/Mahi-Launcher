export type RepairRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export type RepairCategory =
  | 'STALE_USER_PATH'
  | 'DUPLICATE_USER_PATH'
  | 'BROKEN_DEVELOPER_ENV'
  | 'TOOLCHAIN_ALIGNMENT_RECOMMENDATION';

export type RepairStatus =
  | 'PREVIEWED'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'ROLLED_BACK'
  | 'ABORTED';

export interface RepairPlan {
  id: string;
  category: RepairCategory;
  affectedItem: string;
  currentState: string;
  proposedState: string;
  reason: string;
  evidence: string;
  risk: RepairRisk;
  reversible: boolean;
  actions: string[];
  expectedResult: string;
  rollbackPlan: string;
  available: boolean;
  unavailabilityReason?: string;
}

export interface RepairExecutionResult {
  success: boolean;
  repairId: string;
  category: RepairCategory;
  affectedItem: string;
  previousValuePreview: string;
  newValuePreview: string;
  verificationPassed: boolean;
  verificationDetails: string;
  rollbackPerformed: boolean;
  rollbackDetails?: string;
  snapshotId: string;
  message: string;
  timestamp: number;
}

export interface RepairHistoryEntry {
  id: string;
  repairId: string;
  category: RepairCategory;
  target: string;
  timestamp: number;
  formattedTime: string;
  status: RepairStatus;
  description: string;
  snapshotId: string;
  canRestore: boolean;
}

export interface RestorePreview {
  historyEntryId: string;
  target: string;
  currentValue: string;
  restoredValue: string;
  risk: RepairRisk;
  summary: string;
}
