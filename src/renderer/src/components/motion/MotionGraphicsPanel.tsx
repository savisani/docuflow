import React, { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Play, CheckCircle, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { useDocuFlowStore } from '../../app/store';
import { processMotionRequest } from '../../engine/motion';
import { MOTION_LIMITS } from '../../engine/motion/validator';
import type { MotionPlanV1, MotionComponent } from '../../engine/motion/types';
import type { Command } from '../../engine/commands/types';

export const MotionGraphicsPanel: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [status, setStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [compiledCommands, setCompiledCommands] = useState<Command[]>([]);
  const [components, setComponents] = useState<MotionComponent[]>([]);

  const {
    motionPlan, setMotionPlan, setMotionPreviewCommands,
    addCommand, beginBatch, endBatch, setActiveTab,
  } = useDocuFlowStore();

  const handleGenerate = useCallback(() => {
    if (!prompt.trim()) return;

    setStatus('generating');
    setError(null);

    // Build a minimal MotionPlan from user input
    const plan: MotionPlanV1 = {
      version: 1,
      metadata: {
        name: prompt.trim().slice(0, 200),
        createdAt: new Date().toISOString(),
      },
      canvas: { width: 1920, height: 1080 },
      duration,
      style: { visual: 'documentary', motion: 'subtle' },
      components: components.length > 0 ? components : [
        {
          type: 'statistic',
          data: { value: prompt.trim(), label: 'Motion Graphics' },
          timing: { start: 0, duration },
        },
      ],
    };

    // Validate via gateway
    const result = processMotionRequest({
      version: 1,
      operation: 'validatePlan',
      requestId: uuidv4(),
      plan,
    });

    if (result.status === 'error') {
      setStatus('error');
      setError(result.errors?.join('\n') || result.error || 'Validation failed');
      return;
    }

    // Compile via gateway
    const compileResult = processMotionRequest({
      version: 1,
      operation: 'compilePlan',
      requestId: uuidv4(),
      plan,
    });

    if (compileResult.status === 'error') {
      setStatus('error');
      setError(compileResult.error || 'Compilation failed');
      return;
    }

    const data = compileResult.data as { commands: Command[]; commandCount: number };
    setMotionPlan(plan);
    setCompiledCommands(data.commands);
    setMotionPreviewCommands(data.commands);
    setStatus('success');
  }, [prompt, duration, components, setMotionPlan, setMotionPreviewCommands]);

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

    setActiveTab('studio');
  }, [compiledCommands, addCommand, beginBatch, endBatch, setActiveTab]);

  const handleAddComponent = useCallback(() => {
    const newComponent: MotionComponent = {
      type: 'statistic',
      id: uuidv4(),
      data: { value: '0', label: 'New Statistic' },
      timing: { start: 0, duration: 3 },
    };
    setComponents((prev) => [...prev, newComponent]);
  }, []);

  const handleRemoveComponent = useCallback((index: number) => {
    setComponents((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpdateComponent = useCallback((index: number, field: string, value: string) => {
    setComponents((prev) => prev.map((comp, i) => {
      if (i !== index) return comp;
      if (field === 'value' || field === 'label') {
        return { ...comp, data: { ...comp.data, [field]: value } };
      }
      return comp;
    }));
  }, []);

  return (
    <div className="w-full h-full flex flex-col bg-df-bg overflow-auto">
      <div className="p-4 border-b border-df-border">
        <h2 className="text-df-sm font-semibold text-df-text-primary mb-3">AI Motion Graphics</h2>

        {/* Prompt */}
        <div className="mb-3">
          <label className="block text-df-xs text-df-text-muted mb-1">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe your motion graphics..."
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

        {/* Components */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label className="text-df-xs text-df-text-muted">Components</label>
            <button
              onClick={handleAddComponent}
              className="flex items-center gap-1 px-1.5 py-0.5 text-df-xs text-df-accent hover:bg-df-surface-2 rounded-df-sm transition-colors"
            >
              <Plus size={10} />
              <span>Add</span>
            </button>
          </div>
          {components.length === 0 && (
            <div className="text-df-xs text-df-text-dim italic">No components added. One will be created from your prompt.</div>
          )}
          {components.map((comp, idx) => (
            <div key={comp.id || idx} className="flex gap-1 mb-1 items-center">
              <input
                value={comp.data.value}
                onChange={(e) => handleUpdateComponent(idx, 'value', e.target.value)}
                placeholder="Value"
                className="flex-1 px-2 py-1 text-df-xs bg-df-surface-1 border border-df-border rounded-df-sm text-df-text-primary focus:outline-none focus:border-df-accent"
              />
              <input
                value={comp.data.label}
                onChange={(e) => handleUpdateComponent(idx, 'label', e.target.value)}
                placeholder="Label"
                className="flex-1 px-2 py-1 text-df-xs bg-df-surface-1 border border-df-border rounded-df-sm text-df-text-primary focus:outline-none focus:border-df-accent"
              />
              <button
                onClick={() => handleRemoveComponent(idx)}
                className="w-6 h-6 flex items-center justify-center text-df-text-muted hover:text-df-error hover:bg-df-surface-2 rounded-df-sm transition-colors"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || status === 'generating'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-df-xs font-medium bg-df-accent text-white rounded-df-sm hover:bg-df-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={10} />
            <span>Generate Plan</span>
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

      {/* Status */}
      {status === 'error' && error && (
        <div className="p-3 mx-4 mt-3 bg-df-error/10 border border-df-error/30 rounded-df-sm flex items-start gap-2">
          <AlertCircle size={12} className="text-df-error mt-0.5 shrink-0" />
          <div className="text-df-xs text-df-error whitespace-pre-wrap">{error}</div>
        </div>
      )}

      {status === 'success' && (
        <div className="p-3 mx-4 mt-3 bg-df-success/10 border border-df-success/30 rounded-df-sm flex items-start gap-2">
          <CheckCircle size={12} className="text-df-success mt-0.5 shrink-0" />
          <div className="text-df-xs text-df-success">
            Plan compiled: {compiledCommands.length} commands generated.
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

      {/* MotionPlan JSON Preview */}
      {motionPlan && (
        <div className="p-4 border-t border-df-border">
          <h3 className="text-df-xs font-semibold text-df-text-muted mb-2">MotionPlan JSON</h3>
          <pre className="p-2 text-df-xs bg-df-surface-1 border border-df-border rounded-df-sm text-df-text-secondary overflow-auto max-h-60 font-mono">
            {JSON.stringify(motionPlan, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
