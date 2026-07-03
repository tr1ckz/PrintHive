import React from 'react';

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: icon-only buttons must always be labelled */
  'aria-label': string;
  /** Visual weight */
  variant?: 'ghost' | 'surface' | 'accent';
  children: React.ReactNode;
}

const variantClass = {
  ghost: 'text-muted hover:text-fg hover:bg-white/5',
  surface: 'bg-surface-2 text-fg-soft hover:text-fg hover:bg-white/10',
  accent: 'bg-accent text-accent-contrast hover:bg-accent-strong',
} as const;

/**
 * Icon-only button that enforces the touch standard: 44px on mobile,
 * 36px on desktop where a pointer is precise.
 */
const IconButton: React.FC<IconButtonProps> = ({ variant = 'ghost', className, children, ...rest }) => (
  <button
    type="button"
    {...rest}
    className={[
      'inline-flex items-center justify-center size-11 md:size-9 rounded-md',
      'transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none',
      variantClass[variant],
      className || '',
    ]
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </button>
);

export default IconButton;
