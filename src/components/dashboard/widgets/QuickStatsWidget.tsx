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
}

function QuickStatsWidget({ printersOnlineLabel, totalPrints, successRate, libraryModels }: QuickStatsWidgetProps) {
  const cards: StatCard[] = [
    {
      key: 'online',
      label: 'Printers Online',
      value: printersOnlineLabel,
      icon: Printer,
    },
    {
      key: 'prints',
      label: 'Total Prints',
      value: `${totalPrints}`,
      icon: Trophy,
    },
    {
      key: 'success',
      label: 'Success Rate',
      value: `${successRate}%`,
      icon: CheckCircle2,
    },
    {
      key: 'library',
      label: 'Library Models',
      value: `${libraryModels}`,
      icon: BookOpen,
    },
  ];

  return (
    <div className="grid h-full grid-cols-1 gap-2 sm:grid-cols-2">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <article key={card.key} className="rounded-[4px] border border-neutral-800 bg-neutral-900 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="ops-secondary-text">{card.label}</p>
              <Icon className="h-4 w-4 text-neutral-500" />
            </div>
            <p className="mt-2 text-3xl font-bold leading-tight text-white">{card.value}</p>
          </article>
        );
      })}
    </div>
  );
}

export default QuickStatsWidget;
