import React from 'react';

interface SectionProps {
  title: React.ReactNode;
  /** Optional right-aligned actions (buttons, filters) */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * The flat tier: a page section separated by whitespace and a small
 * uppercase heading instead of a container. No borders, no boxes.
 */
const Section: React.FC<SectionProps> = ({ title, actions, children, className }) => (
  <section className={['space-y-3', className || ''].filter(Boolean).join(' ')}>
    <div className="flex items-center justify-between gap-3 min-h-11">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">{title}</h2>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
    {children}
  </section>
);

export default Section;
