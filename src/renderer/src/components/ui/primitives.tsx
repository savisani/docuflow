import React, { forwardRef } from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

const buttonBase = `
  inline-flex items-center justify-center gap-1.5
  font-medium rounded-df-md
  transition-all duration-df-fast ease-df-out
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-df-accent
  disabled:opacity-30 disabled:cursor-not-allowed
  select-none active:scale-[0.97]
`;

const buttonVariants = {
  primary: `
    bg-df-accent hover:bg-df-accent-hover
    active:bg-df-accent-active text-white
    shadow-df-subtle
  `,
  secondary: `
    bg-df-surface-2 hover:bg-df-surface-3
    border border-df-border text-df-text-primary
    hover:border-df-border-strong
  `,
  ghost: `
    bg-transparent hover:bg-df-violet-muted
    text-df-text-secondary hover:text-df-text-primary
  `,
  danger: `
    bg-df-error-muted hover:bg-df-error/20
    text-df-error border border-df-error/30
  `,
};

const buttonSizes = {
  sm: 'h-[24px] px-2 py-1 text-df-xs rounded-df-sm',
  md: 'h-[28px] px-2.5 text-df-sm',
  lg: 'h-[32px] px-3 text-df-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', loading = false, icon, iconPosition = 'left', children, className = '', disabled, ...props }, ref) => {
    const isLoading = loading || disabled;
    return (
      <button
        ref={ref}
        disabled={isLoading}
        className={`${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${isLoading ? 'relative pr-6' : ''} ${className}`}
        {...props}
      >
        {isLoading ? (
          <svg className="absolute right-2 animate-spin h-3 w-3 opacity-60" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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
  md: 'w-[28px] h-[28px]',
  lg: 'w-[32px] h-[32px]',
};

const iconButtonVariants = {
  ghost: 'hover:bg-df-violet-muted text-df-text-secondary hover:text-df-text-primary',
  secondary: 'bg-df-surface-2 hover:bg-df-surface-3 border border-df-border text-df-text-primary',
  primary: 'bg-df-accent hover:bg-df-accent-hover text-white',
  danger: 'bg-df-error-muted hover:bg-df-error/20 text-df-error border border-df-error/30',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'md', variant = 'ghost', 'aria-label': ariaLabel, children, className = '', ...props }, ref) => (
    <button
      ref={ref}
      aria-label={ariaLabel}
      className={`
        inline-flex items-center justify-center
        ${iconButtonSizes[size]}
        rounded-df-md
        transition-all duration-df-fast ease-df-out
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-df-accent
        disabled:opacity-30 disabled:cursor-not-allowed
        active:scale-[0.97]
        ${iconButtonVariants[variant]}
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
          <label htmlFor={inputId} className="block text-df-xs font-medium text-df-text-muted mb-1">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            w-full bg-df-surface-2 border border-df-border
            rounded-df-md px-2 py-1 text-df-sm text-df-text-primary
            placeholder:text-df-text-dim
            transition-all duration-df-fast ease-df-out
            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-df-accent focus-visible:border-df-accent
            disabled:bg-df-surface-1 disabled:text-df-text-muted
            ${error ? 'border-df-error focus-visible:ring-df-error' : ''}
            ${className}
          `}
          {...props}
        />
        {error && <p className="mt-1 text-df-xs text-df-error">{error}</p>}
        {hint && !error && <p className="mt-1 text-df-xs text-df-text-dim">{hint}</p>}
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
          <label htmlFor={selectId} className="block text-df-xs font-medium text-df-text-muted mb-1">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`
            w-full bg-df-surface-2 border border-df-border
            rounded-df-md px-2 py-1 text-df-sm text-df-text-primary
            appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235c5c78' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")] bg-no-repeat bg-[right_6px center]
            pr-8
            transition-all duration-df-fast ease-df-out
            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-df-accent focus-visible:border-df-accent
            disabled:bg-df-surface-1 disabled:text-df-text-muted
            ${error ? 'border-df-error focus-visible:ring-df-error' : ''}
            ${className}
          `}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {error && <p className="mt-1 text-df-xs text-df-error">{error}</p>}
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
        <div className="flex items-center gap-1.5 text-df-xs font-semibold text-df-text-muted mb-1.5 pb-1 border-b border-df-divider">
          {icon && <span className="text-df-text-muted">{icon}</span>}
          {title}
        </div>
        <div className="space-y-1.5">{children}</div>
      </div>
    );
  }
  return (
    <div className={className}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-0.5 py-1 text-left text-df-xs font-semibold text-df-text-muted hover:text-df-text-primary transition-colors duration-df-fast"
        aria-expanded={open}
      >
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-df-text-muted">{icon}</span>}
          {title}
        </div>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-df-text-muted transition-transform duration-df-fast ${open ? 'rotate-0' : '-rotate-90'}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="mt-1 space-y-1.5 animate-slide-down">{children}</div>}
    </div>
  );
};

export interface TooltipProps {
  content: string;
  children: React.ReactElement;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, position = 'top', delay = 400 }) => {
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
            fixed z-50 px-2 py-1 text-df-xs text-df-text-secondary
            bg-df-surface-3 border border-df-border rounded-df-sm
            shadow-df-medium whitespace-nowrap max-w-xs
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

export const LabelValue: React.FC<LabelValueProps> = ({ label, value, labelWidth = '72px', valueClassName = '' }) => (
  <div className="flex items-center gap-2">
    <label className="text-df-xs text-df-text-muted shrink-0" style={{ width: labelWidth }}>{label}</label>
    <span className={`flex-1 text-df-xs text-df-text-primary font-mono ${valueClassName}`}>{value}</span>
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
      bg-df-divider
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
  default: 'bg-df-surface-3 text-df-text-secondary',
  success: 'bg-df-success-muted text-df-success',
  warning: 'bg-df-warning-muted text-df-warning',
  error: 'bg-df-error-muted text-df-error',
  info: 'bg-df-accent-muted text-df-accent',
};

export const Badge: React.FC<BadgeProps> = ({ variant = 'default', children, className = '' }) => (
  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-df-xs text-df-xs font-medium ${badgeVariants[variant]} ${className}`}>
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
        <label className="text-df-xs text-df-text-muted shrink-0" style={{ width: '72px' }}>{label}</label>
      </div>
    )}
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        className="flex-1 h-1 bg-df-surface-3 rounded-full appearance-none cursor-pointer accent-df-accent"
        {...props}
      />
      {valueLabel && (
        <span className="text-df-xs text-df-text-secondary font-mono w-10 text-right shrink-0">
          {props.value != null ? (Number(props.value) * 100).toFixed(0) + '%' : ''}
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
        className="w-3 h-3 rounded border-df-border-strong bg-df-surface-2 text-df-accent focus-visible:ring-2 focus-visible:ring-df-accent focus-visible:ring-offset-1 focus-visible:ring-offset-df-bg transition-colors"
        {...props}
      />
      {label && <span className="text-df-xs text-df-text-secondary">{label}</span>}
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
    <div className="fixed inset-0 z-30 flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80" />
      <div className={`relative ${dialogSizes[size]} w-full mx-4 bg-df-surface-1 border border-df-border rounded-df-lg shadow-df-heavy animate-scale-in flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-df-divider">
          <h2 className="text-df-md font-semibold text-df-text-primary">{title}</h2>
          <IconButton size="sm" variant="ghost" aria-label="Close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </IconButton>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
        {actions && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-df-divider">
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
            fixed z-40 mt-1 min-w-[160px] bg-df-surface-2 border border-df-border
            rounded-df-lg shadow-df-heavy animate-slide-down overflow-hidden
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
        <label htmlFor={inputId} className="block text-df-xs font-medium text-df-text-muted mb-1">
          {label}
        </label>
      )}
      <div className="flex items-stretch gap-0">
        {showButtons && (
          <button
            type="button"
            onClick={handleDecrement}
            className="px-1.5 bg-df-surface-2 border border-df-border border-r-0 rounded-l-df-md text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-3 transition-colors text-df-xs font-mono"
          >
            −
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
          className={`w-full bg-df-surface-2 border border-df-border text-center text-df-xs text-df-text-primary font-mono
            placeholder:text-df-text-dim transition-all duration-df-fast ease-df-out
            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-df-accent focus-visible:border-df-accent
            ${showButtons ? 'rounded-none border-l-0 border-r-0' : 'rounded-df-md'}
            ${className}`}
          {...props}
        />
        {showButtons && (
          <button
            type="button"
            onClick={handleIncrement}
            className="px-1.5 bg-df-surface-2 border border-df-border border-l-0 rounded-r-df-md text-df-text-muted hover:text-df-text-primary hover:bg-df-surface-3 transition-colors text-df-xs font-mono"
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
    <div className="flex border-b border-df-divider">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`
            flex items-center gap-1.5 px-2.5 py-1.5 text-df-xs font-medium
            border-b-2 transition-colors duration-df-fast
            ${activeTab === tab.id
              ? 'text-df-accent border-df-accent'
              : 'text-df-text-muted border-transparent hover:text-df-text-primary hover:bg-df-violet-muted'}
          `}
        >
          {tab.icon && <span className="text-df-text-muted">{tab.icon}</span>}
          {tab.label}
        </button>
      ))}
    </div>
  </div>
);
