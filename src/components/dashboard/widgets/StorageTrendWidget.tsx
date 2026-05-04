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
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.1em] text-white/55">Storage and throughput</p>
        <div className="flex gap-1 rounded border border-white/15 bg-black/20 p-1">
          <button type="button" onClick={() => setSeries('filament')} className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${series === 'filament' ? 'bg-white/15 text-white' : 'text-white/60'}`}>Filament</button>
          <button type="button" onClick={() => setSeries('time')} className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${series === 'time' ? 'bg-white/15 text-white' : 'text-white/60'}`}>Hours</button>
          <button type="button" onClick={() => setSeries('jobs')} className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${series === 'jobs' ? 'bg-white/15 text-white' : 'text-white/60'}`}>Jobs</button>
        </div>
      </div>

      {density !== 'compact' ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded border border-white/15 bg-black/20 px-2 py-1.5 text-[10px] uppercase tracking-[0.08em] text-white/70">Filament: {totals.filament.toFixed(1)}kg</div>
          <div className="rounded border border-white/15 bg-black/20 px-2 py-1.5 text-[10px] uppercase tracking-[0.08em] text-white/70">Hours: {totals.hours.toFixed(0)}h</div>
          <div className="rounded border border-white/15 bg-black/20 px-2 py-1.5 text-[10px] uppercase tracking-[0.08em] text-white/70">Jobs: {totals.jobs}</div>
        </div>
      ) : null}

      {points.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No trend data available.
        </div>
      ) : (
        <div className="space-y-2">
          {points.slice(-(density === 'compact' ? 5 : 8)).map((point) => {
            const value = series === 'filament' ? point.filamentKg : series === 'time' ? point.printHours : point.jobs;
            const width = Math.max(6, (value / maxValue) * 100);
            return (
              <div key={point.label} className="grid grid-cols-[48px_1fr_58px] items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.08em] text-white/45">{point.label}</span>
                <div className="h-5 overflow-hidden rounded border border-white/10 bg-black/20">
                  <div className="h-full" style={{ width: `${width}%`, background: 'linear-gradient(90deg, rgba(var(--theme-accent-rgb),0.85), rgba(var(--theme-accent-rgb),0.35))' }} />
                </div>
                <span className="text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-white/75">
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
