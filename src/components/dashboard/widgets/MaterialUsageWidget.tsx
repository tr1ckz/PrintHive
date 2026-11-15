import ProgressBar from '../../common/ProgressBar';

interface MaterialUsageWidgetProps {
  todayWeight: number;
  weekWeight: number;
  monthWeight: number;
  allTimeWeight: number;
  successSharePct: number;
}

export function formatWeight(weight: number): string {
  const grams = Math.max(0, Number(weight || 0));
  if (grams >= 1000) {
    return `${(grams / 1000).toFixed(2)} kg`;
  }
  return `${Math.round(grams)} g`;
}

function MaterialUsageWidget({
  todayWeight,
  weekWeight,
  monthWeight,
  allTimeWeight,
  successSharePct,
}: MaterialUsageWidgetProps) {
  const maxWindowWeight = Math.max(todayWeight, weekWeight, monthWeight, 1);
  const successShare = Math.max(0, Math.min(100, Math.round(successSharePct)));

  const windows = [
    { id: 'today', label: 'Today', value: todayWeight },
    { id: 'week', label: '7 days', value: weekWeight },
    { id: 'month', label: '30 days', value: monthWeight },
  ];

  return (
    <div>
      <dl className="grid grid-cols-3 gap-4">
        {windows.map((item) => (
          <div key={item.id} className="min-w-0">
            <dt className="truncate text-xs text-muted">{item.label}</dt>
            <dd className="mt-0.5 truncate text-lg font-semibold leading-7 tracking-tight tabular-nums text-fg">{formatWeight(item.value)}</dd>
            <dd>
              <ProgressBar value={(item.value / maxWindowWeight) * 100} size="xs" className="mt-1" />
            </dd>
          </div>
        ))}
      </dl>

      <dl className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">All time</dt>
          <dd className="font-medium tabular-nums text-fg-soft">{formatWeight(allTimeWeight)}</dd>
        </div>
        {monthWeight > 0 ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="truncate text-muted">Went into successful prints (30 days)</dt>
            <dd className="shrink-0 font-medium tabular-nums text-fg-soft">{successShare}%</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

export default MaterialUsageWidget;
