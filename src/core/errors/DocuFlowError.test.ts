import { describe, test, expect } from 'vitest';
import { DocuFlowError } from './DocuFlowError';
import { ErrorCode } from './errorCodes';

describe('DocuFlowError', () => {
  test('creates error with code and message', () => {
    const err = new DocuFlowError(ErrorCode.MEDIA_LOAD, 'Failed to load video');
    expect(err.code).toBe(ErrorCode.MEDIA_LOAD);
    expect(err.message).toBe('Failed to load video');
    expect(err.name).toBe('DocuFlowError');
  });

  test('defaults to non-recoverable', () => {
    const err = new DocuFlowError(ErrorCode.UNKNOWN, 'Something went wrong');
    expect(err.recoverable).toBe(false);
  });

  test('accepts recoverable flag', () => {
    const err = new DocuFlowError(ErrorCode.VALIDATION, 'Invalid input', {
      recoverable: true,
    });
    expect(err.recoverable).toBe(true);
  });

  test('preserves cause', () => {
    const original = new Error('original error');
    const err = new DocuFlowError(ErrorCode.MEDIA_PROCESSING, 'Processing failed', {
      cause: original,
    });
    expect(err.cause).toBe(original);
  });

  test('preserves context', () => {
    const err = new DocuFlowError(ErrorCode.AI_GENERATION, 'Generation failed', {
      context: { modelPath: '/models/sd15', prompt: 'a forest' },
    });
    expect(err.context).toEqual({ modelPath: '/models/sd15', prompt: 'a forest' });
  });

  test('is instance of Error', () => {
    const err = new DocuFlowError(ErrorCode.UNKNOWN, 'test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DocuFlowError);
  });

  test('has stack trace', () => {
    const err = new DocuFlowError(ErrorCode.UNKNOWN, 'test');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('DocuFlowError');
  });

  test('toSerializable produces plain object', () => {
    const err = new DocuFlowError(ErrorCode.VALIDATION, 'Invalid', {
      recoverable: true,
      context: { field: 'name' },
    });
    const serialized = err.toSerializable();
    expect(serialized).toEqual({
      code: ErrorCode.VALIDATION,
      message: 'Invalid',
      recoverable: true,
      context: { field: 'name' },
    });
    expect(serialized).not.toBeInstanceOf(Error);
  });

  test('toSerializable omits empty context', () => {
    const err = new DocuFlowError(ErrorCode.UNKNOWN, 'test');
    const serialized = err.toSerializable();
    expect(serialized.context).toBeUndefined();
  });

  test('fromSerializable reconstructs DocuFlowError', () => {
    const original = new DocuFlowError(ErrorCode.TRANSCRIPTION, 'Transcription failed', {
      recoverable: true,
      context: { audioPath: '/tmp/audio.wav' },
    });
    const serialized = original.toSerializable();
    const reconstructed = DocuFlowError.fromSerializable(serialized);
    expect(reconstructed).toBeInstanceOf(DocuFlowError);
    expect(reconstructed.code).toBe(ErrorCode.TRANSCRIPTION);
    expect(reconstructed.message).toBe('Transcription failed');
    expect(reconstructed.recoverable).toBe(true);
    expect(reconstructed.context).toEqual({ audioPath: '/tmp/audio.wav' });
  });

  test('all error codes are valid', () => {
    const codes = Object.values(ErrorCode);
    expect(codes.length).toBeGreaterThanOrEqual(12);
    expect(codes).toContain('VALIDATION');
    expect(codes).toContain('MEDIA_LOAD');
    expect(codes).toContain('AI_GENERATION');
    expect(codes).toContain('TRANSCRIPTION');
    expect(codes).toContain('UNKNOWN');
  });
});
