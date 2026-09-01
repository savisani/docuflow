import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity, ChevronRight, Loader2, Zap, Send, Settings, FileText, RefreshCw,
} from 'lucide-react';
import { useDocuFlowStore } from '../../app/store';
import { buildProjectContext, ProjectContext } from '../../services/aiService';
import { refreshModels, ModelInfo, AIProvider } from '../../services/modelRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThinkingInspectorProps {
  open: boolean;
  onToggle: () => void;
  active: boolean;
  status: 'idle' | 'loading_model' | 'thinking' | 'done' | 'error';
  thinkingText: string;
  outputText: string;
  modelName?: string;
  onChatSend: () => void;
  /** Timing metrics from generation (label → ms) */
  timingMetrics?: Record<string, number>;
  /** Status message (batch progress, etc.) */
  statusMessage?: string;
}

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------

type InspectorTab = 'live' | 'chat';

// ---------------------------------------------------------------------------
// Streaming Section — Thinking or Output
// ---------------------------------------------------------------------------

const StreamingSection: React.FC<{
  label: string;
  color: 'gray' | 'white';
  text: string;
  active: boolean;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}> = ({ label, color, text, active, collapsible = false, defaultExpanded = true }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current && expanded) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text, expanded]);

  if (!text && !active) return null;

  const colorClasses = color === 'gray'
    ? 'text-slate-400'
    : 'text-slate-100';

  return (
    <div className="space-y-1.5">
      {collapsible ? (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between"
        >
          <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider">
            {label}
          </span>
          <div className="flex items-center gap-2">
            {active && text && (
              <span className="flex items-center gap-1 text-[8px] text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" />
                streaming
              </span>
            )}
            <ChevronRight
              size={9}
              className={`text-slate-600 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          </div>
        </button>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider">
            {label}
          </span>
          {active && text && (
            <span className="flex items-center gap-1 text-[8px] text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" />
              streaming
            </span>
          )}
        </div>
      )}

      {expanded && (
        <div
          ref={containerRef}
          className="bg-[#0a0e14] rounded-lg border border-white/5 overflow-hidden"
          style={{ maxHeight: 400 }}
        >
          {text ? (
            <pre className={`p-2.5 text-[10px] font-mono ${colorClasses} whitespace-pre-wrap break-words leading-relaxed overflow-y-auto`}
              style={{ maxHeight: 400, tabSize: 2 }}>
              {text}
              {active && (
                <span className={`inline-block w-1.5 h-3 animate-pulse ml-0.5 align-middle ${
                  color === 'gray' ? 'bg-slate-400/60' : 'bg-white/40'
                }`} />
              )}
            </pre>
          ) : (
            <div className="p-3 text-center">
              <p className="text-[9px] text-slate-600">
                {active ? 'Waiting for tokens...' : `No ${label.toLowerCase()} output`}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Chat Tab
// ---------------------------------------------------------------------------

const ChatTab: React.FC<{
  messages: Array<{ role: 'user' | 'assistant'; thinking?: string; content: string }>;
  input: string;
  loading: boolean;
  modelName?: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClear?: () => void;
}> = ({ messages, input, loading, modelName, onInputChange, onSend, onClear }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [includeContext, setIncludeContext] = useState(true);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const {
    chatProvider, setChatProvider, chatModel, setChatModel,
    scenes, assets, commands, settings, transcript, voiceover,
  } = useDocuFlowStore();

  // Load models when provider changes
  useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      setLoadingModels(true);
      try {
        const models = await refreshModels(chatProvider as AIProvider);
        if (!cancelled) {
          setAvailableModels(models);
          // Auto-select first model if current one isn't in the list
          if (models.length > 0 && !models.some(m => m.id === chatModel)) {
            setChatModel(models[0].id);
          }
        }
      } catch {
        if (!cancelled) setAvailableModels([]);
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    };
    loadModels();
    return () => { cancelled = true; };
  }, [chatProvider]);

  const buildContext = useCallback((): string => {
    if (!includeContext) return '';

    const ctx: ProjectContext = {
      scenes: scenes.map(s => ({
        id: s.id,
        type: s.type,
        duration: s.duration,
        content: s.content || s.imagePrompt || '',
      })),
      assets: assets.map(a => ({
        id: a.id,
        name: a.filename,
        type: a.type,
        duration: a.duration,
      })),
      timeline: commands.length > 0 ? {
        duration: commands.reduce((max, c) => {
          const end = (c.start ?? 0) + (c.duration ?? 0);
          return end > max ? end : max;
        }, 0),
        fps: settings.fps,
      } : null,
      transcript: transcript ? {
        text: transcript.text,
        duration: voiceover?.duration || 0,
        segments: transcript.words?.length || 0,
      } : null,
      selectedItems: [],
    };

    return buildProjectContext(ctx);
  }, [includeContext, scenes, assets, commands, settings, transcript, voiceover]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Provider/Model selector */}
      <div className="shrink-0 space-y-1.5 pb-2">
        <div className="flex items-center gap-1">
          <select
            value={chatProvider}
            onChange={(e) => setChatProvider(e.target.value as any)}
            className="flex-1 bg-slate-800/60 border border-white/10 rounded px-1.5 py-1 text-[9px] text-slate-300 outline-none"
          >
            <option value="ollama">Local (Ollama)</option>
            <option value="openrouter">OpenRouter</option>
            <option value="gemini">Gemini</option>
          </select>
          <button
            onClick={async () => {
              setLoadingModels(true);
              try {
                const models = await refreshModels(chatProvider as AIProvider, true);
                setAvailableModels(models);
              } catch {}
              setLoadingModels(false);
            }}
            disabled={loadingModels}
            className="px-1.5 py-1 rounded bg-slate-800/60 border border-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            title="Refresh models"
          >
            <RefreshCw size={9} className={loadingModels ? 'animate-spin' : ''} />
          </button>
        </div>
        <select
          value={chatModel}
          onChange={(e) => setChatModel(e.target.value)}
          className="w-full bg-slate-800/60 border border-white/10 rounded px-1.5 py-1 text-[9px] text-slate-300 font-mono outline-none"
        >
          {loadingModels ? (
            <option value="">Loading models...</option>
          ) : availableModels.length === 0 ? (
            <option value="">No models available</option>
          ) : (
            availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.isLoaded ? '(loaded)' : ''} {m.sizeLabel ? `- ${m.sizeLabel}` : ''}
              </option>
            ))
          )}
        </select>
      </div>

      {/* Model header */}
      <div className="shrink-0 flex items-center justify-between px-1 pb-2">
        <span className="text-[8px] text-slate-600 font-mono truncate">
          {modelName || chatModel || 'No model loaded'}
        </span>
        {messages.length > 0 && onClear && (
          <button
            onClick={onClear}
            className="text-[8px] text-slate-600 hover:text-slate-400 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto space-y-2.5 min-h-0"
      >
        {messages.length === 0 && !loading && (
          <div className="flex items-center justify-center h-full">
            <p className="text-[9px] text-slate-600 text-center">
              Chat with the loaded model
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === 'user' ? (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-lg px-2.5 py-1.5 text-[10px] bg-amber-500/10 text-amber-200 border border-amber-500/15">
                  <pre className="whitespace-pre-wrap break-words font-mono" style={{ tabSize: 2 }}>
                    {msg.content}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg px-2.5 py-1.5 text-[10px] bg-slate-800/60 text-slate-300 border border-white/5 space-y-1.5">
                  {msg.thinking && (
                    <div>
                      <span className="text-[8px] text-slate-600 uppercase tracking-wider block mb-0.5">Thinking</span>
                      <pre className="text-slate-500 whitespace-pre-wrap break-words font-mono text-[9px]" style={{ tabSize: 2 }}>
                        {msg.thinking}
                      </pre>
                    </div>
                  )}
                  <div>
                    {msg.thinking && (
                      <span className="text-[8px] text-slate-600 uppercase tracking-wider block mb-0.5">Output</span>
                    )}
                    <pre className="whitespace-pre-wrap break-words font-mono" style={{ tabSize: 2 }}>
                      {msg.content}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && messages.length === 0 && (
          <div className="flex justify-start">
            <div className="bg-slate-800/60 rounded-lg px-2.5 py-1.5 border border-white/5 flex items-center gap-1.5">
              <Loader2 size={10} className="text-slate-400 animate-spin" />
              <span className="text-[9px] text-slate-500">Connecting...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 flex gap-1.5 pt-2">
        <div className="flex-1 flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIncludeContext(!includeContext)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] transition-colors ${
                includeContext
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  : 'bg-slate-800/60 text-slate-500 border border-white/5 hover:text-slate-300'
              }`}
              title={includeContext ? 'Include project context' : 'Exclude project context'}
            >
              <FileText size={8} />
              <span>Context</span>
            </button>
          </div>
          <input
            type="text"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the model anything..."
            disabled={loading}
            className="flex-1 bg-slate-800/60 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600 transition-all disabled:opacity-50"
          />
        </div>
        <button
          onClick={() => {
            // Store the context for the send handler
            (window as any).__chatContext = includeContext ? buildContext() : '';
            onSend();
          }}
          disabled={loading || !input.trim()}
          className="px-2 py-1.5 rounded-lg bg-slate-700/50 text-slate-400 border border-white/10 hover:bg-slate-700 hover:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-end"
        >
          <Send size={10} />
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Live AI Tab
// ---------------------------------------------------------------------------

const LiveAITab: React.FC<{
  status: ThinkingInspectorProps['status'];
  thinkingText: string;
  outputText: string;
  modelName?: string;
  timingMetrics?: Record<string, number>;
  statusMessage?: string;
}> = ({ status, thinkingText, outputText, modelName, timingMetrics, statusMessage }) => {
  const statusLabel = {
    idle: '',
    loading_model: 'Loading model...',
    thinking: 'Generating...',
    done: 'Complete',
    error: 'Error',
  }[status];

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 space-y-3">
      {/* Status bar */}
      <div className="shrink-0 flex items-center justify-between">
        <span className="text-[9px] text-slate-500 truncate">
          {modelName}
        </span>
        <div className="flex items-center gap-2">
          {statusLabel && (
            <span className={`text-[8px] font-medium px-1.5 py-0.5 rounded ${
              status === 'error' ? 'text-red-400 bg-red-500/10' :
              status === 'done' ? 'text-emerald-400 bg-emerald-500/10' :
              status === 'loading_model' ? 'text-amber-400 bg-amber-500/10' :
              'text-slate-400 bg-slate-500/10'
            }`}>
              {statusLabel}
            </span>
          )}
        </div>
      </div>

      {/* Status message (batch progress, etc.) */}
      {statusMessage && status === 'thinking' && (
        <div className="shrink-0 flex items-center gap-2 px-2 py-1 bg-slate-800/40 rounded-lg border border-white/5">
          <Zap size={10} className="text-amber-400" />
          <span className="text-[9px] text-slate-400">{statusMessage}</span>
        </div>
      )}

      {/* Timing metrics — shown when generation completes */}
      {timingMetrics && Object.keys(timingMetrics).length > 0 && (
        <div className="shrink-0 grid grid-cols-2 gap-1.5">
          {Object.entries(timingMetrics).map(([label, ms]) => (
            <div key={label} className="flex items-center justify-between px-2 py-1 bg-slate-800/40 rounded border border-white/5">
              <span className="text-[8px] text-slate-500 uppercase">{label}</span>
              <span className="text-[9px] text-slate-300 font-mono">{(ms / 1000).toFixed(1)}s</span>
            </div>
          ))}
        </div>
      )}

      {/* Thinking section — light gray, collapsible, only when present */}
      <StreamingSection
        label="Thinking"
        color="gray"
        text={thinkingText}
        active={status === 'thinking' || status === 'loading_model'}
        collapsible
        defaultExpanded
      />

      {/* Output section — white, always visible during generation */}
      <StreamingSection
        label="Output"
        color="white"
        text={outputText}
        active={status === 'thinking' || status === 'loading_model'}
      />

      {/* Error display */}
      {status === 'error' && outputText && (
        <div className="bg-red-500/5 rounded-lg border border-red-500/10 p-2.5">
          <p className="text-[9px] text-red-400">{outputText}</p>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Inspector Panel — 350px inline sidebar
// ---------------------------------------------------------------------------

export const ThinkingInspector: React.FC<ThinkingInspectorProps> = ({
  open,
  onToggle,
  active,
  status,
  thinkingText,
  outputText,
  modelName,
  onChatSend,
  timingMetrics,
  statusMessage,
}) => {
  const [tab, setTab] = useState<InspectorTab>('live');
  const {
    chatMessages, chatInput, chatLoading,
    setChatInput, clearChatMessages,
  } = useDocuFlowStore();

  return (
    <div
      className={`flex-shrink-0 h-full border-l border-slate-800 bg-slate-950 flex flex-col transition-all duration-200 overflow-hidden ${
        open ? 'w-[350px]' : 'w-0 border-l-0'
      }`}
    >
      {open && (
        <div className="flex-1 flex flex-col overflow-hidden w-[350px]">
          {/* Header */}
          <div className="shrink-0 px-3 py-2 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Activity size={11} className={active ? 'text-amber-400' : 'text-slate-500'} />
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                Inspector
              </span>
            </div>
            <div className="flex items-center gap-2">
              {modelName && (
                <span className="text-[8px] text-slate-600 font-mono truncate max-w-[120px]">{modelName}</span>
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

          {/* Tab bar */}
          <div className="shrink-0 flex border-b border-white/5">
            <button
              onClick={() => setTab('live')}
              className={`flex-1 px-3 py-2 text-[10px] font-medium transition-colors ${
                tab === 'live'
                  ? 'text-amber-400 border-b-2 border-amber-400'
                  : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent'
              }`}
            >
              Live AI
            </button>
            <button
              onClick={() => setTab('chat')}
              className={`flex-1 px-3 py-2 text-[10px] font-medium transition-colors ${
                tab === 'chat'
                  ? 'text-amber-400 border-b-2 border-amber-400'
                  : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent'
              }`}
            >
              Chat
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden p-3 flex flex-col min-h-0">
            {tab === 'live' ? (
              <LiveAITab
                status={status}
                thinkingText={thinkingText}
                outputText={outputText}
                modelName={modelName}
                timingMetrics={timingMetrics}
                statusMessage={statusMessage}
              />
            ) : (
              <ChatTab
                messages={chatMessages}
                input={chatInput}
                loading={chatLoading}
                modelName={modelName}
                onInputChange={setChatInput}
                onSend={onChatSend}
                onClear={clearChatMessages}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
