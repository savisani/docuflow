import React, { useState, useCallback, useEffect } from 'react';
import { Settings, Wand2, Image as ImageIcon, Download, Film, Plus, Cloud, X, Sliders, Sparkles, ZoomIn, Save, CheckCircle, FolderOpen, RefreshCw, Cpu, Monitor } from 'lucide-react';
import { useDocuFlowStore } from '../../app/store';
import { Button } from '../ui';
import { CLOUDFLARE_MODELS, CloudflareConfig } from '../../utils/cloudflareApi';
import { generateImage, regenerateImage, ImageProvider } from '../../services/imageGenerationService';
import { listLocalModels, detectHardware, importModel, LocalModel, LocalHardware, getRecommendedSettings, QUALITY_PRESETS, QualityPreset } from '../../services/localImageProvider';

const ASPECT_RATIOS = [
  { id: '16:9', label: '16:9', width: 16, height: 9 },
  { id: '9:16', label: '9:16', width: 9, height: 16 },
  { id: '1:1', label: '1:1', width: 1, height: 1 },
  { id: '4:3', label: '4:3', width: 4, height: 3 },
] as const;

const BATCH_SIZES = [1, 2, 3, 4];

const POLISH_TAGS = 'cinematic lighting, hyper-detailed, sharp focus, 8k, ultra-realistic textures, depth of field, subtle volumetric lighting, intricate details, award-winning photography';

function loadCloudflareConfig(): CloudflareConfig {
  try {
    const stored = localStorage.getItem('docuflow-cloudflare-config');
    if (stored) return JSON.parse(stored);
  } catch {}
  return { workerUrl: '' };
}

function saveCloudflareConfig(config: CloudflareConfig) {
  localStorage.setItem('docuflow-cloudflare-config', JSON.stringify(config));
}

function loadAdvancedSettings(): { model: string; steps: number } {
  try {
    const stored = localStorage.getItem('docuflow-advanced-settings');
    if (stored) return JSON.parse(stored);
  } catch {}
  return { model: '@cf/black-forest-labs/flux-1-schnell', steps: 4 };
}

function saveAdvancedSettings(settings: { model: string; steps: number }) {
  localStorage.setItem('docuflow-advanced-settings', JSON.stringify(settings));
}

function loadSaveLocation(): string {
  try {
    return localStorage.getItem('docuflow-save-location') || '';
  } catch {}
  return '';
}

function setSaveLocation(path: string) {
  localStorage.setItem('docuflow-save-location', path);
}

async function blobUrlToBase64(url: string): Promise<string> {
  const resp = await fetch(url);
  const blob = await resp.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const ImageGenerator: React.FC = () => {
  const { generatedImages, addToTimeline } = useDocuFlowStore();
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [cloudflareConfig, setCloudflareConfig] = useState<CloudflareConfig>(loadCloudflareConfig);
  const [tempWorkerUrl, setTempWorkerUrl] = useState(cloudflareConfig.workerUrl);

  const [advancedSettings, setAdvancedSettings] = useState(loadAdvancedSettings);
  const [tempAdvanced, setTempAdvanced] = useState(advancedSettings);

  const [selectedAspectRatio, setSelectedAspectRatio] = useState<string>('1:1');
  const [batchSize, setBatchSize] = useState(1);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [prePolishPrompt, setPrePolishPrompt] = useState('');
  const [isPolished, setIsPolished] = useState(false);

  // Provider selection
  const [imageProvider, setImageProvider] = useState<ImageProvider>(() => {
    return (localStorage.getItem('docuflow-image-provider') as ImageProvider) || 'cloudflare';
  });

  // Local model state
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [selectedLocalModel, setSelectedLocalModel] = useState<string>(() => {
    return localStorage.getItem('docuflow-local-model-path') || '';
  });
  const [localHardware, setLocalHardware] = useState<LocalHardware | null>(null);
  const [localQualityPreset, setLocalQualityPreset] = useState<QualityPreset>('balanced');
  const [localDevice, setLocalDevice] = useState<'auto' | 'gpu' | 'cpu' | 'directml'>('auto');
  const [localProgress, setLocalProgress] = useState<{ percent: number; message: string } | null>(null);
  const [showLocalModelManager, setShowLocalModelManager] = useState(false);

  const [lightboxImage, setLightboxImage] = useState<{ url: string; prompt: string; aspectRatio: string } | null>(null);

  // Regeneration state
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [regeneratePrompt, setRegeneratePrompt] = useState('');
  const [regenerateOriginalUrl, setRegenerateOriginalUrl] = useState<string | null>(null);

  const [saveLocation, setSaveLocationState] = useState(loadSaveLocation);

  // Derived values — must be before any useCallback that references them
  const currentModel = CLOUDFLARE_MODELS.find(m => m.id === advancedSettings.model);
  const selectedRatio = ASPECT_RATIOS.find(r => r.id === selectedAspectRatio) ?? ASPECT_RATIOS[2];

  useEffect(() => { saveCloudflareConfig(cloudflareConfig); }, [cloudflareConfig]);
  useEffect(() => { saveAdvancedSettings(advancedSettings); }, [advancedSettings]);
  useEffect(() => { localStorage.setItem('docuflow-image-provider', imageProvider); }, [imageProvider]);
  useEffect(() => { localStorage.setItem('docuflow-local-model-path', selectedLocalModel); }, [selectedLocalModel]);

  // Load local models and hardware when switching to local provider
  useEffect(() => {
    if (imageProvider === 'local') {
      listLocalModels().then(setLocalModels);
      detectHardware().then((hw) => {
        setLocalHardware(hw);
        const rec = getRecommendedSettings(hw);
        setLocalDevice(rec.device);
      });
    }
  }, [imageProvider]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleSaveSettings = useCallback(() => {
    setCloudflareConfig({ workerUrl: tempWorkerUrl });
    setAdvancedSettings(tempAdvanced);
    setShowSettings(false);
  }, [tempWorkerUrl, tempAdvanced]);

  // Regeneration handler
  const handleRegenerate = useCallback(async (imageId: string) => {
    const image = generatedImages.find(img => img.id === imageId);
    if (!image) return;

    if (imageProvider === 'cloudflare' && !cloudflareConfig.workerUrl) return;
    if (imageProvider === 'local' && !selectedLocalModel) return;

    // Start regeneration - preserve original
    setRegeneratingId(imageId);
    setRegeneratePrompt(image.prompt);
    setRegenerateOriginalUrl(image.url);
    setError(null);
    setLocalProgress(null);

    try {
      const preset = QUALITY_PRESETS[localQualityPreset];
      const result = await regenerateImage(
        imageId,
        image.prompt,
        {
          provider: imageProvider,
          cloudflareConfig,
          model: advancedSettings.model,
          steps: imageProvider === 'local' ? preset.steps : advancedSettings.steps,
          negativePrompt: negativePrompt || undefined,
          localModelPath: imageProvider === 'local' ? selectedLocalModel : undefined,
          device: imageProvider === 'local' ? localDevice : undefined,
          onProgress: imageProvider === 'local' ? (p) => {
            if (p.type === 'progress' && p.percent !== undefined) {
              setLocalProgress({ percent: p.percent, message: `Regenerating... ${p.percent}%` });
            } else if (p.type === 'status' && p.message) {
              setLocalProgress({ percent: 0, message: p.message });
            }
          } : undefined,
        }
      );

      if (!result.success) {
        throw new Error(result.error || 'Regeneration failed');
      }

      setToast({ message: 'Image regenerated successfully', type: 'success' });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Regeneration failed';
      setError(errorMsg);
      // Preserve original on error - no change needed
    } finally {
      setRegeneratingId(null);
      setRegeneratePrompt('');
      setRegenerateOriginalUrl(null);
      setLocalProgress(null);
    }
  }, [generatedImages, imageProvider, cloudflareConfig, selectedLocalModel, advancedSettings, negativePrompt, localQualityPreset, localDevice]);

  const handleSelectFolder = useCallback(async () => {
    const result = await window.docuflow.selectFolder();
    if (!result.canceled && result.filePath) {
      setSaveLocationState(result.filePath);
      setSaveLocation(result.filePath);
      setToast({ message: `Save location set to ${result.filePath}`, type: 'success' });
    }
  }, []);

  const handleMagicPolish = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed || polishing) return;
    if (isPolished) {
      setPrompt(prePolishPrompt);
      setIsPolished(false);
      return;
    }
    setPrePolishPrompt(trimmed);
    setPolishing(true);
    setTimeout(() => {
      setPrompt(`${trimmed}, ${POLISH_TAGS}`);
      setIsPolished(true);
      setPolishing(false);
    }, 350);
  }, [prompt, polishing, isPolished, prePolishPrompt]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;

    if (imageProvider === 'cloudflare' && !cloudflareConfig.workerUrl) {
      setError('Please configure your Cloudflare Worker URL in Settings first.');
      return;
    }

    if (imageProvider === 'local' && !selectedLocalModel) {
      setError('Please select a local model first.');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setLocalProgress(null);

    try {
      const preset = QUALITY_PRESETS[localQualityPreset];
      const result = await generateImage({
        prompt: prompt.trim(),
        aspectRatio: selectedAspectRatio,
        negativePrompt,
        source: 'image-generator',
        provider: imageProvider,
        cloudflareConfig,
        model: advancedSettings.model,
        steps: imageProvider === 'local' ? preset.steps : advancedSettings.steps,
        count: imageProvider === 'local' ? 1 : batchSize,
        localModelPath: imageProvider === 'local' ? selectedLocalModel : undefined,
        device: imageProvider === 'local' ? localDevice : undefined,
        width: imageProvider === 'local' ? preset.width : undefined,
        height: imageProvider === 'local' ? preset.height : undefined,
        onProgress: imageProvider === 'local' ? (p) => {
          if (p.type === 'progress' && p.percent !== undefined) {
            setLocalProgress({ percent: p.percent, message: `Generating... ${p.percent}%` });
          } else if (p.type === 'status' && p.message) {
            setLocalProgress({ percent: 0, message: p.message });
          }
        } : undefined,
      });

      if (!result.success) {
        throw new Error(result.error || 'Image generation failed');
      }

      setPrompt('');
      setIsPolished(false);
      setPrePolishPrompt('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(message);
      console.error('Image generation failed:', err);
    } finally {
      setIsGenerating(false);
      setLocalProgress(null);
    }
  }, [prompt, isGenerating, imageProvider, cloudflareConfig, selectedLocalModel, advancedSettings, selectedAspectRatio, batchSize, negativePrompt, localQualityPreset, localDevice]);

  const handleDownload = useCallback(async (url: string, filename: string) => {
    try {
      const base64 = await blobUrlToBase64(url);

      if (saveLocation) {
        const result = await window.docuflow.saveImageToFolder({
          imageBase64: base64,
          folderPath: saveLocation,
          fileName: filename,
        });
        if (result.success && result.path) {
          setToast({ message: `Saved to ${result.path}`, type: 'success' });
        } else {
          setToast({ message: result.error || 'Save failed', type: 'error' });
        }
      } else {
        const result = await window.docuflow.saveImage({
          imageBase64: base64,
          defaultName: filename,
        });
        if (result.success && result.path) {
          setToast({ message: `Saved to ${result.path}`, type: 'success' });
        } else if (result.error !== 'Save cancelled') {
          setToast({ message: result.error || 'Save failed', type: 'error' });
        }
      }
    } catch {
      setToast({ message: 'Failed to save image', type: 'error' });
    }
  }, [saveLocation]);

  const handleAddToTimeline = useCallback((imageId: string) => {
    addToTimeline(imageId);
  }, [addToTimeline]);

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-white overflow-hidden">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg backdrop-blur-sm transition-all ${
          toast.type === 'success'
            ? 'bg-emerald-500/90 text-white'
            : 'bg-red-500/90 text-white'
        }`}>
          {toast.type === 'success' ? <CheckCircle size={14} /> : <X size={14} />}
          <span className="text-[11px] font-medium max-w-[300px] truncate">{toast.message}</span>
        </div>
      )}

      {/* Full-screen Lightbox */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxImage(null)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
            onClick={() => setLightboxImage(null)}
          >
            <X size={20} />
          </button>
          <div className="max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
            <img
              src={lightboxImage.url}
              alt={lightboxImage.prompt}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            <div className="flex items-center gap-3">
              <p className="text-[12px] text-white/70 max-w-[500px] truncate">{lightboxImage.prompt}</p>
              <span className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-white/50">{lightboxImage.aspectRatio}</span>
              <button
                onClick={() => handleDownload(lightboxImage.url, `image-${Date.now()}.png`)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-white text-[11px] hover:bg-white/20 transition-colors"
              >
                <Download size={12} />
                <span>Save</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compact Control Panel */}
      <div className="w-full shrink-0 border-b border-white/5 bg-slate-900/40">
        <div className="w-full px-4 py-3">
          {/* Header row */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                imageProvider === 'local'
                  ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
                  : 'bg-gradient-to-br from-purple-500 to-pink-600'
              }`}>
                {imageProvider === 'local' ? <Cpu size={14} className="text-white" /> : <Cloud size={14} className="text-white" />}
              </div>
              <div>
                <h1 className="text-[13px] font-bold text-white">
                  {imageProvider === 'local' ? 'Local Image Generator' : 'AI Image Generator'}
                </h1>
                <p className="text-[10px] text-slate-400">
                  {imageProvider === 'local' ? 'Offline Stable Diffusion' : 'Powered by Cloudflare Workers AI'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Provider Toggle */}
              <div className="flex items-center bg-slate-800/60 rounded-md border border-white/5 p-0.5">
                <button
                  onClick={() => setImageProvider('cloudflare')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-medium transition-all ${
                    imageProvider === 'cloudflare'
                      ? 'bg-purple-500/20 text-purple-300'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Cloud size={10} />
                  <span>Cloud</span>
                </button>
                <button
                  onClick={() => setImageProvider('local')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-medium transition-all ${
                    imageProvider === 'local'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Cpu size={10} />
                  <span>Local</span>
                </button>
              </div>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                  showAdvanced
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                    : 'bg-slate-800/60 text-slate-400 border border-white/5 hover:text-white hover:border-white/10'
                }`}
              >
                <Sliders size={10} />
                <span>Advanced</span>
              </button>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-slate-800/60 text-slate-400 border border-white/5 hover:text-white hover:border-white/10 transition-all"
              >
                <Settings size={10} />
                <span>Settings</span>
              </button>
            </div>
          </div>

          {/* Settings Panel */}
          {showSettings && (
            <div className="mb-3 p-3 rounded-lg bg-slate-800/50 border border-white/10">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-semibold text-white">Settings</h3>
                <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white">
                  <X size={12} />
                </button>
              </div>

              {/* Cloudflare Settings */}
              {imageProvider === 'cloudflare' && (
                <>
                  {/* Worker URL */}
                  <div className="mb-3">
                    <label className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">
                      Cloudflare Worker URL
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={tempWorkerUrl}
                        onChange={(e) => setTempWorkerUrl(e.target.value)}
                        placeholder="https://your-worker.workers.dev"
                        className="flex-1 bg-slate-700/50 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                      <Button variant="primary" onClick={handleSaveSettings} className="px-3 py-1.5 text-[10px]">
                        Save
                      </Button>
                    </div>
                    <p className="mt-1 text-[9px] text-slate-500">Worker: https://image-generator.docuflowyt.workers.dev</p>
                  </div>
                </>
              )}

              {/* Local Model Settings */}
              {imageProvider === 'local' && (
                <>
                  {/* Hardware Info */}
                  {localHardware && (
                    <div className="mb-3 p-2 rounded-md bg-slate-700/30 border border-white/5">
                      <div className="flex items-center gap-2 mb-1">
                        <Monitor size={12} className="text-slate-400" />
                        <span className="text-[10px] font-medium text-slate-300">Hardware</span>
                      </div>
                      <p className="text-[9px] text-slate-400">
                        {localHardware.device_name} {localHardware.vram_mb > 0 ? `(${Math.round(localHardware.vram_mb / 1024)} GB VRAM)` : ''}
                      </p>
                      <div className="flex gap-1.5 mt-1.5">
                        {localHardware.cuda && <span className="text-[8px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">CUDA</span>}
                        {localHardware.directml && <span className="text-[8px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">DirectML</span>}
                        <span className="text-[8px] px-1.5 py-0.5 rounded bg-slate-600/50 text-slate-300">CPU</span>
                      </div>
                    </div>
                  )}

                  {/* Model Selection */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[9px] font-medium text-slate-400 uppercase tracking-wider">
                        Local Model
                      </label>
                      <button
                        onClick={async () => {
                          const result = await importModel();
                          if (result.success && result.path) {
                            setSelectedLocalModel(result.path);
                            const models = await listLocalModels();
                            setLocalModels(models);
                            setToast({ message: 'Model imported', type: 'success' });
                          }
                        }}
                        className="text-[9px] text-purple-400 hover:text-purple-300"
                      >
                        + Import Model
                      </button>
                    </div>
                    {localModels.length > 0 ? (
                      <select
                        value={selectedLocalModel}
                        onChange={(e) => setSelectedLocalModel(e.target.value)}
                        className="w-full bg-slate-700/50 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="">Select a model...</option>
                        {localModels.map((model) => (
                          <option key={model.path} value={model.path}>
                            {model.name} ({model.size_label})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-[10px] text-slate-500 py-2 text-center border border-dashed border-white/10 rounded-md">
                        No models found. Click "Import Model" to add one.
                      </div>
                    )}
                  </div>

                  {/* Quality Preset */}
                  <div className="mb-3">
                    <label className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">
                      Quality Preset
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(Object.entries(QUALITY_PRESETS) as [QualityPreset, typeof QUALITY_PRESETS[QualityPreset]][]).map(([key, preset]) => (
                        <button
                          key={key}
                          onClick={() => setLocalQualityPreset(key)}
                          className={`px-2 py-1.5 rounded-md text-[10px] font-medium transition-all ${
                            localQualityPreset === key
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-700/50 text-slate-400 border border-white/5 hover:text-white hover:border-white/10'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-[8px] text-slate-500">
                      {QUALITY_PRESETS[localQualityPreset].width}x{QUALITY_PRESETS[localQualityPreset].height} | {QUALITY_PRESETS[localQualityPreset].steps} steps
                    </p>
                  </div>

                  {/* Device Selection */}
                  <div className="mb-3">
                    <label className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">
                      Device
                    </label>
                    <select
                      value={localDevice}
                      onChange={(e) => setLocalDevice(e.target.value as 'auto' | 'gpu' | 'cpu' | 'directml')}
                      className="w-full bg-slate-700/50 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="auto">Auto (Best Available)</option>
                      <option value="gpu">GPU (CUDA)</option>
                      <option value="directml">DirectML</option>
                      <option value="cpu">CPU Only</option>
                    </select>
                  </div>
                </>
              )}

              {/* Save Location (shared) */}
              <div>
                <label className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">
                  Save Location
                </label>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-2 bg-slate-700/50 border border-white/10 rounded-md px-2 py-1.5">
                    <FolderOpen size={12} className="text-slate-400 shrink-0" />
                    <span className="text-[11px] text-slate-200 truncate">
                      {saveLocation || 'No location set (will show save dialog)'}
                    </span>
                  </div>
                  <Button variant="secondary" onClick={handleSelectFolder} className="px-3 py-1.5 text-[10px]">
                    Browse
                  </Button>
                </div>
                <p className="mt-1 text-[9px] text-slate-500">
                  {saveLocation ? 'Images auto-save here' : 'Click Browse to set a default folder'}
                </p>
              </div>
            </div>
          )}

          {/* Advanced Panel */}
          {showAdvanced && (
            <div className="mb-3 p-3 rounded-lg bg-slate-800/50 border border-white/10">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-semibold text-white">Advanced Settings</h3>
                <button onClick={() => setShowAdvanced(false)} className="text-slate-400 hover:text-white">
                  <X size={12} />
                </button>
              </div>

              {imageProvider === 'cloudflare' ? (
                <>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {CLOUDFLARE_MODELS.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => setTempAdvanced({ ...tempAdvanced, model: model.id, steps: 4 })}
                        className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-[10px] font-medium transition-all ${
                          tempAdvanced.model === model.id
                            ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-white border border-purple-500/30'
                            : 'bg-slate-700/50 text-slate-400 border border-white/5 hover:text-white hover:border-white/10'
                        }`}
                      >
                        <span>{model.label}</span>
                        <span className="text-[8px] text-slate-500">{model.description}</span>
                      </button>
                    ))}
                  </div>
                  <div className="mb-2">
                    <label className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">
                      Inference Steps: {tempAdvanced.steps}
                    </label>
                    <input
                      type="range"
                      min="1"
                      max={currentModel?.maxSteps || 8}
                      value={tempAdvanced.steps}
                      onChange={(e) => setTempAdvanced({ ...tempAdvanced, steps: parseInt(e.target.value) })}
                      className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                    <div className="flex justify-between text-[8px] text-slate-500 mt-0.5">
                      <span>Fast</span>
                      <span>Quality</span>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button variant="primary" onClick={handleSaveSettings} className="px-3 py-1 text-[10px]">
                      Save
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[10px] text-slate-400 mb-2">
                    Local generation settings are in the Settings panel above.
                  </div>
                  {localHardware && (
                    <div className="p-2 rounded-md bg-slate-700/30 border border-white/5 text-[9px] text-slate-400">
                      <p>Recommended: {localHardware.cuda ? 'GPU (CUDA)' : localHardware.directml ? 'DirectML' : 'CPU'}</p>
                      <p>VRAM: {localHardware.vram_mb > 0 ? `${Math.round(localHardware.vram_mb / 1024)} GB` : 'N/A'}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Prompt + Generate */}
          <div className="flex gap-2">
            <textarea
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value); setError(null); }}
              placeholder="Describe the image you want to create..."
              rows={2}
              disabled={isGenerating}
              className="flex-1 bg-slate-800/80 border border-slate-700/50 rounded-lg px-3 py-2 text-[12px] text-slate-200 placeholder:text-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all disabled:opacity-60"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />
            <div className="flex flex-col gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleMagicPolish}
                loading={polishing}
                disabled={!prompt.trim() || isGenerating}
                icon={<Sparkles size={12} />}
                className="px-2 py-1 text-[10px] border border-white/10 hover:border-purple-500/30 hover:text-purple-300"
              >
                Polish
              </Button>
              <Button
                variant="primary"
                onClick={handleGenerate}
                disabled={!prompt.trim() || isGenerating}
                loading={isGenerating}
                icon={<Wand2 size={12} />}
                className="px-3 py-1 text-[10px] bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 border-0"
              >
                Generate
              </Button>
            </div>
          </div>

          {error && (
            <p className="mt-1.5 text-[10px] text-red-400 flex items-center gap-1">
              <span className="inline-block w-1 h-1 rounded-full bg-red-400 shrink-0" />
              {error}
            </p>
          )}

          {/* Local Generation Progress */}
          {localProgress && imageProvider === 'local' && (
            <div className="mt-2 p-2 rounded-md bg-emerald-500/10 border border-emerald-500/20">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-emerald-300">{localProgress.message}</span>
                <span className="text-[9px] text-emerald-400">{localProgress.percent}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300"
                  style={{ width: `${localProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          {/* Controls row */}
          <div className="mt-2 flex items-end gap-3 flex-wrap">
            {/* Aspect Ratio */}
            <div>
              <label className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">
                Aspect Ratio
              </label>
              <div className="flex gap-1">
                {ASPECT_RATIOS.map((ratio) => (
                  <button
                    key={ratio.id}
                    onClick={() => !isGenerating && setSelectedAspectRatio(ratio.id)}
                    disabled={isGenerating}
                    className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                      selectedAspectRatio === ratio.id
                        ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-white border border-purple-500/30'
                        : 'bg-slate-800/60 text-slate-400 border border-white/5 hover:text-white hover:border-white/10'
                    }`}
                  >
                    {ratio.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Batch Size */}
            <div>
              <label className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">
                Batch
              </label>
              <div className="flex gap-1">
                {BATCH_SIZES.map((size) => (
                  <button
                    key={size}
                    onClick={() => !isGenerating && setBatchSize(size)}
                    disabled={isGenerating}
                    className={`w-7 h-6 rounded-md text-[10px] font-medium transition-all ${
                      batchSize === size
                        ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-white border border-purple-500/30'
                        : 'bg-slate-800/60 text-slate-400 border border-white/5 hover:text-white hover:border-white/10'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {/* Negative Prompt */}
            <div className="flex-1 min-w-[150px]">
              <label className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">
                Negative Prompt <span className="text-slate-600 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                disabled={isGenerating}
                placeholder="blurry, low quality, watermark"
                className="w-full bg-slate-800/80 border border-slate-700/50 rounded-md px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-60"
              />
            </div>

            {/* Model info */}
            <div className="text-[9px] text-slate-500 whitespace-nowrap">
              {currentModel?.label || 'FLUX'} &middot; {advancedSettings.steps} steps &middot; {batchSize}x
            </div>
          </div>
        </div>
      </div>

      {/* Gallery */}
      <div className="flex-1 overflow-y-auto px-4 py-4 relative">
        {isGenerating && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm">
            <div className="relative mb-3">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/30 to-pink-500/30 flex items-center justify-center animate-pulse">
                <Cloud size={24} className="text-purple-400 animate-spin" style={{ animationDuration: '3s' }} />
              </div>
              <div className="absolute inset-0 rounded-2xl border-2 border-purple-500/20 animate-ping" style={{ animationDuration: '2s' }} />
            </div>
            <p className="text-[12px] font-medium text-slate-200 mb-0.5">
              Generating {batchSize} image{batchSize > 1 ? 's' : ''}...
            </p>
            <p className="text-[10px] text-slate-400">Using {currentModel?.label || 'Cloudflare Workers AI'}</p>
          </div>
        )}

        {generatedImages.length === 0 && !isGenerating ? (
          <div className="h-full flex items-center justify-center">
            <div className="glass-panel max-w-sm w-full text-center p-6">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center mx-auto mb-3">
                <ImageIcon size={22} className="text-purple-400" />
              </div>
              <h3 className="text-[13px] font-semibold text-slate-300 mb-1">No images generated yet</h3>
              <p className="text-[11px] text-slate-500">
                Enter a prompt above and click Generate to create your first AI image
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 w-full">
            {generatedImages.map((image) => (
              <div
                key={image.id}
                className={`group relative rounded-xl overflow-hidden border transition-all duration-200 cursor-pointer ${
                  selectedImage === image.id
                    ? 'border-purple-500/50 ring-2 ring-purple-500/20'
                    : 'border-white/5 hover:border-white/10'
                } ${regeneratingId === image.id ? 'ring-2 ring-amber-500/50' : ''}`}
                onClick={() => setLightboxImage({ url: image.url, prompt: image.prompt, aspectRatio: image.aspectRatio })}
              >
                {/* Regenerating overlay */}
                {regeneratingId === image.id && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm">
                    <RefreshCw size={20} className="text-amber-400 animate-spin mb-2" />
                    <p className="text-[10px] text-amber-300 font-medium">Regenerating...</p>
                  </div>
                )}
                <div className="aspect-square bg-slate-800/50">
                  <img
                    src={image.url}
                    alt={image.prompt}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                {/* Hover actions */}
                <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightboxImage({ url: image.url, prompt: image.prompt, aspectRatio: image.aspectRatio });
                    }}
                    className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30 transition-colors"
                    title="View full size"
                  >
                    <ZoomIn size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRegenerate(image.id);
                    }}
                    disabled={regeneratingId === image.id || isGenerating}
                    className="w-8 h-8 rounded-full bg-amber-500/80 backdrop-blur-sm flex items-center justify-center text-white hover:bg-amber-400 transition-colors disabled:opacity-50"
                    title="Regenerate image"
                  >
                    {regeneratingId === image.id ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(image.url, `generated-${image.id}.png`);
                    }}
                    className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30 transition-colors"
                    title="Save to location"
                  >
                    <Save size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddToTimeline(image.id);
                    }}
                    className="w-8 h-8 rounded-full bg-indigo-500/80 backdrop-blur-sm flex items-center justify-center text-white hover:bg-indigo-400 transition-colors"
                    title="Add to Timeline"
                  >
                    <Film size={14} />
                  </button>
                </div>

                {/* Bottom info */}
                <div className="absolute bottom-0 left-0 right-0 p-2 translate-y-full group-hover:translate-y-0 transition-transform">
                  <p className="text-[9px] text-white/80 line-clamp-1">{image.prompt}</p>
                  <span className="text-[8px] px-1 py-0.5 rounded bg-white/10 text-white/60">{image.aspectRatio}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export type { GeneratedImage } from '../../app/store';
