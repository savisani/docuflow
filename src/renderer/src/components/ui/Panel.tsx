import React from 'react';

export interface PanelProps {
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerActions?: React.ReactNode;
}

export const Panel: React.FC<PanelProps> = ({ title, icon, children, className = '', headerActions }) => (
  <div className={`flex flex-col h-full bg-df-surface-1 border border-df-border ${className}`}>
    {(title || headerActions) && (
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-df-divider shrink-0">
        {title && (
          <div className="flex items-center gap-1.5 text-df-xs font-medium text-df-text-muted uppercase tracking-wider">
            {icon && <span className="text-df-text-muted">{icon}</span>}
            {title}
          </div>
        )}
        {headerActions && <div className="flex items-center gap-0.5">{headerActions}</div>}
      </div>
    )}
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</div>
  </div>
);
