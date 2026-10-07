import { FileEntry } from './filesystem';

export type ViewMode = 'details' | 'grid';

export type SortField = 'name' | 'modifiedDate' | 'fileType' | 'size';

export type SortDirection = 'asc' | 'desc';

export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  targetItem: FileEntry | null;
}
