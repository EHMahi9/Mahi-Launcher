import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { StorageIntelligenceView } from './StorageIntelligenceView';
import { canExecuteCleanup, normalizeArray, normalizeStorageReport } from './cleanupUtils';
import { CleanupPreview } from '../../types/storage';

const preview = (targetCount: number): CleanupPreview => ({
  targets: Array.from({ length: targetCount }, (_, index) => ({
    id: `target-${index}`,
    name: 'Generated cache',
    path: `D:\\Project\\cache-${index}`,
    category: 'Rebuildable project-generated artifacts',
    bytes: 1024,
    formattedSize: '1.0 KB',
    reason: 'Generated files',
    isRebuildable: true,
    classification: 'SAFE_TO_CLEAN',
  })),
  totalBytes: targetCount * 1024,
  totalFormatted: `${targetCount} KB`,
  targetCount,
  containsUnsafeItems: targetCount === 0,
  warnings: targetCount === 0 ? ['Path was rejected'] : [],
});

describe('StorageIntelligence cleanup confirmation safety', () => {
  it('disables execution when preview verifies zero targets', () => {
    expect(canExecuteCleanup(preview(0), false)).toBe(false);
  });

  it('allows execution only for verified targets and not while loading', () => {
    expect(canExecuteCleanup(preview(1), false)).toBe(true);
    expect(canExecuteCleanup(preview(1), true)).toBe(false);
  });

  it('normalizes missing report arrays instead of crashing the view', () => {
    const normalized = normalizeStorageReport({
      driveLetter: 'C',
      totalBytes: 0,
      usedBytes: 0,
      freeBytes: 0,
      freePercentage: 0,
      usedPercentage: 0,
    } as any);

    expect(normalized).not.toBeNull();
    expect(normalized?.categories).toEqual([]);
    expect(normalized?.developerStorage).toEqual([]);
    expect(normalized?.recommendations).toEqual([]);
  });

  it('normalizes missing or malformed auxiliary collections before render', () => {
    expect(normalizeArray(null)).toEqual([]);
    expect(normalizeArray(undefined)).toEqual([]);
    expect(normalizeArray({} as any)).toEqual([]);
    expect(normalizeArray([{ id: 'history-entry' }])).toEqual([{ id: 'history-entry' }]);
  });

  it('keeps hook order stable when the native report arrives after the empty render', () => {
    const props = {
      reports: {},
      availableDrives: ['C', 'D'],
      activeDrive: 'C',
      onSelectDrive: () => {},
      onRefresh: () => {},
      refreshing: false,
    };
    const view = render(React.createElement(StorageIntelligenceView, props));

    view.rerender(
      React.createElement(StorageIntelligenceView, {
        ...props,
        reports: { C: normalizeStorageReport({ driveLetter: 'C' })! },
      })
    );

    expect(view.getByText('Storage Intelligence, Safe Cleanup & Guided Relocation')).toBeInTheDocument();
  });
});
