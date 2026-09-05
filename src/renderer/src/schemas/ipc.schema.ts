import { z } from 'zod';

// ── Image Generation ─────────────────────────────────────────────

export const GenerateLocalEnhancedSchema = z.object({
  prompt: z.string().min(1),
  negativePrompt: z.string().optional(),
  width: z.number().positive(),
  height: z.number().positive(),
  outputPath: z.string().min(1),
  modelPath: z.string().min(1),
  steps: z.number().positive().optional(),
  seed: z.number().optional(),
  device: z.string().optional(),
  generationId: z.string().optional(),
  unloadAfter: z.boolean().optional(),
});

export const GenerateLocalSchema = z.object({
  prompt: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  outputPath: z.string().min(1),
  seed: z.number().optional(),
});

export const ModelSwitchSchema = z.object({
  modelPath: z.string().min(1),
});

// ── Image Save / Upscale ────────────────────────────────────────

export const SaveImageSchema = z.object({
  imageBase64: z.string().min(1),
  defaultName: z.string().optional(),
});

export const SaveImageFromPathSchema = z.object({
  sourcePath: z.string().min(1),
  defaultName: z.string().optional(),
});

export const SaveImageToFolderSchema = z.object({
  imageBase64: z.string().min(1),
  folderPath: z.string().min(1),
  fileName: z.string().optional(),
});

export const SaveBytesSchema = z.object({
  imageBase64: z.string().min(1),
  filename: z.string().optional(),
});

export const UpscaleSchema = z.object({
  inputPath: z.string().min(1),
  outputPath: z.string().min(1),
  scale: z.number().positive().optional(),
  device: z.string().optional(),
});

// ── Transcription ────────────────────────────────────────────────

export const TranscribeAudioSchema = z.object({
  audioPath: z.string().min(1),
  modelSize: z.string().optional(),
});

// ── Pipeline / Batch ─────────────────────────────────────────────

export const BatchGenerateJobSchema = z.object({
  sceneId: z.string().min(1),
  prompt: z.string().min(1),
  negativePrompt: z.string().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  steps: z.number().positive().optional(),
  seed: z.number().optional(),
});

export const BatchGenerateSchema = z.object({
  jobs: z.array(BatchGenerateJobSchema).min(1),
  modelPath: z.string().min(1),
  device: z.string().optional(),
  outputDir: z.string().min(1),
});

export const BatchUpscaleJobSchema = z.object({
  sceneId: z.string().min(1),
  inputPath: z.string().min(1),
});

export const BatchUpscaleSchema = z.object({
  jobs: z.array(BatchUpscaleJobSchema).min(1),
  scale: z.number().positive().optional(),
  device: z.string().optional(),
  outputDir: z.string().min(1),
});

export const CompositeSchema = z.object({
  backgroundPath: z.string().min(1),
  foregroundPath: z.string().min(1),
  maskPath: z.string().optional(),
  outputPath: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const CheckQualitySchema = z.object({
  imagePath: z.string().min(1),
  expectedWidth: z.number().positive(),
  expectedHeight: z.number().positive(),
  requirePerson: z.boolean(),
});

// ── Project ──────────────────────────────────────────────────────

export const ProjectSaveSchema = z.object({
  projectName: z.string().min(1),
  projectData: z.any(), // validated by ProjectSchema at higher level
});

export const ProjectLoadSchema = z.object({
  projectName: z.string().min(1),
});
