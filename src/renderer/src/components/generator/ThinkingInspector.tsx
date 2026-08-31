import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Cpu, Activity, ChevronRight, ChevronLeft, Loader2, Clock,
  Thermometer, HardDrive, Zap,
} from 'lucide-react';
import { fetchOllamaPs, type OllamaPsModel } from '../../services/aiService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThinkingInspectorProps {
  open: boolean;
  onToggle: () => void;
  active: boolean;
  thinkingLog: string;
  elapsedMs: number;
  status: 'idle' | 'thinking' | 'generating' | 'done' | 'error';
  progress?: { current: number; total: number };
  modelName?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m > 0 ? `${m}m ${ss}s` : `${ss}s`;
}

// ---------------------------------------------------------------------------
// VRAM Monitor
// ---------------------------------------------------------------------------

const VRAMMonitor: React.FC<{ models: OllamaPsModel[]; polling: boolean }> = ({ models, polling }) => {
  const loaded = models.length > 0;
  const model = models[0];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
          <HardDrive size={9} />
          Model / VRAM
        </span>
        {polling && (
          <span className="flex items-center gap-1 text-[8px] text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </span>
        )}
      </div>

      {loaded && model ? (
        <div className="bg-slate-900/80 rounded-lg border border-white/5 p-2.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <Cpu size={10} className="text-amber-400 shrink-0" />
            <span className="text-[10px] text-white font-medium truncate">{model.name}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div className="flex justify-between">
              <span className="text-[8px] text-slate-500">VRAM</span>
              <span className="text-[9px] text-sky-400 font-mono">{formatBytes(model.size_vram)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[8px] text-slate-500">RAM</span>
              <span className="text-[9px] text-slate-300 font-mono">{formatBytes(model.size)}</span>
            </div>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000 bg-gradient-to-r from-sky-500 to-cyan-400"
              style={{ width: `${Math.min(100, (model.size_vram / (4 * 1024 * 1024 * 1024)) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between">
            <span className="text-[7px] text-slate-600">VRAM usage vs 4 GB limit</span>
            <span className="text-[8px] text-slate-500 font-mono">
              {((model.size_vram / (4 * 1024 * 1024 * 1024)) * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      ) : (
        <div className="bg-slate-900/60 rounded-lg border border-white/5 p-2.5 flex items-center gap-2">
          <Thermometer size={10} className="text-slate-600" />
          <span className="text-[9px] text-slate-500">No model loaded in VRAM</span>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Progress Indicator
// ---------------------------------------------------------------------------

const ProgressIndicator: React.FC<{
  status: string;
  elapsedMs: number;
  progress?: { current: number; total: number };
}> = ({ status, elapsedMs, progress }) => {
  const isActive = status === 'thinking' || status === 'generating';
  const pct = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : status === 'thinking' ? -1 : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
          <Activity size={9} />
          Progress
        </span>
        {isActive && (
          <span className="text-[9px] text-slate-500 font-mono flex items-center gap-1">
            <Clock size={8} />
            {formatElapsed(elapsedMs)}
          </span>
        )}
      </div>

      <div className="bg-slate-900/60 rounded-lg border border-white/5 p-2.5 space-y-2">
        {/* Status line */}
        <div className="flex items-center gap-2">
          {isActive ? (
            <Loader2 size={10} className="text-amber-400 animate-spin shrink-0" />
          ) : status === 'done' ? (
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
          ) : status === 'error' ? (
            <span className="w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" />
          ) : (
            <span className="w-2.5 h-2.5 rounded-full bg-slate-600 shrink-0" />
          )}
          <span className={`text-[10px] font-medium ${
            status === 'thinking' ? 'text-amber-300' :
            status === 'generating' ? 'text-sky-300' :
            status === 'done' ? 'text-emerald-300' :
            status === 'error' ? 'text-red-300' : 'text-slate-500'
          }`}>
            {status === 'idle' && 'Waiting to start'}
            {status === 'thinking' && 'AI is reasoning...'}
            {status === 'generating' && (progress ? `Generating scene ${progress.current}/${progress.total}` : 'Generating...')}
            {status === 'done' && 'Complete'}
            {status === 'error' && 'Error occurred'}
          </span>
        </div>

        {/* Progress bar */}
        {isActive && (
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            {pct === -1 ? (
              <div className="h-full bg-amber-500/60 rounded-full animate-pulse" style={{ width: '40%' }} />
            ) : (
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
        )}

        {progress && progress.total > 0 && (
          <div className="flex justify-between">
            <span className="text-[8px] text-slate-600">
              {progress.current} / {progress.total} scenes
            </span>
            <span className="text-[8px] text-slate-500 font-mono">
              {Math.round((progress.current / progress.total) * 100)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Live AI Reasoning Console
// ---------------------------------------------------------------------------

const ReasoningConsole: React.FC<{ log: string; active: boolean }> = ({ log, active }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [log]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
          <Zap size={9} />
          AI Reasoning Console
        </span>
        {active && (
          <span className="flex items-center gap-1 text-[8px] text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            STREAMING
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className="bg-[#0a0e14] rounded-lg border border-white/5 overflow-hidden"
        style={{ maxHeight: 260 }}
      >
        {log ? (
          <pre className="p-2.5 text-[10px] font-mono text-emerald-300/90 whitespace-pre-wrap break-words leading-relaxed overflow-y-auto"
            style={{ maxHeight: 260, tabSize: 2 }}>
            {log}
            {active && <span className="inline-block w-1.5 h-3 bg-amber-400/80 animate-pulse ml-0.5 align-middle" />}
          </pre>
        ) : (
          <div className="p-4 text-center">
            <p className="text-[9px] text-slate-600">
              {active ? 'Waiting for AI reasoning stream...' : 'AI thinking output will appear here'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export const ThinkingInspector: React.FC<ThinkingInspectorProps> = ({
  open,
  onToggle,
  active,
  thinkingLog,
  elapsedMs,
  status,
  progress,
  modelName,
}) => {
  const [vramModels, setVramModels] = useState<OllamaPsModel[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollVram = useCallback(async () => {
    const resp = await fetchOllamaPs();
    setVramModels(resp.models);
  }, []);

  useEffect(() => {
    if (active) {
      pollVram();
      pollRef.current = setInterval(pollVram, 3000);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [active, pollVram]);

  return (
    <>
      {/* Collapse/expand toggle button */}
      <button
        onClick={onToggle}
        className={`absolute top-0 right-0 z-20 h-full flex items-center transition-all duration-200 group ${
          open ? 'translate-x-full' : 'translate-x-0'
        }`}
        style={{ width: 16 }}
      >
        <div className={`w-full h-12 flex items-center justify-center rounded-l-md transition-colors ${
          active
            ? 'bg-amber-500/20 text-amber-300 border border-r-0 border-amber-500/30'
            : 'bg-slate-800/60 text-slate-500 border border-r-0 border-white/5 hover:text-white hover:border-white/10'
        }`}>
          {open ? <ChevronRight size={10} /> : <ChevronLeft size={10} />}
        </div>
      </button>

      {/* Panel */}
      <div
        className={`absolute top-0 right-0 z-10 h-full flex flex-col bg-slate-900/95 border-l border-white/5 transition-all duration-200 overflow-hidden ${
          open ? 'w-[280px]' : 'w-0'
        }`}
      >
        {open && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="shrink-0 px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Activity size={11} className={active ? 'text-amber-400' : 'text-slate-500'} />
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                  Telemetry Inspector
                </span>
              </div>
              {modelName && (
                <span className="text-[8px] text-slate-500 font-mono truncate max-w-[120px]">{modelName}</span>
              )}
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              <VRAMMonitor models={vramModels} polling={active} />
              <div className="h-px bg-white/5" />
              <ProgressIndicator status={status} elapsedMs={elapsedMs} progress={progress} />
              <div className="h-px bg-white/5" />
              <ReasoningConsole log={thinkingLog} active={active} />
            </div>
          </div>
        )}
      </div>
    </>
  );
};
