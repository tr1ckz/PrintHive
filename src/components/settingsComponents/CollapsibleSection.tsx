import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface CollapsibleSectionProps {
  title: string;
  /** Legacy emoji marker. Accepted for compatibility but no longer rendered —
   *  section titles carry the meaning and the page stays calmer without it. */
  icon?: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

export function CollapsibleSection({ title, children, defaultExpanded = true }: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <section className="rounded-lg bg-card">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-4 text-left"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
        <ChevronDown
          className={`size-4 shrink-0 text-muted transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {isExpanded && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}
