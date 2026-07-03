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
      iconColor: 'text-success',
      borderColor: 'border-l-success/50',
    },
    {
      key: 'prints',
      label: 'Total Prints',
      value: `${totalPrints}`,
      icon: Trophy,
      iconColor: 'text-accent',
      borderColor: 'border-l-accent/50',
    },
    {
      key: 'success',
      label: 'Success Rate',
      value: `${successRate}%`,
      icon: CheckCircle2,
      iconColor: 'text-success',
      borderColor: 'border-l-success/50',
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
    <div className="grid h-full grid-cols-1 gap-2 sm:grid-cols-2">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <article key={card.key} className={`transition-colors hover:bg-white/[0.06] rounded-md border border-line border-l-[3px] ${card.borderColor} bg-white/[0.04] p-2.5`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">{card.label}</p>
              <Icon className={`h-4 w-4 ${card.iconColor}`} />
            </div>
            <p className="mt-1 text-4xl font-bold leading-tight text-fg">{card.value}</p>
          </article>
        );
      })}
    </div>
  );
}

export default QuickStatsWidget;
