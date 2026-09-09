import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Play, CheckCircle, AlertCircle, Plus, Loader2, RefreshCw, ChevronDown, Eye } from 'lucide-react';
import { useDocuFlowStore } from '../../app/store';
import { processMotionRequest, MOTION_LIMITS } from '../../engine/motion';
import { OllamaMotionProvider } from '../../engine/motion/director/providers/ollama';
import { parseAIResponse } from '../../engine/motion/director/parser';
import { processOperations } from '../../engine/motion/director/operations';
import { fetchOllamaModels, type OllamaModel } from '../../services/aiService';
import type { MotionPlanV1, MotionComponent } from '../../engine/motion/types';
import type { Command } from '../../engine/commands/types';
import type { MotionProviderResponse } from '../../engine/motion/director/provider';

// ── Error Classification ───────────────────────────────────────

type ErrorType =
  | 'ollama-unavailable'
  | 'model-unavailable'
  | 'ai-error'
  | 'parse-error'
  | 'validation-error'
  | 'gateway-rejection'
  | 'unsupported-component'
  | 'blocked-remove'
  | 'unknown';

interface ClassifiedError {
  type: ErrorType;
  message: string;
  details?: string;
}

function classifyError(error: string, context?: { parseErrors?: Array<{ message: string }>; validationErrors?: string[] }): ClassifiedError {
  const lower = error.toLowerCase();

  if (lower.includes('ollama') && (lower.includes('unavailable') || lower.includes('refused') || lower.includes('failed to fetch') || lower.includes('econnrefused'))) {
    return { type: 'ollama-unavailable', message: 'Ollama is not running or not reachable.', details: 'Start Ollama and ensure it is listening on localhost:11434.' };
  }

  if (lower.includes('ollama') && lower.includes('404')) {
    return { type: 'model-unavailable', message: 'Selected model is not available in Ollama.', details: 'Pull the model with: ollama pull <model-name>' };
  }

  if (context?.parseErrors && context.parseErrors.length > 0) {
    const msgs = context.parseErrors.map((e) => e.message).join('\n');
    return { type: 'parse-error', message: 'AI response could not be parsed.', details: msgs };
  }

  if (context?.validationErrors && context.validationErrors.length > 0) {
    const msgs = context.validationErrors.join('\n');
    return { type: 'validation-error', message: 'AI response failed validation.', details: msgs };
  }

  if (lower.includes('remove') && lower.includes('blocked')) {
    return { type: 'blocked-remove', message: 'AI requested a REMOVE operation which is blocked.', details: 'REMOVE operations require explicit user confirmation and are not automatically executed.' };
  }

  if (lower.includes('unsupported') || lower.includes('unknown component')) {
    return { type: 'unsupported-component', message: 'AI used an unsupported component type.', details: error };
  }

  if (lower.includes('validation') || lower.includes('invalid')) {
    return { type: 'validation-error', message: 'AI response failed validation.', details: error };
  }

  return { type: 'unknown', message: error };
}

// ── Component ──────────────────────────────────────────────────

export const MotionGraphicsPanel: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [selectedModel, setSelectedModel] = useState('gemma3:1b');
  const [availableModels, setAvailableModels] = useState<OllamaModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [ollamaAvailable, setOllamaAvailable] = useState<boolean | null>(null);

  const [status, setStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [classifiedError, setClassifiedError] = useState<ClassifiedError | null>(null);
  const [aiResponse, setAiResponse] = useState<string>('');
  const [motionPlan, setLocalMotionPlan] = useState<MotionPlanV1 | null>(null);
  const [compiledCommands, setCompiledCommands] = useState<Command[]>([]);
  const [blockedOps, setBlockedOps] = useState<string[]>([]);
  const [showRaw, setShowRaw] = useState(false);

  const providerRef = useRef(new OllamaMotionProvider());

  const {
    setMotionPlan: storeSetMotionPlan,
    setMotionPreviewCommands,
    addCommand,
    beginBatch,
    endBatch,
    setActiveTab,
    settings,
  } = useDocuFlowStore();

  // ── On Mount: Check Ollama + Fetch Models ────────────────────

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setModelsLoading(true);
      try {
        const available = await providerRef.current.isAvailable();
        if (cancelled) return;
        setOllamaAvailable(available);

        if (!available) {
          setModelsLoading(false);
          return;
        }

        const models = await fetchOllamaModels();
        if (cancelled) return;
        setAvailableModels(models);

        // If default model not available, try to select the first available one
        const modelNames = models.map((m) => m.name);
        if (!modelNames.includes(selectedModel)) {
          // Check for partial match (e.g., "gemma3:1b" vs "gemma3:4b")
          const defaultPrefix = selectedModel.split(':')[0];
          const partialMatch = modelNames.find((n) => n.startsWith(defaultPrefix));
          if (partialMatch) {
            setSelectedModel(partialMatch);
          } else if (modelNames.length > 0) {
            // Don't silently switch — just leave the default selected
            // The user will see an error if they try to generate with an unavailable model
          }
        }
      } catch {
        if (!cancelled) setOllamaAvailable(false);
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate Handler ─────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;

    setStatus('generating');
    setClassifiedError(null);
    setAiResponse('');
    setLocalMotionPlan(null);
    setCompiledCommands([]);
    setBlockedOps([]);

    // 1. Check Ollama availability
    const available = await providerRef.current.isAvailable();
    if (!available) {
      setStatus('error');
      setClassifiedError({ type: 'ollama-unavailable', message: 'Ollama is not running or not reachable.', details: 'Start Ollama and ensure it is listening on localhost:11434.' });
      return;
    }

    // 2. Build provider with selected model
    const provider = new OllamaMotionProvider({ model: selectedModel });

    // 3. Send request to AI
    const aiResult: MotionProviderResponse = await provider.generate({
      prompt: prompt.trim(),
      canvasWidth: settings.width,
      canvasHeight: settings.height,
      duration,
    });

    if (aiResult.finishReason === 'error') {
      setStatus('error');
      setClassifiedError(classifyError(aiResult.error || 'Unknown AI error'));
      return;
    }

    setAiResponse(aiResult.text);

    // 4. Parse response → MotionPlanV1
    const parseResult = parseAIResponse(aiResult.text, {
      canvasWidth: settings.width,
      canvasHeight: settings.height,
      defaultDuration: duration,
    });

    if (!parseResult.success) {
      setStatus('error');
      setClassifiedError(classifyError('Parse failed', { parseErrors: parseResult.errors }));
      return;
    }

    // 5. Check for blocked operations
    const opResult = processOperations(parseResult.operations, []);
    const blockedNames = opResult.blocked.map((op) => `REMOVE: ${op.reason || 'no reason'}`);
    if (blockedNames.length > 0) {
      setBlockedOps(blockedNames);
    }

    // 6. Validate plan via gateway
    const plan = parseResult.plan!;
    const validationResult = processMotionRequest({
      version: 1,
      operation: 'validatePlan',
      requestId: crypto.randomUUID(),
      plan,
    });

    if (validationResult.status === 'error') {
      setStatus('error');
      setClassifiedError(classifyError('Validation failed', { validationErrors: validationResult.errors }));
      return;
    }

    // 7. Compile plan via gateway
    const compileResult = processMotionRequest({
      version: 1,
      operation: 'compilePlan',
      requestId: crypto.randomUUID(),
      plan,
    });

    if (compileResult.status === 'error') {
      setStatus('error');
      setClassifiedError(classifyError(compileResult.error || 'Compilation failed'));
      return;
    }

    // 8. Success — show preview
    const data = compileResult.data as { commands: Command[]; commandCount: number };
    setLocalMotionPlan(plan);
    setCompiledCommands(data.commands);
    storeSetMotionPlan(plan);
    setMotionPreviewCommands(data.commands);
    setStatus('success');
  }, [prompt, duration, selectedModel, settings.width, settings.height, storeSetMotionPlan, setMotionPreviewCommands]);

  // ── Add to Timeline ──────────────────────────────────────────

  const handleAddToTimeline = useCallback(() => {
    if (compiledCommands.length === 0) return;

    beginBatch();
    try {
      for (const cmd of compiledCommands) {
        addCommand(cmd);
      }
    } finally {
      endBatch();
    }

    setCompiledCommands([]);
    setActiveTab('studio');
  }, [compiledCommands, addCommand, beginBatch, endBatch, setActiveTab]);

  // ── Render ───────────────────────────────────────────────────

  const isGenerating = status === 'generating';
  const canGenerate = prompt.trim() && !isGenerating && ollamaAvailable !== false;
  const modelNames = availableModels.map((m) => m.name);

  return (
    <div className="w-full h-full flex flex-col bg-df-bg overflow-auto">
      <div className="p-4 border-b border-df-border">
        <h2 className="text-df-sm font-semibold text-df-text-primary mb-3">AI Motion Director</h2>

        {/* Provider Selection */}
        <div className="mb-3">
          <label className="block text-df-xs text-df-text-muted mb-1">Provider</label>
          <div className="px-2 py-1.5 text-df-xs bg-df-surface-1 border border-df-border rounded-df-sm text-df-text-primary">
            Ollama (local)
          </div>
        </div>

        {/* Model Selection */}
        <div className="mb-3">
          <label className="block text-df-xs text-df-text-muted mb-1">Model</label>
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={modelsLoading || ollamaAvailable === false}
              className="w-full appearance-none px-2 py-1.5 pr-7 text-df-xs bg-df-surface-1 border border-df-border rounded-df-sm text-df-text-primary focus:outline-none focus:border-df-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {modelsLoading && <option value="">Loading models...</option>}
              {!modelsLoading && ollamaAvailable === false && <option value="">Ollama unavailable</option>}
              {!modelsLoading && ollamaAvailable === true && modelNames.length === 0 && (
                <option value="">No models installed</option>
              )}
              {modelNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-df-text-muted pointer-events-none" />
          </div>
          {!modelsLoading && ollamaAvailable === true && modelNames.length > 0 && !modelNames.includes(selectedModel) && (
            <div className="mt-1 text-df-xs text-df-warning">
              Default model "{selectedModel}" not found. Available: {modelNames.slice(0, 3).join(', ')}{modelNames.length > 3 ? '...' : ''}
            </div>
          )}
          {!modelsLoading && ollamaAvailable === true && (
            <button
              onClick={async () => {
                setModelsLoading(true);
                const models = await fetchOllamaModels();
                setAvailableModels(models);
                setModelsLoading(false);
              }}
              className="mt-1 flex items-center gap-1 text-df-xs text-df-text-muted hover:text-df-accent transition-colors"
            >
              <RefreshCw size={10} />
              <span>Refresh models</span>
            </button>
          )}
        </div>

        {/* Prompt */}
        <div className="mb-3">
          <label className="block text-df-xs text-df-text-muted mb-1">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='e.g. "Show a statistic saying 42% in the center for 4 seconds."'
            className="w-full h-20 px-2 py-1.5 text-df-xs bg-df-surface-1 border border-df-border rounded-df-sm text-df-text-primary placeholder-df-text-dim resize-none focus:outline-none focus:border-df-accent"
          />
        </div>

        {/* Duration */}
        <div className="mb-3">
          <label className="block text-df-xs text-df-text-muted mb-1">Duration (seconds)</label>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(Math.max(0.1, Math.min(MOTION_LIMITS.MAX_DURATION, Number(e.target.value))))}
            min={0.1}
            max={MOTION_LIMITS.MAX_DURATION}
            step={0.5}
            className="w-24 px-2 py-1 text-df-xs bg-df-surface-1 border border-df-border rounded-df-sm text-df-text-primary focus:outline-none focus:border-df-accent"
          />
        </div>

        {/* Generate Button */}
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-df-xs font-medium bg-df-accent text-white rounded-df-sm hover:bg-df-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <Loader2 size={10} className="animate-spin" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <Play size={10} />
                <span>Generate</span>
              </>
            )}
          </button>
          {compiledCommands.length > 0 && (
            <button
              onClick={handleAddToTimeline}
              className="flex items-center gap-1.5 px-3 py-1.5 text-df-xs font-medium bg-df-surface-2 text-df-text-primary border border-df-border rounded-df-sm hover:bg-df-surface-3 transition-colors"
            >
              <Plus size={10} />
              <span>Add to Timeline</span>
            </button>
          )}
        </div>
      </div>

      {/* Ollama Unavailable Banner */}
      {ollamaAvailable === false && (
        <div className="p-3 mx-4 mt-3 bg-df-warning/10 border border-df-warning/30 rounded-df-sm flex items-start gap-2">
          <AlertCircle size={12} className="text-df-warning mt-0.5 shrink-0" />
          <div className="text-df-xs text-df-warning">
            <div className="font-medium">Ollama is not running</div>
            <div className="mt-0.5 text-df-text-muted">Start Ollama and ensure it is listening on localhost:11434.</div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {status === 'error' && classifiedError && (
        <div className="p-3 mx-4 mt-3 bg-df-error/10 border border-df-error/30 rounded-df-sm flex items-start gap-2">
          <AlertCircle size={12} className="text-df-error mt-0.5 shrink-0" />
          <div className="text-df-xs text-df-error whitespace-pre-wrap">
            <div className="font-medium">{classifiedError.message}</div>
            {classifiedError.details && (
              <div className="mt-1 text-df-text-muted whitespace-pre-wrap">{classifiedError.details}</div>
            )}
          </div>
        </div>
      )}

      {/* Blocked Operations Warning */}
      {blockedOps.length > 0 && (
        <div className="p-3 mx-4 mt-3 bg-df-warning/10 border border-df-warning/30 rounded-df-sm flex items-start gap-2">
          <AlertCircle size={12} className="text-df-warning mt-0.5 shrink-0" />
          <div className="text-df-xs text-df-warning">
            <div className="font-medium">Blocked operations:</div>
            {blockedOps.map((op, i) => (
              <div key={i} className="mt-0.5 text-df-text-muted">{op}</div>
            ))}
            <div className="mt-1 text-df-text-muted">These operations require explicit user confirmation.</div>
          </div>
        </div>
      )}

      {/* Success Display */}
      {status === 'success' && (
        <div className="p-3 mx-4 mt-3 bg-df-success/10 border border-df-success/30 rounded-df-sm flex items-start gap-2">
          <CheckCircle size={12} className="text-df-success mt-0.5 shrink-0" />
          <div className="text-df-xs text-df-success">
            Plan compiled: {compiledCommands.length} commands generated.
            {blockedOps.length > 0 && ` (${blockedOps.length} blocked operations)`}
          </div>
        </div>
      )}

      {/* Compiled Commands Preview */}
      {compiledCommands.length > 0 && (
        <div className="p-4">
          <h3 className="text-df-xs font-semibold text-df-text-muted mb-2">Compiled Commands</h3>
          <div className="space-y-1">
            {compiledCommands.map((cmd) => (
              <div
                key={cmd.id}
                className="px-2 py-1 text-df-xs bg-df-surface-1 border border-df-border rounded-df-sm text-df-text-secondary font-mono"
              >
                {cmd.type}
                {'content' in cmd ? ` — ${(cmd as any).content}` : ''}
                {'target' in cmd ? ` → ${(cmd as any).target}` : ''}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Raw AI Response Toggle */}
      {aiResponse && (
        <div className="p-4 border-t border-df-border">
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="flex items-center gap-1.5 text-df-xs text-df-text-muted hover:text-df-accent transition-colors mb-2"
          >
            <Eye size={10} />
            <span>{showRaw ? 'Hide' : 'Show'} Raw AI Response</span>
          </button>
          {showRaw && (
            <pre className="p-2 text-df-xs bg-df-surface-1 border border-df-border rounded-df-sm text-df-text-secondary overflow-auto max-h-60 font-mono whitespace-pre-wrap">
              {aiResponse}
            </pre>
          )}
        </div>
      )}

      {/* MotionPlan Preview */}
      {motionPlan && (
        <div className="p-4 border-t border-df-border">
          <h3 className="text-df-xs font-semibold text-df-text-muted mb-2">MotionPlan</h3>
          <div className="space-y-1 text-df-xs text-df-text-secondary">
            <div>Components: {motionPlan.components.length}</div>
            <div>Canvas: {motionPlan.canvas.width}x{motionPlan.canvas.height}</div>
            <div>Duration: {motionPlan.duration}s</div>
            {motionPlan.components.map((comp: MotionComponent, i: number) => (
              <div key={i} className="px-2 py-1 bg-df-surface-1 border border-df-border rounded-df-sm font-mono">
                {comp.type}: {'value' in comp.data ? comp.data.value : ''}
                {'label' in comp.data ? ` — ${comp.data.label}` : ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
