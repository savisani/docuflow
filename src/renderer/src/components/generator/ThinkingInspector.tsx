import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Cpu, Activity, ChevronRight, ChevronLeft, Loader2, Clock,
  Thermometer, HardDrive, Zap, ArrowDownToLine, Trash2, Wifi,
  WifiOff, Gauge, MonitorDot,
} from 'lucide-react';
import { fetchOllamaPs, offloadModel, type OllamaPsModel } from '../../services/aiService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThinkingInspectorProps {
  open: boolean;
  onToggle: () => void;
  active: boolean;
  thinkingLog: string;
  liveOutput: string;
  elapsedMs: number;
  status: 'idle' | 'loading_model' | 'thinking' | 'generating' | 'done' | 'error';
  progress?: { current: number; total: number };
  modelName?: string;
  onOffload?: () => void;
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
// GPU / VRAM Monitor — polls /api/ps every 2s when active
// ---------------------------------------------------------------------------

const VRAMMonitor: React.FC<{
  models: OllamaPsModel[];
  polling: boolean;
  onOffload: (name: string) => void;
  modelLoading: boolean;
}> = ({ models, polling, onOffload, modelLoading }) => {
  const loaded = models.length > 0;
  const model = models[0];

  // Estimate 4GB VRAM target (will be overridden if we get real data)
  const totalVram = 4 * 1024 * 1024 * 1024;
  const usedVram = model?.size_vram || 0;
  const vramPct = totalVram > 0 ? Math.min(100, (usedVram / totalVram) * 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
          <MonitorDot size={9} />
          GPU / VRAM Monitor
        </span>
        <div className="flex items-center gap-2">
          {polling && (
            <span className="flex items-center gap-1 text-[8px] text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          )}
        </div>
      </div>

      {/* Model loading progress */}
      {modelLoading && (
        <div className="bg-amber-500/10 rounded-lg border border-amber-500/20 p-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 size={10} className="text-amber-400 animate-spin shrink-0" />
            <span className="text-[10px] text-amber-300 font-medium">Loading model to GPU...</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full animate-pulse"
              style={{ width: '60%' }} />
          </div>
          <p className="text-[8px] text-amber-400/60">First token may take 30-60s while model loads into VRAM</p>
        </div>
      )}

      {loaded && model ? (
        <div className="bg-slate-900/80 rounded-lg border border-white/5 p-2.5 space-y-2">
          {/* Model name */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Cpu size={10} className="text-amber-400 shrink-0" />
              <span className="text-[10px] text-white font-medium truncate">{model.name}</span>
            </div>
            <button
              onClick={() => onOffload(model.name)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-medium
                bg-red-500/10 text-red-400 border border-red-500/20
                hover:bg-red-500/20 hover:text-red-300 transition-colors shrink-0"
              title="Unload model from GPU memory"
            >
              <Trash2 size={8} />
              Offload
            </button>
          </div>

          {/* VRAM bar */}
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-[8px] text-slate-500 flex items-center gap-1">
                <HardDrive size={8} />
                VRAM
              </span>
              <span className="text-[9px] text-sky-400 font-mono">
                {formatBytes(usedVram)} / {formatBytes(totalVram)}
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  vramPct > 80 ? 'bg-gradient-to-r from-red-500 to-orange-400' :
                  vramPct > 50 ? 'bg-gradient-to-r from-amber-500 to-yellow-400' :
                  'bg-gradient-to-r from-sky-500 to-cyan-400'
                }`}
                style={{ width: `${vramPct}%` }}
              />
            </div>
            <div className="flex justify-between">
              <span className="text-[7px] text-slate-600">
                {vramPct.toFixed(1)}% used
              </span>
              <span className="text-[7px] text-slate-600 font-mono">
                RAM: {formatBytes(model.size)}
              </span>
            </div>
          </div>
        </div>
      ) : !modelLoading ? (
        <div className="bg-slate-900/60 rounded-lg border border-white/5 p-2.5 flex items-center gap-2">
          <Thermometer size={10} className="text-slate-600" />
          <span className="text-[9px] text-slate-500">No model loaded in VRAM</span>
        </div>
      ) : null}
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
  const isActive = status === 'thinking' || status === 'generating' || status === 'loading_model';
  const pct = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : status === 'thinking' || status === 'loading_model' ? -1 : 0;

  const statusLabel = (() => {
    switch (status) {
      case 'idle': return 'Waiting to start';
      case 'loading_model': return 'Loading model to GPU...';
      case 'thinking': return 'AI is reasoning...';
      case 'generating': return progress ? `Generating scene ${progress.current}/${progress.total}` : 'Generating...';
      case 'done': return 'Complete';
      case 'error': return 'Error occurred';
      default: return 'Unknown';
    }
  })();

  const statusColor = (() => {
    switch (status) {
      case 'thinking': return 'text-amber-300';
      case 'loading_model': return 'text-orange-300';
      case 'generating': return 'text-sky-300';
      case 'done': return 'text-emerald-300';
      case 'error': return 'text-red-300';
      default: return 'text-slate-500';
    }
  })();

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
          <span className={`text-[10px] font-medium ${statusColor}`}>
            {statusLabel}
          </span>
        </div>

        {/* Progress bar */}
        {isActive && (
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            {pct === -1 ? (
              <div className="h-full rounded-full animate-pulse bg-gradient-to-r from-amber-500/60 to-orange-400/60"
                style={{ width: '40%' }} />
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
// Live AI Reasoning Console — shows thinking tags
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
          AI Reasoning (think tags)
        </span>
        {active && log && (
          <span className="flex items-center gap-1 text-[8px] text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            STREAMING
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className="bg-[#0a0e14] rounded-lg border border-white/5 overflow-hidden"
        style={{ maxHeight: 180 }}
      >
        {log ? (
          <pre className="p-2.5 text-[10px] font-mono text-emerald-300/90 whitespace-pre-wrap break-words leading-relaxed overflow-y-auto"
            style={{ maxHeight: 180, tabSize: 2 }}>
            {log}
            {active && <span className="inline-block w-1.5 h-3 bg-amber-400/80 animate-pulse ml-0.5 align-middle" />}
          </pre>
        ) : (
          <div className="p-3 text-center">
            <p className="text-[9px] text-slate-600">
              {active ? 'Waiting for thinking output...' : 'AI thinking tags will appear here'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Live Output Console — shows streaming response tokens as they arrive
// ---------------------------------------------------------------------------

const LiveOutputConsole: React.FC<{ output: string; active: boolean }> = ({ output, active }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
          <Gauge size={9} />
          Live Output Stream
        </span>
        {active && (
          <span className="flex items-center gap-1 text-[8px] text-sky-400">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
            TYPING
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className="bg-[#0a0e14] rounded-lg border border-white/5 overflow-hidden"
        style={{ maxHeight: 200 }}
      >
        {output ? (
          <pre className="p-2.5 text-[10px] font-mono text-sky-200/90 whitespace-pre-wrap break-words leading-relaxed overflow-y-auto"
            style={{ maxHeight: 200, tabSize: 2 }}>
            {output}
            {active && <span className="inline-block w-1.5 h-3 bg-sky-400/80 animate-pulse ml-0.5 align-middle" />}
          </pre>
        ) : (
          <div className="p-3 text-center">
            <p className="text-[9px] text-slate-600">
              {active ? 'Waiting for first token...' : 'Response will stream here token-by-token'}
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
  liveOutput,
  elapsedMs,
  status,
  progress,
  modelName,
  onOffload,
}) => {
  const [vramModels, setVramModels] = useState<OllamaPsModel[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollVram = useCallback(async () => {
    const resp = await fetchOllamaPs();
    setVramModels(resp.models);
  }, []);

  // Expose setModelLoading for parent
  useEffect(() => {
    (window as any).__thinkingInspectorSetModelLoading = setModelLoading;
    return () => { delete (window as any).__thinkingInspectorSetModelLoading; };
  }, []);

  useEffect(() => {
    if (active || vramModels.length > 0) {
      pollVram();
      pollRef.current = setInterval(pollVram, 2000);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [active, pollVram, vramModels.length]);

  const handleOffload = useCallback(async (modelName: string) => {
    await offloadModel(modelName);
    pollVram();
    onOffload?.();
  }, [pollVram, onOffload]);

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
          open ? 'w-[300px]' : 'w-0'
        }`}
      >
        {open && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="shrink-0 px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Activity size={11} className={active ? 'text-amber-400' : 'text-slate-500'} />
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                  AI Inspector
                </span>
              </div>
              {modelName && (
                <span className="text-[8px] text-slate-500 font-mono truncate max-w-[130px]">{modelName}</span>
              )}
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              <VRAMMonitor
                models={vramModels}
                polling={active}
                onOffload={handleOffload}
                modelLoading={modelLoading}
              />
              <div className="h-px bg-white/5" />
              <ProgressIndicator status={status} elapsedMs={elapsedMs} progress={progress} />
              <div className="h-px bg-white/5" />
              <LiveOutputConsole output={liveOutput} active={active} />
              <div className="h-px bg-white/5" />
              <ReasoningConsole log={thinkingLog} active={active} />
            </div>
          </div>
        )}
      </div>
    </>
  );
};
