import React from 'react';

interface AmsTrayProps {
  slot: number | string;
  color: string | null;
  type?: string | null;
  subBrands?: string | null;
  remain?: number | null;
  humidity?: number | null;
  active?: boolean;
}

/**
 * One AMS filament slot: color-filled remain bar + quiet metadata.
 * Active slot gets the accent ring signal (never a hard border).
 */
const AmsTray: React.FC<AmsTrayProps> = ({ slot, color, type, subBrands, remain, humidity, active }) => {
  const colorHex = color ? `#${color.substring(0, 6)}` : 'var(--text-disabled)';
  const remainPercent = remain != null && remain >= 0 ? remain : null;

  return (
    <div className={`rounded-md bg-white/[0.03] p-2.5 ${active ? 'ring-1 ring-accent/40' : ''}`}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted">
          {/* Filament color swatch — ringed so white/empty spools stay legible */}
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"
            style={{ background: colorHex }}
          />
          Slot {slot}
        </span>
        <strong className="tabular-nums text-fg-soft">{remainPercent != null ? `${remainPercent}%` : '—'}</strong>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full"
          style={{
            background: colorHex,
            width: remainPercent != null ? `${remainPercent <= 0 ? 0 : Math.max(remainPercent, 6)}%` : '100%',
          }}
        />
      </div>
      <div className="mt-1.5 truncate text-xs font-medium text-fg-soft">{subBrands || type || 'Empty'}</div>
      <div className="flex items-center gap-1 text-xs text-muted">
        {typeof humidity === 'number' ? (
          <>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden className="shrink-0">
              <path d="M12 3s6 6.5 6 10.5A6 6 0 016 13.5C6 9.5 12 3 12 3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="tabular-nums">{Math.round(humidity)}%</span>
          </>
        ) : (
          'Humidity —'
        )}
      </div>
    </div>
  );
};

export default AmsTray;
