/**
 * Stable string error codes for DocuFlow.
 *
 * Categories cover every domain that throws or surfaces errors.
 * Codes are strings so they survive serialization, don't collide,
 * and stay readable in logs and IPC payloads.
 */
export const ErrorCode = {
  // Data validation (Zod, schema, user input)
  VALIDATION: 'VALIDATION',

  // Media import / loading
  MEDIA_LOAD: 'MEDIA_LOAD',

  // Media processing (FFmpeg, sharp, upscale, composite)
  MEDIA_PROCESSING: 'MEDIA_PROCESSING',

  // AI image generation (Cloudflare, local SD, Ollama vision)
  AI_GENERATION: 'AI_GENERATION',

  // AI text / scene generation (Gemini, OpenRouter, Ollama)
  AI_SCENE: 'AI_SCENE',

  // Transcription (Whisper, local provider)
  TRANSCRIPTION: 'TRANSCRIPTION',

  // Timeline builder / resolver
  TIMELINE_BUILD: 'TIMELINE_BUILD',

  // Electron IPC communication
  IPC: 'IPC',

  // Web Worker communication (future)
  WORKER: 'WORKER',

  // Project load from disk / localStorage
  PROJECT_LOAD: 'PROJECT_LOAD',

  // Project save to disk / localStorage
  PROJECT_SAVE: 'PROJECT_SAVE',

  // Project version too new for this DocuFlow version
  PROJECT_VERSION_UNSUPPORTED: 'PROJECT_VERSION_UNSUPPORTED',

  // Project migration failed
  PROJECT_MIGRATION: 'PROJECT_MIGRATION',

  // Remotion / rendering
  RENDER: 'RENDER',

  // Model management (load, unload, switch)
  MODEL: 'MODEL',

  // Fallback / uncategorized
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
