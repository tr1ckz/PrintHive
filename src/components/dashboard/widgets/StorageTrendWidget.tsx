import { useMemo, useState } from 'react';

export interface TrendPoint {
  label: string;
  filamentKg: number;
  printHours: number;
  jobs: number;
}

interface StorageTrendWidgetProps {
  points: TrendPoint[];
  density?: 'compact' | 'comfortable' | 'expanded';
}

function StorageTrendWidget({ points, density = 'comfortable' }: StorageTrendWidgetProps) {
  const [series, setSeries] = useState<'filament' | 'time' | 'jobs'>('filament');

  const maxValue = useMemo(() => {
    const values = points.map((point) => {
      if (series === 'filament') return point.filamentKg;
      if (series === 'time') return point.printHours;
      return point.jobs;
    });
    return Math.max(1, ...values);
  }, [points, series]);

  const totals = useMemo(() => {
    return points.reduce(
      (acc, point) => {
        acc.filament += point.filamentKg;
        acc.hours += point.printHours;
        acc.jobs += point.jobs;
        return acc;
      },
      { filament: 0, hours: 0, jobs: 0 }
    );
  }, [points]);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.1em] text-muted">Storage and throughput</p>
        <div className="flex gap-1 rounded-md border border-line bg-white/[0.04] p-1">
          <button type="button" onClick={() => setSeries('filament')} className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${series === 'filament' ? 'bg-white/10 text-fg' : 'text-fg-faint'}`}>Filament</button>
          <button type="button" onClick={() => setSeries('time')} className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${series === 'time' ? 'bg-white/10 text-fg' : 'text-fg-faint'}`}>Hours</button>
          <button type="button" onClick={() => setSeries('jobs')} className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${series === 'jobs' ? 'bg-white/10 text-fg' : 'text-fg-faint'}`}>Jobs</button>
        </div>
      </div>

      {density !== 'compact' ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border border-line bg-white/[0.04] px-2 py-1.5 text-[10px] uppercase tracking-[0.08em] text-fg">Filament: {totals.filament.toFixed(1)}kg</div>
          <div className="rounded-md border border-line bg-white/[0.04] px-2 py-1.5 text-[10px] uppercase tracking-[0.08em] text-fg">Hours: {totals.hours.toFixed(0)}h</div>
          <div className="rounded-md border border-line bg-white/[0.04] px-2 py-1.5 text-[10px] uppercase tracking-[0.08em] text-fg">Jobs: {totals.jobs}</div>
        </div>
      ) : null}

      {points.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-fg/50">
          No trend data available.
        </div>
      ) : (
        <div className="space-y-2">
          {points.slice(-(density === 'compact' ? 5 : 8)).map((point) => {
            const value = series === 'filament' ? point.filamentKg : series === 'time' ? point.printHours : point.jobs;
            const width = Math.max(6, (value / maxValue) * 100);
            return (
              <div key={point.label} className="grid grid-cols-[48px_1fr_58px] items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.08em] text-muted">{point.label}</span>
                <div className="h-5 overflow-hidden rounded border border-line bg-transparent">
                  <div className="h-full bg-accent" style={{ width: `${width}%` }} />
                </div>
                <span className="text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-fg">
                  {series === 'filament' ? `${value.toFixed(1)}kg` : series === 'time' ? `${value.toFixed(0)}h` : value.toFixed(0)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default StorageTrendWidget;
