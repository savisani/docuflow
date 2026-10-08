import { z } from 'zod';
import { CommandSchema } from './command.schema';
import { SerializedAssetSchema } from './asset.schema';

export const ProjectSettingsSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  fps: z.number().positive(),
});

export const ProjectVoiceoverSchema = z.object({
  assetId: z.string().min(1),
  language: z.string().min(1),
});

export const ProjectTranscriptSegmentSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  words: z.array(z.object({
    text: z.string(),
    start: z.number(),
    end: z.number(),
  })).optional(),
  originalText: z.string().optional(),
  originalLanguage: z.string().optional(),
});

export const ProjectTranscriptSchema = z.object({
  language: z.string().min(1),
  text: z.string(),
  segments: z.array(ProjectTranscriptSegmentSchema),
  translated: z.boolean().optional(),
});

export const ProjectSceneMarkerSchema = z.object({
  id: z.string().min(1),
  start: z.number(),
  end: z.number(),
  transcriptSegmentIds: z.array(z.string()),
});

const SceneLayerTransformSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  scale: z.number().optional(),
  rotation: z.number().optional(),
  opacity: z.number().optional(),
  blur: z.number().optional(),
});

/**
 * Layered documentary scene layer. Deliberately lenient (most fields optional)
 * so saved projects never fail validation on minor shape drift.
 */
const SceneLayerSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['background', 'midground', 'foreground', 'atmosphere']),
  name: z.string().optional(),
  order: z.number().optional(),
  subject: z.string().optional(),
  prompt: z.string().optional(),
  status: z.enum(['pending', 'generating', 'done', 'error']).optional(),
  assetId: z.string().optional(),
  error: z.string().optional(),
  alphaMode: z.enum(['none', 'chroma', 'luminance']).optional(),
  alphaApplied: z.boolean().optional(),
  visible: z.boolean().optional(),
  optional: z.boolean().optional(),
  transform: SceneLayerTransformSchema.optional(),
  updatedAt: z.number().optional(),
});

const SceneVisualContextSchema = z.object({
  period: z.string().optional(),
  location: z.string().optional(),
  lighting: z.string().optional(),
  weather: z.string().optional(),
  tone: z.string().optional(),
  architecture: z.string().optional(),
  characters: z.string().optional(),
  clothing: z.string().optional(),
  cameraStyle: z.string().optional(),
  environment: z.string().optional(),
  style: z.string().optional(),
});

export const ProjectSceneSchema = z.object({
  sceneId: z.number(),
  startTime: z.number(),
  endTime: z.number(),
  transcriptChunk: z.string(),
  visualDescription: z.string(),
  imagePrompt: z.string(),
  cameraMotion: z.enum(['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static']),
  reasoning: z.string().optional(),
  status: z.enum(['pending', 'generating', 'done', 'error']),
  imageUrl: z.string().optional(),
  imageId: z.string().optional(),
  error: z.string().optional(),
  // Layered documentary scene — optional so legacy scenes validate unchanged
  layers: z.array(SceneLayerSchema).optional(),
  shotType: z.enum([
    'establishing',
    'subject',
    'environment',
    'historical_reconstruction',
    'detail',
    'atmospheric',
  ]).optional(),
  cameraIntensity: z.enum(['subtle', 'moderate', 'strong']).optional(),
  visualContext: SceneVisualContextSchema.optional(),
});

export const GeneratedImageSchema = z.object({
  id: z.string().min(1),
  prompt: z.string(),
  style: z.string(),
  aspectRatio: z.string(),
  timestamp: z.number(),
  source: z.enum(['image-generator', 'scene-generator']),
  sceneId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  generationType: z.enum(['scene-background', 'scene-person']).optional(),
});

export type GeneratedImageInput = z.infer<typeof GeneratedImageSchema>;

/**
 * Full Project schema — validates the serialized .docuflow.json format.
 * Matches src/renderer/src/types/project.ts Project
 */
export const ProjectSchema = z.object({
  version: z.number(),
  settings: ProjectSettingsSchema,
  assets: z.array(SerializedAssetSchema),
  commands: z.array(CommandSchema),
  voiceover: ProjectVoiceoverSchema.nullable().optional(),
  transcript: ProjectTranscriptSchema.nullable().optional(),
  sceneMarkers: z.array(ProjectSceneMarkerSchema).optional(),
  scenes: z.array(ProjectSceneSchema).optional(),
  generatedImages: z.array(GeneratedImageSchema).optional(),
});

export type ProjectInput = z.infer<typeof ProjectSchema>;
export type ProjectSettingsInput = z.infer<typeof ProjectSettingsSchema>;
