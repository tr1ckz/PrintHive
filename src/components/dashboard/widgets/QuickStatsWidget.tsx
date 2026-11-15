import type { Tone } from '../primitives';

export interface QuickStat {
  key: string;
  label: string;
  value: string;
  /** Rendered smaller after the value, e.g. the "/4" of "3/4" */
  suffix?: string;
  hint?: string;
  tone?: Tone;
}

interface QuickStatsWidgetProps {
  stats: QuickStat[];
}

const valueTone: Record<Tone, string> = {
  neutral: 'text-fg',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/**
 * The dashboard's headline numbers: one surface, tiles split by hairlines.
 * Each tile draws its top/left rule and the wrapper clips the outermost
 * ones, so the dividers stay correct at any column count.
 */
function QuickStatsWidget({ stats }: QuickStatsWidgetProps) {
  return (
    <div className="overflow-hidden rounded-lg bg-card">
      <dl className="-ml-px -mt-px grid grid-cols-2 @xl:grid-cols-3 @4xl:grid-cols-6">
        {stats.map((stat) => (
          <div key={stat.key} className="min-w-0 border-l border-t border-line px-4 py-3">
            <dt className="truncate text-xs text-muted">{stat.label}</dt>
            <dd className={`mt-0.5 truncate text-2xl font-semibold leading-8 tracking-tight tabular-nums ${valueTone[stat.tone || 'neutral']}`}>
              {stat.value}
              {stat.suffix ? <span className="text-sm font-medium text-muted">{stat.suffix}</span> : null}
            </dd>
            <dd className="truncate text-xs text-muted">{stat.hint || ' '}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default QuickStatsWidget;
