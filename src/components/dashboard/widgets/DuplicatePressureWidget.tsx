export interface DuplicatePressureSummary {
  groupCount: number;
  duplicateFileCount: number;
  estimatedWasteLabel: string;
  topGroups: Array<{
    name: string;
    fileCount: number;
    sizeLabel: string;
  }>;
}

interface DuplicatePressureWidgetProps {
  summary: DuplicatePressureSummary;
  density?: 'compact' | 'comfortable' | 'expanded';
  onOpenDuplicates: () => void;
}

function DuplicatePressureWidget({ summary, density = 'comfortable', onOpenDuplicates }: DuplicatePressureWidgetProps) {
  const tone = summary.groupCount > 20
    ? 'border-rose-400/45 bg-rose-500/10 text-rose-200'
    : summary.groupCount > 8
      ? 'border-amber-400/45 bg-amber-500/10 text-amber-200'
      : 'border-emerald-400/45 bg-emerald-500/10 text-emerald-200';

  const visibleTop = summary.topGroups.slice(0, density === 'compact' ? 3 : 5);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className={`rounded border p-2 ${tone}`}>
        <p className="text-[10px] uppercase tracking-[0.1em]">Duplicate Pressure</p>
        <p className="mt-1 text-lg font-bold">{summary.groupCount} Groups</p>
        <p className="mt-1 text-[11px] text-white/85">{summary.duplicateFileCount} files | {summary.estimatedWasteLabel} potential waste</p>
      </div>

      {visibleTop.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No duplicates currently detected.
        </div>
      ) : (
        <div className="space-y-2">
          {visibleTop.map((group) => (
            <div key={group.name} className="rounded border border-white/15 bg-white/[0.03] px-2 py-1.5">
              <p className="truncate text-xs font-semibold text-white/88">{group.name}</p>
              <p className="text-[10px] uppercase tracking-[0.08em] text-white/50">{group.fileCount} files | {group.sizeLabel}</p>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onOpenDuplicates}
        className="mt-auto rounded border border-white/20 bg-white/5 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/80 hover:border-white/35"
      >
        Open Duplicates
      </button>
    </div>
  );
}

export default DuplicatePressureWidget;
