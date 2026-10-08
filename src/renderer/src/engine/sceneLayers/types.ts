/**
 * Layered documentary scene model.
 *
 * A scene is a structured composition of depth layers rather than a single
 * image. Layers are persisted on ProjectScene (optional fields) so legacy
 * single-image scenes remain valid — see normalize.ts.
 */

// ---------------------------------------------------------------------------
// Layer primitives
// ---------------------------------------------------------------------------

export type SceneLayerType = 'background' | 'midground' | 'foreground' | 'atmosphere';

export type SceneLayerStatus = 'pending' | 'generating' | 'done' | 'error';

/**
 * How transparency is obtained for a layer. No DocuFlow image provider emits
 * a true alpha channel, so layers that must not occlude the scene behind them
 * are generated on a keyable background and extracted client-side.
 * - 'none'      : opaque full-frame layer (backgrounds)
 * - 'chroma'    : generated on solid chroma green, keyed to alpha
 * - 'luminance' : generated on black, brightness becomes alpha (haze/dust/rays)
 */
export type LayerAlphaMode = 'none' | 'chroma' | 'luminance';

export type ShotType =
  | 'establishing'
  | 'subject'
  | 'environment'
  | 'historical_reconstruction'
  | 'detail'
  | 'atmospheric';

export type CameraIntensity = 'subtle' | 'moderate' | 'strong';

/** Reuses the existing persisted scene.cameraMotion vocabulary. */
export type SceneCameraMovement = 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'static';

/**
 * Layer placement relative to the composed frame.
 * scale is a multiplier applied on top of the cover scale (1 = frame-filling).
 */
export interface SceneLayerTransform {
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  blur?: number;
}

/** One depth layer of a scene. Persisted inside ProjectScene.layers. */
export interface SceneLayer {
  id: string;
  type: SceneLayerType;
  /** Human-readable label shown in the layer panel, e.g. "Tree Foreground". */
  name: string;
  /** Stacking order within the scene: lower = further back. */
  order: number;
  /** Short description of what this layer contributes to the composition. */
  subject: string;
  /** Full generation prompt (editable by the user). */
  prompt: string;
  status: SceneLayerStatus;
  /** Asset UUID once generated. */
  assetId?: string;
  error?: string;
  alphaMode: LayerAlphaMode;
  /** True when transparency extraction succeeded for the current asset. */
  alphaApplied?: boolean;
  /** Hidden layers are excluded from the composed timeline. Default true. */
  visible?: boolean;
  /** Atmosphere layers are optional and never block a scene build. */
  optional?: boolean;
  transform?: SceneLayerTransform;
  updatedAt?: number;
}

// ---------------------------------------------------------------------------
// Shared visual context (cross-layer consistency)
// ---------------------------------------------------------------------------

/**
 * The visual facts every layer of a scene must agree on so separately
 * generated images read as one coherent documentary frame.
 */
export interface SceneVisualContext {
  period?: string;
  location?: string;
  lighting?: string;
  weather?: string;
  tone?: string;
  architecture?: string;
  characters?: string;
  clothing?: string;
  cameraStyle?: string;
  environment?: string;
  /** Visual/narrative style, e.g. "documentary, cinematic". */
  style?: string;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface SceneCameraPlan {
  movement: SceneCameraMovement;
  intensity: CameraIntensity;
}

/** Planner output: shot choice + shared context + ordered layer drafts. */
export interface ScenePlan {
  shot: ShotType;
  context: SceneVisualContext;
  camera: SceneCameraPlan;
  layers: SceneLayer[];
  reasoning?: string;
}

/** Input for planning a scene from the existing storyboard scene data. */
export interface PlanSceneInput {
  text?: string;
  visual?: string;
  imagePrompt?: string;
  durationSec?: number;
  /** Existing camera motion chosen by the AI scene breakdown. */
  cameraMotion?: SceneCameraMovement;
  /** Seed the background layer with an already-generated legacy image. */
  existingAssetId?: string;
  idFactory?: () => string;
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export interface ComposeSceneOptions {
  /** z-index base so layered scenes never collide with existing tracks. */
  zBase: number;
  /** Project canvas dimensions (cover-scale computation). */
  width: number;
  height: number;
}

export interface ComposeSceneResult {
  commands: import('../../engine/commands/types').Command[];
  /** z slots consumed (pass zBase + usedZ for the next scene). */
  usedZ: number;
  /** Layer ids that were skipped because they had no asset. */
  skippedLayerIds: string[];
}
