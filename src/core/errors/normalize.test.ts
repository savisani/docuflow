import { describe, test, expect } from 'vitest';
import { normalizeError } from './normalize';
import { DocuFlowError } from './DocuFlowError';
import { ErrorCode } from './errorCodes';

describe('normalizeError', () => {
  test('returns DocuFlowError as-is', () => {
    const original = new DocuFlowError(ErrorCode.MEDIA_LOAD, 'test error');
    const result = normalizeError(original);
    expect(result).toBe(original);
  });

  test('wraps standard Error with fallback code', () => {
    const original = new Error('standard error');
    const result = normalizeError(original, ErrorCode.AI_GENERATION);
    expect(result).toBeInstanceOf(DocuFlowError);
    expect(result.code).toBe(ErrorCode.AI_GENERATION);
    expect(result.message).toBe('standard error');
    expect(result.cause).toBe(original);
  });

  test('wraps standard Error with default UNKNOWN code', () => {
    const original = new Error('something');
    const result = normalizeError(original);
    expect(result.code).toBe(ErrorCode.UNKNOWN);
  });

  test('converts ZodError to VALIDATION error', () => {
    const zodError = {
      name: 'ZodError',
      issues: [
        { path: ['name'], message: 'Required', code: 'invalid_type' },
        { path: ['age'], message: 'Expected number', code: 'invalid_type' },
      ],
    };
    const result = normalizeError(zodError);
    expect(result).toBeInstanceOf(DocuFlowError);
    expect(result.code).toBe(ErrorCode.VALIDATION);
    expect(result.recoverable).toBe(true);
    expect(result.context).toBeDefined();
    expect(result.context!.totalIssues).toBe(2);
    expect(result.context!.issues).toHaveLength(2);
  });

  test('formats single ZodError issue', () => {
    const zodError = {
      name: 'ZodError',
      issues: [
        { path: ['email'], message: 'Invalid email', code: 'invalid_string' },
      ],
    };
    const result = normalizeError(zodError);
    expect(result.message).toContain('email');
    expect(result.message).toContain('Invalid email');
  });

  test('formats multiple ZodError issues', () => {
    const zodError = {
      name: 'ZodError',
      issues: [
        { path: ['a'], message: 'err1', code: 'custom' },
        { path: ['b'], message: 'err2', code: 'custom' },
        { path: ['c'], message: 'err3', code: 'custom' },
        { path: ['d'], message: 'err4', code: 'custom' },
      ],
    };
    const result = normalizeError(zodError);
    expect(result.message).toContain('4 issues');
    expect(result.message).toContain('...');
  });

  test('wraps plain string', () => {
    const result = normalizeError('something went wrong', ErrorCode.TRANSCRIPTION);
    expect(result).toBeInstanceOf(DocuFlowError);
    expect(result.code).toBe(ErrorCode.TRANSCRIPTION);
    expect(result.message).toBe('something went wrong');
  });

  test('handles null', () => {
    const result = normalizeError(null);
    expect(result).toBeInstanceOf(DocuFlowError);
    expect(result.code).toBe(ErrorCode.UNKNOWN);
    expect(result.message).toBe('An unknown error occurred');
  });

  test('handles undefined', () => {
    const result = normalizeError(undefined);
    expect(result).toBeInstanceOf(DocuFlowError);
    expect(result.code).toBe(ErrorCode.UNKNOWN);
    expect(result.message).toBe('An unknown error occurred');
  });

  test('handles unknown objects', () => {
    const result = normalizeError({ foo: 'bar' });
    expect(result).toBeInstanceOf(DocuFlowError);
    expect(result.code).toBe(ErrorCode.UNKNOWN);
  });

  test('handles numbers', () => {
    const result = normalizeError(42);
    expect(result).toBeInstanceOf(DocuFlowError);
    expect(result.message).toContain('42');
  });

  test('preserves cause chain', () => {
    const original = new Error('root cause');
    const result = normalizeError(original, ErrorCode.RENDER);
    expect(result.cause).toBe(original);
  });

  test('uses custom fallback code', () => {
    const result = normalizeError('test', ErrorCode.MEDIA_PROCESSING);
    expect(result.code).toBe(ErrorCode.MEDIA_PROCESSING);
  });
});
