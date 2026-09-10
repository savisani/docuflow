// ── Error Formatting for Clipboard ──────────────────────────────

export interface ErrorCopyData {
  title: string;
  details?: string;
  stack?: string;
  context?: string;
  rawResponse?: string;
  additionalInfo?: Record<string, string>;
}

/**
 * Formats error data into a readable multi-line string for clipboard.
 * Preserves line breaks and formatting for direct paste into ChatGPT/OpenCode.
 * Sanitizes sensitive information before copying.
 */
export function formatErrorForClipboard(data: ErrorCopyData): string {
  const lines: string[] = [];
  
  // Title/error message
  lines.push(`Error: ${data.title}`);
  lines.push('');
  
  // Details (validation errors, parse errors, etc.)
  if (data.details) {
    lines.push('Details:');
    lines.push(data.details);
    lines.push('');
  }
  
  // Additional context
  if (data.context) {
    lines.push('Context:');
    lines.push(data.context);
    lines.push('');
  }
  
  // Additional info fields
  if (data.additionalInfo) {
    for (const [key, value] of Object.entries(data.additionalInfo)) {
      if (value) {
        lines.push(`${key}: ${value}`);
      }
    }
    lines.push('');
  }
  
  // Stack trace (sanitize any file paths that might contain sensitive info)
  if (data.stack) {
    lines.push('Stack Trace:');
    lines.push(sanitizeStackTrace(data.stack));
    lines.push('');
  }
  
  // Raw response (e.g., from AI) - only if not too large
  if (data.rawResponse && data.rawResponse.length < 5000) {
    lines.push('--- Raw Response ---');
    lines.push(data.rawResponse);
    lines.push('--- End Raw Response ---');
  }
  
  return lines.join('\n').trim();
}

/**
 * Sanitizes stack traces by removing potential sensitive information
 * like full file paths, environment variables, or API keys.
 */
function sanitizeStackTrace(stack: string): string {
  return stack
    // Remove absolute paths but keep relative structure
    .replace(/(?:[A-Z]:\\|\/)Users\/[^/\\]+/gi, '<USER>')
    .replace(/(?:[A-Z]:\\|\/)home\/[^/\\]+/gi, '<USER>')
    // Remove any potential API keys or tokens (long alphanumeric strings)
    .replace(/(?:key|token|secret|password|auth)[=:]\s*['"]?[A-Za-z0-9._-]{20,}['"]?/gi, '$1=<REDACTED>')
    // Remove environment variable values that look like secrets
    .replace(/process\.env\.\w+\s*=\s*['"][^'"]+['"]/gi, 'process.env.<VAR>=<REDACTED>');
}

/**
 * Copies error data to clipboard with fallback.
 * Returns { success, error? } for UI feedback.
 */
export async function copyErrorToClipboard(data: ErrorCopyData): Promise<{ success: boolean; error?: string }> {
  try {
    const text = formatErrorForClipboard(data);
    
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return { success: true };
    }
    
    // Fallback for older browsers or non-secure contexts
    return fallbackCopyToClipboard(text);
  } catch (err) {
    // Try fallback if modern API fails
    const text = formatErrorForClipboard(data);
    return fallbackCopyToClipboard(text);
  }
}

/**
 * Fallback clipboard copy using textarea element.
 * Used when navigator.clipboard is not available (e.g., non-HTTPS).
 */
function fallbackCopyToClipboard(text: string): { success: boolean; error?: string } {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    
    if (success) {
      return { success: true };
    } else {
      return { success: false, error: 'Copy command failed' };
    }
  } catch (err) {
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Failed to copy to clipboard' 
    };
  }
}

/**
 * Creates a simple error copy data structure from a message string.
 * Useful for simple error messages without additional context.
 */
export function createSimpleErrorData(message: string, details?: string): ErrorCopyData {
  return {
    title: message,
    details,
  };
}

/**
 * Creates error copy data from multiple validation errors.
 */
export function createValidationErrorData(
  errors: Array<{ line?: number; message: string } | string>,
  context?: string
): ErrorCopyData {
  const details = errors
    .map(err => {
      if (typeof err === 'string') return err;
      return err.line ? `Line ${err.line}: ${err.message}` : err.message;
    })
    .join('\n');
  
  return {
    title: 'Validation Error',
    details,
    context,
  };
}