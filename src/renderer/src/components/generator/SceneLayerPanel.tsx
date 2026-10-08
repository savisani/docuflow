import React, { useState } from 'react';
import {
  Layers, Plus, RefreshCw, Sparkles, Eye, EyeOff, Trash2,
  ChevronDown, ChevronUp, Loader2, CheckCircle, AlertCircle, Circle,
} from 'lucide-react';
import { Button } from '../ui';
import { useDocuFlowStore } from '../../app/store';
import { v4 as uuidv4 } from 'uuid';
import type { ProjectScene } from '../../types/project';
import type { SceneLayer, SceneLayerType } from '../../engine/sceneLayers/types';
import {
  planScene,
  buildLayerPrompt,
  deriveVisualContext,
  getSceneLayers,
  hasLayerPlan,
  reindexLayers,
  deriveLayeredSceneStatus,
  buildContextSentence,
} from '../../engine/sceneLayers';
import { generateSceneLayer, type LayerGenerationConfig } from '../../services/sceneLayerService';

// ---------------------------------------------------------------------------
// Layered documentary scene controls for one storyboard scene.
//
// Rendered inside each Scene Generator card. Manages the scene's layer plan
// (plan → per-layer generate/regenerate → reorder/hide/remove) and the camera
// shot/intensity settings consumed by the parallax composer at build time.
// ---------------------------------------------------------------------------

const LAYER_META: Record<SceneLayerType, { label: string; chip: string }> = {
  background: { label: 'Background', chip: 'bg-slate-600/40 text-slate-300' },
  midground: { label: 'Midground', chip: 'bg-amber-500/15 text-amber-400' },
  foreground: { label: 'Foreground', chip: 'bg-emerald-500/15 text-emerald-400' },
  atmosphere: { label: 'Atmosphere', chip: 'bg-violet-500/15 text-violet-400' },
};

const ALPHA_META: Record<SceneLayer['alphaMode'], string> = {
  none: 'opaque',
  chroma: 'green screen',
  luminance: 'black screen',
};

const CAMERA_MOTIONS = [
  { value: 'zoom_in', label: 'Zoom In' },
  { value: 'zoom_out', label: 'Zoom Out' },
  { value: 'pan_left', label: 'Pan Left' },
  { value: 'pan_right', label: 'Pan Right' },
  { value: 'static', label: 'Static' },
] as const;

const INTENSITIES = [
  { value: 'subtle', label: 'Subtle' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'strong', label: 'Strong' },
] as const;

interface SceneLayerPanelProps {
  scene: ProjectScene;
  config: LayerGenerationConfig;
  /** True when the selected image provider is not configured. */
  disabled?: boolean;
  onUpdate: (updates: Partial<ProjectScene>) => void;
}

function StatusIcon({ layer }: { layer: SceneLayer }) {
  if (layer.status === 'generating') return <Loader2 size={11} className="text-amber-400 animate-spin" />;
  if (layer.status === 'done') return <CheckCircle size={11} className="text-emerald-400" />;
  if (layer.status === 'error') return <AlertCircle size={11} className="text-red-400" />;
  return <Circle size={11} className="text-slate-600" />;
}

export const SceneLayerPanel: React.FC<SceneLayerPanelProps> = ({ scene, config, disabled, onUpdate }) => {
  const assets = useDocuFlowStore((s) => s.assets);
  const [busyLayerId, setBusyLayerId] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);

  const layered = hasLayerPlan(scene);
  const layers = getSceneLayers(scene);
  const readyCount = layers.filter((l) => l.assetId && l.status === 'done').length;
  const pendingLayers = layers.filter((l) => !l.assetId || l.status !== 'done');
  const busy = busyLayerId !== null || generatingAll;

  const applyLayers = (next: SceneLayer[]) => {
    onUpdate({ layers: next, status: deriveLayeredSceneStatus(next) });
  };

  // -------------------------------------------------------------------------
  // Planning
  // -------------------------------------------------------------------------

  const handlePlan = () => {
    const plan = planScene({
      text: scene.transcriptChunk,
      visual: scene.visualDescription,
      imagePrompt: scene.imagePrompt,
      cameraMotion: scene.cameraMotion,
      // Reuse an already-generated single image as the background plate.
      existingAssetId: scene.imageId && assets.some((a) => a.id === scene.imageId) ? scene.imageId : undefined,
    });
    onUpdate({
      layers: plan.layers,
      shotType: plan.shot,
      visualContext: plan.context,
      cameraIntensity: plan.camera.intensity,
      status: deriveLayeredSceneStatus(plan.layers),
    });
  };

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------

  const runGenerate = async (targets: SceneLayer[]) => {
    if (targets.length === 0) return;
    let current = [...layers];
    try {
      for (const target of targets) {
        current = current.map((l) => (l.id === target.id ? { ...l, status: 'generating', error: undefined } : l));
        applyLayers(current);
        const fresh = current.find((l) => l.id === target.id);
        if (!fresh) continue;
        setBusyLayerId(fresh.id);
        try {
          const out = await generateSceneLayer(scene, fresh, config);
          current = current.map((l) => (l.id === out.id ? out : l));
        } catch (err) {
          current = current.map((l) =>
            l.id === target.id
              ? { ...l, status: 'error', error: err instanceof Error ? err.message : String(err), assetId: l.assetId }
              : l,
          );
        }
        applyLayers(current);
      }
    } finally {
      setBusyLayerId(null);
    }
  };

  const handleGenerateAll = async () => {
    setGeneratingAll(true);
    try {
      await runGenerate(pendingLayers);
    } finally {
      setGeneratingAll(false);
    }
  };

  // -------------------------------------------------------------------------
  // Layer edits
  // -------------------------------------------------------------------------

  const handlePatch = (id: string, patch: Partial<SceneLayer>) => {
    applyLayers(layers.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const handleRemove = (id: string) => {
    applyLayers(reindexLayers(layers.filter((l) => l.id !== id)));
  };

  const handleMove = (id: string, dir: -1 | 1) => {
    const index = layers.findIndex((l) => l.id === id);
    const swapWith = index + dir;
    if (index < 0 || swapWith < 0 || swapWith >= layers.length) return;
    const next = [...layers];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    applyLayers(reindexLayers(next));
  };

  const handleAddLayer = (type: SceneLayerType) => {
    const alphaMode: SceneLayer['alphaMode'] =
      type === 'background' ? 'none' : type === 'atmosphere' ? 'luminance' : 'chroma';
    const context = scene.visualContext ?? deriveVisualContext(scene.visualDescription, scene.transcriptChunk);
    const content =
      type === 'background'
        ? 'the scene environment, wide depth, natural perspective'
        : type === 'atmosphere'
          ? 'a subtle atmospheric effect spread evenly across the frame'
          : type === 'midground'
            ? 'the main subject, scaled for natural distance from the camera'
            : 'framing elements entering from the frame edge, close to the camera';
    const layer: SceneLayer = {
      id: uuidv4(),
      type,
      name: LAYER_META[type].label,
      order: layers.length,
      subject: content,
      prompt: buildLayerPrompt({
        type,
        alphaMode,
        content,
        shot: scene.shotType ?? 'subject',
        context,
      }),
      status: 'pending',
      alphaMode,
      visible: true,
      optional: type === 'atmosphere',
    };
    applyLayers([...layers, layer]);
    setExpanded((prev) => ({ ...prev, [layer.id]: true }));
    setAdding(false);
  };

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------

  const renderPreview = () => {
    const stacked = layers.filter((l) => l.visible !== false && l.assetId);
    return (
      <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-white/10 bg-slate-900/70">
        {stacked.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Layers size={16} className="text-slate-700" />
          </div>
        ) : (
          stacked.map((l) => {
            const url = assets.find((a) => a.id === l.assetId)?.url;
            if (!url) return null;
            return (
              <img
                key={l.id}
                src={url}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                style={{ opacity: l.transform?.opacity ?? (l.type === 'atmosphere' ? 0.55 : 1) }}
              />
            );
          })
        )}
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div data-testid="scene-layer-panel" className="rounded-lg border border-white/10 bg-slate-900/40 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Layers size={11} className="text-indigo-400" />
          <span className="text-[9px] font-semibold text-slate-300 uppercase tracking-wider">Scene Layers</span>
          {layered && (
            <span className="text-[9px] text-slate-500">
              {readyCount}/{layers.length} ready
            </span>
          )}
        </div>
        {!layered && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handlePlan}
            icon={<Sparkles size={10} />}
            className="px-2 py-1 text-[9px]"
          >
            Plan Layers
          </Button>
        )}
      </div>

      {!layered ? (
        <p className="text-[9px] text-slate-500 leading-relaxed">
          Splits this scene into background, subject, foreground and atmosphere plates with a shared visual
          context, then builds a parallax camera move across them.
        </p>
      ) : (
        <>
          {/* Camera controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            {scene.shotType && (
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 font-medium">
                {scene.shotType.replace(/_/g, ' ')}
              </span>
            )}
            <select
              value={scene.cameraMotion}
              onChange={(e) => onUpdate({ cameraMotion: e.target.value as ProjectScene['cameraMotion'] })}
              className="bg-slate-700/50 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-slate-300"
            >
              {CAMERA_MOTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <select
              value={scene.cameraIntensity ?? 'subtle'}
              onChange={(e) => onUpdate({ cameraIntensity: e.target.value as ProjectScene['cameraIntensity'] })}
              className="bg-slate-700/50 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-slate-300"
            >
              {INTENSITIES.map((i) => (
                <option key={i.value} value={i.value}>{i.label}</option>
              ))}
            </select>
            <span className="text-[8px] text-slate-600 ml-auto">
              {buildContextSentence(scene.visualContext ?? {}) || 'No shared context yet'}
            </span>
          </div>

          <div className="grid grid-cols-[110px_1fr] gap-2.5">
            {renderPreview()}

            {/* Layer rows */}
            <div className="space-y-1 min-w-0">
              {layers.map((layer, index) => (
                <div
                  key={layer.id}
                  data-testid="layer-row"
                  data-layer-type={layer.type}
                  data-layer-id={layer.id}
                  className={`rounded-md border px-1.5 py-1 ${
                    layer.status === 'error' ? 'border-red-500/30 bg-red-500/5' : 'border-white/5 bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <StatusIcon layer={layer} />
                    <span className={`text-[8px] px-1 py-0.5 rounded ${LAYER_META[layer.type].chip}`}>
                      {LAYER_META[layer.type].label}
                    </span>
                    <span className="text-[8px] text-slate-500 truncate flex-1" title={layer.subject}>
                      {layer.name}
                    </span>
                    <span className="text-[7px] text-slate-600 hidden sm:inline">{ALPHA_META[layer.alphaMode]}</span>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => runGenerate([layer])}
                        disabled={busy || disabled}
                        title={layer.assetId ? 'Regenerate layer' : 'Generate layer'}
                        className="p-0.5 text-slate-500 hover:text-amber-300 disabled:opacity-40 transition-colors"
                      >
                        {busyLayerId === layer.id ? (
                          <Loader2 size={10} className="text-amber-400 animate-spin" />
                        ) : (
                          <RefreshCw size={10} />
                        )}
                      </button>
                      <button
                        onClick={() => handlePatch(layer.id, { visible: layer.visible === false })}
                        disabled={busy}
                        title={layer.visible === false ? 'Show layer' : 'Hide layer'}
                        className="p-0.5 text-slate-500 hover:text-slate-300 disabled:opacity-40 transition-colors"
                      >
                        {layer.visible === false ? <EyeOff size={10} /> : <Eye size={10} />}
                      </button>
                      <button
                        onClick={() => handleMove(layer.id, -1)}
                        disabled={busy || index === 0}
                        title="Send backward"
                        className="p-0.5 text-slate-500 hover:text-slate-300 disabled:opacity-40 transition-colors"
                      >
                        <ChevronUp size={10} />
                      </button>
                      <button
                        onClick={() => handleMove(layer.id, 1)}
                        disabled={busy || index === layers.length - 1}
                        title="Bring forward"
                        className="p-0.5 text-slate-500 hover:text-slate-300 disabled:opacity-40 transition-colors"
                      >
                        <ChevronDown size={10} />
                      </button>
                      <button
                        onClick={() => handleRemove(layer.id)}
                        disabled={busy}
                        title="Remove layer"
                        className="p-0.5 text-slate-500 hover:text-red-400 disabled:opacity-40 transition-colors"
                      >
                        <Trash2 size={10} />
                      </button>
                      <button
                        onClick={() => setExpanded((prev) => ({ ...prev, [layer.id]: !prev[layer.id] }))}
                        title="Edit prompt"
                        className="p-0.5 text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        <ChevronDown
                          size={10}
                          className={`transition-transform ${expanded[layer.id] ? 'rotate-180' : ''}`}
                        />
                      </button>
                    </div>
                  </div>

                  {layer.error && (
                    <p className="text-[8px] text-red-400/90 leading-snug mt-1">{layer.error}</p>
                  )}

                  {expanded[layer.id] && (
                    <textarea
                      value={layer.prompt}
                      onChange={(e) => handlePatch(layer.id, { prompt: e.target.value })}
                      rows={4}
                      disabled={busy}
                      className="w-full mt-1 bg-slate-900/60 border border-white/5 rounded px-1.5 py-1 text-[9px] text-slate-300 resize-none focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                    />
                  )}
                </div>
              ))}

              {/* Add layer */}
              {adding ? (
                <div className="flex flex-wrap gap-1 rounded-md border border-dashed border-white/10 p-1.5">
                  {(Object.keys(LAYER_META) as SceneLayerType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => handleAddLayer(t)}
                      className="text-[8px] px-1.5 py-0.5 rounded bg-slate-700/50 hover:bg-slate-600/60 text-slate-300 transition-colors"
                    >
                      + {LAYER_META[t].label}
                    </button>
                  ))}
                  <button
                    onClick={() => setAdding(false)}
                    className="text-[8px] px-1.5 py-0.5 rounded text-slate-500 hover:text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAdding(true)}
                  disabled={busy}
                  className="flex items-center gap-1 text-[9px] text-slate-500 hover:text-indigo-300 disabled:opacity-40 transition-colors px-1"
                >
                  <Plus size={9} /> Add Layer
                </button>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-[8px] text-slate-600">
              {pendingLayers.length === 0
                ? 'All layers ready — will be composed at build time.'
                : `${pendingLayers.length} layer${pendingLayers.length === 1 ? '' : 's'} not generated yet`}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGenerateAll}
              disabled={disabled || busy || pendingLayers.length === 0}
              loading={generatingAll}
              icon={<Sparkles size={10} />}
              className="px-2.5 py-1 text-[9px]"
            >
              Generate Layers
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

