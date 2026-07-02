import React from 'react';

interface ProgressDisplayProps {
  /** Left header text, e.g. "🔄 Scanning library..." */
  label: React.ReactNode;
  /** Right header text, e.g. "12 added / 3 skipped" */
  stats: React.ReactNode;
  percentComplete: number;
  processed: number;
  total: number;
  currentFile?: string | null;
}

/**
 * Progress block used by long-running library jobs (scan, auto-tag).
 * Markup and class names match the previously duplicated inline pattern
 * exactly (auto-tag-progress > progress-header/progress-bar/progress-text).
 */
const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ label, stats, percentComplete, processed, total, currentFile }) => (
  <div className="auto-tag-progress">
    <div className="progress-header">
      <span>{label}</span>
      <span>{stats}</span>
    </div>
    <div className="progress-bar">
      <div
        className="progress-fill"
        style={{ width: `${percentComplete}%` }}
      />
    </div>
    <div className="progress-text">
      {processed}/{total} files ({percentComplete}%)
      {currentFile && (
        <span className="current-file"> - {currentFile.substring(0, 40)}{currentFile.length > 40 ? '...' : ''}</span>
      )}
    </div>
  </div>
);

export default ProgressDisplay;
