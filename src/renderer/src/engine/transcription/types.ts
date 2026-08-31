export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  id: string;
  text: string;
  start: number;
  end: number;
  words?: TranscriptWord[];
}

export interface Transcript {
  language: string;
  text: string;
  segments: TranscriptSegment[];
}

export type TranscriptionStatus = 'idle' | 'processing' | 'complete' | 'error';

export interface TranscriptionResult {
  transcript: Transcript;
  status: TranscriptionStatus;
  error?: string;
}

export interface TranscriptionProvider {
  name: string;
  transcribe(audio: Blob | File, language?: string, model?: string): Promise<TranscriptionResult>;
  isAvailable(): boolean;
  checkAvailability?(): Promise<boolean>;
}
