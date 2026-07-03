import React from 'react';

interface ProgressBarProps {
  /** 0–100 */
  value: number;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  /** Bar thickness */
  size?: 'sm' | 'md';
  className?: string;
}

const toneClass = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
} as const;

/** Thin token-pure progress track. */
const ProgressBar: React.FC<ProgressBarProps> = ({ value, tone = 'accent', size = 'sm', className }) => {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={[
        'w-full rounded-full bg-white/8 overflow-hidden',
        size === 'sm' ? 'h-1.5' : 'h-2.5',
        className || '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        className={`h-full rounded-full ${toneClass[tone]} transition-[width] duration-500 ease-out`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};

export default ProgressBar;
