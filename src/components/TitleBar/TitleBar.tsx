import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X } from 'lucide-react';
import './TitleBar.css';

interface TitleBarProps {
  appName?: string;
}

export const TitleBar: React.FC<TitleBarProps> = ({ appName = 'MAHI' }) => {
  const [isMaximized, setIsMaximized] = React.useState(false);

  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    const checkMaximized = async () => {
      try {
        const appWindow = getCurrentWindow();
        setIsMaximized(await appWindow.isMaximized());
        unlisten = await appWindow.onResized(async () => {
          setIsMaximized(await appWindow.isMaximized());
        });
      } catch (err) {
        // running in preview/browser mode fallback
        console.debug('Tauri window API not available:', err);
      }
    };
    checkMaximized();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleMinimize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const appWindow = getCurrentWindow();
      await appWindow.minimize();
    } catch (e) {
      console.debug('Minimize:', e);
    }
  };

  const handleMaximizeToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      setIsMaximized(await appWindow.isMaximized());
    } catch (e) {
      console.debug('Toggle maximize:', e);
    }
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const appWindow = getCurrentWindow();
      await appWindow.close();
    } catch (e) {
      console.debug('Close:', e);
    }
  };

  return (
    <header className="mahi-titlebar" data-tauri-drag-region>
      <div className="mahi-titlebar-brand" data-tauri-drag-region>
        <div className="mahi-logo-icon" data-tauri-drag-region>
          <div className="mahi-logo-core" />
        </div>
        <span className="mahi-app-title" data-tauri-drag-region>{appName}</span>
        <span className="mahi-titlebar-pill" data-tauri-drag-region>WORKSPACE</span>
      </div>

      <div className="mahi-titlebar-center" data-tauri-drag-region>
        <span className="mahi-titlebar-status-text" data-tauri-drag-region>
          v0.1.0 · Developer Edition
        </span>
      </div>

      <div
        className="mahi-window-controls"
        data-tauri-drag-region="false"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="mahi-win-btn minimize"
          title="Minimize"
          aria-label="Minimize"
          onClick={handleMinimize}
        >
          <Minus size={13} strokeWidth={2.2} />
        </button>
        <button
          type="button"
          className="mahi-win-btn maximize"
          title={isMaximized ? "Restore" : "Maximize"}
          aria-label={isMaximized ? "Restore" : "Maximize"}
          onClick={handleMaximizeToggle}
        >
          {isMaximized ? <Copy size={11} strokeWidth={2.2} /> : <Square size={11} strokeWidth={2.2} />}
        </button>
        <button
          type="button"
          className="mahi-win-btn close"
          title="Close"
          aria-label="Close"
          onClick={handleClose}
        >
          <X size={14} strokeWidth={2.2} />
        </button>
      </div>
    </header>
  );
};
