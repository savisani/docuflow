// Protocol types
export type {
  KnownComponentType,
  KnownOperation,
  KnownPosition,
  ParsedComponentBlock,
  ParsedOperationBlock,
  ParsedAIResponse,
  ParseError,
  MotionDirectorRequest,
  MotionDirectorResult,
} from './protocol';

export {
  KNOWN_COMPONENT_TYPES,
  COMPONENT_FIELDS,
  REQUIRED_FIELDS,
  KNOWN_OPERATIONS,
  KNOWN_POSITIONS,
  KNOWN_VISUAL_STYLES,
  KNOWN_MOTION_STYLES,
  STYLE_ALIASES,
  OPERATION_METADATA_FIELDS,
} from './protocol';

// Parser
export { parseAIResponse, type ParseOptions, type ParseResult } from './parser';

// Operations
export {
  validateOperation,
  processOperations,
  type MotionOperation,
  type OperationStatus,
  type OperationResult,
} from './operations';

// Provider
export { buildMotionDirectorPrompt } from './provider';
export type {
  MotionDirectorProvider,
  MotionProviderType,
  MotionProviderConfig,
  MotionProviderResponse,
} from './provider';

// Providers
export { OllamaMotionProvider } from './providers/ollama';
export { MockMotionProvider } from './providers/mock';
