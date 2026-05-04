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
  iconColor: string;
  borderColor: string;
}

function QuickStatsWidget({ printersOnlineLabel, totalPrints, successRate, libraryModels }: QuickStatsWidgetProps) {
  const cards: StatCard[] = [
    {
      key: 'online',
      label: 'Printers Online',
      value: printersOnlineLabel,
      icon: Printer,
      iconColor: 'text-emerald-400',
      borderColor: 'border-l-emerald-500/50',
    },
    {
      key: 'prints',
      label: 'Total Prints',
      value: `${totalPrints}`,
      icon: Trophy,
      iconColor: 'text-orange-400',
      borderColor: 'border-l-orange-500/50',
    },
    {
      key: 'success',
      label: 'Success Rate',
      value: `${successRate}%`,
      icon: CheckCircle2,
      iconColor: 'text-emerald-400',
      borderColor: 'border-l-emerald-500/50',
    },
    {
      key: 'library',
      label: 'Library Models',
      value: `${libraryModels}`,
      icon: BookOpen,
      iconColor: 'text-violet-400',
      borderColor: 'border-l-violet-500/50',
    },
  ];

  return (
    <div className="grid h-full grid-cols-1 gap-3 sm:grid-cols-2">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <article key={card.key} className={`ops-clickable-card rounded-[4px] border border-neutral-800 border-l-[3px] ${card.borderColor} bg-neutral-900 p-4`}>
            <div className="flex items-center justify-between gap-2">
              <p className="ops-secondary-text">{card.label}</p>
              <Icon className={`h-4 w-4 ${card.iconColor}`} />
            </div>
            <p className="ops-data-value mt-2 text-4xl font-bold leading-tight text-white">{card.value}</p>
          </article>
        );
      })}
    </div>
  );
}

export default QuickStatsWidget;
