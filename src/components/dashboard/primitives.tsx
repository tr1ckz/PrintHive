import React from 'react';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const toneText: Record<Tone, string> = {
  neutral: 'text-muted',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

const toneDot: Record<Tone, string> = {
  neutral: 'bg-disabled',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

const tonePill: Record<Tone, string> = {
  neutral: 'bg-white/5 text-muted',
  accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
};

/** Status dot. `pulse` is reserved for live states (printing, running). */
export function Dot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2 shrink-0" aria-hidden>
      {pulse ? <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${toneDot[tone]}`} /> : null}
      <span className={`relative inline-flex size-2 rounded-full ${toneDot[tone]}`} />
    </span>
  );
}

/** Dot + label: the single status vocabulary used by every dashboard widget. */
export function StatusLabel({ tone, pulse, children }: { tone: Tone; pulse?: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium tabular-nums ${toneText[tone]}`}>
      <Dot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}

/** Compact count/status pill for widget headers and row ends. */
export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 tabular-nums ${tonePill[tone]}`}>
      {children}
    </span>
  );
}

/** Empty state: one quiet line, never a placeholder box. */
export function EmptyLine({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted">
      <Dot tone={tone} />
      {children}
    </p>
  );
}

/** "+3 more" style footer for capped lists. */
export function MoreLine({ children }: { children: React.ReactNode }) {
  return <p className="pt-2 text-xs text-muted">{children}</p>;
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (value: T) => void;
}

/** Small filter switch. 32px targets, one track, no nested boxes. */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md bg-white/5 p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`min-h-8 rounded px-2.5 text-xs font-medium transition-colors ${
              selected ? 'bg-white/10 text-fg' : 'text-muted hover:text-fg'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
