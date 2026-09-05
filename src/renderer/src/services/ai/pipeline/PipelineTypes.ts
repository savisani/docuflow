/**
 * AI Image Production Pipeline — Type Definitions
 *
 * Defines the complete data model for the staged documentary image pipeline:
 * Background → Person → Pose → Segment → Composite → Quality → Upscale
 */

// ---------------------------------------------------------------------------
// Pipeline Stages
// ---------------------------------------------------------------------------

export type PipelineStageName =
  | 'BACKGROUND'
  | 'PERSON'
  | 'POSE'
  | 'SEGMENT'
  | 'COMPOSITE'
  | 'QUALITY'
  | 'UPSCALE';

export type JobStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'retry_pending';

export type PipelineStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ---------------------------------------------------------------------------
// Scene Job — represents one scene's full pipeline state
// ---------------------------------------------------------------------------

export interface SceneJob {
  /** Unique scene identifier */
  sceneId: string;
  /** Scene index in the original batch (0-based) */
  sceneIndex: number;
  /** Text prompt for image generation */
  prompt: string;
  /** Negative prompt */
  negativePrompt?: string;

  // --- Stage flags ---
  /** Whether background generation is required */
  backgroundRequired: boolean;
  /** Whether person/face generation is required */
  personRequired: boolean;
  /** Person identity profile to use (if personRequired) */
  personIdentityProfileId?: string;
  /** Whether pose control is required */
  poseRequired: boolean;
  /** Pose reference data or path */
  poseReference?: string;
  /** Whether compositing is required */
  compositionRequired: boolean;
  /** Whether quality check is required */
  qualityCheckRequired: boolean;
  /** Whether upscaling is required */
  upscaleRequired: boolean;

  // --- Dimensions ---
  targetWidth: number;
  targetHeight: number;

  // --- Generation settings ---
  seed?: number;
  steps?: number;
  guidanceScale?: number;
  device?: 'auto' | 'gpu' | 'cpu' | 'directml';

  // --- Pipeline state ---
  status: PipelineStatus;
  currentStage: PipelineStageName | null;
  retryCount: number;
  maxRetries: number;

  // --- Stage results (asset paths) ---
  assets: SceneAssets;

  // --- Quality result ---
  qualityResult?: QualityResult;

  // --- Error tracking ---
  error?: PipelineError;

  // --- Timing ---
  startedAt?: number;
  completedAt?: number;
}

// ---------------------------------------------------------------------------
// Scene Assets — persistent file references for each stage output
// ---------------------------------------------------------------------------

export interface SceneAssets {
  /** Background layer image path */
  backgroundPath?: string;
  /** Generated person/face image path */
  personPath?: string;
  /** Person mask/alpha path */
  maskPath?: string;
  /** Pose control image path */
  posePath?: string;
  /** Final composited scene image path */
  compositePath?: string;
  /** Quality-checked final image path */
  qualityPassedPath?: string;
  /** Upscaled final image path */
  upscaledPath?: string;
}

// ---------------------------------------------------------------------------
// Person Identity Profile
// ---------------------------------------------------------------------------

export interface PersonIdentityProfile {
  /** Unique profile identifier */
  profileId: string;
  /** Human-readable name */
  name: string;
  /** Reference images (file paths) for identity conditioning */
  referenceImages: string[];
  /** Face embedding path (if available) */
  faceEmbeddingPath?: string;
  /** Approximate age range */
  approximateAge?: string;
  /** Hairstyle description */
  hairstyle?: string;
  /** Clothing description */
  clothing?: string;
  /** Other visual characteristics */
  visualCharacteristics?: string;
  /** Generation settings override */
  generationSettings?: Partial<SceneJob>;
}

// ---------------------------------------------------------------------------
// Quality Check Result
// ---------------------------------------------------------------------------

export interface QualityResult {
  /** Whether the image passed quality checks */
  passed: boolean;
  /** Quality score (0-1) */
  score: number;
  /** Specific issues found */
  issues: QualityIssue[];
  /** Recommendations for improvement */
  recommendations: string[];
  /** Identity similarity score (if face model available) */
  identitySimilarityScore?: number;
  /** Timestamp of the check */
  checkedAt: number;
}

export interface QualityIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  stage?: PipelineStageName;
}

// ---------------------------------------------------------------------------
// Pipeline Error
// ---------------------------------------------------------------------------

export interface PipelineError {
  code: PipelineErrorCode;
  message: string;
  stage: PipelineStageName;
  detail?: string;
  timestamp: number;
}

export type PipelineErrorCode =
  | 'MODEL_NOT_FOUND'
  | 'CUDA_OUT_OF_MEMORY'
  | 'GENERATION_FAILED'
  | 'INVALID_IMAGE'
  | 'MASK_FAILED'
  | 'COMPOSITE_FAILED'
  | 'QUALITY_FAILED'
  | 'UPSCALE_FAILED'
  | 'IDENTITY_MODEL_UNAVAILABLE'
  | 'POSE_MODEL_UNAVAILABLE'
  | 'CANCELLED'
  | 'UNKNOWN';

// ---------------------------------------------------------------------------
// Pipeline Progress
// ---------------------------------------------------------------------------

export interface PipelineProgress {
  /** Overall pipeline status */
  pipelineStatus: PipelineStatus;
  /** Total scenes in the batch */
  totalScenes: number;
  /** Number of completed scenes */
  completedScenes: number;
  /** Number of failed scenes */
  failedScenes: number;
  /** Number of scenes being retried */
  retriedScenes: number;
  /** Current stage being processed */
  currentStage: PipelineStageName;
  /** Stage-level progress counts */
  stageProgress: Record<PipelineStageName, StageProgress>;
  /** Currently processing scene */
  activeSceneId?: string;
  /** Current scene detail */
  activeSceneDetail?: string;
  /** Elapsed time in ms */
  elapsedTime: number;
  /** Estimated remaining time in ms (if calculable) */
  estimatedRemaining?: number;
  /** Overall percent (0-100) */
  overallPercent: number;
}

export interface StageProgress {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  running: boolean;
}

// ---------------------------------------------------------------------------
// Pipeline Batch Request — input for running a batch
// ---------------------------------------------------------------------------

export interface PipelineBatchRequest {
  /** Scene jobs to process */
  scenes: SceneJob[];
  /** Global generation settings (overridden by per-scene settings) */
  defaultSettings: PipelineDefaultSettings;
  /** Identity profiles referenced by scenes */
  identityProfiles?: PersonIdentityProfile[];
  /** Project name for asset storage */
  projectName: string;
  /** Whether to stop on first failure */
  stopOnError?: boolean;
}

export interface PipelineDefaultSettings {
  modelPath: string;
  device: 'auto' | 'gpu' | 'cpu' | 'directml';
  steps: number;
  guidanceScale: number;
  width: number;
  height: number;
  negativePrompt?: string;
  upscaleModel?: string;
}

// ---------------------------------------------------------------------------
// GPU Worker Types
// ---------------------------------------------------------------------------

export type GPUModelName =
  | 'background_sd'
  | 'person_sd'
  | 'openpose'
  | 'segmentation'
  | 'upscale_realesrgan';

export interface GPULoadRequest {
  model: GPUModelName;
  modelPath?: string;
  device?: string;
}

export interface GPUUnloadRequest {
  model: GPUModelName;
}

// ---------------------------------------------------------------------------
// Pipeline Event — for IPC progress reporting
// ---------------------------------------------------------------------------

export interface PipelineEvent {
  type: 'progress' | 'stage_start' | 'stage_complete' | 'scene_complete' | 'scene_error' | 'batch_complete' | 'cancelled';
  sceneId?: string;
  stage?: PipelineStageName;
  progress?: Partial<PipelineProgress>;
  error?: PipelineError;
}

// ---------------------------------------------------------------------------
// Pipeline Configuration
// ---------------------------------------------------------------------------

export interface PipelineConfig {
  /** Maximum concurrent GPU jobs (1 for 4GB VRAM) */
  maxConcurrentGPUJobs: number;
  /** Maximum retries per scene */
  maxRetries: number;
  /** Quality threshold (0-1) below which a scene fails */
  qualityThreshold: number;
  /** Enable identity similarity checking */
  enableIdentityCheck: boolean;
  /** Enable pose control */
  enablePoseControl: boolean;
  /** Timeout per stage in ms */
  stageTimeoutMs: number;
  /** Enable detailed logging */
  verboseLogging: boolean;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  maxConcurrentGPUJobs: 1,
  maxRetries: 2,
  qualityThreshold: 0.5,
  enableIdentityCheck: false,
  enablePoseControl: true,
  stageTimeoutMs: 600000, // 10 minutes
  verboseLogging: true,
};
