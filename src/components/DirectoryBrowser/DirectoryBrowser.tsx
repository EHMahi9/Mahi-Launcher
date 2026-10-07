import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  ArrowLeft, 
  ArrowRight, 
  ArrowUp, 
  RefreshCw, 
  Folder, 
  File, 
  FileCode, 
  FileText, 
  FileJson, 
  Image, 
  Archive, 
  Terminal, 
  Code2, 
  FolderOpen,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  HardDrive,
  LayoutGrid,
  List,
  FolderPlus,
  Info,
  X,
  PanelRight,
  ArrowUp as ArrowUpIcon,
  ArrowDown as ArrowDownIcon
} from 'lucide-react';
import { DirectoryResult, FileEntry, ClipboardState, DetailedProperties } from '../../types/filesystem';
import { ViewMode, SortField, SortDirection, ContextMenuState } from '../../types/explorer';
import { formatBytes, formatDate } from '../../utils/formatters';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { ConfirmDeleteModal } from '../ConfirmDeleteModal/ConfirmDeleteModal';
import { PropertiesModal } from '../PropertiesModal/PropertiesModal';
import { PreviewPanel } from '../PreviewPanel/PreviewPanel';
import { 
  copyItems, 
  moveItems, 
  renameItem, 
  deleteToRecycleBin, 
  deletePermanently, 
  createDirectory, 
  getDetailedProperties,
  getSystemClipboardFiles,
  setSystemClipboardFiles,
  copyPathToClipboard,
  normalizePath
} from '../../services/tauriApi';
import './DirectoryBrowser.css';

interface DirectoryBrowserProps {
  currentPath: string;
  data: DirectoryResult | null;
  loading: boolean;
  error: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  // Phase 5: Controlled state from parent (per-tab)
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  selectedPaths: string[];
  showPreview: boolean;
  onNavigate: (path: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onGoUp: () => void;
  onRefresh: () => void;
  onOpenThisPc: () => void;
  onOpenFile: (path: string) => void;
  onOpenInVsCode?: (path: string) => void;
  onOpenInTerminal?: (path: string) => void;
  onOpenInExplorer?: (path: string) => void;
  onOpenInNewTab?: (path: string) => void;
  // Phase 5: Callbacks to bubble state changes up to tab
  onViewModeChange: (mode: ViewMode) => void;
  onSortChange: (field: SortField, direction: SortDirection) => void;
  onSelectionChange: (paths: string[]) => void;
  onPreviewToggle: (show: boolean) => void;
}

export const DirectoryBrowser: React.FC<DirectoryBrowserProps> = ({
  currentPath,
  data,
  loading,
  error,
  canGoBack,
  canGoForward,
  viewMode,
  sortField,
  sortDirection,
  selectedPaths: selectedPathsArray,
  showPreview,
  onNavigate,
  onGoBack,
  onGoForward,
  onGoUp,
  onRefresh,
  onOpenThisPc,
  onOpenFile,
  onOpenInVsCode,
  onOpenInTerminal,
  onOpenInExplorer,
  onOpenInNewTab,
  onViewModeChange,
  onSortChange,
  onSelectionChange,
  onPreviewToggle,
}) => {
  // Derive a Set from the controlled array prop with normalized paths for O(1) cross-platform lookups
  const selectedPathsNorm = useMemo(() => new Set(selectedPathsArray.map((p) => normalizePath(p))), [selectedPathsArray]);
  const isSelectedPath = useCallback((path: string) => {
    return selectedPathsNorm.has(normalizePath(path));
  }, [selectedPathsNorm]);

  // Focus tracking (internal — not tab-persistent)
  const [lastFocusedIndex, setLastFocusedIndex] = useState<number>(0);

  // Application Clipboard state (Phase 3C) — internal to browser session
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

  // Delete Confirmation Modal state (Phase 3C)
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    isPermanent: boolean;
    items: string[];
  }>({
    isOpen: false,
    isPermanent: false,
    items: [],
  });
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Properties Modal state (Phase 3C)
  const [propertiesModal, setPropertiesModal] = useState<{
    isOpen: boolean;
    loading: boolean;
    data: DetailedProperties | null;
  }>({
    isOpen: false,
    loading: false,
    data: null,
  });

  // Inline Rename state (Phase 3C)
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Feedback notifications / Operation progress (Phase 17)
  const [toast, setToast] = useState<{ type: 'error' | 'info' | 'success' | 'warning'; message: string } | null>(null);
  const [isOperating, setIsOperating] = useState<{ running: boolean; message: string }>({
    running: false,
    message: '',
  });

  // Phase 5: Drag-and-drop state
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [dragInvalid, setDragInvalid] = useState<boolean>(false);
  const draggedPathsRef = useRef<string[]>([]);
  const dragCopyModeRef = useRef<boolean>(false);

  // Context Menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    targetItem: null,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLTableRowElement | HTMLDivElement | null>(null);

  // Derived sort + view helpers
  const togglePreview = useCallback(() => {
    onPreviewToggle(!showPreview);
  }, [showPreview, onPreviewToggle]);

  // Clear selection and modals when navigating to a new directory
  useEffect(() => {
    setLastFocusedIndex(0);
    setContextMenu({ isOpen: false, x: 0, y: 0, targetItem: null });
    setRenamingPath(null);
    setRenameError(null);
    setDragOverPath(null);
    setDragInvalid(false);
  }, [currentPath]);

  // Focus and select text when starting inline rename
  useEffect(() => {
    if (renamingPath && renameInputRef.current) {
      renameInputRef.current.focus();
      const dotIndex = renameValue.lastIndexOf('.');
      const currentEntry = data?.entries.find((e) => e.path === renamingPath);
      if (dotIndex > 0 && currentEntry && !currentEntry.isDirectory) {
        renameInputRef.current.setSelectionRange(0, dotIndex);
      } else {
        renameInputRef.current.select();
      }
    }
  }, [renamingPath]);

  // Auto-dismiss toast based on category (Phase 17)
  useEffect(() => {
    if (toast) {
      const duration = toast.type === 'error' ? 7000 : toast.type === 'warning' ? 5000 : 3500;
      const timer = setTimeout(() => setToast(null), duration);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Compute breadcrumbs
  const breadcrumbs = useMemo(() => {
    const crumbs: { label: string; path: string }[] = [
      { label: 'This PC', path: 'this-pc' }
    ];

    if (!currentPath || currentPath === 'this-pc') {
      return crumbs;
    }

    const normalized = currentPath.replace(/\//g, '\\');
    const driveMatch = normalized.match(/^([A-Za-z]:)(\\?.*)$/);

    if (driveMatch) {
      const driveLetter = driveMatch[1];
      const driveRoot = `${driveLetter}\\`;
      crumbs.push({ label: driveLetter, path: driveRoot });

      const rest = driveMatch[2].replace(/^\\+/, '');
      if (rest) {
        const parts = rest.split('\\').filter(Boolean);
        let accumulated = driveRoot;

        for (const part of parts) {
          accumulated = accumulated.endsWith('\\') ? `${accumulated}${part}` : `${accumulated}\\${part}`;
          crumbs.push({ label: part, path: accumulated });
        }
      }
    } else {
      crumbs.push({ label: currentPath, path: currentPath });
    }

    return crumbs;
  }, [currentPath]);

  // Sorted items (In-memory, preserving folders at top)
  const sortedEntries = useMemo(() => {
    if (!data?.entries) return [];

    const folders = data.entries.filter((e) => e.isDirectory);
    const files = data.entries.filter((e) => !e.isDirectory);

    const compare = (a: FileEntry, b: FileEntry) => {
      let result = 0;
      switch (sortField) {
        case 'name':
          result = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
          break;
        case 'modifiedDate':
          result = (a.modifiedDate || 0) - (b.modifiedDate || 0);
          break;
        case 'fileType':
          result = a.fileType.localeCompare(b.fileType);
          break;
        case 'size':
          result = (a.size || 0) - (b.size || 0);
          break;
      }
      return sortDirection === 'asc' ? result : -result;
    };

    folders.sort(compare);
    files.sort(compare);

    return [...folders, ...files];
  }, [data?.entries, sortField, sortDirection]);

  // Selection counts for status bar
  const selectionStats = useMemo(() => {
    if (selectedPathsArray.length === 0) return null;

    let folderCount = 0;
    let fileCount = 0;
    let totalBytes = 0;
    let singleItem: FileEntry | null = null;

    for (const entry of sortedEntries) {
      if (isSelectedPath(entry.path)) {
        if (entry.isDirectory) {
          folderCount++;
        } else {
          fileCount++;
          if (entry.size) totalBytes += entry.size;
        }
        if (selectedPathsArray.length === 1) {
          singleItem = entry;
        }
      }
    }

    return {
      count: selectedPathsArray.length,
      folderCount,
      fileCount,
      totalBytes,
      singleItem,
    };
  }, [selectedPathsArray.length, sortedEntries, isSelectedPath]);

  // Selected entries list for Preview Panel (Phase 4)
  const selectedEntriesList = useMemo(() => {
    return sortedEntries.filter((e) => isSelectedPath(e.path));
  }, [sortedEntries, isSelectedPath]);

  // Handle Sort column click
  const handleSortHeader = (field: SortField) => {
    if (sortField === field) {
      onSortChange(field, sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      onSortChange(field, 'asc');
    }
  };

  // Open item action
  const openItem = useCallback((entry: FileEntry) => {
    if (entry.isDirectory) {
      onNavigate(entry.path);
    } else {
      onOpenFile(entry.path);
    }
  }, [onNavigate, onOpenFile]);

  // ===================== FILE OPERATIONS (PHASE 3C) =====================

  // Copy selected items (MAHI internal + Windows System Clipboard CF_HDROP)
  const handleCopy = useCallback(async () => {
    if (selectedPathsArray.length === 0) return;
    const paths = [...selectedPathsArray];
    setClipboard({
      items: paths,
      operation: 'copy',
    });
    try {
      await setSystemClipboardFiles(paths, false);
    } catch (err) {
      console.warn('Failed to set Windows system clipboard:', err);
    }
    setToast({
      type: 'success',
      message: `Copied ${paths.length} ${paths.length === 1 ? 'item' : 'items'} to clipboard.`,
    });
  }, [selectedPathsArray]);

  // Cut selected items (MAHI internal + Windows System Clipboard DROPEFFECT_MOVE)
  const handleCut = useCallback(async () => {
    if (selectedPathsArray.length === 0) return;
    const paths = [...selectedPathsArray];
    setClipboard({
      items: paths,
      operation: 'cut',
    });
    try {
      await setSystemClipboardFiles(paths, true);
    } catch (err) {
      console.warn('Failed to set Windows system clipboard:', err);
    }
    setToast({
      type: 'info',
      message: `Cut ${paths.length} ${paths.length === 1 ? 'item' : 'items'} (press Ctrl+V in MAHI or Explorer).`,
    });
  }, [selectedPathsArray]);

  // Paste clipboard items (Interoperable: checks Windows System Clipboard first, falls back to internal)
  const handlePaste = useCallback(async (targetDir?: string) => {
    const dest = targetDir || currentPath;
    if (!dest || dest === 'this-pc') return;

    // 1. Try Windows system clipboard first (CF_HDROP)
    let itemsToPaste: string[] = [];
    let isCutOperation = false;

    try {
      const sysClip = await getSystemClipboardFiles();
      if (sysClip && sysClip.paths && sysClip.paths.length > 0) {
        itemsToPaste = sysClip.paths;
        isCutOperation = sysClip.isCut;
      }
    } catch (e) {
      console.warn('Error querying Windows system clipboard:', e);
    }

    // 2. Fall back to internal clipboard state if system clipboard has no files
    if (itemsToPaste.length === 0 && clipboard && clipboard.items.length > 0) {
      itemsToPaste = clipboard.items;
      isCutOperation = clipboard.operation === 'cut';
    }

    if (itemsToPaste.length === 0) {
      setToast({ type: 'warning', message: 'Clipboard contains no files.' });
      return;
    }

    const opLabel = isCutOperation ? 'Moving' : 'Copying';
    setIsOperating({ running: true, message: `${opLabel} ${itemsToPaste.length} item(s)...` });

    try {
      const res = isCutOperation
        ? await moveItems(itemsToPaste, dest)
        : await copyItems(itemsToPaste, dest);

      if (res.failureCount > 0) {
        setToast({
          type: 'error',
          message: `Completed with errors: ${res.errors.join('; ')}`,
        });
      } else {
        setToast({
          type: 'success',
          message: `Successfully ${isCutOperation ? 'moved' : 'copied'} ${res.successCount} item(s).`,
        });
      }

      if (isCutOperation) {
        setClipboard(null);
        try {
          await setSystemClipboardFiles([], false);
        } catch {}
      }

      onRefresh();
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err.message || 'Paste operation failed.';
      setToast({ type: 'error', message: msg });
    } finally {
      setIsOperating({ running: false, message: '' });
    }
  }, [clipboard, currentPath, onRefresh]);

  // Copy Path (copies actual Windows path to text clipboard)
  const handleCopyPath = useCallback(async (entry?: FileEntry) => {
    const target = entry || sortedEntries.find((e) => isSelectedPath(e.path));
    const pathToCopy = target ? target.path : currentPath;
    if (!pathToCopy || pathToCopy === 'this-pc') return;

    try {
      await copyPathToClipboard(pathToCopy);
      setToast({
        type: 'success',
        message: `Copied path to clipboard: ${pathToCopy.replace(/\//g, '\\')}`,
      });
    } catch {
      setToast({ type: 'error', message: 'Failed to copy path to clipboard.' });
    }
  }, [sortedEntries, isSelectedPath, currentPath]);

  // Start inline rename
  const handleStartRename = useCallback((entry?: FileEntry) => {
    const target = entry || sortedEntries.find((e) => isSelectedPath(e.path));
    if (!target) return;
    setRenamingPath(target.path);
    setRenameValue(target.name);
    setRenameError(null);
  }, [sortedEntries, isSelectedPath]);

  // Commit inline rename
  const handleCommitRename = useCallback(async () => {
    if (!renamingPath) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError('Filename cannot be empty.');
      return;
    }

    const illegalChars = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
    if (illegalChars.some((c) => trimmed.includes(c))) {
      setRenameError('Illegal characters: \\ / : * ? " < > |');
      return;
    }

    const currentEntry = sortedEntries.find((e) => normalizePath(e.path) === normalizePath(renamingPath));
    if (currentEntry && currentEntry.name === trimmed) {
      setRenamingPath(null);
      setRenameError(null);
      return;
    }

    try {
      const newPath = await renameItem(renamingPath, trimmed);
      setRenamingPath(null);
      setRenameError(null);
      await Promise.resolve(onRefresh());
      onSelectionChange([newPath]);
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err.message || 'Failed to rename item.';
      setRenameError(msg);
    }
  }, [renamingPath, renameValue, sortedEntries, onRefresh, onSelectionChange]);

  // Cancel inline rename
  const handleCancelRename = useCallback(() => {
    setRenamingPath(null);
    setRenameError(null);
  }, []);

  // Delete Prompt (Recycle Bin vs Permanent)
  const handleDeletePrompt = useCallback((isPermanent: boolean) => {
    if (selectedPathsArray.length === 0) return;
    setDeleteModal({
      isOpen: true,
      isPermanent,
      items: [...selectedPathsArray],
    });
  }, [selectedPathsArray]);

  // Confirm and Execute Deletion
  const handleConfirmDelete = useCallback(async () => {
    if (deleteModal.items.length === 0) return;
    setIsDeleting(true);

    try {
      const res = deleteModal.isPermanent
        ? await deletePermanently(deleteModal.items)
        : await deleteToRecycleBin(deleteModal.items);

      if (res.failureCount > 0) {
        setToast({
          type: 'error',
          message: `Deletion errors: ${res.errors.join('; ')}`,
        });
      } else {
        setToast({
          type: 'success',
          message: `${res.successCount} ${res.successCount === 1 ? 'item' : 'items'} deleted ${deleteModal.isPermanent ? 'permanently' : 'to Recycle Bin'}.`,
        });
      }

      setDeleteModal({ isOpen: false, isPermanent: false, items: [] });
      onSelectionChange([]);
      await Promise.resolve(onRefresh());
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err.message || 'Deletion failed.';
      setToast({ type: 'error', message: msg });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteModal, onRefresh, onSelectionChange]);

  // Create New Folder
  const handleNewFolder = useCallback(async () => {
    if (!currentPath || currentPath === 'this-pc') return;

    try {
      const newFolderPath = await createDirectory(currentPath);
      await Promise.resolve(onRefresh());
      onSelectionChange([newFolderPath]);
      const newName = newFolderPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || 'New folder';

      setTimeout(() => {
        setRenamingPath(newFolderPath);
        setRenameValue(newName);
        setRenameError(null);
      }, 120);
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err.message || 'Failed to create new folder.';
      setToast({ type: 'error', message: msg });
    }
  }, [currentPath, onRefresh, onSelectionChange]);

  // Show Properties Modal
  const handleShowProperties = useCallback(async (entry?: FileEntry) => {
    const target = entry || sortedEntries.find((e) => isSelectedPath(e.path));
    if (!target) return;

    setPropertiesModal({ isOpen: true, loading: true, data: null });
    try {
      const props = await getDetailedProperties(target.path);
      setPropertiesModal({ isOpen: true, loading: false, data: props });
    } catch (err: any) {
      setPropertiesModal({ isOpen: false, loading: false, data: null });
      setToast({ type: 'error', message: typeof err === 'string' ? err : err.message || 'Failed to get properties.' });
    }
  }, [sortedEntries, isSelectedPath]);

  // ===================== PHASE 5: DRAG AND DROP =====================

  /**
   * Check if dropping dragged items onto targetPath is valid:
   * - target must be a directory
   * - target must not be one of the dragged items
   * - target must not be a descendant of any dragged item
   */
  const isValidDrop = useCallback((targetPath: string, draggedPaths: string[]): boolean => {
    const targetEntry = sortedEntries.find((e) => e.path === targetPath);
    if (!targetEntry?.isDirectory) return false;

    for (const draggedPath of draggedPaths) {
      // Self-drop
      if (draggedPath === targetPath) return false;
      // Dropping a folder into itself or a descendant
      const normalizedDragged = draggedPath.replace(/\\/g, '/').toLowerCase();
      const normalizedTarget = targetPath.replace(/\\/g, '/').toLowerCase();
      if (normalizedTarget.startsWith(normalizedDragged + '/')) return false;
    }
    return true;
  }, [sortedEntries]);

  const handleDragStart = useCallback((entry: FileEntry, e: React.DragEvent) => {
    // Build the list of items being dragged
    let dragPaths: string[];
    if (isSelectedPath(entry.path) && selectedPathsArray.length > 1) {
      dragPaths = [...selectedPathsArray];
    } else {
      dragPaths = [entry.path];
      onSelectionChange([entry.path]);
    }
    draggedPathsRef.current = dragPaths;
    dragCopyModeRef.current = false;

    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', dragPaths.join('\n'));
  }, [isSelectedPath, selectedPathsArray, onSelectionChange]);

  const handleDragOver = useCallback((entry: FileEntry, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Determine copy vs move
    dragCopyModeRef.current = e.ctrlKey;
    const valid = isValidDrop(entry.path, draggedPathsRef.current);

    if (valid) {
      e.dataTransfer.dropEffect = dragCopyModeRef.current ? 'copy' : 'move';
      setDragOverPath(entry.path);
      setDragInvalid(false);
    } else {
      e.dataTransfer.dropEffect = 'none';
      setDragOverPath(entry.path);
      setDragInvalid(true);
    }
  }, [isValidDrop]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if we're leaving to outside the row (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverPath(null);
      setDragInvalid(false);
    }
  }, []);

  const handleDrop = useCallback(async (entry: FileEntry, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);
    setDragInvalid(false);

    let dragPaths = draggedPathsRef.current;
    let isExternal = false;

    // Check if dragged from Windows Explorer via HTML5 dataTransfer
    if ((!dragPaths || dragPaths.length === 0) && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const externalPaths: string[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const f = e.dataTransfer.files[i] as any;
        if (f.path) {
          externalPaths.push(f.path);
        }
      }
      if (externalPaths.length > 0) {
        dragPaths = externalPaths;
        isExternal = true;
      }
    }

    if (!dragPaths || !dragPaths.length) return;

    const isCopy = isExternal || e.ctrlKey || dragCopyModeRef.current;

    if (!isExternal && !isValidDrop(entry.path, dragPaths)) {
      setToast({ type: 'error', message: 'Cannot drop here — invalid target.' });
      return;
    }

    const opLabel = isCopy ? 'Copying' : 'Moving';
    setIsOperating({ running: true, message: `${opLabel} ${dragPaths.length} item(s) to ${entry.name}...` });

    try {
      const res = isCopy
        ? await copyItems(dragPaths, entry.path)
        : await moveItems(dragPaths, entry.path);

      if (res.failureCount > 0) {
        setToast({
          type: 'error',
          message: `Completed with errors: ${res.errors.join('; ')}`,
        });
      } else {
        setToast({
          type: 'success',
          message: `${isCopy ? 'Copied' : 'Moved'} ${res.successCount} item(s) to "${entry.name}".`,
        });
      }

      onRefresh();
      draggedPathsRef.current = [];
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err.message || 'Drop operation failed.';
      setToast({ type: 'error', message: msg });
    } finally {
      setIsOperating({ running: false, message: '' });
    }
  }, [isValidDrop, onRefresh]);

  const handleDragEnd = useCallback(() => {
    setDragOverPath(null);
    setDragInvalid(false);
    draggedPathsRef.current = [];
  }, []);

  // ===================== SELECTION & CLICK HANDLERS =====================

  // Handle click on file/folder
  const handleItemClick = (entry: FileEntry, index: number, e: React.MouseEvent) => {
    e.stopPropagation();

    if (renamingPath && renamingPath !== entry.path) {
      handleCommitRename();
    }

    if (e.ctrlKey || e.metaKey) {
      const isSelected = isSelectedPath(entry.path);
      const next = isSelected
        ? selectedPathsArray.filter((p) => normalizePath(p) !== normalizePath(entry.path))
        : [...selectedPathsArray, entry.path];
      onSelectionChange(next);
      setLastFocusedIndex(index);
    } else if (e.shiftKey) {
      const start = Math.min(lastFocusedIndex, index);
      const end = Math.max(lastFocusedIndex, index);
      const next: string[] = [];
      for (let i = start; i <= end; i++) {
        if (sortedEntries[i]) {
          next.push(sortedEntries[i].path);
        }
      }
      onSelectionChange(next);
    } else {
      onSelectionChange([entry.path]);
      setLastFocusedIndex(index);
    }
  };

  // Double click handler
  const handleItemDoubleClick = (entry: FileEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    if (renamingPath === entry.path) return;
    openItem(entry);
  };

  // Background click: clear selection
  const handleBackgroundClick = () => {
    if (renamingPath) {
      handleCommitRename();
    }
    onSelectionChange([]);
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  };

  // Context menu on item
  const handleItemContextMenu = (entry: FileEntry, index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (renamingPath) {
      handleCommitRename();
    }

    if (!isSelectedPath(entry.path)) {
      onSelectionChange([entry.path]);
      setLastFocusedIndex(index);
    }

    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      targetItem: entry,
    });
  };

  // Context menu on background
  const handleBackgroundContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (renamingPath) {
      handleCommitRename();
    }
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      targetItem: null,
    });
  };

  // Keyboard navigation & Shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (renamingPath) return;

    // Ctrl + A: Select All
    if (e.ctrlKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      onSelectionChange(sortedEntries.map((item) => item.path));
      return;
    }

    // Ctrl + `: Open in Terminal
    if (e.ctrlKey && e.key === '`') {
      e.preventDefault();
      if (onOpenInTerminal && currentPath && currentPath !== 'this-pc') {
        const singleSelected = selectedPathsArray.length === 1 ? sortedEntries.find((item) => isSelectedPath(item.path)) : null;
        const target = singleSelected?.isDirectory ? singleSelected.path : currentPath;
        onOpenInTerminal(target);
      }
      return;
    }

    // Ctrl + C: Copy
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      handleCopy();
      return;
    }

    // Ctrl + Shift + C: Copy Path
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      handleCopyPath();
      return;
    }

    // Ctrl + X: Cut
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      handleCut();
      return;
    }

    // Ctrl + V: Paste
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      handlePaste();
      return;
    }

    // Ctrl + Shift + N: New Folder
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      handleNewFolder();
      return;
    }

    // F2: Rename
    if (e.key === 'F2') {
      e.preventDefault();
      handleStartRename();
      return;
    }

    // Shift + Delete: Permanent Delete
    if (e.key === 'Delete' && e.shiftKey) {
      e.preventDefault();
      handleDeletePrompt(true);
      return;
    }

    // Delete: Recycle Bin Delete
    if (e.key === 'Delete' && !e.shiftKey) {
      e.preventDefault();
      handleDeletePrompt(false);
      return;
    }

    // Ctrl + P: Toggle Preview Panel
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      togglePreview();
      return;
    }

    // Alt + Enter: Properties
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      handleShowProperties();
      return;
    }

    // Escape: Clear selection & close context menu
    if (e.key === 'Escape') {
      e.preventDefault();
      onSelectionChange([]);
      setContextMenu((prev) => ({ ...prev, isOpen: false }));
      return;
    }

    // Enter: Open item
    if (e.key === 'Enter') {
      e.preventDefault();
      const focusedItem = sortedEntries[lastFocusedIndex];
      if (focusedItem) {
        openItem(focusedItem);
      }
      return;
    }

    // F5: Refresh
    if (e.key === 'F5') {
      e.preventDefault();
      onRefresh();
      return;
    }

    if (sortedEntries.length === 0) return;

    let nextIndex = lastFocusedIndex;

    if (viewMode === 'details') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        nextIndex = Math.min(lastFocusedIndex + 1, sortedEntries.length - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        nextIndex = Math.max(lastFocusedIndex - 1, 0);
      } else if (e.key === 'Home') {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        nextIndex = sortedEntries.length - 1;
      }
    } else {
      const cols = 4;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextIndex = Math.min(lastFocusedIndex + 1, sortedEntries.length - 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        nextIndex = Math.max(lastFocusedIndex - 1, 0);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        nextIndex = Math.min(lastFocusedIndex + cols, sortedEntries.length - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        nextIndex = Math.max(lastFocusedIndex - cols, 0);
      } else if (e.key === 'Home') {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        nextIndex = sortedEntries.length - 1;
      }
    }

    if (nextIndex !== lastFocusedIndex) {
      setLastFocusedIndex(nextIndex);
      const target = sortedEntries[nextIndex];

      if (e.shiftKey) {
        const start = Math.min(lastFocusedIndex, nextIndex);
        const end = Math.max(lastFocusedIndex, nextIndex);
        const next = new Set(selectedPathsArray);
        for (let i = start; i <= end; i++) {
          if (sortedEntries[i]) next.add(sortedEntries[i].path);
        }
        onSelectionChange(Array.from(next));
      } else {
        onSelectionChange([target.path]);
      }

      setTimeout(() => {
        activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 0);
    }
  }, [
    sortedEntries, 
    lastFocusedIndex, 
    viewMode, 
    openItem, 
    renamingPath, 
    handleCopy, 
    handleCut, 
    handlePaste, 
    handleNewFolder, 
    handleStartRename, 
    handleDeletePrompt, 
    handleShowProperties, 
    togglePreview,
    onRefresh,
    onSelectionChange,
    selectedPathsArray,
    isSelectedPath,
    onOpenInTerminal,
    currentPath,
  ]);

  // Get item icon based on file type / extension
  const getItemIcon = (entry: FileEntry, size: number = 18) => {
    if (entry.isDirectory) {
      return <Folder size={size} className="mahi-entry-icon folder" />;
    }

    const ext = (entry.extension || '').toLowerCase();
    if (['ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'go', 'java', 'c', 'cpp', 'html', 'css'].includes(ext)) {
      return <FileCode size={size} className="mahi-entry-icon code" />;
    }
    if (['json', 'toml', 'yaml', 'yml', 'xml'].includes(ext)) {
      return <FileJson size={size} className="mahi-entry-icon json" />;
    }
    if (['md', 'txt', 'log', 'pdf', 'doc', 'docx'].includes(ext)) {
      return <FileText size={size} className="mahi-entry-icon text" />;
    }
    if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'ico'].includes(ext)) {
      return <Image size={size} className="mahi-entry-icon image" />;
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
      return <Archive size={size} className="mahi-entry-icon archive" />;
    }
    return <File size={size} className="mahi-entry-icon default" />;
  };

  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <ArrowUpIcon size={12} className="mahi-sort-arrow active" />
    ) : (
      <ArrowDownIcon size={12} className="mahi-sort-arrow active" />
    );
  };

  return (
    <div 
      className="mahi-dir-browser"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={handleBackgroundClick}
      onContextMenu={handleBackgroundContextMenu}
    >
      {/* Navigation Toolbar */}
      <div className="mahi-nav-toolbar" onClick={(e) => e.stopPropagation()}>
        <div className="mahi-nav-buttons">
          <button
            type="button"
            className="mahi-nav-btn"
            disabled={!canGoBack}
            onClick={onGoBack}
            title="Back (Alt + Left Arrow)"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            className="mahi-nav-btn"
            disabled={!canGoForward}
            onClick={onGoForward}
            title="Forward (Alt + Right Arrow)"
          >
            <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="mahi-nav-btn"
            onClick={onGoUp}
            title="Up to Parent Directory (Alt + Up Arrow)"
          >
            <ArrowUp size={16} />
          </button>
          <button
            type="button"
            className="mahi-nav-btn"
            onClick={onRefresh}
            title="Refresh Directory (F5 / Ctrl + R)"
          >
            <RefreshCw size={15} className={loading ? 'mahi-spin' : ''} />
          </button>
        </div>

        {/* Breadcrumb Path Bar */}
        <div className="mahi-breadcrumb-bar">
          <div className="mahi-breadcrumb-scroll">
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <React.Fragment key={crumb.path}>
                  <button
                    type="button"
                    className={`mahi-crumb-btn ${isLast ? 'active' : ''}`}
                    onClick={() => {
                      if (crumb.path === 'this-pc') {
                        onOpenThisPc();
                      } else {
                        onNavigate(crumb.path);
                      }
                    }}
                  >
                    {idx === 0 && <HardDrive size={13} className="mahi-crumb-root-icon" />}
                    <span>{crumb.label}</span>
                  </button>
                  {!isLast && (
                    <ChevronRight size={13} className="mahi-crumb-separator" />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* View Switcher: Details vs Grid & Preview Toggle */}
        <div className="mahi-view-switcher">
          <button
            type="button"
            className={`mahi-view-toggle-btn ${viewMode === 'details' ? 'active' : ''}`}
            onClick={() => onViewModeChange('details')}
            title="Details View"
          >
            <List size={14} />
          </button>
          <button
            type="button"
            className={`mahi-view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => onViewModeChange('grid')}
            title="Grid View"
          >
            <LayoutGrid size={14} />
          </button>
          <div style={{ width: 1, height: 16, background: 'rgba(255, 255, 255, 0.1)', margin: '0 2px' }} />
          <button
            type="button"
            className={`mahi-view-toggle-btn ${showPreview ? 'active' : ''}`}
            onClick={togglePreview}
            title={showPreview ? "Hide Preview Panel (Ctrl + P)" : "Show Preview Panel (Ctrl + P)"}
          >
            <PanelRight size={14} />
          </button>
        </div>

        {/* Directory Quick Actions */}
        <div className="mahi-dir-actions">
          <button
            type="button"
            className="mahi-dir-action-pill"
            title="New Folder (Ctrl + Shift + N)"
            onClick={handleNewFolder}
          >
            <FolderPlus size={14} />
            <span>New Folder</span>
          </button>

          {onOpenInVsCode && (
            <button
              type="button"
              className="mahi-dir-action-pill vs-code"
              title="Open Directory in VS Code"
              onClick={() => onOpenInVsCode(currentPath)}
            >
              <Code2 size={14} />
              <span>VS Code</span>
            </button>
          )}
          {onOpenInTerminal && (
            <button
              type="button"
              className="mahi-dir-action-pill"
              title="Open Terminal in Directory"
              onClick={() => onOpenInTerminal(currentPath)}
            >
              <Terminal size={14} />
              <span>Terminal</span>
            </button>
          )}
          {onOpenInExplorer && (
            <button
              type="button"
              className="mahi-dir-action-pill"
              title="Open in Windows Explorer"
              onClick={() => onOpenInExplorer(currentPath)}
            >
              <FolderOpen size={14} />
              <span>Explorer</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Card */}
      <div 
        ref={containerRef}
        className="mahi-dir-content-card"
      >
        <div className="mahi-dir-files-area">
          {loading && !data ? (
          <div className="mahi-dir-loading-state">
            <RefreshCw size={28} className="mahi-spin mahi-loader-icon" />
            <p>Reading directory contents...</p>
          </div>
        ) : error ? (
          <div className="mahi-dir-error-state" onClick={(e) => e.stopPropagation()}>
            <div className="mahi-error-icon-box">
              <AlertCircle size={32} />
            </div>
            <h3 className="mahi-error-title">Unable to access directory</h3>
            <p className="mahi-error-message">{error}</p>
            <div className="mahi-error-buttons">
              <button
                type="button"
                className="mahi-error-btn primary"
                onClick={onGoUp}
              >
                Go to Parent Directory
              </button>
              <button
                type="button"
                className="mahi-error-btn"
                onClick={onOpenThisPc}
              >
                Return to This PC
              </button>
            </div>
          </div>
        ) : sortedEntries.length === 0 ? (
          <div className="mahi-dir-empty-state">
            <FolderOpen size={42} className="mahi-empty-icon" />
            <h3>No items here</h3>
            <p>This directory does not contain any files or folders.</p>
          </div>
        ) : viewMode === 'details' ? (
          /* DETAILS VIEW */
          <div className="mahi-files-table-wrapper">
            <table className="mahi-files-table">
              <thead>
                <tr>
                  <th 
                    className="th-name is-clickable"
                    onClick={() => handleSortHeader('name')}
                  >
                    <span>Name</span>
                    {renderSortIndicator('name')}
                  </th>
                  <th 
                    className="th-date is-clickable"
                    onClick={() => handleSortHeader('modifiedDate')}
                  >
                    <span>Date modified</span>
                    {renderSortIndicator('modifiedDate')}
                  </th>
                  <th 
                    className="th-type is-clickable"
                    onClick={() => handleSortHeader('fileType')}
                  >
                    <span>Type</span>
                    {renderSortIndicator('fileType')}
                  </th>
                  <th 
                    className="th-size is-clickable"
                    onClick={() => handleSortHeader('size')}
                  >
                    <span>Size</span>
                    {renderSortIndicator('size')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry, idx) => {
                  const isSelected = isSelectedPath(entry.path);
                  const isFocused = idx === lastFocusedIndex;
                  const isCut = clipboard?.operation === 'cut' && clipboard.items.includes(entry.path);
                  const isRenaming = renamingPath ? normalizePath(renamingPath) === normalizePath(entry.path) : false;
                  const isDragOver = dragOverPath === entry.path;
                  const isDragInvalid = isDragOver && dragInvalid;
                  const isDragValid = isDragOver && !dragInvalid && entry.isDirectory;

                  return (
                    <tr
                      key={entry.path}
                      ref={isFocused ? (activeRowRef as React.RefObject<HTMLTableRowElement>) : null}
                      className={`mahi-file-row ${isSelected ? 'is-selected' : ''} ${isFocused ? 'is-focused' : ''} ${isCut ? 'is-cut' : ''} ${isDragValid ? 'is-drop-target' : ''} ${isDragInvalid ? 'is-drop-invalid' : ''}`}
                      onClick={(e) => handleItemClick(entry, idx, e)}
                      onDoubleClick={(e) => handleItemDoubleClick(entry, e)}
                      onContextMenu={(e) => handleItemContextMenu(entry, idx, e)}
                      draggable={!isRenaming}
                      onDragStart={(e) => handleDragStart(entry, e)}
                      onDragOver={(e) => entry.isDirectory ? handleDragOver(entry, e) : e.preventDefault()}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => entry.isDirectory ? handleDrop(entry, e) : e.preventDefault()}
                      onDragEnd={handleDragEnd}
                    >
                      <td className="td-name">
                        <div className="mahi-cell-name">
                          {getItemIcon(entry, 17)}
                          {isRenaming ? (
                            <div 
                              className="mahi-inline-rename-wrapper"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                ref={renameInputRef}
                                type="text"
                                className="mahi-inline-rename-input"
                                value={renameValue}
                                onChange={(e) => {
                                  setRenameValue(e.target.value);
                                  if (renameError) setRenameError(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleCommitRename();
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    handleCancelRename();
                                  }
                                }}
                                onBlur={() => handleCommitRename()}
                              />
                              {renameError && (
                                <div className="mahi-rename-error-tip">{renameError}</div>
                              )}
                            </div>
                          ) : (
                            <span className="mahi-entry-name" title={entry.name}>
                              {entry.name}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="td-date">{formatDate(entry.modifiedDate)}</td>
                      <td className="td-type">{entry.fileType}</td>
                      <td className="td-size">{formatBytes(entry.size)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* GRID VIEW */
          <div className="mahi-files-grid-wrapper">
            <div className="mahi-files-grid">
              {sortedEntries.map((entry, idx) => {
                const isSelected = isSelectedPath(entry.path);
                const isFocused = idx === lastFocusedIndex;
                const isCut = clipboard?.operation === 'cut' && clipboard.items.includes(entry.path);
                const isRenaming = renamingPath ? normalizePath(renamingPath) === normalizePath(entry.path) : false;
                const isDragOver = dragOverPath === entry.path;
                const isDragInvalid = isDragOver && dragInvalid;
                const isDragValid = isDragOver && !dragInvalid && entry.isDirectory;

                return (
                  <div
                    key={entry.path}
                    ref={isFocused ? (activeRowRef as React.RefObject<HTMLDivElement>) : null}
                    className={`mahi-grid-card ${isSelected ? 'is-selected' : ''} ${isFocused ? 'is-focused' : ''} ${isCut ? 'is-cut' : ''} ${isDragValid ? 'is-drop-target' : ''} ${isDragInvalid ? 'is-drop-invalid' : ''}`}
                    onClick={(e) => handleItemClick(entry, idx, e)}
                    onDoubleClick={(e) => handleItemDoubleClick(entry, e)}
                    onContextMenu={(e) => handleItemContextMenu(entry, idx, e)}
                    title={`${entry.name}\nType: ${entry.fileType}${entry.size ? '\nSize: ' + formatBytes(entry.size) : ''}\nModified: ${formatDate(entry.modifiedDate)}`}
                    draggable={!isRenaming}
                    onDragStart={(e) => handleDragStart(entry, e)}
                    onDragOver={(e) => entry.isDirectory ? handleDragOver(entry, e) : e.preventDefault()}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => entry.isDirectory ? handleDrop(entry, e) : e.preventDefault()}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="mahi-grid-card-icon">
                      {getItemIcon(entry, 34)}
                    </div>
                    {isRenaming ? (
                      <div 
                        className="mahi-inline-rename-wrapper"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          ref={renameInputRef}
                          type="text"
                          className="mahi-inline-rename-input"
                          value={renameValue}
                          onChange={(e) => {
                            setRenameValue(e.target.value);
                            if (renameError) setRenameError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleCommitRename();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              handleCancelRename();
                            }
                          }}
                          onBlur={() => handleCommitRename()}
                        />
                        {renameError && (
                          <div className="mahi-rename-error-tip">{renameError}</div>
                        )}
                      </div>
                    ) : (
                      <>
                        <span className="mahi-grid-card-name">
                          {entry.name}
                        </span>
                        <span className="mahi-grid-card-sub">
                          {entry.isDirectory ? 'Folder' : formatBytes(entry.size)}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </div>

        {/* Preview Panel (Phase 4) */}
        <PreviewPanel
          isOpen={showPreview}
          selectedEntries={selectedEntriesList}
          onClose={() => onPreviewToggle(false)}
          onOpenFile={onOpenFile}
          onOpenFolder={onNavigate}
        />
      </div>

      {/* Directory Status Bar */}
      <footer className="mahi-dir-status-bar" onClick={(e) => e.stopPropagation()}>
        <div className="mahi-status-left">
          {isOperating.running ? (
            <div className="mahi-op-progress-bar">
              <RefreshCw size={13} className="mahi-spin" />
              <span>{isOperating.message}</span>
            </div>
          ) : data ? (
            <span>
              {sortedEntries.length} {sortedEntries.length === 1 ? 'item' : 'items'} ({data.dirCount} folders, {data.fileCount} files)
            </span>
          ) : (
            <span>Ready</span>
          )}
        </div>
        <div className="mahi-status-right">
          {selectionStats ? (
            selectionStats.count === 1 && selectionStats.singleItem ? (
              <span className="mahi-selected-status">
                Selected: <strong>{selectionStats.singleItem.name}</strong> · {selectionStats.singleItem.fileType}
                {!selectionStats.singleItem.isDirectory && selectionStats.singleItem.size !== undefined && (
                  <> · {formatBytes(selectionStats.singleItem.size)}</>
                )}
              </span>
            ) : (
              <span className="mahi-selected-status">
                <strong>{selectionStats.count} items selected</strong> ({selectionStats.folderCount} folders, {selectionStats.fileCount} files)
                {selectionStats.totalBytes > 0 && <> · {formatBytes(selectionStats.totalBytes)}</>}
              </span>
            )
          ) : (
            <span className="mahi-hint-text">
              Click to select · Ctrl/Shift for multi-select · Drag to move · Hold Ctrl to copy · F2 to rename · Del to delete
            </span>
          )}
        </div>
      </footer>

      {/* Custom Context Menu */}
      <ContextMenu
        state={contextMenu}
        viewMode={viewMode}
        clipboard={clipboard}
        selectedCount={selectedPathsArray.length}
        onClose={() => setContextMenu((prev) => ({ ...prev, isOpen: false }))}
        onOpenItem={() => {
          if (contextMenu.targetItem) {
            openItem(contextMenu.targetItem);
          } else if (selectedPathsArray.length > 0) {
            const focusedItem = sortedEntries[lastFocusedIndex];
            if (focusedItem) openItem(focusedItem);
          }
        }}
        onRefresh={onRefresh}
        onSetViewMode={onViewModeChange}
        onSetSort={(field) => {
          handleSortHeader(field);
        }}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={() => {
          if (contextMenu.targetItem?.isDirectory) {
            handlePaste(contextMenu.targetItem.path);
          } else {
            handlePaste();
          }
        }}
        onRename={() => {
          if (contextMenu.targetItem) {
            handleStartRename(contextMenu.targetItem);
          } else {
            handleStartRename();
          }
        }}
        onDelete={(permanent) => {
          handleDeletePrompt(permanent);
        }}
        onNewFolder={handleNewFolder}
        onProperties={() => {
          if (contextMenu.targetItem) {
            handleShowProperties(contextMenu.targetItem);
          } else {
            handleShowProperties();
          }
        }}
        onCopyPath={() => {
          if (contextMenu.targetItem) {
            handleCopyPath(contextMenu.targetItem);
          } else {
            handleCopyPath();
          }
        }}
        onOpenInVsCode={onOpenInVsCode ? () => {
          const target = contextMenu.targetItem ? contextMenu.targetItem.path : currentPath;
          if (target && target !== 'this-pc') onOpenInVsCode(target);
        } : undefined}
        onOpenInTerminal={onOpenInTerminal ? () => {
          const target = contextMenu.targetItem ? contextMenu.targetItem.path : currentPath;
          if (target && target !== 'this-pc') onOpenInTerminal(target);
        } : undefined}
        onOpenInExplorer={onOpenInExplorer ? () => {
          const target = contextMenu.targetItem ? contextMenu.targetItem.path : currentPath;
          if (target && target !== 'this-pc') onOpenInExplorer(target);
        } : undefined}
        onOpenInNewTab={onOpenInNewTab && contextMenu.targetItem?.isDirectory ? () => {
          onOpenInNewTab(contextMenu.targetItem!.path);
        } : undefined}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={deleteModal.isOpen}
        isPermanent={deleteModal.isPermanent}
        items={deleteModal.items}
        loading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteModal({ isOpen: false, isPermanent: false, items: [] })}
      />

      {/* Properties Modal */}
      <PropertiesModal
        isOpen={propertiesModal.isOpen}
        properties={propertiesModal.data}
        loading={propertiesModal.loading}
        onClose={() => setPropertiesModal({ isOpen: false, loading: false, data: null })}
      />

      {/* Floating Notification Toast */}
      {toast && (
        <div className="mahi-toast-container">
          <div className={`mahi-toast ${toast.type}`}>
            {toast.type === 'success' && <CheckCircle2 size={16} className="mahi-toast-icon success" />}
            {toast.type === 'warning' && <AlertTriangle size={16} className="mahi-toast-icon warning" />}
            {toast.type === 'error' && <AlertCircle size={16} className="mahi-toast-icon error" />}
            {toast.type === 'info' && <Info size={16} className="mahi-toast-icon info" />}
            <span className="mahi-toast-message">{toast.message}</span>
            <button 
              type="button" 
              className="mahi-toast-close" 
              onClick={() => setToast(null)}
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
