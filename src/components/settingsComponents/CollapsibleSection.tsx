import { useState } from 'react';

interface CollapsibleSectionProps {
  title: string;
  icon?: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

export function CollapsibleSection({ title, icon, children, defaultExpanded = true }: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <section className="rounded-lg bg-card shadow-sm">
      <button
        type="button"
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          {icon && <span aria-hidden="true">{icon}</span>}
          {title}
        </h2>
        <span className="text-lg leading-none text-muted" aria-hidden="true">{isExpanded ? '−' : '+'}</span>
      </button>
      {isExpanded && (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          {children}
        </div>
      )}
    </section>
  );
}
