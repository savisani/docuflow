import React, { useCallback, useState, useMemo } from 'react';
import { useDocuFlowStore } from '../../app/store';
import { v4 as uuidv4 } from 'uuid';
import { EasingType } from '../../engine/commands/types';
import { KeyframeTrack, Keyframe } from '../../types/timeline';
import { Sparkles, Plus, Trash2, Key, Move, Maximize2, RotateCcw, Eye, EyeOff, ChevronDown, ChevronRight, GripVertical, ArrowRightLeft } from 'lucide-react';
import { Panel, Section, Divider, IconButton, Tooltip, Slider, NumberInput, Badge } from '../ui';

interface AnimationPreset {
  name: string;
  description: string;
  icon: React.ReactNode;
  apply: (targetId: string, startSec: number) => any[];
}

const ANIMATION_PRESETS: AnimationPreset[] = [
  {
    name: 'Fade In',
    description: 'Opacity 0→1 over 1s',
    icon: <Eye size={12} />,
    apply: (target, start) => [{
      id: uuidv4(),
      type: 'fadeIn',
      target,
      start,
      duration: 1,
    }],
  },
  {
    name: 'Fade Out',
    description: 'Opacity 1→0 over 1s',
    icon: <EyeOff size={12} />,
    apply: (target, start) => [{
      id: uuidv4(),
      type: 'fadeOut',
      target,
      start,
      duration: 1,
    }],
  },
  {
    name: 'Slide In Left',
    description: 'Slide from left over 0.8s',
    icon: <Move size={12} />,
    apply: (target, start) => [{
      id: uuidv4(),
      type: 'move',
      target,
      start,
      duration: 0.8,
      from: { x: -1920, y: 0 },
      to: { x: 0, y: 0 },
      easing: 'easeOut',
    }],
  },
  {
    name: 'Slide In Right',
    description: 'Slide from right over 0.8s',
    icon: <Move size={12} />,
    apply: (target, start) => [{
      id: uuidv4(),
      type: 'move',
      target,
      start,
      duration: 0.8,
      from: { x: 1920, y: 0 },
      to: { x: 0, y: 0 },
      easing: 'easeOut',
    }],
  },
  {
    name: 'Slide In Top',
    description: 'Slide from top over 0.8s',
    icon: <Move size={12} />,
    apply: (target, start) => [{
      id: uuidv4(),
      type: 'move',
      target,
      start,
      duration: 0.8,
      from: { x: 0, y: -1080 },
      to: { x: 0, y: 0 },
      easing: 'easeOut',
    }],
  },
  {
    name: 'Slide In Bottom',
    description: 'Slide from bottom over 0.8s',
    icon: <Move size={12} />,
    apply: (target, start) => [{
      id: uuidv4(),
      type: 'move',
      target,
      start,
      duration: 0.8,
      from: { x: 0, y: 1080 },
      to: { x: 0, y: 0 },
      easing: 'easeOut',
    }],
  },
  {
    name: 'Zoom In',
    description: 'Scale 1→1.3 over 1s',
    icon: <Maximize2 size={12} />,
    apply: (target, start) => [{
      id: uuidv4(),
      type: 'scale',
      target,
      start,
      duration: 1,
      from: 1,
      to: 1.3,
      easing: 'easeOut',
    }],
  },
  {
    name: 'Zoom Out',
    description: 'Scale 1→0.7 over 1s',
    icon: <Maximize2 size={12} />,
    apply: (target, start) => [{
      id: uuidv4(),
      type: 'scale',
      target,
      start,
      duration: 1,
      from: 1,
      to: 0.7,
      easing: 'easeOut',
    }],
  },
  {
    name: 'Slow Zoom (Ken Burns)',
    description: 'Scale 1→1.1 over 5s',
    icon: <Maximize2 size={12} />,
    apply: (target, start) => [{
      id: uuidv4(),
      type: 'scale',
      target,
      start,
      duration: 5,
      from: 1,
      to: 1.1,
      easing: 'linear',
    }],
  },
  {
    name: 'Pop In',
    description: 'Scale 0→1.1→1 over 0.5s',
    icon: <Sparkles size={12} />,
    apply: (target, start) => [
      {
        id: uuidv4(),
        type: 'setKeyframes',
        target,
        start,
        property: 'scale',
        keyframes: [
          { time: start, value: 0, easing: 'easeOut' },
          { time: start + 0.35, value: 1.1, easing: 'easeIn' },
          { time: start + 0.5, value: 1, easing: 'linear' },
        ],
      },
    ],
  },
  {
    name: 'Blur In',
    description: 'Blur 10→0 over 1s',
    icon: <Eye size={12} />,
    apply: (target, start) => [{
      id: uuidv4(),
      type: 'blur',
      target,
      start,
      duration: 1,
      from: 10,
      to: 0,
      easing: 'easeOut',
    }],
  },
  {
    name: 'Blur Out',
    description: 'Blur 0→10 over 1s',
    icon: <EyeOff size={12} />,
    apply: (target, start) => [{
      id: uuidv4(),
      type: 'blur',
      target,
      start,
      duration: 1,
      from: 0,
      to: 10,
      easing: 'easeIn',
    }],
  },
  {
    name: 'Rotate In',
    description: 'Rotate 0→360° over 1s',
    icon: <RotateCcw size={12} />,
    apply: (target, start) => [{
      id: uuidv4(),
      type: 'rotate',
      target,
      start,
      duration: 1,
      from: 0,
      to: 360,
      easing: 'easeOut',
    }],
  },
];

interface TransitionPreset {
  name: string;
  description: string;
  icon: React.ReactNode;
  apply: (targetId: string, toAssetId: string, startSec: number, durationSec: number) => any[];
}

const TRANSITION_PRESETS: TransitionPreset[] = [
  {
    name: 'Cross Dissolve',
    description: 'Fade out current, fade in next',
    icon: <ArrowRightLeft size={12} />,
    apply: (target, toAsset, start, duration) => [{
      id: uuidv4(),
      type: 'crossfade',
      target,
      toAsset,
      start,
      duration: duration || 1,
    }],
  },
  {
    name: 'Slide Left',
    description: 'Current slides left, next slides in from right',
    icon: <Move size={12} />,
    apply: (target, toAsset, start, duration) => [{
      id: uuidv4(),
      type: 'slide',
      target,
      fromAsset: toAsset,
      direction: 'left',
      start,
      duration: duration || 0.8,
    }],
  },
  {
    name: 'Slide Right',
    description: 'Current slides right, next slides in from left',
    icon: <Move size={12} />,
    apply: (target, toAsset, start, duration) => [{
      id: uuidv4(),
      type: 'slide',
      target,
      fromAsset: toAsset,
      direction: 'right',
      start,
      duration: duration || 0.8,
    }],
  },
  {
    name: 'Slide Up',
    description: 'Current slides up, next slides in from bottom',
    icon: <Move size={12} />,
    apply: (target, toAsset, start, duration) => [{
      id: uuidv4(),
      type: 'slide',
      target,
      fromAsset: toAsset,
      direction: 'top',
      start,
      duration: duration || 0.8,
    }],
  },
  {
    name: 'Slide Down',
    description: 'Current slides down, next slides in from top',
    icon: <Move size={12} />,
    apply: (target, toAsset, start, duration) => [{
      id: uuidv4(),
      type: 'slide',
      target,
      fromAsset: toAsset,
      direction: 'bottom',
      start,
      duration: duration || 0.8,
    }],
  },
  {
    name: 'Wipe Right',
    description: 'Reveal next clip from left to right',
    icon: <ArrowRightLeft size={12} />,
    apply: (target, toAsset, start, duration) => [{
      id: uuidv4(),
      type: 'wipe',
      target,
      toAsset,
      direction: 'right',
      start,
      duration: duration || 1,
    }],
  },
  {
    name: 'Zoom Dissolve',
    description: 'Cross dissolve with zoom effect',
    icon: <Maximize2 size={12} />,
    apply: (target, toAsset, start, duration) => [
      {
        id: uuidv4(),
        type: 'crossfade',
        target,
        toAsset,
        start,
        duration: duration || 1,
      },
      {
        id: uuidv4(),
        type: 'scale',
        target,
        start,
        duration: duration || 1,
        from: 1,
        to: 1.15,
        easing: 'easeIn',
      },
    ],
  },
];

const ANIMATABLE_PROPERTIES = [
  { key: 'x', label: 'Position X', icon: Move },
  { key: 'y', label: 'Position Y', icon: Move },
  { key: 'scale', label: 'Scale', icon: Maximize2 },
  { key: 'rotationZ', label: 'Rotation', icon: RotateCcw },
  { key: 'opacity', label: 'Opacity', icon: Eye },
  { key: 'blur', label: 'Blur', icon: EyeOff },
];

const EASING_OPTIONS: { value: EasingType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeIn', label: 'Ease In' },
  { value: 'easeOut', label: 'Ease Out' },
  { value: 'easeInOut', label: 'Ease In-Out' },
];

export const AnimationPanel: React.FC = () => {
  const { commands, selectedCommandId, timeline, currentTime, settings, addCommand, updateCommand, removeCommand, beginBatch, endBatch } = useDocuFlowStore();
  const [expandedPresets, setExpandedPresets] = useState(true);
  const [expandedTransitions, setExpandedTransitions] = useState(true);
  const [expandedKeyframes, setExpandedKeyframes] = useState(true);

  const selectedCommand = commands.find(c => c.id === selectedCommandId);
  const isShowCommand = selectedCommand?.type === 'show';
  const layer = isShowCommand && timeline ? timeline.layers[selectedCommandId!] : null;

  const handleApplyPreset = useCallback((preset: AnimationPreset) => {
    if (!selectedCommand || !isShowCommand) return;
    const startSec = selectedCommand.start + (('duration' in selectedCommand) ? (selectedCommand as any).duration || 3 : 3);
    const newCommands = preset.apply(selectedCommandId!, startSec);
    beginBatch();
    for (const cmd of newCommands) {
      addCommand(cmd);
    }
    endBatch();
  }, [selectedCommand, selectedCommandId, isShowCommand, addCommand, beginBatch, endBatch]);

  const handleAddKeyframe = useCallback((property: string) => {
    if (!selectedCommandId || !isShowCommand) return;
    const currentTimeSec = currentTime;
    const existingKeyframeCmd = commands.find(
      c => c.type === 'setKeyframes' && (c as any).target === selectedCommandId && (c as any).property === property
    );

    if (existingKeyframeCmd) {
      const existing = existingKeyframeCmd as any;
      const newKeyframes = [...(existing.keyframes || []), { time: currentTimeSec, value: 1, easing: 'linear' }];
      newKeyframes.sort((a: any, b: any) => a.time - b.time);
      updateCommand(existingKeyframeCmd.id, { keyframes: newKeyframes });
    } else {
      addCommand({
        id: uuidv4(),
        type: 'setKeyframes',
        target: selectedCommandId,
        start: 0,
        property,
        keyframes: [{ time: currentTimeSec, value: 1, easing: 'linear' }],
      });
    }
  }, [selectedCommandId, isShowCommand, currentTime, commands, addCommand, updateCommand]);

  const handleUpdateKeyframe = useCallback((cmdId: string, property: string, keyframeIndex: number, updates: Partial<Keyframe>) => {
    const cmd = commands.find(c => c.id === cmdId);
    if (!cmd || cmd.type !== 'setKeyframes') return;
    const newKeyframes = [...(cmd as any).keyframes];
    newKeyframes[keyframeIndex] = { ...newKeyframes[keyframeIndex], ...updates };
    newKeyframes.sort((a: any, b: any) => a.time - b.time);
    updateCommand(cmdId, { keyframes: newKeyframes });
  }, [commands, updateCommand]);

  const handleRemoveKeyframe = useCallback((cmdId: string, keyframeIndex: number) => {
    const cmd = commands.find(c => c.id === cmdId);
    if (!cmd || cmd.type !== 'setKeyframes') return;
    const newKeyframes = [...(cmd as any).keyframes];
    newKeyframes.splice(keyframeIndex, 1);
    if (newKeyframes.length === 0) {
      removeCommand(cmdId);
    } else {
      updateCommand(cmdId, { keyframes: newKeyframes });
    }
  }, [commands, updateCommand, removeCommand]);

  const keyframeCommands = useMemo(() => {
    if (!selectedCommandId) return [];
    return commands.filter(
      c => c.type === 'setKeyframes' && (c as any).target === selectedCommandId
    );
  }, [commands, selectedCommandId]);

  const existingAnimationCommands = useMemo(() => {
    if (!selectedCommandId) return [];
    return commands.filter(
      c => c.type !== 'show' && c.type !== 'hide' && c.type !== 'setKeyframes' &&
           (c as any).target === selectedCommandId
    );
  }, [commands, selectedCommandId]);

  return (
    <Panel title="Animation" icon={<Sparkles size={10} />} className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-df-divider text-df-xs font-semibold text-df-text-muted uppercase tracking-wider shrink-0">
        Animation
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 scrollbar-thin">
        {!selectedCommand || !isShowCommand ? (
          <div className="text-center text-df-text-muted py-8">
            <Sparkles size={24} className="mx-auto mb-2 opacity-50" />
            <p className="text-df-sm">Select an image/video clip on the timeline to animate it.</p>
          </div>
        ) : (
          <>
            {/* Animation Presets */}
            <Section
              title="Presets"
              icon={<Sparkles size={10} />}
              className="space-y-1"
              collapsible
              defaultOpen={expandedPresets}
            >
              <div className="grid grid-cols-2 gap-1.5">
                {ANIMATION_PRESETS.map((preset) => (
                  <Tooltip key={preset.name} content={preset.description}>
                    <button
                      onClick={() => handleApplyPreset(preset)}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-df-md bg-df-surface-2 hover:bg-df-accent-muted border border-df-border hover:border-df-accent/30 transition-all text-df-sm text-df-text-secondary hover:text-df-text-primary cursor-pointer"
                    >
                      {preset.icon}
                      <span className="truncate">{preset.name}</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
            </Section>

            {/* Transition Presets */}
            <Section
              title="Transitions"
              icon={<ArrowRightLeft size={10} />}
              className="space-y-1"
              collapsible
              defaultOpen={expandedTransitions}
            >
              <div className="text-df-xs text-df-text-muted mb-1.5">
                Select a clip, then apply a transition to add it after the clip ends.
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {TRANSITION_PRESETS.map((preset) => (
                  <Tooltip key={preset.name} content={preset.description}>
                    <button
                      onClick={() => {
                        if (!selectedCommand || !isShowCommand) return;
                        const duration = ('duration' in selectedCommand) ? (selectedCommand as any).duration || 3 : 3;
                        const startSec = selectedCommand.start + duration;
                        const newCommands = preset.apply(selectedCommandId!, '', startSec, 1);
                        beginBatch();
                        for (const cmd of newCommands) {
                          addCommand(cmd);
                        }
                        endBatch();
                      }}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-df-md bg-df-surface-2 hover:bg-df-success-muted border border-df-border hover:border-df-success/30 transition-all text-df-sm text-df-text-secondary hover:text-df-text-primary cursor-pointer"
                    >
                      {preset.icon}
                      <span className="truncate">{preset.name}</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
            </Section>

            {/* Existing Animations */}
            {existingAnimationCommands.length > 0 && (
              <Section
                title={`Active Animations (${existingAnimationCommands.length})`}
                icon={<Key size={10} />}
                className="space-y-1"
              >
                {existingAnimationCommands.map((cmd) => (
                  <div key={cmd.id} className="flex items-center gap-2 px-2 py-1.5 rounded-df-md bg-df-surface-2 border border-df-border text-df-sm">
                    <span className="text-df-accent font-mono">{cmd.type}</span>
                    {'from' in cmd && 'to' in cmd && (
                      <span className="text-df-text-muted">
                        {(cmd as any).from} → {(cmd as any).to}
                      </span>
                    )}
                    <span className="text-df-text-dim ml-auto">{(cmd as any).duration || '?'}s</span>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label="Remove animation"
                      onClick={() => removeCommand(cmd.id)}
                      className="opacity-50 hover:opacity-100"
                    >
                      <Trash2 size={10} />
                    </IconButton>
                  </div>
                ))}
              </Section>
            )}

            {/* Keyframe Editor */}
            <Section
              title="Keyframes"
              icon={<Key size={10} />}
              className="space-y-2"
              collapsible
              defaultOpen={expandedKeyframes}
            >
              {ANIMATABLE_PROPERTIES.map(({ key, label, icon: Icon }) => {
                const kfCmd = keyframeCommands.find(c => (c as any).property === key);
                const keyframes = kfCmd ? (kfCmd as any).keyframes : [];

                return (
                  <div key={key} className="bg-df-surface-2 rounded-df-md border border-df-border p-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5 text-df-sm text-df-text-primary">
                        <Icon size={10} className="text-df-text-muted" />
                        <span>{label}</span>
                        {keyframes.length > 0 && (
                          <Badge variant="info" className="text-df-xs">{keyframes.length}</Badge>
                        )}
                      </div>
                      <Tooltip content={`Add keyframe at ${currentTime.toFixed(1)}s`}>
                        <IconButton size="sm" variant="ghost" aria-label="Add keyframe" onClick={() => handleAddKeyframe(key)}>
                          <Plus size={10} />
                        </IconButton>
                      </Tooltip>
                    </div>

                    {keyframes.length > 0 && (
                      <div className="space-y-1">
                        {keyframes.map((kf: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-1 text-df-xs">
                            <GripVertical size={8} className="text-df-text-dim cursor-grab" />
                            <span className="text-df-text-muted font-mono w-10">{kf.time.toFixed(1)}s</span>
                            <NumberInput
                              step={0.1}
                              value={kf.value}
                              onChange={(v) => handleUpdateKeyframe(kfCmd!.id, key, idx, { value: v })}
                              showButtons={false}
                              className="flex-1 !py-0 !text-df-xs"
                            />
                            <select
                              value={kf.easing}
                              onChange={(e) => handleUpdateKeyframe(kfCmd!.id, key, idx, { easing: e.target.value as EasingType })}
                              className="bg-df-surface-3 border border-df-border rounded-df-sm px-1 py-0.5 text-df-xs text-df-text-muted w-16"
                            >
                              {EASING_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            <IconButton
                              size="sm"
                              variant="ghost"
                              aria-label="Remove keyframe"
                              onClick={() => handleRemoveKeyframe(kfCmd!.id, idx)}
                              className="opacity-50 hover:opacity-100 !p-0"
                            >
                              <Trash2 size={8} />
                            </IconButton>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>

            {/* Quick Actions */}
            <Section title="Quick Actions" icon={<Sparkles size={10} />} className="space-y-1">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => {
                    if (!selectedCommandId) return;
                    beginBatch();
                    addCommand({
                      id: uuidv4(),
                      type: 'fadeIn',
                      target: selectedCommandId,
                      start: selectedCommand!.start,
                      duration: 0.5,
                    });
                    addCommand({
                      id: uuidv4(),
                      type: 'fadeOut',
                      target: selectedCommandId,
                      start: selectedCommand!.start + (('duration' in selectedCommand!) ? (selectedCommand as any).duration || 3 : 3) - 0.5,
                      duration: 0.5,
                    });
                    endBatch();
                  }}
                  className="px-2 py-1.5 rounded-df-md bg-df-surface-2 hover:bg-df-accent-muted border border-df-border hover:border-df-accent/30 transition-all text-df-sm text-df-text-secondary hover:text-df-text-primary cursor-pointer"
                >
                  Add Fade In+Out
                </button>
                <button
                  onClick={() => {
                    if (!selectedCommandId) return;
                    beginBatch();
                    addCommand({
                      id: uuidv4(),
                      type: 'setKeyframes',
                      target: selectedCommandId,
                      start: 0,
                      property: 'scale',
                      keyframes: [
                        { time: selectedCommand!.start, value: 1, easing: 'linear' },
                        { time: selectedCommand!.start + 2.5, value: 1.15, easing: 'easeInOut' },
                      ],
                    });
                    endBatch();
                  }}
                  className="px-2 py-1.5 rounded-df-md bg-df-surface-2 hover:bg-df-accent-muted border border-df-border hover:border-df-accent/30 transition-all text-df-sm text-df-text-secondary hover:text-df-text-primary cursor-pointer"
                >
                  Ken Burns Effect
                </button>
              </div>
            </Section>
          </>
        )}
      </div>
    </Panel>
  );
};
