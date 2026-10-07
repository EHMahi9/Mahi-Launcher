import React, { useState } from 'react';
import { 
  HardDrive, 
  ArrowUpRight, 
  RefreshCw, 
  Database,
  Cloud,
  Disc,
  Usb
} from 'lucide-react';
import { DriveInfo } from '../../types/filesystem';
import { formatBytes } from '../../utils/formatters';
import './DriveView.css';

interface DriveViewProps {
  drives: DriveInfo[];
  loading: boolean;
  onRefresh: () => void;
  onOpenDrive: (path: string) => void;
}

export const DriveView: React.FC<DriveViewProps> = ({
  drives,
  loading,
  onRefresh,
  onOpenDrive,
}) => {
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);

  const getDriveIcon = (type: string, label: string) => {
    const l = (type + ' ' + label).toLowerCase();
    if (l.includes('cloud') || l.includes('google')) return <Cloud size={24} className="mahi-drive-type-icon cloud" />;
    if (l.includes('removable') || l.includes('usb')) return <Usb size={24} className="mahi-drive-type-icon usb" />;
    if (l.includes('cd') || l.includes('dvd')) return <Disc size={24} className="mahi-drive-type-icon disc" />;
    return <HardDrive size={24} className="mahi-drive-type-icon fixed" />;
  };

  const getProgressColorClass = (pct: number) => {
    if (pct >= 92) return 'critical';
    if (pct >= 82) return 'warning';
    return 'normal';
  };

  return (
    <div className="mahi-drive-view">
      {/* Header bar */}
      <div className="mahi-drive-header">
        <div className="mahi-drive-title-area">
          <div className="mahi-drive-header-icon-box">
            <Database size={20} />
          </div>
          <div>
            <h1 className="mahi-drive-title">This PC</h1>
            <p className="mahi-drive-subtitle">
              Local and network storage devices · {drives.length} drives detected
            </p>
          </div>
        </div>

        <button
          type="button"
          className="mahi-drive-refresh-btn"
          onClick={onRefresh}
          title="Refresh drives"
        >
          <RefreshCw size={14} className={loading ? 'mahi-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Drives Grid */}
      <div className="mahi-drives-grid">
        {drives.map((drive) => {
          const isSelected = selectedLetter === drive.letter;
          const usedPct = Math.min(Math.max(Math.round(drive.usedPercentage), 0), 100);
          const colorClass = getProgressColorClass(usedPct);

          return (
            <div
              key={drive.letter}
              className={`mahi-drive-card ${isSelected ? 'is-selected' : ''}`}
              onClick={() => setSelectedLetter(drive.letter)}
              onDoubleClick={() => onOpenDrive(drive.path)}
            >
              <div className="mahi-drive-card-top">
                <div className="mahi-drive-icon-wrapper">
                  {getDriveIcon(drive.driveType, drive.volumeLabel)}
                </div>

                <div className="mahi-drive-identity">
                  <div className="mahi-drive-name-row">
                    <span className="mahi-drive-label">{drive.volumeLabel}</span>
                    <span className="mahi-drive-letter">({drive.letter})</span>
                  </div>
                  <div className="mahi-drive-badges">
                    <span className="mahi-drive-type-badge">{drive.driveType}</span>
                    {drive.fileSystem && (
                      <span className="mahi-drive-fs-badge">{drive.fileSystem}</span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  className="mahi-drive-open-btn"
                  title={`Open ${drive.letter}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDrive(drive.path);
                  }}
                >
                  <ArrowUpRight size={16} />
                </button>
              </div>

              {/* Space Capacity Bar */}
              <div className="mahi-drive-capacity-section">
                <div className="mahi-drive-progress-track">
                  <div
                    className={`mahi-drive-progress-fill ${colorClass}`}
                    style={{ width: `${usedPct}%` }}
                  />
                </div>

                <div className="mahi-drive-capacity-labels">
                  <span className="mahi-drive-free-text">
                    {formatBytes(drive.availableBytes)} free of {formatBytes(drive.totalBytes)}
                  </span>
                  <span className="mahi-drive-pct-text">{usedPct}% used</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
