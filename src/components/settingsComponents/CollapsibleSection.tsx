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
    <div className={`settings-section collapsible ${isExpanded ? 'expanded' : ''}`}>
      <div className="section-header" onClick={() => setIsExpanded(!isExpanded)}>
        <h2>
          {icon && <span className="section-icon">{icon}</span>}
          {title}
        </h2>
        <span className="expand-icon">{isExpanded ? '−' : '+'}</span>
      </div>
      <div className="section-content">
        {children}
      </div>
    </div>
  );
}
