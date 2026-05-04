import { useMemo, useState } from 'react';

export interface HeatmapBucket {
  dateLabel: string;
  dayShort: string;
  count: number;
}

interface HeatmapWidgetProps {
  buckets: HeatmapBucket[];
}

function HeatmapWidget({ buckets }: HeatmapWidgetProps) {
  const [windowSize, setWindowSize] = useState<42 | 84>(42);

  const visibleBuckets = useMemo(() => buckets.slice(-windowSize), [buckets, windowSize]);
  const maxCount = useMemo(
    () => Math.max(1, ...visibleBuckets.map((bucket) => bucket.count)),
    [visibleBuckets]
  );

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.1em] text-white/55">Print volume by day</p>
        <div className="flex gap-1 rounded border border-white/15 bg-black/20 p-1">
          <button
            type="button"
            onClick={() => setWindowSize(42)}
            className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${windowSize === 42 ? 'bg-white/15 text-white' : 'text-white/60'}`}
          >
            6w
          </button>
          <button
            type="button"
            onClick={() => setWindowSize(84)}
            className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${windowSize === 84 ? 'bg-white/15 text-white' : 'text-white/60'}`}
          >
            12w
          </button>
        </div>
      </div>

      {visibleBuckets.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No print history for heatmap.
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {visibleBuckets.map((bucket) => {
            const intensity = bucket.count / maxCount;
            return (
              <div key={bucket.dateLabel} className="group relative">
                <div
                  className="h-6 rounded border border-white/10"
                  style={{
                    backgroundColor: `rgba(var(--theme-accent-rgb), ${0.12 + intensity * 0.68})`,
                  }}
                  title={`${bucket.dateLabel}: ${bucket.count} jobs`}
                />
                <span className="mt-1 block text-center text-[9px] uppercase tracking-[0.08em] text-white/40">
                  {bucket.dayShort}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default HeatmapWidget;
