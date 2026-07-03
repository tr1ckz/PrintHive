import React from 'react';

export type StatusVariant = 'printing' | 'idle' | 'error' | 'offline' | 'paused' | 'success' | 'info';

interface StatusBadgeProps {
  variant: StatusVariant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<StatusVariant, { dot: string; text: string; pulse: boolean }> = {
  printing: { dot: 'bg-accent', text: 'text-accent', pulse: true },
  success: { dot: 'bg-success', text: 'text-success', pulse: false },
  idle: { dot: 'bg-info', text: 'text-fg-soft', pulse: false },
  paused: { dot: 'bg-warning', text: 'text-warning', pulse: true },
  error: { dot: 'bg-danger', text: 'text-danger', pulse: true },
  offline: { dot: 'bg-disabled', text: 'text-muted', pulse: false },
  info: { dot: 'bg-info', text: 'text-info', pulse: false },
};

/** Map a raw printer/print status string onto a badge variant. */
export function statusToVariant(status: string | undefined | null, online?: boolean): StatusVariant {
  if (online === false) return 'offline';
  const s = String(status || '').toUpperCase();
  if (s === 'RUNNING' || s === 'PRINTING' || s === 'PREPARE') return 'printing';
  if (s === 'PAUSE' || s === 'PAUSED') return 'paused';
  if (s === 'FAILED' || s === 'ERROR') return 'error';
  if (s === 'FINISH' || s === 'SUCCESS') return 'success';
  if (s === 'OFFLINE' || s === 'UNKNOWN' || s === '') return 'offline';
  return 'idle';
}

/** Dot + label status indicator. Live states pulse. */
const StatusBadge: React.FC<StatusBadgeProps> = ({ variant, children, className }) => {
  const style = variantStyles[variant];
  return (
    <span className={['inline-flex items-center gap-1.5 text-xs font-medium', style.text, className || ''].filter(Boolean).join(' ')}>
      <span className="relative flex size-2">
        {style.pulse && (
          <span className={`absolute inline-flex size-full rounded-full ${style.dot} opacity-60 animate-ping`} />
        )}
        <span className={`relative inline-flex size-2 rounded-full ${style.dot}`} />
      </span>
      {children}
    </span>
  );
};

export default StatusBadge;
