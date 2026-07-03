import React from 'react';

interface StatChipProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Small line under the value (delta, context) */
  hint?: React.ReactNode;
  /** Tints the value for signal states */
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  className?: string;
}

const toneClass: Record<NonNullable<StatChipProps['tone']>, string> = {
  default: 'text-fg',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/** Label-over-stat block. Typography does the hierarchy — no box. */
const StatChip: React.FC<StatChipProps> = ({ label, value, hint, tone = 'default', className }) => (
  <div className={['min-w-0', className || ''].filter(Boolean).join(' ')}>
    <div className="text-xs text-muted truncate">{label}</div>
    <div className={`text-3xl font-semibold tabular-nums tracking-tight ${toneClass[tone]}`}>{value}</div>
    {hint && <div className="text-xs text-muted mt-0.5 truncate">{hint}</div>}
  </div>
);

export default StatChip;
