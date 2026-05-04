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
            <article key={card.id} className="rounded-[4px] border border-neutral-800 bg-neutral-900 p-5">
              <p className="ops-secondary-text">{card.label}</p>
              <p className="mt-2 text-xl font-bold leading-tight text-white">{formatWeight(card.value)}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-[3px] border border-neutral-800 bg-neutral-950">
                <div
                  className="h-full bg-orange-500"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </article>
          );
        })}
      </div>

      <div className="rounded-[4px] border border-neutral-800 bg-neutral-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="ops-secondary-text">All-Time Filament Used</p>
          <p className="ops-tertiary-text">{Math.max(0, Math.min(100, Math.round(successSharePct)))}% successful</p>
        </div>
        <p className="mt-1.5 text-2xl font-bold leading-tight text-white">{formatWeight(allTimeWeight)}</p>
        <p className="mt-2 ops-tertiary-text">Based on {sampleSize} recent print records with weight data</p>
      </div>
    </div>
  );
}

export default MaterialUsageWidget;
