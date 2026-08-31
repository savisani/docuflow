import React from 'react';

export interface PanelProps {
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerActions?: React.ReactNode;
}

export const Panel: React.FC<PanelProps> = ({ title, icon, children, className = '', headerActions }) => (
  <div className={`flex flex-col h-full bg-slate-900/60 backdrop-blur-xl border border-white/5 shadow-2xl rounded-xl ${className}`}>
    {(title || headerActions) && (
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0">
        {title && (
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            {icon && <span>{icon}</span>}
            {title}
          </div>
        )}
        {headerActions && <div className="flex items-center gap-1">{headerActions}</div>}
      </div>
    )}
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</div>
  </div>
);
