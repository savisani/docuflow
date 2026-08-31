import React, { useCallback, useState } from 'react';
import { useDocuFlowStore } from '../../app/store';
import { AudioRole } from '../../types/assets';
import { Settings, Zap, Volume2, Music, Play, CheckCircle, XCircle, Trash2, Copy, Box, Camera, RotateCcw, SlidersHorizontal, Key, Trash, Minimize2 } from 'lucide-react';
import { resolveLayerState, resolveCameraState } from '../../engine/timeline/resolver';
import { Panel, Section, Divider, LabelValue, Badge, IconButton, Tooltip, Toggle, Slider, Input, Select, NumberInput } from '../ui';

export const Inspector: React.FC = () => {
  const { commands, selectedCommandId, settings, setSettings, assets, timeline, updateCommand, removeCommand, duplicateCommand, currentTime, setAudioRole, beginBatch, endBatch } = useDocuFlowStore();

  const selectedCommand = commands.find((c) => c.id === selectedCommandId);
  const isAudioCommand = selectedCommand && (selectedCommand.type === 'sfx' || selectedCommand.type === 'music' || selectedCommand.type === 'ambient');
  const isShowCommand = selectedCommand && selectedCommand.type === 'show';
  const isTransformCommand = selectedCommand && ['move', 'scale', 'rotate', 'move3D', 'rotate3D', 'depth', 'opacity', 'fadeIn', 'fadeOut', 'slide', 'crossfade', 'wipe', 'cut', 'blur', 'flipHorizontal', 'flipVertical', 'crop'].includes(selectedCommand.type);

  const audioTrack = timeline?.audioTracks.find((t) => t.id === selectedCommandId);
  const audioAsset = isAudioCommand ? assets.find(a => a.logicalId === (selectedCommand as any).asset) : null;

  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [testError, setTestError] = useState('');

  const handleDelete = useCallback(() => {
    if (!selectedCommandId) return;
    removeCommand(selectedCommandId);
  }, [selectedCommandId, removeCommand]);

  const handleStartChange = useCallback((start: number) => {
    if (!selectedCommand) return;
    updateCommand(selectedCommand.id, { start });
  }, [selectedCommand, updateCommand]);

  const handleDurationChange = useCallback((duration: number) => {
    if (!selectedCommand) return;
    updateCommand(selectedCommand.id, { duration });
  }, [selectedCommand, updateCommand]);

  const handleTestAudio = useCallback(() => {
    if (!audioAsset?.url) {
      setTestResult('error');
      setTestError('No URL for audio asset');
      return;
    }

    const audio = new Audio(audioAsset.url);
    audio.volume = 1;

    setTestResult(null);
    setTestError('');

    audio.play().then(() => {
      setTestResult('success');
      setTimeout(() => setTestResult(null), 3000);
    }).catch(err => {
      setTestResult('error');
      setTestError(err.message || 'Unknown error');
    });
  }, [audioAsset]);

  const handleVolumeChange = useCallback((volume: number) => {
    if (!selectedCommand || !isAudioCommand) return;
    updateCommand(selectedCommand.id, { volume });
  }, [selectedCommand, isAudioCommand, updateCommand]);

  const handleDuplicate = useCallback(() => {
    if (!selectedCommandId) return;
    duplicateCommand(selectedCommandId);
  }, [selectedCommandId, duplicateCommand]);

  const handleTransformChange = useCallback((key: string, value: number) => {
    if (!selectedCommand) return;
    updateCommand(selectedCommand.id, { [key]: value } as any);
  }, [selectedCommand, updateCommand]);

  return (
    <Panel title="Inspector" icon={<SlidersHorizontal size={10} />} className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-white/5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider shrink-0 flex items-center justify-between">
        <span>Inspector</span>
        {selectedCommand && (
          <div className="flex items-center gap-1">
            <Tooltip content="Duplicate (Ctrl+D)">
              <IconButton size="sm" variant="ghost" aria-label="Duplicate" onClick={handleDuplicate}>
                <Copy size={10} />
              </IconButton>
            </Tooltip>
            <Tooltip content="Delete (Delete/Backspace)">
              <IconButton size="sm" variant="ghost" aria-label="Delete" onClick={handleDelete}>
                <Trash size={10} />
              </IconButton>
            </Tooltip>
            <Tooltip content="Minimize Inspector">
              <IconButton size="sm" variant="ghost" aria-label="Minimize" onClick={() => useDocuFlowStore.getState().setPanelVisibility('assets', false)}>
                <Minimize2 size={10} />
              </IconButton>
            </Tooltip>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 scrollbar-thin">
        <Section title="Project Settings" icon={<Settings size={10} />} className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <NumberInput
              label="Width"
              value={settings.width}
              onChange={(v) => setSettings({ ...settings, width: v })}
              min={1}
              step={1}
            />
            <NumberInput
              label="Height"
              value={settings.height}
              onChange={(v) => setSettings({ ...settings, height: v })}
              min={1}
              step={1}
            />
            <NumberInput
              label="FPS"
              value={settings.fps}
              onChange={(v) => setSettings({ ...settings, fps: v })}
              min={1}
              max={120}
              step={1}
            />
          </div>
        </Section>

        {selectedCommand && (
          <Section title={`Selected: ${selectedCommand.type}`} icon={<Key size={10} />} className="space-y-2">
            <div className="bg-slate-800/50 rounded-lg p-3 space-y-2 border border-white/5">
              <LabelValue label="Start" value={`${selectedCommand.start}s`} labelWidth="60px" valueClassName="font-mono" />
              {'duration' in selectedCommand && (
                <LabelValue label="Duration" value={`${(selectedCommand as any).duration ?? 5}s`} labelWidth="60px" valueClassName="font-mono" />
              )}
              {'asset' in selectedCommand && (
                <LabelValue label="Asset" value={<span className="text-indigo-400 font-mono">{(selectedCommand as any).asset}</span>} labelWidth="60px" />
              )}
              {'target' in selectedCommand && (
                <LabelValue label="Target" value={<span className="text-indigo-400 font-mono">{(selectedCommand as any).target}</span>} labelWidth="60px" />
              )}
              {'toAsset' in selectedCommand && (
                <LabelValue label="To Asset" value={<span className="text-indigo-400 font-mono">{(selectedCommand as any).toAsset}</span>} labelWidth="60px" />
              )}
            </div>

            <div className="flex items-center gap-2">
              <NumberInput
                label="Start (s)"
                step={0.1}
                min={0}
                value={selectedCommand.start}
                onChange={(v) => handleStartChange(v)}
              />
              {'duration' in selectedCommand && (
                <NumberInput
                  label="Duration (s)"
                  step={0.1}
                  min={0.1}
                  value={(selectedCommand as any).duration ?? 5}
                  onChange={(v) => handleDurationChange(v)}
                />
              )}
            </div>
          </Section>
        )}

        {selectedCommand && timeline && isTransformCommand && (() => {
          const layer = timeline.layers[selectedCommand.id];
          if (!layer) return null;
          const resolved = resolveLayerState(layer, Math.round((currentTime ?? 0) * settings.fps));
          return (
            <Section title="3D Transform" icon={<Box size={10} />} className="space-y-2">
              <div className="bg-slate-800/50 rounded-lg p-3 space-y-2 border border-white/5">
                <LabelValue label="Position" labelWidth="60px" />
                <div className="grid grid-cols-3 gap-2">
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <NumberInput
                      key={axis}
                      step={1}
                      label={axis.toUpperCase()}
                      value={Math.round(resolved[axis])}
                      onChange={(v) => handleTransformChange(axis, v)}
                      showButtons={false}
                    />
                  ))}
                </div>
                <Divider />
                <LabelValue label="Rotation" labelWidth="60px" />
                <div className="grid grid-cols-3 gap-2">
                  {(['rotationX', 'rotationY', 'rotationZ'] as const).map((axis) => (
                    <NumberInput
                      key={axis}
                      step={1}
                      label={axis.replace('rotation', '')}
                      value={Math.round(resolved[axis])}
                      onChange={(v) => handleTransformChange(axis, v)}
                      showButtons={false}
                    />
                  ))}
                </div>
                <Divider />
                <LabelValue label="Scale" labelWidth="60px" />
                <div onMouseDown={() => beginBatch()} onMouseUp={() => endBatch()}>
                <Slider
                  min={0.1}
                  max={3}
                  step={0.05}
                  value={resolved.scale}
                  onChange={(e) => handleTransformChange('scale', parseFloat(e.target.value))}
                  valueLabel
                />
                </div>
                <Tooltip content="Reset all transforms">
                  <IconButton size="sm" variant="ghost" aria-label="Reset Transform" onClick={() => {
                    updateCommand(selectedCommand.id, { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1 } as any);
                  }}>
                    <RotateCcw size={10} />
                  </IconButton>
                </Tooltip>
              </div>
            </Section>
          )
        })()}

        {timeline && (
          <Section title="Camera" icon={<Camera size={10} />} className="space-y-2">
            <div className="bg-slate-800/50 rounded-lg p-3 space-y-2 border border-white/5">
              <LabelValue label="Position" labelWidth="60px" />
              <div className="grid grid-cols-3 gap-2">
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <NumberInput
                    key={axis}
                    step={10}
                    label={axis.toUpperCase()}
                    value={Math.round(resolveCameraState(timeline.camera, Math.round((currentTime ?? 0) * settings.fps))[axis])}
                    onChange={() => {}}
                    showButtons={false}
                    readOnly
                    className="!bg-slate-900/50 !border-white/5 !text-slate-400 !cursor-not-allowed"
                  />
                ))}
              </div>
              <Divider />
              <LabelValue label="Rotation" labelWidth="60px" />
              <div className="grid grid-cols-3 gap-2">
                {(['rotationX', 'rotationY', 'rotationZ'] as const).map((axis) => (
                  <NumberInput
                    key={axis}
                    step={1}
                    label={axis.replace('rotation', '')}
                    value={Math.round(resolveCameraState(timeline.camera, Math.round((currentTime ?? 0) * settings.fps))[axis])}
                    onChange={() => {}}
                    showButtons={false}
                    readOnly
                    className="!bg-slate-900/50 !border-white/5 !text-slate-400 !cursor-not-allowed"
                  />
                ))}
              </div>
              <div className="text-[10px] text-slate-500 mt-2">
                Animate camera with <code className="bg-slate-900/50 px-1 rounded font-mono text-indigo-400">cameraMove</code> and <code className="bg-slate-900/50 px-1 rounded font-mono text-indigo-400">cameraRotate</code> commands.
              </div>
            </div>
          </Section>
        )}

        {isAudioCommand && (
          <Section title="Volume Control" icon={<Volume2 size={10} />} className="space-y-2">
            <div className="bg-slate-800/50 rounded-lg p-3 space-y-2 border border-white/5"
              onMouseDown={() => beginBatch()}
              onMouseUp={() => endBatch()}
            >
              <Slider
                min={0}
                max={1}
                step={0.01}
                value={(selectedCommand as any).volume ?? 0.7}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                valueLabel
              />
            </div>
          </Section>
        )}

        {isAudioCommand && audioAsset && (
          <Section title="Audio Asset Info" icon={<Music size={10} />} className="space-y-2">
            <div className="bg-slate-800/50 rounded-lg p-2 space-y-1.5 text-[12px] border border-white/5">
              <LabelValue label="ID" value={<span className="text-indigo-400 font-mono">{audioAsset.logicalId}</span>} labelWidth="50px" />
              <LabelValue label="File" value={<span className="font-mono truncate">{audioAsset.filename}</span>} labelWidth="50px" />
              <LabelValue label="Duration" value={audioAsset.duration ? `${audioAsset.duration.toFixed(2)}s` : 'Unknown'} labelWidth="50px" />
              <LabelValue label="URL" value={<span className={`font-mono ${audioAsset.url ? 'text-emerald-400' : 'text-red-400'}`}>{audioAsset.url ? 'OK' : 'Missing'}</span>} labelWidth="50px" />
              <Divider />
              <Tooltip content="Test audio directly via browser">
                <IconButton size="sm" variant="primary" aria-label="Test Audio" onClick={handleTestAudio} disabled={!audioAsset?.url}>
                  <Play size={10} />
                  <span>Test Audio</span>
                </IconButton>
              </Tooltip>
              {testResult === 'success' && (
                <div className="flex items-center gap-1 text-[12px] text-emerald-400">
                  <CheckCircle size={12} /> Audio test: SUCCESS
                </div>
              )}
              {testResult === 'error' && (
                <div className="text-[12px] text-red-400">
                  <div className="flex items-center gap-1"><XCircle size={12} /> Audio test: FAILED</div>
                  {testError && <div className="mt-1 font-mono text-[10px] text-red-400/80">{testError}</div>}
                </div>
              )}
            </div>
          </Section>
        )}

        {isAudioCommand && audioAsset && (
          <Section title="Audio Role" icon={<Music size={10} />} className="space-y-2">
            <Select
              value={audioAsset.audioRole || 'unassigned'}
              onChange={(e) => setAudioRole(audioAsset.id, e.target.value as AudioRole)}
              options={[
                { value: 'voiceover', label: 'Voiceover' },
                { value: 'music', label: 'Music' },
                { value: 'sfx', label: 'SFX' },
                { value: 'ambient', label: 'Ambient' },
                { value: 'unassigned', label: 'Unassigned' },
              ]}
              className="w-full bg-slate-800/80 border border-slate-700/50 rounded-lg px-2 py-1.5 text-[12px] text-white"
            />
          </Section>
        )}

        {isAudioCommand && audioTrack && (
          <Section title="Timeline Track" icon={<Volume2 size={10} />} className="space-y-2">
            <div className="bg-slate-800/50 rounded-lg p-2 space-y-1.5 text-[12px] border border-white/5">
              <LabelValue label="Start" value={`${(audioTrack.startFrame / settings.fps).toFixed(2)}s`} labelWidth="50px" />
              <LabelValue label="Frame" value={audioTrack.startFrame.toString()} labelWidth="50px" />
              <LabelValue label="End" value={`${(audioTrack.endFrame / settings.fps).toFixed(2)}s`} labelWidth="50px" />
              <LabelValue label="Volume" value={audioTrack.volume.toFixed(2)} labelWidth="50px" />
            </div>
          </Section>
        )}

        <Section title={`Commands (${commands.length})`} icon={<Zap size={10} />} className="space-y-1">
          <div className="space-y-1 max-h-60 overflow-y-auto scrollbar-thin">
            {commands.map((cmd) => (
              <button
                key={cmd.id}
                onClick={() => useDocuFlowStore.getState().selectCommand(cmd.id === selectedCommandId ? null : cmd.id)}
                className={`
                  w-full px-2 py-1.5 rounded-lg text-[12px] text-left cursor-pointer transition-all duration-150
                  ${cmd.id === selectedCommandId
                    ? 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300'
                    : 'bg-white/3 text-slate-400 hover:bg-white/5 border border-transparent'}
                `}
              >
                <span className="font-mono text-slate-500 mr-1">{cmd.start}s</span>
                <span className="font-medium">{cmd.type}</span>
                {'asset' in cmd && <span className="ml-1 text-slate-300">{(cmd as any).asset}</span>}
                {'target' in cmd && <span className="ml-1 text-slate-300">&rarr; {(cmd as any).target}</span>}
              </button>
            ))}
          </div>
        </Section>

        <Section title={`Assets (${assets.length})`} icon={<Box size={10} />} className="space-y-1">
          <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
            {assets.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-[12px] text-slate-400">
                <span className="w-2 h-2 rounded-full bg-slate-600" />
                <span className="font-mono text-indigo-400">{a.logicalId}</span>
                <span className="truncate text-slate-500">{a.filename}</span>
                <span className="text-slate-600 ml-auto">{a.type}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </Panel>
  );
};