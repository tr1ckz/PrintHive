import React from 'react';

interface CardProps {
  children: React.ReactNode;
  /** Adds hover elevation + press feedback for clickable cards */
  interactive?: boolean;
  /** Accent ring + glow — reserved for "live/selected" signals */
  glow?: boolean;
  /** Remove default padding (e.g. for media that bleeds to the edge) */
  flush?: boolean;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

/**
 * The raised surface tier. Borderless by design: separation comes from
 * the bg shift + soft shadow. This is the single source of the card
 * recipe — pages must not re-derive it.
 */
const Card: React.FC<CardProps> = ({ children, interactive, glow, flush, className, onClick }) => (
  <div
    onClick={onClick}
    className={[
      'bg-card rounded-lg shadow-sm',
      flush ? '' : 'p-4 sm:p-5',
      interactive
        ? 'transition duration-200 ease-out hover:shadow-md hover:bg-surface-2 active:scale-[0.99] cursor-pointer'
        : '',
      glow ? 'ring-1 ring-accent/30 shadow-glow' : '',
      className || '',
    ]
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </div>
);

export default Card;
