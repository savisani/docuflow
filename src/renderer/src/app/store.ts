import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { Asset } from '../types/assets';
import { ProjectSettings, Project, ProjectVoiceover, ProjectTranscript, ProjectSceneMarker, ProjectScene } from '../types/project';
import { Command } from '../engine/commands/types';
import { TimelineState } from '../types/timeline';
import { buildTimeline } from '../engine/timeline/builder';
import { ProjectSchema } from '../schemas';
import { normalizeError } from '../../../core/errors';
import { migrateProject, CURRENT_PROJECT_VERSION } from '../../../core/project';
import type { SerializedDocuFlowError, ErrorCode } from '../../../core/errors';

export type PreviewMode = 'timeline' | 'asset';
export type ActiveTab = 'studio' | 'generator' | 'scenes';
export type RightPanel = 'inspector' | 'commands' | 'animation';

export interface GeneratedImage {
  id: string;
  prompt: string;
  style: string;
  aspectRatio: string;
  url: string;
  timestamp: number;
  /** Where this image was generated from */
  source: 'image-generator' | 'scene-generator';
  /** Associated scene ID if source is 'scene-generator' */
  sceneId?: string;
  /** Image provider used (cloudflare, etc.) */
  provider?: string;
  /** Model used for generation */
  model?: string;
  /** Scene generation type: 'scene-background' or 'scene-person' */
  generationType?: 'scene-background' | 'scene-person';
}

export interface TrackVisibility {
  video: boolean;
  voiceover: boolean;
  music: boolean;
  sfx: boolean;
  ambient: boolean;
  text: boolean;
}

interface PanelVisibility {
  assets: boolean;
  assetPreview: boolean;
  timelinePreview: boolean;
  timeline: boolean;
  inspector: boolean;
}

interface WorkspaceLayout {
  assetsWidth: number;
  previewTimelineSplit: number;
  timelineHeight: number;
}

function loadPanelVisibility(): PanelVisibility {
  try {
    const stored = localStorage.getItem('docuflow-panel-visibility');
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        assets: parsed.assets ?? true,
        assetPreview: parsed.assetPreview ?? true,
        timelinePreview: parsed.timelinePreview ?? true,
        timeline: parsed.timeline ?? true,
        inspector: parsed.inspector ?? true,
      };
    }
  } catch {}
  return { assets: true, assetPreview: true, timelinePreview: true, timeline: true, inspector: true };
}

function savePanelVisibility(v: PanelVisibility) {
  try {
    localStorage.setItem('docuflow-panel-visibility', JSON.stringify(v));
  } catch {}
}

function loadWorkspaceLayout(): WorkspaceLayout {
  try {
    const stored = localStorage.getItem('docuflow-workspace-layout');
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        assetsWidth: parsed.assetsWidth ?? 224,
        previewTimelineSplit: parsed.previewTimelineSplit ?? 50,
        timelineHeight: parsed.timelineHeight ?? 288,
      };
    }
  } catch {}
  return { assetsWidth: 224, previewTimelineSplit: 50, timelineHeight: 288 };
}

function saveWorkspaceLayout(l: WorkspaceLayout) {
  try {
    localStorage.setItem('docuflow-workspace-layout', JSON.stringify(l));
  } catch {}
}

interface DocuFlowState {
  project: Project | null;
  assets: Asset[];
  commands: Command[];
  timeline: TimelineState | null;
  settings: ProjectSettings;

  activeTab: ActiveTab;
  generatedImages: GeneratedImage[];
  scenes: ProjectScene[];

  currentTime: number;
  playing: boolean;
  selectedAssetId: string | null;
  selectedCommandId: string | null;
  selectedCommandIds: string[];
  previewAssetUrl: string | null;
  previewMode: PreviewMode;
  selectedPreviewAsset: Asset | null;
  trackVisibility: TrackVisibility;
  hiddenAssetIds: Set<string>;
  panelVisibility: PanelVisibility;
  workspaceLayout: WorkspaceLayout;
  snapEnabled: boolean;
  rightPanel: RightPanel;
  rightPanelWidth: number;

  // AI Chat state (persisted across tab switches)
  chatMessages: Array<{ role: 'user' | 'assistant'; content: string; thinking?: string }>;
  chatInput: string;
  chatLoading: boolean;
  chatProvider: 'ollama' | 'openrouter' | 'gemini';
  chatModel: string;

  // Model status (poll-based)
  ollamaModelStatus: 'unknown' | 'loading' | 'loaded' | 'error';
  ollamaModelName: string;

  // GPU/VRAM status
  gpuStatus: {
    cuda: boolean;
    device_name: string;
    total_vram_gb: number;
    allocated_vram_gb: number;
    reserved_vram_gb: number;
    free_vram_gb: number;
    supports_fp16?: boolean;
  } | null;
  gpuStatusLoading: boolean;
  localModelCount: number;
  localModelNames: string[];

  // Runtime model status (tracks actual loaded model, not just selection)
  loadedModelName: string | null;
  modelLoadState: 'unloaded' | 'loading' | 'loaded' | 'generating' | 'unloading';

  voiceover: ProjectVoiceover | null;
  transcript: ProjectTranscript | null;
  sceneMarkers: ProjectSceneMarker[];
  transcriptionStatus: 'idle' | 'processing' | 'complete' | 'error';
  transcriptionError: string | null;
  transcriptionStep: number;
  transcriptionStepLabel: string;
  transcriptionStartedAt: number | null;

  // Centralized error state (serializable for safe state persistence)
  error: SerializedDocuFlowError | null;
  errorHistory: SerializedDocuFlowError[];

  history: HistoryState[];
  historyIndex: number;
  batchActive: boolean;
  batchSnapshot: HistoryState | null;

  // Project file path and save state
  projectPath: string | null;
  isDirty: boolean;
  saveStatus: 'saved' | 'unsaved' | 'saving' | 'save-failed';

  // Clipboard for cut/copy/paste
  clipboardCommands: Command[];

  setProject: (project: Project) => void;
  setAssets: (assets: Asset[]) => void;
  addAsset: (asset: Asset) => void;
  updateAsset: (id: string, updates: Partial<Asset>) => void;
  removeAsset: (id: string) => void;
  setCommands: (commands: Command[]) => void;
  addCommand: (command: Command) => void;
  removeCommand: (id: string) => void;
  updateCommand: (id: string, updates: Partial<Command>) => void;
  setTimeline: (timeline: TimelineState) => void;
  setSettings: (settings: ProjectSettings) => void;
  setActiveTab: (tab: ActiveTab) => void;
  addGeneratedImage: (image: GeneratedImage) => void;
  updateGeneratedImage: (id: string, updates: Partial<GeneratedImage>) => void;
  getGeneratedImagesBySceneId: (sceneId: string) => GeneratedImage[];
  setScenes: (scenes: ProjectScene[]) => void;
  addToTimeline: (imageId: string) => void;
  setCurrentTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  selectAsset: (id: string | null) => void;
  selectCommand: (id: string | null) => void;
  toggleCommandSelection: (id: string) => void;
  setSelectedCommandIds: (ids: string[]) => void;
  setPreviewAssetUrl: (url: string | null) => void;
  setPreviewMode: (mode: PreviewMode) => void;
  setSelectedPreviewAsset: (asset: Asset | null) => void;
  setTrackVisibility: (track: keyof TrackVisibility, visible: boolean) => void;
  toggleAssetHidden: (id: string) => void;
  isAssetHidden: (id: string) => boolean;
  reorderCommands: (fromIndex: number, toIndex: number) => void;
  setPanelVisibility: (panel: keyof PanelVisibility, visible: boolean) => void;
  setAssetsWidth: (width: number) => void;
  setPreviewTimelineSplit: (split: number) => void;
  setTimelineHeight: (height: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setRightPanel: (panel: RightPanel) => void;
  setRightPanelWidth: (width: number) => void;
  addChatMessage: (message: { role: 'user' | 'assistant'; content: string; thinking?: string }) => void;
  setChatInput: (input: string) => void;
  setChatLoading: (loading: boolean) => void;
  setChatProvider: (provider: 'ollama' | 'openrouter' | 'gemini') => void;
  setChatModel: (model: string) => void;
  clearChatMessages: () => void;
  setOllamaModelStatus: (status: 'unknown' | 'loading' | 'loaded' | 'error', modelName?: string) => void;

  // GPU/VRAM status actions
  setGpuStatus: (status: DocuFlowState['gpuStatus']) => void;
  setGpuStatusLoading: (loading: boolean) => void;
  setLocalModelInfo: (count: number, names: string[]) => void;
  setLoadedModel: (name: string | null, loadState: DocuFlowState['modelLoadState']) => void;

  setVoiceover: (voiceover: ProjectVoiceover | null) => void;
  setTranscript: (transcript: ProjectTranscript | null) => void;
  setSceneMarkers: (markers: ProjectSceneMarker[]) => void;
  addSceneMarker: (marker: ProjectSceneMarker) => void;
  removeSceneMarker: (id: string) => void;
  setTranscriptionStatus: (status: 'idle' | 'processing' | 'complete' | 'error') => void;
  setTranscriptionError: (error: string | null) => void;
  setTranscriptionStep: (step: number, label: string) => void;
  resetTranscriptionProgress: () => void;
  setAudioRole: (assetId: string, role: 'voiceover' | 'music' | 'sfx' | 'ambient' | 'unassigned') => void;
  getVoiceoverAsset: () => Asset | undefined;

  // Error actions
  setError: (error: unknown, code?: ErrorCode) => void;
  clearError: () => void;

  beginBatch: () => void;
  endBatch: () => void;
  undo: () => void;
  redo: () => void;
  resetHistory: () => void;
  duplicateCommand: (id: string) => void;
  replaceCommands: (commands: Command[]) => void;
  splitCommandAtPlayhead: (id: string) => void;
  deleteSelectedCommands: () => void;
  copySelectedCommands: () => void;
  cutSelectedCommands: () => void;
  pasteCommands: () => void;
  selectAllCommands: () => void;
  saveProject: (projectName?: string) => Promise<{ success: boolean; error?: string }>;
  loadProject: (projectName: string) => Promise<{ success: boolean; error?: string }>;
  newProject: () => void;
  saveAsProject: () => Promise<{ success: boolean; error?: string }>;
  openProjectFromDialog: () => Promise<{ success: boolean; error?: string }>;
  setProjectPath: (path: string | null) => void;
  setSaveStatus: (status: 'saved' | 'unsaved' | 'saving' | 'save-failed') => void;
  markDirty: () => void;
  markClean: () => void;
}

const MAX_HISTORY = 100;

interface HistoryState {
  commands: Command[];
  assets: Asset[];
  voiceover: ProjectVoiceover | null;
  transcript: ProjectTranscript | null;
  sceneMarkers: ProjectSceneMarker[];
  settings: ProjectSettings;
}

function captureState(state: DocuFlowState): HistoryState {
  return {
    commands: state.commands.map((c) => ({ ...c }) as Command),
    assets: state.assets.map((a) => ({ ...a }) as Asset),
    voiceover: state.voiceover,
    transcript: state.transcript,
    sceneMarkers: state.sceneMarkers,
    settings: { ...state.settings },
  };
}

function restoreState(snapshot: HistoryState): Partial<DocuFlowState> {
  return {
    commands: snapshot.commands.map((c) => ({ ...c }) as Command),
    assets: snapshot.assets.map((a) => ({ ...a }) as Asset),
    voiceover: snapshot.voiceover,
    transcript: snapshot.transcript,
    sceneMarkers: snapshot.sceneMarkers,
    settings: { ...snapshot.settings },
  };
}

/**
 * Find the primary (voiceover) audio asset and return its duration in seconds.
 * Returns undefined if no voiceover audio with a known duration exists.
 */
function getPrimaryAudioDuration(assets: Asset[], voiceover: ProjectVoiceover | null): number | undefined {
  if (!voiceover) return undefined;
  const asset = assets.find((a) => a.id === voiceover.assetId);
  if (!asset || asset.type !== 'audio' || !asset.duration || asset.duration <= 0) return undefined;
  return asset.duration;
}

function rebuildAndSet(commands: Command[], assets: Asset[], settings: ProjectSettings, voiceover: ProjectVoiceover | null) {
  const primaryAudioDuration = getPrimaryAudioDuration(assets, voiceover);
  const tl = buildTimeline(commands, assets, settings, primaryAudioDuration);
  useDocuFlowStore.setState({ timeline: tl });
}

/**
 * Build timeline using current state's primary audio duration.
 * Call this instead of buildTimeline directly to ensure audio duration is respected.
 */
function buildTimelineFromState(
  commands: Command[],
  assets: Asset[],
  settings: ProjectSettings,
  voiceover: ProjectVoiceover | null
): ReturnType<typeof buildTimeline> {
  const primaryAudioDuration = getPrimaryAudioDuration(assets, voiceover);
  return buildTimeline(commands, assets, settings, primaryAudioDuration);
}

export const useDocuFlowStore = create<DocuFlowState>((set, get) => ({
  project: null,
  assets: [],
  commands: [],
  timeline: null,
  settings: { width: 1920, height: 1080, fps: 30 },

  activeTab: 'studio',
  generatedImages: [],
  scenes: [],

  currentTime: 0,
  playing: false,
  selectedAssetId: null,
  selectedCommandId: null,
  selectedCommandIds: [],
  previewAssetUrl: null,
  previewMode: 'timeline',
  selectedPreviewAsset: null,
  trackVisibility: {
    video: true,
    voiceover: true,
    music: true,
    sfx: true,
    ambient: true,
    text: true,
  },
  hiddenAssetIds: new Set<string>(),
  panelVisibility: loadPanelVisibility(),
  workspaceLayout: loadWorkspaceLayout(),
  snapEnabled: true,
  rightPanel: 'inspector',
  rightPanelWidth: 288,
  chatMessages: [],
  chatInput: '',
  chatLoading: false,
  chatProvider: 'ollama',
  chatModel: 'llama3.2',
  ollamaModelStatus: 'unknown',
  ollamaModelName: '',

  gpuStatus: null,
  gpuStatusLoading: false,
  localModelCount: 0,
  localModelNames: [],

  loadedModelName: null,
  modelLoadState: 'unloaded',

  voiceover: null,
  transcript: null,
  sceneMarkers: [],
  transcriptionStatus: 'idle',
  transcriptionError: null,
  transcriptionStep: -1,
  transcriptionStepLabel: '',
  transcriptionStartedAt: null,

  error: null,
  errorHistory: [],

  history: [{
    commands: [],
    assets: [],
    voiceover: null,
    transcript: null,
    sceneMarkers: [],
    settings: { width: 1920, height: 1080, fps: 30 },
  }],
  historyIndex: 0,
  batchActive: false,
  batchSnapshot: null,

  projectPath: null,
  isDirty: false,
  saveStatus: 'unsaved',

  clipboardCommands: [],

  setProject: (project) => {
    const state = get();
    const newVoiceover = project.voiceover ?? null;
    // Rebuild timeline with new voiceover audio duration constraint
    const tl = buildTimelineFromState(state.commands, state.assets, state.settings, newVoiceover);
    set({
      project,
      voiceover: newVoiceover,
      transcript: project.transcript ?? null,
      sceneMarkers: project.sceneMarkers ?? [],
      timeline: tl,
    });
  },
  setAssets: (assets) => set({ assets }),
  addAsset: (asset) => {
    const state = get();
    const newAssets = [...state.assets, asset];
    const newState = { ...state, assets: newAssets };
    const tl = buildTimelineFromState(newState.commands, newAssets, newState.settings, state.voiceover);
    if (!state.batchActive) {
      const postSnap = captureState({ ...newState, timeline: tl });
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(postSnap);
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      set({ assets: newAssets, timeline: tl, history: newHistory, historyIndex: newHistory.length - 1, isDirty: true, saveStatus: 'unsaved' });
    } else {
      set({ assets: newAssets, timeline: tl });
    }
  },
  removeAsset: (id) => {
    const state = get();
    const newAssets = state.assets.filter((a) => a.id !== id);
    const tl = buildTimelineFromState(state.commands, newAssets, state.settings, state.voiceover);
    if (!state.batchActive) {
      const postSnap = captureState({ ...state, assets: newAssets, timeline: tl });
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(postSnap);
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      set({ assets: newAssets, timeline: tl, history: newHistory, historyIndex: newHistory.length - 1, isDirty: true, saveStatus: 'unsaved' });
    } else {
      set({ assets: newAssets, timeline: tl });
    }
  },
  updateAsset: (id, updates) => {
    const state = get();
    const newAssets = state.assets.map((a) => (a.id === id ? { ...a, ...updates } : a));
    const tl = buildTimelineFromState(state.commands, newAssets, state.settings, state.voiceover);
    set({ assets: newAssets, timeline: tl, isDirty: true, saveStatus: 'unsaved' });
  },
  setCommands: (commands) => {
    const state = get();
    set({ commands });
    const tl = buildTimelineFromState(commands, get().assets, get().settings, state.voiceover);
    set({ timeline: tl });
  },
  addCommand: (command) => {
    const state = get();
    const newCommands = [...state.commands, command];
    const tl = buildTimelineFromState(newCommands, state.assets, state.settings, state.voiceover);
    if (!state.batchActive) {
      const postSnap = captureState({ ...state, commands: newCommands, timeline: tl });
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(postSnap);
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      set({ commands: newCommands, timeline: tl, history: newHistory, historyIndex: newHistory.length - 1, isDirty: true, saveStatus: 'unsaved' });
    } else {
      set({ commands: newCommands, timeline: tl });
    }
  },
  removeCommand: (id) => {
    const state = get();
    const newCommands = state.commands.filter((c) => c.id !== id);
    const newSelectedId = state.selectedCommandId === id ? null : state.selectedCommandId;
    const tl = buildTimelineFromState(newCommands, state.assets, state.settings, state.voiceover);
    if (!state.batchActive) {
      const postSnap = captureState({ ...state, commands: newCommands, timeline: tl });
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(postSnap);
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      set({ commands: newCommands, selectedCommandId: newSelectedId, timeline: tl, history: newHistory, historyIndex: newHistory.length - 1, isDirty: true, saveStatus: 'unsaved' });
    } else {
      set({ commands: newCommands, selectedCommandId: newSelectedId, timeline: tl });
    }
  },
  updateCommand: (id, updates) => {
    const state = get();
    const newCommands = state.commands.map((c) => (c.id === id ? { ...c, ...updates } as Command : c));
    const tl = buildTimelineFromState(newCommands, state.assets, state.settings, state.voiceover);
    if (!state.batchActive) {
      const postSnap = captureState({ ...state, commands: newCommands, timeline: tl });
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(postSnap);
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      set({ commands: newCommands, timeline: tl, history: newHistory, historyIndex: newHistory.length - 1, isDirty: true, saveStatus: 'unsaved' });
    } else {
      set({ commands: newCommands, timeline: tl });
    }
  },
  setTimeline: (timeline) => set({ timeline }),
  setSettings: (settings) => set({ settings, isDirty: true, saveStatus: 'unsaved' }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  addGeneratedImage: (image) => set((state) => ({ generatedImages: [...state.generatedImages, image] })),
  updateGeneratedImage: (id, updates) => set((state) => ({
    generatedImages: state.generatedImages.map((img) =>
      img.id === id ? { ...img, ...updates } : img
    ),
  })),
  getGeneratedImagesBySceneId: (sceneId) => get().generatedImages.filter((img) => img.sceneId === sceneId),
  setScenes: (scenes) => set({ scenes, isDirty: true, saveStatus: 'unsaved' }),
  addToTimeline: (imageId) => {
    const state = get();
    const image = state.generatedImages.find((img) => img.id === imageId);
    if (!image) return;

    const asset = state.assets.find((a) => a.id === imageId);
    if (!asset) return;

    const lastCommand = state.commands[state.commands.length - 1];
    const start = lastCommand ? ((lastCommand as any).start ?? 0) + ((lastCommand as any).duration ?? 3) : 0;

    const command: Command = {
      id: uuidv4(),
      type: 'show',
      asset: asset.id,
      start,
      duration: 3,
    } as Command;

    const newCommands = [...state.commands, command];
    const tl = buildTimelineFromState(newCommands, state.assets, state.settings, state.voiceover);
    const postSnap = captureState({ ...state, commands: newCommands, timeline: tl });
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(postSnap);
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    set({
      activeTab: 'studio',
      commands: newCommands,
      timeline: tl,
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
      saveStatus: 'unsaved',
    });
  },
  setCurrentTime: (time) => set({ currentTime: time }),
  setPlaying: (playing) => set({ playing }),
  selectAsset: (id) => set({ selectedAssetId: id }),
  selectCommand: (id) => set({ selectedCommandId: id, selectedCommandIds: id ? [id] : [] }),
  toggleCommandSelection: (id) => set((state) => {
    const ids = state.selectedCommandIds.includes(id)
      ? state.selectedCommandIds.filter((i) => i !== id)
      : [...state.selectedCommandIds, id];
    return {
      selectedCommandIds: ids,
      selectedCommandId: ids.length > 0 ? ids[ids.length - 1] : null,
    };
  }),
  setSelectedCommandIds: (ids) => set({
    selectedCommandIds: ids,
    selectedCommandId: ids.length > 0 ? ids[ids.length - 1] : null,
  }),
  setPreviewAssetUrl: (url) => set({ previewAssetUrl: url }),
  setPreviewMode: (mode) => set({ previewMode: mode }),
  setSelectedPreviewAsset: (asset) => set({ selectedPreviewAsset: asset }),
  setTrackVisibility: (track, visible) =>
    set((state) => ({
      trackVisibility: { ...state.trackVisibility, [track]: visible },
    })),
  toggleAssetHidden: (id) =>
    set((state) => {
      const newHidden = new Set(state.hiddenAssetIds);
      if (newHidden.has(id)) {
        newHidden.delete(id);
      } else {
        newHidden.add(id);
      }
      return { hiddenAssetIds: newHidden };
    }),
  isAssetHidden: (id) => get().hiddenAssetIds.has(id),
  reorderCommands: (fromIndex, toIndex) => {
    const state = get();
    const newCommands = [...state.commands];
    const [removed] = newCommands.splice(fromIndex, 1);
    newCommands.splice(toIndex, 0, removed);
    const tl = buildTimelineFromState(newCommands, state.assets, state.settings, state.voiceover);
    if (!state.batchActive) {
      const postSnap = captureState({ ...state, commands: newCommands, timeline: tl });
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(postSnap);
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      set({ commands: newCommands, timeline: tl, history: newHistory, historyIndex: newHistory.length - 1, isDirty: true, saveStatus: 'unsaved' });
    } else {
      set({ commands: newCommands, timeline: tl });
    }
  },
  setPanelVisibility: (panel, visible) =>
    set((state) => {
      const next = { ...state.panelVisibility, [panel]: visible };
      if (!next.timelinePreview && !next.timeline) {
        if (panel === 'timelinePreview') next.timeline = true;
        else next.timelinePreview = true;
      }
      savePanelVisibility(next);
      return { panelVisibility: next };
    }),
  setAssetsWidth: (width) =>
    set((state) => {
      const next = { ...state.workspaceLayout, assetsWidth: Math.max(160, Math.min(400, width)) };
      saveWorkspaceLayout(next);
      return { workspaceLayout: next };
    }),
  setPreviewTimelineSplit: (split) =>
    set((state) => {
      const next = { ...state.workspaceLayout, previewTimelineSplit: Math.max(10, Math.min(90, split)) };
      saveWorkspaceLayout(next);
      return { workspaceLayout: next };
    }),
  setTimelineHeight: (height) =>
    set((state) => {
      const titlebarHeight = 32;
      const resizeHandleHeight = 1;
      const availableHeight = window.innerHeight - titlebarHeight - resizeHandleHeight;
      const maxHeight = Math.floor(availableHeight * 0.7);
      const next = { ...state.workspaceLayout, timelineHeight: Math.max(180, Math.min(maxHeight, height)) };
      saveWorkspaceLayout(next);
      return { workspaceLayout: next };
    }),
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
  setRightPanel: (panel) => set({ rightPanel: panel }),
  setRightPanelWidth: (width) => set({ rightPanelWidth: width }),
  addChatMessage: (message) => set((state) => ({ chatMessages: [...state.chatMessages, message] })),
  setChatInput: (input) => set({ chatInput: input }),
  setChatLoading: (loading) => set({ chatLoading: loading }),
  setChatProvider: (provider) => set({ chatProvider: provider }),
  setChatModel: (model) => set({ chatModel: model }),
  clearChatMessages: () => set({ chatMessages: [] }),
  setOllamaModelStatus: (status, modelName) => set({
    ollamaModelStatus: status,
    ...(modelName !== undefined ? { ollamaModelName: modelName } : {}),
  }),

  setGpuStatus: (status) => set({ gpuStatus: status }),
  setGpuStatusLoading: (loading) => set({ gpuStatusLoading: loading }),
  setLocalModelInfo: (count, names) => set({ localModelCount: count, localModelNames: names }),
  setLoadedModel: (name, loadState) => set({
    loadedModelName: name,
    modelLoadState: loadState,
  }),

  setVoiceover: (voiceover) => {
    const state = get();
    const tl = buildTimelineFromState(state.commands, state.assets, state.settings, voiceover);
    set({ voiceover, timeline: tl, isDirty: true, saveStatus: 'unsaved' });
  },
  setTranscript: (transcript) => set({ transcript, isDirty: true, saveStatus: 'unsaved' }),
  setSceneMarkers: (sceneMarkers) => set({ sceneMarkers, isDirty: true, saveStatus: 'unsaved' }),
  addSceneMarker: (marker) => set((s) => ({ sceneMarkers: [...s.sceneMarkers, marker], isDirty: true, saveStatus: 'unsaved' })),
  removeSceneMarker: (id) => set((s) => ({ sceneMarkers: s.sceneMarkers.filter((m) => m.id !== id), isDirty: true, saveStatus: 'unsaved' })),
  setTranscriptionStatus: (transcriptionStatus) => {
    if (transcriptionStatus === 'processing') {
      set({ transcriptionStatus, transcriptionStartedAt: Date.now() });
    } else {
      set({ transcriptionStatus });
    }
  },
  setTranscriptionError: (transcriptionError) => set({ transcriptionError }),
  setTranscriptionStep: (step, label) => set({ transcriptionStep: step, transcriptionStepLabel: label }),
  resetTranscriptionProgress: () => set({
    transcriptionStep: -1,
    transcriptionStepLabel: '',
    transcriptionStartedAt: null,
  }),

  // Centralized error actions
  setError: (error, code) => {
    const normalized = normalizeError(error, code);
    const serialized = normalized.toSerializable();
    set((state) => ({
      error: serialized,
      errorHistory: [...state.errorHistory.slice(-49), serialized], // keep last 50
    }));
  },
  clearError: () => set({ error: null }),

  setAudioRole: (assetId, role) => {
    const state = get();
    const newAssets = state.assets.map((a) => a.id === assetId ? { ...a, audioRole: role } : a);
    const tl = buildTimelineFromState(state.commands, newAssets, state.settings, state.voiceover);
    if (!state.batchActive) {
      const postSnap = captureState({ ...state, assets: newAssets, timeline: tl });
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(postSnap);
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      set({ assets: newAssets, timeline: tl, history: newHistory, historyIndex: newHistory.length - 1, isDirty: true, saveStatus: 'unsaved' });
    } else {
      set({ assets: newAssets, timeline: tl });
    }
  },
  getVoiceoverAsset: () => {
    const state = get();
    if (!state.voiceover) return undefined;
    return state.assets.find((a) => a.id === state.voiceover!.assetId);
  },

  beginBatch: () => set((state) => {
    if (state.batchActive) return {};
    return {
      batchActive: true,
      batchSnapshot: captureState(state),
    };
  }),

  endBatch: () => set((state) => {
    if (!state.batchActive) return {};
    const snapshot = state.batchSnapshot;
    const currentState = captureState(state);
    if (snapshot && !historySnapshotsEqual(snapshot, currentState)) {
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(currentState);
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      return {
        batchActive: false,
        batchSnapshot: null,
        history: newHistory,
        historyIndex: newHistory.length - 1,
      };
    }
    return { batchActive: false, batchSnapshot: null };
  }),

  resetHistory: () => set((state) => ({
    history: [captureState(state)],
    historyIndex: 0,
  })),

  undo: () => {
    const state = get();
    if (state.batchActive) {
      state.endBatch();
    }
    if (state.historyIndex <= 0) return;
    const newIndex = state.historyIndex - 1;
    const snapshot = state.history[newIndex];
    if (!snapshot) return;
    const restored = restoreState(snapshot);
    const tl = buildTimelineFromState(restored.commands || [], restored.assets || [], restored.settings || state.settings, restored.voiceover ?? state.voiceover);
    set({
      ...restored,
      historyIndex: newIndex,
      timeline: tl,
    });
  },

  redo: () => {
    const state = get();
    if (state.batchActive) {
      state.endBatch();
    }
    if (state.historyIndex >= state.history.length - 1) return;
    const newIndex = state.historyIndex + 1;
    const snapshot = state.history[newIndex];
    if (!snapshot) return;
    const restored = restoreState(snapshot);
    const tl = buildTimelineFromState(restored.commands || [], restored.assets || [], restored.settings || state.settings, restored.voiceover ?? state.voiceover);
    set({
      ...restored,
      historyIndex: newIndex,
      timeline: tl,
    });
  },

  duplicateCommand: (id) => {
    const state = get();
    const cmd = state.commands.find((c) => c.id === id);
    if (!cmd) return;
    const newCmd = {
      ...cmd,
      id: uuidv4(),
      start: cmd.start + (('duration' in cmd) ? (cmd as any).duration + 0.5 : 3.5),
    } as Command;
    const newCommands = [...state.commands, newCmd];
    const tl = buildTimelineFromState(newCommands, state.assets, state.settings, state.voiceover);
    if (!state.batchActive) {
      const postSnap = captureState({ ...state, commands: newCommands, timeline: tl });
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(postSnap);
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      set({ commands: newCommands, timeline: tl, history: newHistory, historyIndex: newHistory.length - 1, isDirty: true, saveStatus: 'unsaved' });
    } else {
      set({ commands: newCommands, timeline: tl });
    }
  },

  replaceCommands: (commands) => {
    const state = get();
    const tl = buildTimelineFromState(commands, state.assets, state.settings, state.voiceover);
    if (!state.batchActive) {
      const postSnap = captureState({ ...state, commands, timeline: tl });
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(postSnap);
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      set({ commands, timeline: tl, history: newHistory, historyIndex: newHistory.length - 1, isDirty: true, saveStatus: 'unsaved' });
    } else {
      set({ commands, timeline: tl });
    }
  },

  splitCommandAtPlayhead: (id) => {
    const state = get();
    const cmd = state.commands.find((c) => c.id === id);
    if (!cmd || !('duration' in cmd) || !(cmd as any).duration) return;

    const fps = state.settings.fps;
    const splitTime = state.currentTime;
    const cmdStart = cmd.start;
    const cmdDuration = (cmd as any).duration as number;
    const cmdEnd = cmdStart + cmdDuration;

    // Only split if playhead is within the clip
    if (splitTime <= cmdStart || splitTime >= cmdEnd) return;

    const splitFrameDuration = Math.round((cmdEnd - splitTime) * fps);
    const newDuration = splitFrameDuration / fps;

    const secondCmd = { ...cmd, id: uuidv4(), start: splitTime, duration: newDuration } as Command;
    const firstCmd = { ...cmd, duration: splitTime - cmdStart } as Command;

    const newCommands = state.commands.map((c) => (c.id === id ? firstCmd : c));
    newCommands.push(secondCmd);
    newCommands.sort((a, b) => a.start - b.start);

    const tl = buildTimelineFromState(newCommands, state.assets, state.settings, state.voiceover);
    const postSnap = captureState({ ...state, commands: newCommands, timeline: tl });
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(postSnap);
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    set({ commands: newCommands, timeline: tl, history: newHistory, historyIndex: newHistory.length - 1, isDirty: true, saveStatus: 'unsaved' });
  },

  deleteSelectedCommands: () => {
    const state = get();
    const ids = state.selectedCommandIds.length > 0 ? state.selectedCommandIds : (state.selectedCommandId ? [state.selectedCommandId] : []);
    if (ids.length === 0) return;

    const newCommands = state.commands.filter((c) => !ids.includes(c.id));
    const tl = buildTimelineFromState(newCommands, state.assets, state.settings, state.voiceover);
    const postSnap = captureState({ ...state, commands: newCommands, timeline: tl });
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(postSnap);
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    set({ commands: newCommands, timeline: tl, history: newHistory, historyIndex: newHistory.length - 1, selectedCommandId: null, selectedCommandIds: [], isDirty: true, saveStatus: 'unsaved' });
  },

  copySelectedCommands: () => {
    const state = get();
    const ids = state.selectedCommandIds.length > 0 ? state.selectedCommandIds : (state.selectedCommandId ? [state.selectedCommandId] : []);
    if (ids.length === 0) return;

    const copied = state.commands.filter((c) => ids.includes(c.id)).map((c) => ({ ...c }) as Command);
    set({ clipboardCommands: copied });
  },

  cutSelectedCommands: () => {
    const state = get();
    const ids = state.selectedCommandIds.length > 0 ? state.selectedCommandIds : (state.selectedCommandId ? [state.selectedCommandId] : []);
    if (ids.length === 0) return;

    const copied = state.commands.filter((c) => ids.includes(c.id)).map((c) => ({ ...c }) as Command);
    const newCommands = state.commands.filter((c) => !ids.includes(c.id));
    const tl = buildTimelineFromState(newCommands, state.assets, state.settings, state.voiceover);
    const postSnap = captureState({ ...state, commands: newCommands, timeline: tl });
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(postSnap);
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    set({ commands: newCommands, timeline: tl, history: newHistory, historyIndex: newHistory.length - 1, clipboardCommands: copied, selectedCommandId: null, selectedCommandIds: [], isDirty: true, saveStatus: 'unsaved' });
  },

  pasteCommands: () => {
    const state = get();
    if (state.clipboardCommands.length === 0) return;

    const pasteTime = state.currentTime;
    const newCommands = state.clipboardCommands.map((cmd) => {
      const originalDuration = ('duration' in cmd && (cmd as any).duration) ? (cmd as any).duration as number : 3;
      return {
        ...cmd,
        id: uuidv4(),
        start: pasteTime,
      } as Command;
    });

    // Sort by start time to maintain order, then offset pasted commands
    let offset = 0;
    const sorted = [...newCommands].sort((a, b) => a.start - b.start);
    for (const cmd of sorted) {
      (cmd as any).start = pasteTime + offset;
      const dur = ('duration' in cmd && (cmd as any).duration) ? (cmd as any).duration as number : 3;
      offset += dur;
    }

    const allCommands = [...state.commands, ...newCommands];
    const tl = buildTimelineFromState(allCommands, state.assets, state.settings, state.voiceover);
    const postSnap = captureState({ ...state, commands: allCommands, timeline: tl });
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(postSnap);
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    const pastedIds = newCommands.map((c) => c.id);
    set({ commands: allCommands, timeline: tl, history: newHistory, historyIndex: newHistory.length - 1, selectedCommandIds: pastedIds, selectedCommandId: pastedIds[pastedIds.length - 1], isDirty: true, saveStatus: 'unsaved' });
  },

  selectAllCommands: () => {
    const state = get();
    const ids = state.commands.map((c) => c.id);
    set({ selectedCommandIds: ids, selectedCommandId: ids.length > 0 ? ids[ids.length - 1] : null });
  },

  saveProject: async (projectName) => {
    const state = get();

    // If no project path exists, show Save As dialog
    if (!state.projectPath) {
      return state.saveAsProject();
    }

    // Subsequent save - save directly to existing path
    set({ saveStatus: 'saving' });
    const projectData = {
      version: CURRENT_PROJECT_VERSION,
      settings: state.settings,
      assets: state.assets.map(a => ({
        id: a.id,
        logicalId: a.logicalId,
        filename: a.filename,
        type: a.type,
        mimeType: a.mimeType,
        width: a.width,
        height: a.height,
        duration: a.duration,
        filePath: a.filePath,
        audioRole: a.audioRole,
      })),
      commands: state.commands,
      voiceover: state.voiceover,
      transcript: state.transcript,
      sceneMarkers: state.sceneMarkers,
      scenes: state.scenes.map(({ imageUrl: _imageUrl, ...scene }) => scene),
      generatedImages: state.generatedImages.map(img => ({
        id: img.id,
        prompt: img.prompt,
        style: img.style,
        aspectRatio: img.aspectRatio,
        timestamp: img.timestamp,
        source: img.source,
        sceneId: img.sceneId,
        provider: img.provider,
        model: img.model,
        generationType: img.generationType,
      })),
    };

    const validation = ProjectSchema.safeParse(projectData);
    if (!validation.success) {
      const err = normalizeError(validation.error, 'PROJECT_SAVE' as ErrorCode);
      set({ saveStatus: 'save-failed' });
      return { success: false, error: err.message };
    }

    try {
      if (window.docuflow) {
        const result = await window.docuflow.saveProjectToPath(state.projectPath, projectData);
        if (!result.success) {
          set({ saveStatus: 'save-failed' });
          return { success: false, error: result.error };
        }
        set({ saveStatus: 'saved', isDirty: false });
        return { success: true };
      }
      set({ saveStatus: 'save-failed' });
      return { success: false, error: 'DocuFlow API not available' };
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'PROJECT_SAVE' as ErrorCode);
      set({ saveStatus: 'save-failed' });
      return { success: false, error: normalized.message };
    }
  },

  loadProject: async (projectName) => {
    try {
      let projectData: any = null;
      if (window.docuflow) {
        const result = await window.docuflow.loadProject(projectName);
        if (result.success && result.data) {
          projectData = result.data;
        } else if (!result.success && result.error) {
          const err = normalizeError(result.error, 'PROJECT_LOAD' as ErrorCode);
          return { success: false, error: err.message };
        }
      }
      if (!projectData) {
        const stored = localStorage.getItem(`docuflow-project-${projectName}`);
        if (stored) projectData = JSON.parse(stored);
      }
      if (!projectData) {
        const err = normalizeError('Project not found', 'PROJECT_LOAD' as ErrorCode, {
          context: { projectName },
        });
        return { success: false, error: err.message };
      }
      const migrationResult = migrateProject(projectData);
      if ('error' in migrationResult) {
        const err = normalizeError(migrationResult.error, migrationResult.code as ErrorCode, {
          context: migrationResult.context,
        });
        return { success: false, error: err.message };
      }
      projectData = migrationResult.project;
      const validation = ProjectSchema.safeParse(projectData);
      if (!validation.success) {
        const err = normalizeError(validation.error, 'PROJECT_LOAD' as ErrorCode);
        return { success: false, error: err.message };
      }
      const state = get();
      const newAssets = (projectData.assets || []).map((a: any) => ({
        ...a,
        url: a.filePath ? (window.docuflow ? window.docuflow.filePathToAssetUrl(a.filePath) : undefined) : a.url,
      })) as Asset[];

      const assetUrlMap = new Map(newAssets.map(a => [a.id, a.url]));

      const restoredGeneratedImages = (projectData.generatedImages || []).map((img: any) => ({
        ...img,
        url: assetUrlMap.get(img.id) || img.url,
      }));

      const restoredScenes = (projectData.scenes || []).map((scene: any) => ({
        ...scene,
        imageUrl: scene.imageId ? assetUrlMap.get(scene.imageId) : scene.imageUrl,
      }));

      set({
        settings: projectData.settings || state.settings,
        assets: newAssets,
        commands: projectData.commands || [],
        voiceover: projectData.voiceover || null,
        transcript: projectData.transcript || null,
        sceneMarkers: projectData.sceneMarkers || [],
        scenes: restoredScenes,
        generatedImages: restoredGeneratedImages,
      });
      const tl = buildTimelineFromState(
        projectData.commands || [],
        newAssets,
        projectData.settings || state.settings,
        projectData.voiceover || null
      );
      set({ timeline: tl, saveStatus: 'saved', isDirty: false });
      const snap = captureState({ ...get() });
      set({ history: [snap], historyIndex: 0 });
      return { success: true };
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'PROJECT_LOAD' as ErrorCode);
      return { success: false, error: normalized.message };
    }
  },

  newProject: () => {
    set({
      project: null,
      assets: [],
      commands: [],
      timeline: null,
      settings: { width: 1920, height: 1080, fps: 30 },
      voiceover: null,
      transcript: null,
      sceneMarkers: [],
      projectPath: null,
      isDirty: false,
      saveStatus: 'unsaved',
      generatedImages: [],
      scenes: [],
      error: null,
      history: [{
        commands: [],
        assets: [],
        voiceover: null,
        transcript: null,
        sceneMarkers: [],
        settings: { width: 1920, height: 1080, fps: 30 },
      }],
      historyIndex: 0,
    });
  },

  saveAsProject: async () => {
    const state = get();
    set({ saveStatus: 'saving' });

    const projectData = {
      version: CURRENT_PROJECT_VERSION,
      settings: state.settings,
      assets: state.assets.map(a => ({
        id: a.id,
        logicalId: a.logicalId,
        filename: a.filename,
        type: a.type,
        mimeType: a.mimeType,
        width: a.width,
        height: a.height,
        duration: a.duration,
        filePath: a.filePath,
        audioRole: a.audioRole,
      })),
      commands: state.commands,
      voiceover: state.voiceover,
      transcript: state.transcript,
      sceneMarkers: state.sceneMarkers,
      scenes: state.scenes.map(({ imageUrl: _imageUrl, ...scene }) => scene),
      generatedImages: state.generatedImages.map(img => ({
        id: img.id,
        prompt: img.prompt,
        style: img.style,
        aspectRatio: img.aspectRatio,
        timestamp: img.timestamp,
        source: img.source,
        sceneId: img.sceneId,
        provider: img.provider,
        model: img.model,
        generationType: img.generationType,
      })),
    };

    const validation = ProjectSchema.safeParse(projectData);
    if (!validation.success) {
      const err = normalizeError(validation.error, 'PROJECT_SAVE' as ErrorCode);
      set({ saveStatus: 'save-failed' });
      return { success: false, error: err.message };
    }

    try {
      if (!window.docuflow) {
        set({ saveStatus: 'save-failed' });
        return { success: false, error: 'DocuFlow API not available' };
      }

      // Show Save As dialog
      const dialogResult = await window.docuflow.showSaveProjectDialog();
      if (dialogResult.canceled || !dialogResult.filePath) {
        set({ saveStatus: state.isDirty ? 'unsaved' : 'saved' });
        return { success: false, error: 'Save cancelled' };
      }

      // Save to the selected path
      const saveResult = await window.docuflow.saveProjectToPath(dialogResult.filePath, projectData);
      if (!saveResult.success) {
        set({ saveStatus: 'save-failed' });
        return { success: false, error: saveResult.error };
      }

      set({ projectPath: dialogResult.filePath, saveStatus: 'saved', isDirty: false });
      return { success: true };
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'PROJECT_SAVE' as ErrorCode);
      set({ saveStatus: 'save-failed' });
      return { success: false, error: normalized.message };
    }
  },

  openProjectFromDialog: async () => {
    try {
      if (!window.docuflow) {
        return { success: false, error: 'DocuFlow API not available' };
      }

      const dialogResult = await window.docuflow.showOpenProjectDialog();
      if (dialogResult.canceled || !dialogResult.filePath) {
        return { success: false, error: 'Open cancelled' };
      }

      const loadResult = await window.docuflow.loadProjectFromPath(dialogResult.filePath);
      if (!loadResult.success) {
        return { success: false, error: loadResult.error };
      }

      const projectData = loadResult.data;
      const migrationResult = migrateProject(projectData);
      if ('error' in migrationResult) {
        const err = normalizeError(migrationResult.error, migrationResult.code as ErrorCode, {
          context: migrationResult.context,
        });
        return { success: false, error: err.message };
      }
      const migratedData = migrationResult.project;

      const validation = ProjectSchema.safeParse(migratedData);
      if (!validation.success) {
        const err = normalizeError(validation.error, 'PROJECT_LOAD' as ErrorCode);
        return { success: false, error: err.message };
      }

      const state = get();
      const newAssets = (migratedData.assets || []).map((a: any) => ({
        ...a,
        url: a.filePath ? (window.docuflow ? window.docuflow.filePathToAssetUrl(a.filePath) : undefined) : a.url,
      })) as Asset[];

      const assetUrlMap = new Map(newAssets.map(a => [a.id, a.url]));

      const restoredGeneratedImages = (migratedData.generatedImages || []).map((img: any) => ({
        ...img,
        url: assetUrlMap.get(img.id) || img.url,
      }));

      const restoredScenes = (migratedData.scenes || []).map((scene: any) => ({
        ...scene,
        imageUrl: scene.imageId ? assetUrlMap.get(scene.imageId) : scene.imageUrl,
      }));

      set({
        projectPath: dialogResult.filePath,
        settings: migratedData.settings || state.settings,
        assets: newAssets,
        commands: migratedData.commands || [],
        voiceover: migratedData.voiceover || null,
        transcript: migratedData.transcript || null,
        sceneMarkers: migratedData.sceneMarkers || [],
        scenes: restoredScenes,
        generatedImages: restoredGeneratedImages,
        saveStatus: 'saved',
        isDirty: false,
      });

      const tl = buildTimelineFromState(
        migratedData.commands || [],
        newAssets,
        migratedData.settings || state.settings,
        migratedData.voiceover || null
      );
      set({ timeline: tl });

      const snap = captureState({ ...get() });
      set({ history: [snap], historyIndex: 0 });
      return { success: true };
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'PROJECT_LOAD' as ErrorCode);
      return { success: false, error: normalized.message };
    }
  },

  setProjectPath: (path) => set({ projectPath: path }),

  setSaveStatus: (status) => set({ saveStatus: status }),

  markDirty: () => set({ isDirty: true, saveStatus: 'unsaved' }),

  markClean: () => set({ isDirty: false, saveStatus: 'saved' }),
}));

function historySnapshotsEqual(a: HistoryState, b: HistoryState): boolean {
  if (a.commands.length !== b.commands.length) return false;
  if (a.assets.length !== b.assets.length) return false;
  for (let i = 0; i < a.commands.length; i++) {
    const ac = a.commands[i] as any;
    const bc = b.commands[i] as any;
    if (ac.id !== bc.id || ac.type !== bc.type || ac.start !== bc.start || ac.duration !== bc.duration) return false;
    if (JSON.stringify(ac) !== JSON.stringify(bc)) return false;
  }
  for (let i = 0; i < a.assets.length; i++) {
    if (a.assets[i].id !== b.assets[i].id) return false;
    if (JSON.stringify(a.assets[i]) !== JSON.stringify(b.assets[i])) return false;
  }
  if (JSON.stringify(a.voiceover) !== JSON.stringify(b.voiceover)) return false;
  if (JSON.stringify(a.settings) !== JSON.stringify(b.settings)) return false;
  return true;
}
