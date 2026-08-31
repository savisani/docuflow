export type {
  TranscriptWord,
  TranscriptSegment,
  Transcript,
  TranscriptionStatus,
  TranscriptionResult,
  TranscriptionProvider,
} from './types';

export {
  registerProvider,
  getProvider,
  isProviderAvailable,
  getProviderName,
} from './provider';

export {
  transcribeAudio,
  getSegmentAtTime,
  getWordsAtTime,
  formatTimestamp,
} from './service';

export { LocalTranscriptionProvider, checkServerHealth } from './localProvider';
export type { ServerHealth } from './localProvider';
export { initLocalProvider } from './autoRegister';
