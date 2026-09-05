import { z } from 'zod';

export const AssetTypeSchema = z.enum(['image', 'video', 'audio']);
export const AudioRoleSchema = z.enum(['voiceover', 'music', 'sfx', 'ambient', 'unassigned']);

/**
 * Runtime Asset — used in the Zustand store.
 * Matches src/renderer/src/types/assets.ts
 */
export const AssetSchema = z.object({
  id: z.string().min(1),
  logicalId: z.string().min(1),
  filename: z.string().min(1),
  type: AssetTypeSchema,
  mimeType: z.string().min(1),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
  url: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  filePath: z.string().optional(),
  serverUrl: z.string().optional(),
  thumbnail: z.string().optional(),
  audioRole: AudioRoleSchema.optional(),
  sampleRate: z.number().optional(),
  channels: z.number().optional(),
});

export type AssetInput = z.infer<typeof AssetSchema>;

/**
 * Serialized Asset — saved to project JSON.
 * Matches src/renderer/src/types/project.ts SerializedAsset
 */
export const SerializedAssetSchema = z.object({
  id: z.string().min(1),
  logicalId: z.string().min(1),
  filename: z.string().min(1),
  type: AssetTypeSchema,
  mimeType: z.string().min(1),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
  serverUrl: z.string().optional(),
  audioRole: AudioRoleSchema.optional(),
  sampleRate: z.number().optional(),
  channels: z.number().optional(),
});

export type SerializedAssetInput = z.infer<typeof SerializedAssetSchema>;
