import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { X, Trash2, Search, ChevronDown, ChevronRight, Copy, Check, Terminal, GripHorizontal } from 'lucide-react';
import { useConsoleStore, ConsoleFilter } from './ConsoleStore';
import { logger, LogEntry, LogLevel } from '../../services/logger';

const LEVEL_STYLES: Record<LogLevel, { bg: string; text: string; label: string }> = {
  LOG: { bg: 'bg-df-surface-2', text: 'text-df-text-primary', label: 'LOG' },
  DEBUG: { bg: 'bg-df-surface-2', text: 'text-df-text-muted', label: 'DEBUG' },
  INFO: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'INFO' },
  SUCCESS: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'SUCCESS' },
  WARN: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'WARN' },
  ERROR: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'ERROR' },
};

const SOURCE_STYLES: Record<string, { badge: string }> = {
  app: { badge: 'bg-purple-500/20 text-purple-400' },
  console: { badge: 'bg-cyan-500/20 text-cyan-400' },
};

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

interface ObjectNodeProps {
  value: unknown;
  depth: number;
  name?: string;
  isLast?: boolean;
}

function ObjectNode({ value, depth, name, isLast = false }: ObjectNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);

  if (value === null) {
    return (
      <div className="pl-4" style={{ paddingLeft: depth * 16 }}>
        <span className="text-df-text-muted">{name && <span className="text-cyan-400">{name}: </span>}</span>
        <span className="text-amber-400">null</span>
        {!isLast && <span className="text-df-text-muted">,</span>}
      </div>
    );
  }

  if (value === undefined) {
    return (
      <div className="pl-4" style={{ paddingLeft: depth * 16 }}>
        <span className="text-df-text-muted">{name && <span className="text-cyan-400">{name}: </span>}</span>
        <span className="text-amber-400">undefined</span>
        {!isLast && <span className="text-df-text-muted">,</span>}
      </div>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <div className="pl-4" style={{ paddingLeft: depth * 16 }}>
        <span className="text-df-text-muted">{name && <span className="text-cyan-400">{name}: </span>}</span>
        <span className="text-amber-400">{value ? 'true' : 'false'}</span>
        {!isLast && <span className="text-df-text-muted">,</span>}
      </div>
    );
  }

  if (typeof value === 'number') {
    return (
      <div className="pl-4" style={{ paddingLeft: depth * 16 }}>
        <span className="text-df-text-muted">{name && <span className="text-cyan-400">{name}: </span>}</span>
        <span className="text-green-400">{value}</span>
        {!isLast && <span className="text-df-text-muted">,</span>}
      </div>
    );
  }

  if (typeof value === 'string') {
    const display = value.length > 100 ? `"${value.slice(0, 100)}..."` : `"${value}"`;
    return (
      <div className="pl-4" style={{ paddingLeft: depth * 16 }}>
        <span className="text-df-text-muted">{name && <span className="text-cyan-400">{name}: </span>}</span>
        <span className="text-orange-400">{display}</span>
        {!isLast && <span className="text-df-text-muted">,</span>}
      </div>
    );
  }

  if (typeof value === 'function') {
    return (
      <div className="pl-4" style={{ paddingLeft: depth * 16 }}>
        <span className="text-df-text-muted">{name && <span className="text-cyan-400">{name}: </span>}</span>
        <span className="text-blue-400">ƒ </span>
        <span className="text-df-text-muted">{value.name || 'anonymous'}()</span>
        {!isLast && <span className="text-df-text-muted">,</span>}
      </div>
    );
  }

  if (Array.isArray(value)) {
    const toggle = () => setExpanded(!expanded);
    return (
      <div>
        <div className="pl-4 cursor-pointer hover:bg-df-surface-1/50" style={{ paddingLeft: depth * 16 }} onClick={toggle}>
          <span className="text-df-text-muted">{name && <span className="text-cyan-400">{name}: </span>}</span>
          {expanded ? <ChevronDown size={12} className="inline text-df-text-muted" /> : <ChevronRight size={12} className="inline text-df-text-muted" />}
          <span className="text-yellow-300">Array[{value.length}]</span>
        </div>
        {expanded && value.map((item, i) => (
          <ObjectNode key={i} value={item} depth={depth + 1} isLast={i === value.length - 1} />
        ))}
      </div>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const toggle = () => setExpanded(!expanded);
    return (
      <div>
        <div className="pl-4 cursor-pointer hover:bg-df-surface-1/50" style={{ paddingLeft: depth * 16 }} onClick={toggle}>
          <span className="text-df-text-muted">{name && <span className="text-cyan-400">{name}: </span>}</span>
          {expanded ? <ChevronDown size={12} className="inline text-df-text-muted" /> : <ChevronRight size={12} className="inline text-df-text-muted" />}
          <span className="text-yellow-300">Object{'{'}{entries.length}{'}'}</span>
        </div>
        {expanded && entries.map(([k, v], i) => (
          <ObjectNode key={k} value={v} depth={depth + 1} name={k} isLast={i === entries.length - 1} />
        ))}
      </div>
    );
  }

  return (
    <div className="pl-4" style={{ paddingLeft: depth * 16 }}>
      <span className="text-df-text-muted">{name && <span className="text-cyan-400">{name}: </span>}</span>
      <span className="text-df-text-muted">{String(value)}</span>
      {!isLast && <span className="text-df-text-muted">,</span>}
    </div>
  );
}

function DataInspector({ data }: { data: unknown }) {
  if (data === null || data === undefined) {
    return <span className="text-amber-400">{data === null ? 'null' : 'undefined'}</span>;
  }

  if (typeof data === 'object') {
    return <ObjectNode value={data} depth={0} />;
  }

  return <span className="text-df-text-muted">{String(data)}</span>;
}

interface LogEntryRowProps {
  entry: LogEntry;
}

function LogEntryRow({ entry }: LogEntryRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const style = LEVEL_STYLES[entry.level];
  const sourceStyle = SOURCE_STYLES[entry.source || 'app'];

  const handleCopy = useCallback(() => {
    const text = entry.data !== undefined
      ? `${entry.message}\n${typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2)}`
      : entry.message;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [entry.message, entry.data]);

  const hasData = entry.data !== undefined;
  const isExpandable = hasData && typeof entry.data === 'object';

  return (
    <div className={`border-b border-df-border/50 ${style.bg}`}>
      <div
        className="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-df-surface-1/50"
        onClick={() => isExpandable && setExpanded(!expanded)}
      >
        <span className="text-df-xs text-df-text-muted font-mono shrink-0">
          {formatTime(entry.timestamp)}
        </span>
        <span className={`text-df-xs font-medium shrink-0 px-1.5 py-0.5 rounded ${style.text}`}>
          {style.label}
        </span>
        {entry.source && (
          <span className={`text-df-xs font-medium shrink-0 px-1 py-0.5 rounded ${sourceStyle.badge}`}>
            {entry.source}
          </span>
        )}
        <span className="text-df-sm text-df-text-primary flex-1 break-all">
          {entry.message}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {isExpandable && (
            expanded ? <ChevronDown size={14} className="text-df-text-muted" /> : <ChevronRight size={14} className="text-df-text-muted" />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleCopy(); }}
            className="p-1 rounded hover:bg-df-surface-2 text-df-text-muted hover:text-df-text-primary"
            title="Copy"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          </button>
        </div>
      </div>
      {expanded && isExpandable && entry.data && (
        <div className="px-3 pb-2 pl-16 bg-df-surface-1 rounded-b border-t border-df-border/30">
          <pre className="text-df-xs font-mono overflow-x-auto">
            <DataInspector data={entry.data} />
          </pre>
        </div>
      )}
    </div>
  );
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      className="h-2 bg-df-surface-1 hover:bg-df-accent/50 cursor-ns-resize flex items-center justify-center transition-colors"
      onMouseDown={onMouseDown}
    >
      <GripHorizontal size={14} className="text-df-text-muted" />
    </div>
  );
}

function CommandInput() {
  const [command, setCommand] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    addToHistory,
    navigateHistory,
    resetHistoryIndex,
    commandHistory,
    historyIndex,
  } = useConsoleStore();

  const displayCommand = historyIndex >= 0 ? commandHistory[historyIndex] || '' : command;

  useEffect(() => {
    setCommand(displayCommand);
  }, [displayCommand]);

  const executeCommand = useCallback(() => {
    const trimmed = command.trim();
    if (!trimmed) return;

    addToHistory(trimmed);

    try {
      const fn = new Function('console', `
        with (console) {
          return eval(${JSON.stringify(trimmed)});
        }
      `);
      const result = fn(console);
      if (result !== undefined) {
        logger.log(`→ ${String(result)}`, result);
      }
    } catch (err) {
      logger.error('Command execution failed', err);
    }

    setCommand('');
    resetHistoryIndex();
  }, [command, addToHistory, resetHistoryIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      executeCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateHistory('up');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateHistory('down');
    } else if (e.key === 'Escape') {
      resetHistoryIndex();
      setCommand('');
    }
  }, [executeCommand, navigateHistory, resetHistoryIndex]);

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-df-border bg-df-surface-1">
      <Terminal size={14} className="text-df-accent shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Evaluate JavaScript... (↑↓ for history)"
        className="flex-1 bg-df-surface-2 text-df-sm text-df-text-primary placeholder-df-text-muted px-2 py-1 rounded outline-none focus:ring-1 focus:ring-df-accent font-mono"
      />
      <span className="text-df-xs text-df-text-muted">⏎</span>
    </div>
  );
}

export const Console: React.FC = () => {
  const {
    isOpen,
    filter,
    searchQuery,
    autoScroll,
    drawerHeight,
    closeConsole,
    setFilter,
    setSearchQuery,
    setAutoScroll,
    setDrawerHeight,
  } = useConsoleStore();

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [isResizing, setIsResizing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  useEffect(() => {
    logger.setupInterceptor();
    setEntries(logger.getEntries());
    return logger.subscribe((entry) => {
      setEntries((prev) => [...prev.slice(-1999), entry]);
    });
  }, []);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, autoScroll]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const delta = startYRef.current - e.clientY;
      setDrawerHeight(startHeightRef.current + delta);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setDrawerHeight]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startYRef.current = e.clientY;
    startHeightRef.current = drawerHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [drawerHeight]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (filter !== 'ALL' && entry.level !== filter) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!entry.message.toLowerCase().includes(query)) {
          if (entry.data === undefined) return false;
          const dataStr = typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data).toLowerCase();
          if (!dataStr.includes(query)) return false;
        }
      }
      return true;
    });
  }, [entries, filter, searchQuery]);

  const filters: ConsoleFilter[] = ['ALL', 'LOG', 'DEBUG', 'INFO', 'SUCCESS', 'WARN', 'ERROR'];

  if (!isOpen) return null;

  return (
    <div
      ref={consoleRef}
      className="fixed bottom-0 right-0 w-[800px] bg-df-bg border border-df-border rounded-tl-lg shadow-2xl z-50 flex flex-col"
      style={{ height: drawerHeight }}
    >
      <ResizeHandle onMouseDown={handleResizeStart} />
      <div className="flex items-center justify-between px-3 py-2 border-b border-df-border bg-df-surface-1">
        <div className="flex items-center gap-3">
          <h3 className="text-df-sm font-semibold text-df-text-primary">Console</h3>
          <div className="flex items-center gap-1">
            {filters.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-0.5 text-df-xs rounded transition-colors ${
                  filter === f
                    ? 'bg-df-accent text-white'
                    : 'bg-df-surface-2 text-df-text-muted hover:text-df-text-primary'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-df-xs text-df-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded"
            />
            Auto
          </label>
          <button
            onClick={() => { logger.clear(); setEntries([]); }}
            className="p-1.5 rounded hover:bg-df-surface-2 text-df-text-muted hover:text-df-text-primary"
            title="Clear"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={closeConsole}
            className="p-1.5 rounded hover:bg-df-surface-2 text-df-text-muted hover:text-df-text-primary"
            title="Close (F12)"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="px-3 py-1.5 border-b border-df-border bg-df-surface-1">
        <div className="flex items-center gap-2 bg-df-surface-2 rounded px-2 py-1">
          <Search size={12} className="text-df-text-muted shrink-0" />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => { setLocalSearch(e.target.value); setSearchQuery(e.target.value); }}
            placeholder="Filter logs..."
            className="flex-1 bg-transparent text-df-sm text-df-text-primary placeholder-df-text-muted outline-none"
          />
          {localSearch && (
            <button
              onClick={() => { setLocalSearch(''); setSearchQuery(''); }}
              className="text-df-text-muted hover:text-df-text-primary"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-df-xs">
        {filteredEntries.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-df-text-muted">
            {entries.length === 0 ? 'No logs yet' : 'No matching logs'}
          </div>
        ) : (
          filteredEntries.map((entry) => <LogEntryRow key={entry.id} entry={entry} />)
        )}
        <div ref={bottomRef} />
      </div>
      <CommandInput />
    </div>
  );
};