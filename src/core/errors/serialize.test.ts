import { describe, test, expect } from 'vitest';
import { serializeError, deserializeError, redactContext } from './serialize';
import { DocuFlowError } from './DocuFlowError';
import { ErrorCode } from './errorCodes';

describe('serializeError', () => {
  test('converts DocuFlowError to plain object', () => {
    const err = new DocuFlowError(ErrorCode.MEDIA_LOAD, 'Failed', {
      recoverable: true,
      context: { path: '/tmp/video.mp4' },
    });
    const serialized = serializeError(err);
    expect(serialized).toEqual({
      code: ErrorCode.MEDIA_LOAD,
      message: 'Failed',
      recoverable: true,
      context: { path: '/tmp/video.mp4' },
    });
  });

  test('strips stack trace', () => {
    const err = new DocuFlowError(ErrorCode.UNKNOWN, 'test');
    const serialized = serializeError(err);
    expect(serialized).not.toHaveProperty('stack');
  });

  test('omits empty context', () => {
    const err = new DocuFlowError(ErrorCode.UNKNOWN, 'test');
    const serialized = serializeError(err);
    expect(serialized.context).toBeUndefined();
  });
});

describe('deserializeError', () => {
  test('reconstructs from serialized object', () => {
    const original = new DocuFlowError(ErrorCode.TRANSCRIPTION, 'Failed', {
      recoverable: true,
      context: { audioPath: '/tmp/audio.wav' },
    });
    const serialized = serializeError(original);
    const reconstructed = deserializeError(serialized);
    expect(reconstructed).toBeInstanceOf(DocuFlowError);
    expect(reconstructed.code).toBe(ErrorCode.TRANSCRIPTION);
    expect(reconstructed.message).toBe('Failed');
    expect(reconstructed.recoverable).toBe(true);
    expect(reconstructed.context).toEqual({ audioPath: '/tmp/audio.wav' });
  });

  test('handles legacy string errors', () => {
    const result = deserializeError('old style error');
    expect(result).toBeInstanceOf(DocuFlowError);
    expect(result.code).toBe(ErrorCode.UNKNOWN);
    expect(result.message).toBe('old style error');
  });

  test('handles malformed IPC data', () => {
    const result = deserializeError({ random: 'data' });
    expect(result).toBeInstanceOf(DocuFlowError);
    expect(result.code).toBe(ErrorCode.UNKNOWN);
    expect(result.message).toContain('malformed');
  });

  test('handles null', () => {
    const result = deserializeError(null);
    expect(result).toBeInstanceOf(DocuFlowError);
    expect(result.code).toBe(ErrorCode.UNKNOWN);
  });

  test('handles undefined', () => {
    const result = deserializeError(undefined);
    expect(result).toBeInstanceOf(DocuFlowError);
    expect(result.code).toBe(ErrorCode.UNKNOWN);
  });

  test('passes through DocuFlowError instances', () => {
    const original = new DocuFlowError(ErrorCode.VALIDATION, 'test');
    const result = deserializeError(original);
    expect(result).toBe(original);
  });
});

describe('redactContext', () => {
  test('redacts sensitive keys', () => {
    const context = {
      apiKey: 'secret-123',
      modelPath: '/models/sd15',
      token: 'bearer xyz',
    };
    const redacted = redactContext(context);
    expect(redacted!.apiKey).toBe('[REDACTED]');
    expect(redacted!.token).toBe('[REDACTED]');
    expect(redacted!.modelPath).toBe('/models/sd15');
  });

  test('returns undefined for undefined input', () => {
    expect(redactContext(undefined)).toBeUndefined();
  });

  test('returns undefined for empty object', () => {
    expect(redactContext({})).toBeUndefined();
  });

  test('returns original if no sensitive keys', () => {
    const context = { path: '/tmp/file', width: 512 };
    const result = redactContext(context);
    expect(result).toBe(context);
  });
});
