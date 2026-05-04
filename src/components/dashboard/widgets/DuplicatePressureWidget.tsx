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
    ? 'border-orange-500/55 bg-orange-500/10 text-orange-300'
    : summary.groupCount > 8
      ? 'border-orange-500/40 bg-orange-500/5 text-orange-300'
      : 'border-neutral-800 bg-neutral-900 text-white';

  const visibleTop = summary.topGroups.slice(0, density === 'compact' ? 3 : 5);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className={`rounded-[4px] border p-4 ${tone}`}>
        <p className="text-[10px] uppercase tracking-[0.1em]">Duplicate Pressure</p>
        <p className="mt-1 text-lg font-bold">{summary.groupCount} Groups</p>
        <p className="mt-1 text-[11px] text-white/85">{summary.duplicateFileCount} files | {summary.estimatedWasteLabel} potential waste</p>
      </div>

      {visibleTop.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-white/50">
          No duplicates currently detected.
        </div>
      ) : (
        <div className="space-y-4 rounded-[4px] border border-neutral-800 bg-neutral-900 p-4">
          {visibleTop.map((group) => (
            <div key={group.name} className="border-b border-neutral-800 py-3 last:border-b-0">
              <p className="truncate text-xs font-semibold text-white/88">{group.name}</p>
              <p className="text-[10px] uppercase tracking-[0.08em] text-white/50">{group.fileCount} files | {group.sizeLabel}</p>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onOpenDuplicates}
        className="mt-auto rounded-[4px] border border-neutral-800 bg-neutral-900 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white hover:border-neutral-700"
      >
        Open Duplicates
      </button>
    </div>
  );
}

export default DuplicatePressureWidget;
