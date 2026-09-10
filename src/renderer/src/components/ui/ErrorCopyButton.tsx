import React, { useState, useCallback } from 'react';
import { Copy, Check, AlertCircle } from 'lucide-react';
import { copyErrorToClipboard, type ErrorCopyData } from '../../utils/errorUtils';

export interface ErrorCopyButtonProps {
  /** Error data to copy */
  errorData: ErrorCopyData;
  /** Optional custom label */
  label?: string;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Additional CSS classes */
  className?: string;
  /** Callback when copy completes (success or failure) */
  onCopyComplete?: (success: boolean) => void;
}

/**
 * Reusable button component for copying error information to clipboard.
 * Shows copy/check icon with auto-reset feedback.
 * 
 * Usage:
 * ```tsx
 * <ErrorCopyButton 
 *   errorData={{ title: 'Error message', details: 'Additional info' }}
 *   size="sm"
 * />
 * ```
 */
export const ErrorCopyButton: React.FC<ErrorCopyButtonProps> = ({
  errorData,
  label = 'Copy',
  size = 'sm',
  className = '',
  onCopyComplete,
}) => {
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  
  const handleClick = useCallback(async () => {
    if (copyState !== 'idle') return; // Prevent double-clicks during feedback
    
    const result = await copyErrorToClipboard(errorData);
    
    if (result.success) {
      setCopyState('success');
      setTimeout(() => setCopyState('idle'), 2000);
    } else {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 3000);
    }
    
    onCopyComplete?.(result.success);
  }, [errorData, copyState, onCopyComplete]);
  
  const sizeClasses = size === 'sm' 
    ? 'px-1.5 py-0.5 text-[10px] gap-1' 
    : 'px-2 py-1 text-xs gap-1.5';
  
  const iconSize = size === 'sm' ? 10 : 12;
  
  return (
    <button
      onClick={handleClick}
      disabled={copyState !== 'idle'}
      className={`
        inline-flex items-center justify-center
        rounded-df-sm font-medium
        transition-all duration-150
        ${sizeClasses}
        ${copyState === 'success' 
          ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
          : copyState === 'error'
            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
            : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/80 border border-white/10'
        }
        disabled:cursor-default
        ${className}
      `}
      title={copyState === 'success' ? 'Copied!' : copyState === 'error' ? 'Copy failed' : 'Copy error to clipboard'}
    >
      {copyState === 'success' ? (
        <>
          <Check size={iconSize} className="text-green-400" />
          <span>Copied</span>
        </>
      ) : copyState === 'error' ? (
        <>
          <AlertCircle size={iconSize} className="text-red-400" />
          <span>Failed</span>
        </>
      ) : (
        <>
          <Copy size={iconSize} />
          <span>{label}</span>
        </>
      )}
    </button>
  );
};

export default ErrorCopyButton;