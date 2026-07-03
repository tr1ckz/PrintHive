import React from 'react';
import ProgressBar from './ProgressBar';

interface TemperatureGaugeProps {
  label: React.ReactNode;
  /** Current temperature in °C */
  current?: number | null;
  /** Target temperature in °C (omit/0 = no active target) */
  target?: number | null;
  /** Upper bound for the bar scale (default 300 for nozzle-ish ranges) */
  max?: number;
  className?: string;
}

/**
 * Compact current/target temperature readout with a thin heat bar.
 * Warm tint while actively heating toward a target; muted when idle.
 */
const TemperatureGauge: React.FC<TemperatureGaugeProps> = ({ label, current, target, max = 300, className }) => {
  const cur = typeof current === 'number' && Number.isFinite(current) ? current : null;
  const tgt = typeof target === 'number' && Number.isFinite(target) && target > 0 ? target : null;
  const heating = cur !== null && tgt !== null && cur < tgt - 1;
  const pct = cur !== null ? (cur / max) * 100 : 0;

  return (
    <div className={['min-w-0', className || ''].filter(Boolean).join(' ')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted truncate">{label}</span>
        <span className="text-lg font-semibold tabular-nums text-fg whitespace-nowrap">
          {cur !== null ? `${Math.round(cur)}°` : '—'}
          {tgt !== null && (
            <span className={`text-xs font-normal ml-1 ${heating ? 'text-warning' : 'text-fg-faint'}`}>
              / {Math.round(tgt)}°
            </span>
          )}
        </span>
      </div>
      <ProgressBar value={pct} tone={heating ? 'warning' : 'accent'} className="mt-1" />
    </div>
  );
};

export default TemperatureGauge;
