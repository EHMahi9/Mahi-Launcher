import { ViewMode, SortField, SortDirection } from './explorer';

export interface TabState {
  id: string;
  title: string;
  currentPath: string;
  history: string[];
  historyIndex: number;
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  selectedPaths: string[];
  showPreview: boolean;
}
