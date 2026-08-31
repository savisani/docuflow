import React, { forwardRef } from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

const buttonStyles = {
  base: `
    inline-flex items-center justify-center gap-1.5
    font-medium rounded-lg
    transition-all duration-150
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900
    disabled:opacity-40 disabled:cursor-not-allowed
    select-none active:scale-[0.98]
  `,
  variant: {
    primary: `
      bg-indigo-600 hover:bg-indigo-500
      active:bg-indigo-700 text-white
      shadow-lg shadow-indigo-500/20
      focus-visible:ring-indigo-500
    `,
    secondary: `
      bg-slate-800/80 hover:bg-slate-700/80
      border border-slate-700/50 text-slate-200
      focus-visible:ring-indigo-500
    `,
    ghost: `
      bg-transparent hover:bg-white/5
      text-slate-400 hover:text-white
      focus-visible:ring-indigo-500
    `,
    danger: `
      bg-red-500/10 hover:bg-red-500/20
      text-red-400 border border-red-500/30
      focus-visible:ring-red-500
    `,
  },
  size: {
    sm: 'h-[28px] px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap',
    md: 'h-[32px] px-3 text-[12px]',
    lg: 'h-[36px] px-4 text-[13px]',
  },
  loading: 'relative pr-6',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', loading = false, icon, iconPosition = 'left', children, className = '', disabled, ...props }, ref) => {
    const isLoading = loading || disabled;
    return (
      <button
        ref={ref}
        disabled={isLoading}
        className={`
          ${buttonStyles.base}
          ${buttonStyles.variant[variant]}
          ${buttonStyles.size[size]}
          ${isLoading ? buttonStyles.loading : ''}
          ${className}
        `}
        {...props}
      >
        {isLoading ? (
          <svg className="absolute right-2 animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : icon && iconPosition === 'left' ? (
          <span className="flex-shrink-0">{icon}</span>
        ) : null}
        <span className={isLoading ? 'opacity-70' : ''}>{children}</span>
        {!isLoading && icon && iconPosition === 'right' && <span className="flex-shrink-0">{icon}</span>}
      </button>
    );
  }
);

Button.displayName = 'Button';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'secondary' | 'primary' | 'danger';
  'aria-label': string;
  children: React.ReactNode;
}

const iconButtonSizes = {
  sm: 'w-[24px] h-[24px]',
  md: 'w-[30px] h-[30px]',
  lg: 'w-[36px] h-[36px]',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'md', variant = 'ghost', 'aria-label': ariaLabel, children, className = '', ...props }, ref) => (
    <button
      ref={ref}
      aria-label={ariaLabel}
      className={`
        inline-flex items-center justify-center
        ${iconButtonSizes[size]}
        rounded-lg
        transition-all duration-150
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900
        disabled:opacity-40 disabled:cursor-not-allowed
        ${variant === 'ghost' && 'hover:bg-white/5 text-slate-400 hover:text-white focus-visible:ring-indigo-500'}
        ${variant === 'secondary' && 'bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/50 text-slate-200 focus-visible:ring-indigo-500'}
        ${variant === 'primary' && 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 focus-visible:ring-indigo-500'}
        ${variant === 'danger' && 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 focus-visible:ring-red-500'}
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  )
);

IconButton.displayName = 'IconButton';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = '', id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            w-full bg-slate-800/80 border border-slate-700/50
            rounded-lg px-2.5 py-1.5 text-[12px] text-slate-200
            placeholder:text-slate-500
            transition-all duration-150
            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 focus-visible:border-indigo-500
            disabled:bg-slate-900/50 disabled:text-slate-500
            ${error ? 'border-red-500 focus-visible:ring-red-500' : ''}
            ${className}
          `}
          {...props}
        />
        {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
        {hint && !error && <p className="mt-1 text-[10px] text-slate-500">{hint}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className = '', id, ...props }, ref) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={selectId} className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`
            w-full bg-slate-800/80 border border-slate-700/50
            rounded-lg px-2.5 py-1.5 text-[12px] text-slate-200
            appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")] bg-no-repeat bg-[right_8px center]
            pr-10
            transition-all duration-150
            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 focus-visible:border-indigo-500
            disabled:bg-slate-900/50 disabled:text-slate-500
            ${error ? 'border-red-500 focus-visible:ring-red-500' : ''}
            ${className}
          `}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';

export interface SectionProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export const Section: React.FC<SectionProps> = ({ title, icon, children, className = '', collapsible = false, defaultOpen = true }) => {
  const [open, setOpen] = React.useState(defaultOpen);
  if (!collapsible) {
    return (
      <div className={className}>
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-300 uppercase tracking-widest mb-2 pb-1.5 border-b border-white/5">
          {icon && <span>{icon}</span>}
          {title}
        </div>
        <div className="space-y-2">{children}</div>
      </div>
    );
  }
  return (
    <div className={className}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-1 py-1.5 text-left text-[10px] font-bold text-slate-300 uppercase tracking-widest hover:text-white transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-1.5">
          {icon && <span>{icon}</span>}
          {title}
        </div>
        <span className={`transition-transform duration-150 ${open ? 'rotate-0' : '-rotate-90'}`}>▶</span>
      </button>
      {open && <div className="mt-2 space-y-2 animate-slide-down">{children}</div>}
    </div>
  );
};

export interface TooltipProps {
  content: string;
  children: React.ReactElement;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, position = 'top', delay = 200 }) => {
  const [visible, setVisible] = React.useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>();

  const show = () => {
    timeoutRef.current = setTimeout(() => setVisible(true), delay);
  };
  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  };

  return (
    <div className="relative inline-block" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {React.cloneElement(children, { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide })}
      {visible && (
        <div
          className={`
            fixed z-[50] px-2.5 py-1.5 text-[11px] font-mono text-slate-200
            bg-slate-800 border border-slate-700/50 rounded-lg
            shadow-xl shadow-black/30 whitespace-nowrap max-w-xs
            animate-fade-in pointer-events-none
            ${positions[position]}
          `}
        >
          {content}
        </div>
      )}
    </div>
  );
};

export interface LabelValueProps {
  label: string;
  value: React.ReactNode;
  labelWidth?: string;
  valueClassName?: string;
}

export const LabelValue: React.FC<LabelValueProps> = ({ label, value, labelWidth = '80px', valueClassName = '' }) => (
  <div className="flex items-center gap-2">
    <label className="text-[11px] text-slate-400 shrink-0" style={{ width: labelWidth }}>{label}</label>
    <span className={`flex-1 text-[11px] text-slate-200 font-mono ${valueClassName}`}>{value}</span>
  </div>
);

export interface DividerProps {
  className?: string;
  vertical?: boolean;
}

export const Divider: React.FC<DividerProps> = ({ className = '', vertical = false }) => (
  <div
    className={`
      ${vertical ? 'w-px h-full' : 'h-px w-full'}
      bg-white/5
      ${className}
    `}
  />
);

export interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  children: React.ReactNode;
  className?: string;
}

const badgeVariants = {
  default: 'bg-slate-700/50 text-slate-300',
  success: 'bg-emerald-500/15 text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-400',
  error: 'bg-red-500/15 text-red-400',
  info: 'bg-indigo-500/15 text-indigo-400',
};

export const Badge: React.FC<BadgeProps> = ({ variant = 'default', children, className = '' }) => (
  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-medium ${badgeVariants[variant]} ${className}`}>
    {children}
  </span>
);

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  valueLabel?: boolean;
}

export const Slider: React.FC<SliderProps> = ({ label, valueLabel = true, min = 0, max = 1, step = 0.01, className = '', ...props }) => (
  <div className="w-full">
    {label && (
      <div className="flex items-center gap-2 mb-1">
        <label className="text-[11px] text-slate-400 shrink-0" style={{ width: '80px' }}>{label}</label>
      </div>
    )}
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        className="flex-1 h-1.5 bg-slate-700/50 rounded-full appearance-none cursor-pointer accent-indigo-500"
        {...props}
      />
      {valueLabel && (
        <span className="text-[11px] text-slate-300 font-mono w-10 text-right shrink-0">
          {props.value != null ? (props.value * 100).toFixed(0) + '%' : ''}
        </span>
      )}
    </div>
  </div>
);

export interface ToggleProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

export const Toggle: React.FC<ToggleProps> = ({ label, className = '', id, ...props }) => {
  const toggleId = id || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        id={toggleId}
        className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 transition-colors"
        {...props}
      />
      {label && <span className="text-[11px] text-slate-300">{label}</span>}
    </label>
  );
};

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const dialogSizes = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export const Dialog: React.FC<DialogProps> = ({ open, onClose, title, children, actions, size = 'md' }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[30] flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className={`relative ${dialogSizes[size]} w-full mx-4 bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl animate-slide-down flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <h2 className="text-[13px] font-semibold text-white">{title}</h2>
          <IconButton size="sm" variant="ghost" aria-label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </IconButton>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
        {actions && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/5">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
};

export interface DropdownProps {
  trigger: React.ReactElement;
  content: React.ReactNode;
  align?: 'left' | 'right';
}

export const Dropdown: React.FC<DropdownProps> = ({ trigger, content, align = 'left' }) => {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || contentRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block" onClick={() => setOpen(!open)}>
      {React.cloneElement(trigger, { ref: triggerRef, 'aria-expanded': open, 'aria-haspopup': 'true' })}
      {open && (
        <div
          ref={contentRef}
          className={`
            fixed z-[40] mt-1 min-w-[180px] bg-slate-800/95 backdrop-blur-xl border border-white/10
            rounded-xl shadow-2xl shadow-black/30 animate-slide-down overflow-hidden
            ${align === 'right' ? 'right-0' : 'left-0'}
          `}
        >
          {content}
        </div>
      )}
    </div>
  );
};

export interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  showButtons?: boolean;
}

export const NumberInput: React.FC<NumberInputProps> = ({ label, value, onChange, min, max, step = 1, showButtons = true, className = '', id, ...props }) => {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
  const clamp = (v: number) => {
    let clamped = v;
    if (min !== undefined) clamped = Math.max(min, clamped);
    if (max !== undefined) clamped = Math.min(max, clamped);
    return clamped;
  };
  const handleIncrement = () => onChange(clamp(value + step));
  const handleDecrement = () => onChange(clamp(value - step));
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseFloat(e.target.value);
    if (!isNaN(parsed)) onChange(clamp(parsed));
  };

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">
          {label}
        </label>
      )}
      <div className="flex items-stretch gap-0">
        {showButtons && (
          <button
            type="button"
            onClick={handleDecrement}
            className="px-1.5 bg-slate-800/80 border border-r-0 border-slate-700/50 rounded-l-lg text-slate-400 hover:text-white hover:bg-slate-700/80 transition-colors text-[10px] font-mono"
          >
            -
          </button>
        )}
        <input
          id={inputId}
          type="number"
          value={value}
          onChange={handleInputChange}
          min={min}
          max={max}
          step={step}
          className={`w-full bg-slate-800/80 border border-slate-700/50 text-center text-[11px] text-slate-200 font-mono
            placeholder:text-slate-500 transition-all duration-150
            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 focus-visible:border-indigo-500
            ${showButtons ? 'rounded-none border-l-0 border-r-0' : 'rounded-lg'}
            ${className}`}
          {...props}
        />
        {showButtons && (
          <button
            type="button"
            onClick={handleIncrement}
            className="px-1.5 bg-slate-800/80 border border-l-0 border-slate-700/50 rounded-r-lg text-slate-400 hover:text-white hover:bg-slate-700/80 transition-colors text-[10px] font-mono"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
};

NumberInput.displayName = 'NumberInput';

export interface TabsProps {
  tabs: { id: string; label: string; icon?: React.ReactNode }[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onChange, className = '' }) => (
  <div className={className}>
    <div className="flex border-b border-white/5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`
            flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium
            border-b-2 border-transparent
            transition-colors duration-150
            ${activeTab === tab.id
              ? 'text-indigo-400 border-indigo-500'
              : 'text-slate-400 hover:text-white hover:bg-white/5'}
          `}
        >
          {tab.icon && <span>{tab.icon}</span>}
          {tab.label}
        </button>
      ))}
    </div>
  </div>
);