import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Cpu, Activity, ChevronRight, ChevronLeft, Loader2, Clock,
  Thermometer, HardDrive, Zap, Trash2, MonitorDot, Send,
  Brain, Gauge, ChevronDown,
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
  onVramUpdate?: (model: OllamaPsModel | null, totalVram: number) => void;
  chatMessages: Array<{ role: 'user' | 'assistant'; text: string }>;
  chatInput: string;
  chatLoading: boolean;
  onChatInputChange: (value: string) => void;
  onChatSend: () => void;
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

const VRAMMonitor: React.FC<{
  models: OllamaPsModel[];
  polling: boolean;
  onOffload: (name: string) => void;
  modelLoading: boolean;
}> = ({ models, polling, onOffload, modelLoading }) => {
  const loaded = models.length > 0;
  const model = models[0];
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
        {polling && (
          <span className="flex items-center gap-1 text-[8px] text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </span>
        )}
      </div>

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
              <span className="text-[7px] text-slate-600">{vramPct.toFixed(1)}% used</span>
              <span className="text-[7px] text-slate-600 font-mono">RAM: {formatBytes(model.size)}</span>
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
          <span className={`text-[10px] font-medium ${statusColor}`}>{statusLabel}</span>
        </div>

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
            <span className="text-[8px] text-slate-600">{progress.current} / {progress.total} scenes</span>
            <span className="text-[8px] text-slate-500 font-mono">{Math.round((progress.current / progress.total) * 100)}%</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Collapsible Reasoning Console
// ---------------------------------------------------------------------------

const ReasoningConsole: React.FC<{ log: string; active: boolean }> = ({ log, active }) => {
  const [expanded, setExpanded] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current && expanded) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [log, expanded]);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between group"
      >
        <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
          <Brain size={9} />
          AI Reasoning (think tags)
        </span>
        <div className="flex items-center gap-2">
          {active && log && (
            <span className="flex items-center gap-1 text-[8px] text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              STREAMING
            </span>
          )}
          <ChevronDown
            size={10}
            className={`text-slate-500 transition-transform ${expanded ? '' : '-rotate-90'}`}
          />
        </div>
      </button>

      {expanded && (
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
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Live Output Console
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
// Chat Panel
// ---------------------------------------------------------------------------

const ChatPanel: React.FC<{
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  input: string;
  loading: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
}> = ({ messages, input, loading, onInputChange, onSend }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="space-y-2">
      <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
        <Zap size={9} />
        Interactive Chat
      </span>

      <div
        ref={containerRef}
        className="bg-[#0a0e14] rounded-lg border border-white/5 overflow-y-auto space-y-2 p-2.5"
        style={{ maxHeight: 180 }}
      >
        {messages.length === 0 && (
          <p className="text-[9px] text-slate-600 text-center py-2">
            Chat with the loaded model to tweak prompts or ask questions
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[10px] leading-relaxed ${
              msg.role === 'user'
                ? 'bg-amber-500/15 text-amber-200 border border-amber-500/20'
                : 'bg-slate-800/80 text-slate-300 border border-white/5'
            }`}>
              <pre className="whitespace-pre-wrap break-words font-mono" style={{ tabSize: 2 }}>
                {msg.text}
              </pre>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800/80 rounded-lg px-2.5 py-1.5 border border-white/5 flex items-center gap-1.5">
              <Loader2 size={10} className="text-amber-400 animate-spin" />
              <span className="text-[9px] text-slate-400">Thinking...</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the model anything..."
          disabled={loading}
          className="flex-1 bg-slate-800/80 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500 transition-all disabled:opacity-50"
        />
        <button
          onClick={onSend}
          disabled={loading || !input.trim()}
          className="px-2 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send size={10} />
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Panel — 350px inline sidebar
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
  onVramUpdate,
  chatMessages,
  chatInput,
  chatLoading,
  onChatInputChange,
  onChatSend,
}) => {
  const [vramModels, setVramModels] = useState<OllamaPsModel[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollVram = useCallback(async () => {
    const resp = await fetchOllamaPs();
    setVramModels(resp.models);
    onVramUpdate?.(resp.models[0] || null, 4 * 1024 * 1024 * 1024);
  }, [onVramUpdate]);

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
    <div
      className={`flex-shrink-0 h-full border-l border-slate-800 bg-slate-950 flex flex-col transition-all duration-200 overflow-hidden ${
        open ? 'w-[350px]' : 'w-0 border-l-0'
      }`}
    >
      {open && (
        <div className="flex-1 flex flex-col overflow-hidden w-[350px]">
          {/* Header */}
          <div className="shrink-0 px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Activity size={11} className={active ? 'text-amber-400' : 'text-slate-500'} />
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                AI Inspector
              </span>
            </div>
            <div className="flex items-center gap-2">
              {modelName && (
                <span className="text-[8px] text-slate-500 font-mono truncate max-w-[130px]">{modelName}</span>
              )}
              <button
                onClick={onToggle}
                className="text-slate-500 hover:text-white transition-colors"
                title="Close inspector"
              >
                <ChevronRight size={12} />
              </button>
            </div>
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
            <div className="h-px bg-white/5" />
            <ChatPanel
              messages={chatMessages}
              input={chatInput}
              loading={chatLoading}
              onInputChange={onChatInputChange}
              onSend={onChatSend}
            />
          </div>
        </div>
      )}
    </div>
  );
};
