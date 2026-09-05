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
});

export type ProjectInput = z.infer<typeof ProjectSchema>;
export type ProjectSettingsInput = z.infer<typeof ProjectSettingsSchema>;
