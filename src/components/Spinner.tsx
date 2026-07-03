import React from 'react';

interface SpinnerProps {
  size?: 'small' | 'medium' | 'large';
  color?: string;
  message?: string;
}

const sizeClass = {
  small: 'size-6 border-2',
  medium: 'size-10 border-[3px]',
  large: 'size-16 border-4',
} as const;

const Spinner: React.FC<SpinnerProps> = ({ size = 'medium', color, message }) => (
  <div className="flex flex-col items-center justify-center gap-3 p-6">
    <div
      className={`${sizeClass[size]} rounded-full border-transparent border-t-accent animate-[ph-spin_0.8s_linear_infinite]`}
      style={color ? { borderTopColor: color } : undefined}
      role="status"
      aria-label={message || 'Loading'}
    />
    {message && <p className="text-sm text-muted">{message}</p>}
  </div>
);

export default Spinner;
