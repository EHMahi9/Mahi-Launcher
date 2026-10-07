import { useState, useCallback } from 'react';
import { TabState } from '../types/tabs';

let tabIdCounter = 1;

function createTabId(): string {
  return `tab-${Date.now()}-${tabIdCounter++}`;
}

export function getTabTitle(path: string): string {
  if (!path || path === 'this-pc') return 'This PC';
  const normalized = path.replace(/\//g, '\\');
  // Drive root like "C:\" → "C:"
  const driveRootMatch = normalized.match(/^([A-Za-z]:[\\]?)$/);
  if (driveRootMatch) return driveRootMatch[1].replace(/\\$/, '');
  // Last path segment
  const parts = normalized.replace(/[\\]+$/, '').split('\\');
  return parts[parts.length - 1] || path;
}

function makeDefaultTab(path: string = 'this-pc'): TabState {
  return {
    id: createTabId(),
    title: getTabTitle(path),
    currentPath: path,
    history: [path],
    historyIndex: 0,
    viewMode: 'details',
    sortField: 'name',
    sortDirection: 'asc',
    selectedPaths: [],
    showPreview: true,
  };
}

interface TabsState {
  tabs: TabState[];
  activeId: string;
}

export interface UseTabsReturn {
  tabs: TabState[];
  activeTabId: string;
  activeTab: TabState;
  newTab: (path?: string) => string;
  closeTab: (id: string) => void;
  switchTab: (id: string) => void;
  switchTabByOffset: (offset: number) => void;
  updateTab: (id: string, updates: Partial<TabState>) => void;
  navigateTab: (id: string, targetPath: string) => void;
  goBackTab: (id: string) => void;
  goForwardTab: (id: string) => void;
}

export function useTabs(): UseTabsReturn {
  const [state, setState] = useState<TabsState>(() => {
    const firstTab = makeDefaultTab();
    return { tabs: [firstTab], activeId: firstTab.id };
  });

  const activeTab = state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];

  const newTab = useCallback((path: string = 'this-pc') => {
    const tab = makeDefaultTab(path);
    setState((prev) => ({ tabs: [...prev.tabs, tab], activeId: tab.id }));
    return tab.id;
  }, []);

  const closeTab = useCallback((id: string) => {
    setState((prev) => {
      if (prev.tabs.length <= 1) return prev; // Never close the last tab
      const idx = prev.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const nextTabs = prev.tabs.filter((t) => t.id !== id);
      let nextActiveId = prev.activeId;
      if (prev.activeId === id) {
        const newIdx = Math.max(0, Math.min(idx, nextTabs.length - 1));
        nextActiveId = nextTabs[newIdx]?.id ?? nextTabs[0].id;
      }
      return { tabs: nextTabs, activeId: nextActiveId };
    });
  }, []);

  const switchTab = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeId: id }));
  }, []);

  const switchTabByOffset = useCallback((offset: number) => {
    setState((prev) => {
      const idx = prev.tabs.findIndex((t) => t.id === prev.activeId);
      const nextIdx = (idx + offset + prev.tabs.length) % prev.tabs.length;
      return { ...prev, activeId: prev.tabs[nextIdx].id };
    });
  }, []);

  const updateTab = useCallback((id: string, updates: Partial<TabState>) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => {
        if (t.id !== id) return t;
        const merged = { ...t, ...updates };
        // Always recompute title when currentPath changes
        if (updates.currentPath !== undefined) {
          merged.title = getTabTitle(updates.currentPath);
        }
        return merged;
      }),
    }));
  }, []);

  const navigateTab = useCallback((id: string, targetPath: string) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => {
        if (t.id !== id) return t;
        const nextHistory = t.history.slice(0, t.historyIndex + 1);
        if (nextHistory[nextHistory.length - 1] !== targetPath) {
          nextHistory.push(targetPath);
        }
        return {
          ...t,
          currentPath: targetPath,
          title: getTabTitle(targetPath),
          history: nextHistory,
          historyIndex: nextHistory.length - 1,
          selectedPaths: [],
        };
      }),
    }));
  }, []);

  const goBackTab = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => {
        if (t.id !== id || t.historyIndex <= 0) return t;
        const nextIdx = t.historyIndex - 1;
        const targetPath = t.history[nextIdx];
        return {
          ...t,
          currentPath: targetPath,
          title: getTabTitle(targetPath),
          historyIndex: nextIdx,
          selectedPaths: [],
        };
      }),
    }));
  }, []);

  const goForwardTab = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => {
        if (t.id !== id || t.historyIndex >= t.history.length - 1) return t;
        const nextIdx = t.historyIndex + 1;
        const targetPath = t.history[nextIdx];
        return {
          ...t,
          currentPath: targetPath,
          title: getTabTitle(targetPath),
          historyIndex: nextIdx,
          selectedPaths: [],
        };
      }),
    }));
  }, []);

  return {
    tabs: state.tabs,
    activeTabId: state.activeId,
    activeTab,
    newTab,
    closeTab,
    switchTab,
    switchTabByOffset,
    updateTab,
    navigateTab,
    goBackTab,
    goForwardTab,
  };
}
