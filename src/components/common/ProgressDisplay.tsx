import React from 'react';
import ProgressBar from './ProgressBar';

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
 * Self-contained Tailwind; renders the shared ProgressBar primitive.
 */
const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ label, stats, percentComplete, processed, total, currentFile }) => (
  <div className="space-y-1.5 py-2">
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="font-medium text-fg truncate">{label}</span>
      <span className="text-xs text-muted whitespace-nowrap">{stats}</span>
    </div>
    <ProgressBar value={percentComplete} size="md" />
    <div className="text-xs text-muted tabular-nums">
      {processed}/{total} files ({percentComplete}%)
      {currentFile && (
        <span className="text-fg-faint"> - {currentFile.substring(0, 40)}{currentFile.length > 40 ? '...' : ''}</span>
      )}
    </div>
  </div>
);

export default ProgressDisplay;
