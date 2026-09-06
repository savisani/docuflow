export type LogLevel = 'LOG' | 'DEBUG' | 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: unknown;
  source?: 'app' | 'console';
}

const MAX_ENTRIES = 2000;

class Logger {
  private entries: LogEntry[] = [];
  private listeners: Set<(entry: LogEntry) => void> = new Set();
  private isInterceptorSetup = false;
  private originalConsole: Record<string, Function> = {};

  private createEntry(level: LogLevel, message: string, data?: unknown, source: 'app' | 'console' = 'app'): LogEntry {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
      level,
      message,
      data,
      source,
    };
  }

  private addEntry(entry: LogEntry) {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
    this.listeners.forEach((listener) => listener(entry));
  }

  setupInterceptor() {
    if (this.isInterceptorSetup || typeof window === 'undefined') return;

    const levels: LogLevel[] = ['LOG', 'DEBUG', 'INFO', 'WARN', 'ERROR'];

    levels.forEach((level) => {
      const method = level === 'LOG' ? 'log' : level.toLowerCase();
      if (method in console && typeof console[method as keyof typeof console] === 'function') {
        this.originalConsole[method] = console[method as keyof typeof console].bind(console);
      }
    });

    const self = this;

    console.log = function(...args: unknown[]) {
      self.originalConsole.log?.apply(console, args);
      const { message, data } = self.parseConsoleArgs(args);
      self.addEntry(self.createEntry('LOG', message, data, 'console'));
    };

    console.debug = function(...args: unknown[]) {
      self.originalConsole.debug?.apply(console, args);
      const { message, data } = self.parseConsoleArgs(args);
      self.addEntry(self.createEntry('DEBUG', message, data, 'console'));
    };

    console.info = function(...args: unknown[]) {
      self.originalConsole.info?.apply(console, args);
      const { message, data } = self.parseConsoleArgs(args);
      self.addEntry(self.createEntry('INFO', message, data, 'console'));
    };

    console.warn = function(...args: unknown[]) {
      self.originalConsole.warn?.apply(console, args);
      const { message, data } = self.parseConsoleArgs(args);
      self.addEntry(self.createEntry('WARN', message, data, 'console'));
    };

    console.error = function(...args: unknown[]) {
      self.originalConsole.error?.apply(console, args);
      const { message, data } = self.parseConsoleArgs(args);
      self.addEntry(self.createEntry('ERROR', message, data, 'console'));
    };

    this.isInterceptorSetup = true;
  }

  private parseConsoleArgs(args: unknown[]): { message: string; data?: unknown } {
    if (args.length === 0) return { message: '' };
    if (args.length === 1) {
      const arg = args[0];
      if (typeof arg === 'string') return { message: arg };
      return { message: this.stringify(arg), data: arg };
    }
    const message = args.map((a) => (typeof a === 'string' ? a : this.stringify(a))).join(' ');
    const data = args.length > 1 ? args : undefined;
    return { message, data };
  }

  private stringify(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  debug(message: string, data?: unknown) {
    const entry = this.createEntry('DEBUG', message, data);
    this.addEntry(entry);
  }

  info(message: string, data?: unknown) {
    const entry = this.createEntry('INFO', message, data);
    this.addEntry(entry);
  }

  log(message: string, data?: unknown) {
    const entry = this.createEntry('LOG', message, data);
    this.addEntry(entry);
  }

  success(message: string, data?: unknown) {
    const entry = this.createEntry('SUCCESS', message, data);
    this.addEntry(entry);
  }

  warn(message: string, data?: unknown) {
    const entry = this.createEntry('WARN', message, data);
    this.addEntry(entry);
  }

  error(message: string, error?: unknown) {
    let data: unknown = error;
    if (error instanceof Error) {
      data = { message: error.message, stack: error.stack, name: error.name };
    } else if (error !== undefined) {
      data = error;
    }
    const entry = this.createEntry('ERROR', message, data);
    this.addEntry(entry);
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear() {
    this.entries = [];
  }
}

export const logger = new Logger();

export const appConsole = {
  log: (message: string, data?: unknown) => logger.log(message, data),
  debug: (message: string, data?: unknown) => logger.debug(message, data),
  info: (message: string, data?: unknown) => logger.info(message, data),
  success: (message: string, data?: unknown) => logger.success(message, data),
  warn: (message: string, data?: unknown) => logger.warn(message, data),
  error: (message: string, error?: unknown) => logger.error(message, error),
};
