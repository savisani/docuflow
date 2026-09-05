/**
 * Centralized logger for DocuFlow.
 *
 * Wraps console.* with structured levels, timestamps, and context.
 * No external dependencies.
 *
 * Usage:
 * ```ts
 * const log = createLogger('scene-gen');
 * log.info('Starting generation', { prompt: 'a forest', width: 512 });
 * log.error('Generation failed', { error: err, retries: 2 });
 * ```
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let globalMinLevel: LogLevel = 'debug';

/**
 * Set the minimum log level globally.
 * Messages below this level are discarded.
 */
export function setLogLevel(level: LogLevel): void {
  globalMinLevel = level;
}

/**
 * Get the current minimum log level.
 */
export function getLogLevel(): LogLevel {
  return globalMinLevel;
}

/**
 * Format a timestamp for log output.
 */
function formatTimestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

/**
 * Sanitize a context object for safe logging.
 * Removes sensitive keys and truncates long values.
 */
function sanitizeContext(
  context: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!context || Object.keys(context).length === 0) return undefined;

  const SENSITIVE_KEYS = new Set([
    'token', 'apikey', 'api_key', 'secret', 'password',
    'credential', 'authorization', 'auth', 'accesstoken',
    'access_token', 'refreshtoken', 'refresh_token',
  ]);

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 200) {
      sanitized[key] = value.slice(0, 200) + '...[truncated]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Create a logger with a fixed tag (module/component name).
 *
 * The tag is prepended to all messages for easy filtering.
 */
export function createLogger(tag: string) {
  return {
    debug(message: string, context?: Record<string, unknown>): void {
      if (LOG_LEVELS[globalMinLevel] > LOG_LEVELS.debug) return;
      const ctx = sanitizeContext(context);
      const prefix = `[${formatTimestamp()}] [DEBUG] [${tag}]`;
      if (ctx) {
        console.debug(prefix, message, ctx);
      } else {
        console.debug(prefix, message);
      }
    },

    info(message: string, context?: Record<string, unknown>): void {
      if (LOG_LEVELS[globalMinLevel] > LOG_LEVELS.info) return;
      const ctx = sanitizeContext(context);
      const prefix = `[${formatTimestamp()}] [INFO] [${tag}]`;
      if (ctx) {
        console.log(prefix, message, ctx);
      } else {
        console.log(prefix, message);
      }
    },

    warn(message: string, context?: Record<string, unknown>): void {
      if (LOG_LEVELS[globalMinLevel] > LOG_LEVELS.warn) return;
      const ctx = sanitizeContext(context);
      const prefix = `[${formatTimestamp()}] [WARN] [${tag}]`;
      if (ctx) {
        console.warn(prefix, message, ctx);
      } else {
        console.warn(prefix, message);
      }
    },

    error(message: string, context?: Record<string, unknown>): void {
      if (LOG_LEVELS[globalMinLevel] > LOG_LEVELS.error) return;
      const ctx = sanitizeContext(context);
      const prefix = `[${formatTimestamp()}] [ERROR] [${tag}]`;
      if (ctx) {
        console.error(prefix, message, ctx);
      } else {
        console.error(prefix, message);
      }
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
