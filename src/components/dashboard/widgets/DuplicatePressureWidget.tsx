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
    ? 'border-accent/55 bg-accent/10 text-accent'
    : summary.groupCount > 8
      ? 'border-accent/40 bg-accent/5 text-accent'
      : 'border-line bg-white/[0.04] text-fg';

  const visibleTop = summary.topGroups.slice(0, density === 'compact' ? 3 : 5);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className={`rounded-md border p-5 ${tone}`}>
        <p className="text-[10px] uppercase tracking-[0.1em]">Duplicate Pressure</p>
        <p className="mt-1 text-lg font-bold">{summary.groupCount} Groups</p>
        <p className="mt-1 text-[11px] text-fg/85">{summary.duplicateFileCount} files | {summary.estimatedWasteLabel} potential waste</p>
      </div>

      {visibleTop.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded border border-dashed border-white/20 text-xs text-fg/50">
          No duplicates currently detected.
        </div>
      ) : (
        <div className="space-y-4 rounded-md border border-line bg-white/[0.04] p-5">
          {visibleTop.map((group) => (
            <div key={group.name} className="border-b border-line py-3 last:border-b-0">
              <p className="truncate text-xs font-semibold text-fg/88">{group.name}</p>
              <p className="text-[10px] uppercase tracking-[0.08em] text-fg/50">{group.fileCount} files | {group.sizeLabel}</p>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onOpenDuplicates}
        className="mt-auto rounded-md border border-line bg-white/[0.04] px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg hover:border-line-strong"
      >
        Open Duplicates
      </button>
    </div>
  );
}

export default DuplicatePressureWidget;
