interface MaterialUsageWidgetProps {
  todayWeight: number;
  weekWeight: number;
  monthWeight: number;
  allTimeWeight: number;
  successSharePct: number;
  sampleSize: number;
}

function formatWeight(weight: number): string {
  const grams = Math.max(0, Number(weight || 0));
  if (grams >= 1000) {
    return `${(grams / 1000).toFixed(2)}kg`;
  }
  return `${Math.round(grams)}g`;
}

function MaterialUsageWidget({
  todayWeight,
  weekWeight,
  monthWeight,
  allTimeWeight,
  successSharePct,
  sampleSize,
}: MaterialUsageWidgetProps) {
  const maxWindowWeight = Math.max(todayWeight, weekWeight, monthWeight, 1);

  const cards = [
    { id: 'today', label: 'Today', value: todayWeight },
    { id: 'week', label: '7 Days', value: weekWeight },
    { id: 'month', label: '30 Days', value: monthWeight },
  ];

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((card) => {
          const widthPct = Math.max(8, Math.min(100, Math.round((card.value / maxWindowWeight) * 100)));
          return (
            <article key={card.id} className="rounded-md border border-line bg-white/[0.04] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">{card.label}</p>
              <p className="mt-2 text-xl font-bold leading-tight text-fg">{formatWeight(card.value)}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded border border-line-strong bg-white/10">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </article>
          );
        })}
      </div>

      <div className="rounded-md border border-line bg-white/[0.04] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">All-Time Filament Used</p>
          <p className="text-xs text-muted">{Math.max(0, Math.min(100, Math.round(successSharePct)))}% successful</p>
        </div>
        <p className="mt-1.5 text-2xl font-bold leading-tight text-fg">{formatWeight(allTimeWeight)}</p>
        <p className="mt-2 text-xs text-muted">Based on {sampleSize} recent print records with weight data</p>
      </div>
    </div>
  );
}

export default MaterialUsageWidget;
