import { Transcript, TranscriptionResult, TranscriptionStatus } from './types';
import { getProvider } from './provider';

export async function transcribeAudio(
  audio: Blob | File,
  language?: string,
  model?: string,
): Promise<TranscriptionResult> {
  const provider = getProvider();
  if (!provider) {
    return {
      transcript: { language: language || 'auto', text: '', segments: [] },
      status: 'error',
      error: 'Local transcription server is not running. Start it with: cd server && start.bat',
    };
  }

  if (!provider.isAvailable()) {
    return {
      transcript: { language: language || 'auto', text: '', segments: [] },
      status: 'error',
      error: `Local transcription server "${provider.name}" is not responding. Check that the server is running.`,
    };
  }

  try {
    return await provider.transcribe(audio, language, model);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      transcript: { language: language || 'auto', text: '', segments: [] },
      status: 'error',
      error: `Transcription failed: ${message}`,
    };
  }
}

export function getSegmentAtTime(
  transcript: Transcript,
  time: number
) {
  return transcript.segments.find(
    (s) => time >= s.start && time < s.end
  );
}

export function getWordsAtTime(
  transcript: Transcript,
  time: number
) {
  for (const segment of transcript.segments) {
    if (segment.words) {
      const word = segment.words.find(
        (w) => time >= w.start && time < w.end
      );
      if (word) return word;
    }
  }
  return null;
}

export function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}
