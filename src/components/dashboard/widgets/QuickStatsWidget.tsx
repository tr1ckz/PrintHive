import { BookOpen, CheckCircle2, Printer, Trophy } from 'lucide-react';

interface QuickStatsWidgetProps {
  printersOnlineLabel: string;
  totalPrints: number;
  successRate: number;
  libraryModels: number;
}

interface StatCard {
  key: string;
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'blue' | 'green' | 'amber' | 'violet';
}

const toneClassMap: Record<StatCard['tone'], string> = {
  blue: 'border-cyan-400/35 bg-cyan-500/12 text-cyan-100',
  green: 'border-emerald-400/35 bg-emerald-500/12 text-emerald-100',
  amber: 'border-amber-400/35 bg-amber-500/12 text-amber-100',
  violet: 'border-violet-400/35 bg-violet-500/12 text-violet-100',
};

function QuickStatsWidget({ printersOnlineLabel, totalPrints, successRate, libraryModels }: QuickStatsWidgetProps) {
  const cards: StatCard[] = [
    {
      key: 'online',
      label: 'Printers Online',
      value: printersOnlineLabel,
      icon: Printer,
      tone: 'blue',
    },
    {
      key: 'prints',
      label: 'Total Prints',
      value: `${totalPrints}`,
      icon: Trophy,
      tone: 'green',
    },
    {
      key: 'success',
      label: 'Success Rate',
      value: `${successRate}%`,
      icon: CheckCircle2,
      tone: 'amber',
    },
    {
      key: 'library',
      label: 'Library Models',
      value: `${libraryModels}`,
      icon: BookOpen,
      tone: 'violet',
    },
  ];

  return (
    <div className="grid h-full grid-cols-1 gap-3 sm:grid-cols-2">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <article key={card.key} className={`rounded border px-3.5 py-3 ${toneClassMap[card.tone]}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em]">{card.label}</p>
              <Icon className="h-4 w-4 opacity-90" />
            </div>
            <p className="mt-2 text-2xl font-bold leading-none text-white">{card.value}</p>
          </article>
        );
      })}
    </div>
  );
}

export default QuickStatsWidget;
