import { useMemo, useState } from 'react';

interface HealthMetric {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}

interface HealthSummaryWidgetProps {
  fleetMetrics: HealthMetric[];
  qualityMetrics: HealthMetric[];
  density?: 'compact' | 'comfortable' | 'expanded';
  onOpenPrinters?: () => void;
  onOpenMaintenance?: () => void;
}

const toneClassMap: Record<HealthMetric['tone'], string> = {
  good: 'border-neutral-800 bg-neutral-900 text-white',
  warn: 'border-orange-500/40 bg-orange-500/5 text-orange-300',
  bad: 'border-orange-500/55 bg-orange-500/10 text-orange-300',
  neutral: 'border-neutral-800 bg-neutral-900 text-white',
};

function HealthSummaryWidget({
  fleetMetrics,
  qualityMetrics,
  density = 'comfortable',
  onOpenPrinters,
  onOpenMaintenance,
}: HealthSummaryWidgetProps) {
  const [tab, setTab] = useState<'fleet' | 'quality'>('fleet');

  const currentMetrics = useMemo(
    () => (tab === 'fleet' ? fleetMetrics : qualityMetrics),
    [tab, fleetMetrics, qualityMetrics]
  );

  const sortedMetrics = useMemo(() => {
    const toneOrder: Record<HealthMetric['tone'], number> = { bad: 0, warn: 1, neutral: 2, good: 3 };
    return [...currentMetrics].sort((a, b) => {
      if (toneOrder[a.tone] !== toneOrder[b.tone]) {
        return toneOrder[a.tone] - toneOrder[b.tone];
      }
      return a.label.localeCompare(b.label);
    });
  }, [currentMetrics]);

  const visibleMetrics = density === 'compact' ? sortedMetrics.slice(0, 3) : sortedMetrics;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-1 rounded-[4px] border border-neutral-800 bg-neutral-900 p-1">
        <button
          type="button"
          onClick={() => setTab('fleet')}
          className={`rounded-[3px] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${tab === 'fleet' ? 'bg-neutral-800 text-white' : 'text-neutral-400'}`}
        >
          Fleet
        </button>
        <button
          type="button"
          onClick={() => setTab('quality')}
          className={`rounded-[3px] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${tab === 'quality' ? 'bg-neutral-800 text-white' : 'text-neutral-400'}`}
        >
          Quality
        </button>
      </div>

      {currentMetrics.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No health metrics available.
        </div>
      ) : (
        <div className={`grid gap-3 ${density === 'compact' ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
          {visibleMetrics.map((metric) => (
            <div key={metric.label} className={`rounded-[4px] border p-3 ${toneClassMap[metric.tone]}`}>
              <p className="text-[10px] uppercase tracking-[0.12em]">{metric.label}</p>
              <p className="mt-1 text-sm font-semibold">{metric.value}</p>
            </div>
          ))}
        </div>
      )}

      {(onOpenPrinters || onOpenMaintenance) ? (
        <div className="mt-auto grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onOpenPrinters}
            disabled={!onOpenPrinters}
            className="widget-no-drag rounded-[4px] border border-neutral-800 bg-neutral-900 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white hover:border-neutral-700 disabled:opacity-40"
          >
            Printers
          </button>
          <button
            type="button"
            onClick={onOpenMaintenance}
            disabled={!onOpenMaintenance}
            className="widget-no-drag rounded-[4px] border border-neutral-800 bg-neutral-900 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white hover:border-neutral-700 disabled:opacity-40"
          >
            Maintenance
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default HealthSummaryWidget;
