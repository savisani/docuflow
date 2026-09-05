import { describe, test, expect } from 'vitest';
import { extractErrorMessage, isStructuredError } from './helpers';

describe('extractErrorMessage', () => {
  test('returns fallback for null', () => {
    expect(extractErrorMessage(null)).toBe('An unknown error occurred');
  });

  test('returns fallback for undefined', () => {
    expect(extractErrorMessage(undefined)).toBe('An unknown error occurred');
  });

  test('returns custom fallback', () => {
    expect(extractErrorMessage(null, 'custom fallback')).toBe('custom fallback');
  });

  test('extracts from string', () => {
    expect(extractErrorMessage('something went wrong')).toBe('something went wrong');
  });

  test('extracts from Error instance', () => {
    const err = new Error('test error');
    expect(extractErrorMessage(err)).toBe('test error');
  });

  test('extracts from object with message', () => {
    expect(extractErrorMessage({ message: 'structured error' })).toBe('structured error');
  });

  test('extracts from object with non-string message falls back', () => {
    expect(extractErrorMessage({ message: 123 })).toBe('An unknown error occurred');
  });

  test('returns fallback for number', () => {
    expect(extractErrorMessage(42)).toBe('An unknown error occurred');
  });

  test('returns fallback for boolean', () => {
    expect(extractErrorMessage(true)).toBe('An unknown error occurred');
  });

  test('extracts from SerializedDocuFlowError', () => {
    const err = {
      code: 'AI_GENERATION',
      message: 'Generation failed',
      recoverable: false,
    };
    expect(extractErrorMessage(err)).toBe('Generation failed');
  });
});

describe('isStructuredError', () => {
  test('returns true for valid structured error', () => {
    expect(isStructuredError({
      code: 'VALIDATION',
      message: 'test',
      recoverable: false,
    })).toBe(true);
  });

  test('returns false for null', () => {
    expect(isStructuredError(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isStructuredError(undefined)).toBe(false);
  });

  test('returns false for string', () => {
    expect(isStructuredError('error')).toBe(false);
  });

  test('returns false for Error instance', () => {
    expect(isStructuredError(new Error('test'))).toBe(false);
  });

  test('returns false for missing code', () => {
    expect(isStructuredError({ message: 'test', recoverable: false })).toBe(false);
  });

  test('returns false for missing message', () => {
    expect(isStructuredError({ code: 'TEST', recoverable: false })).toBe(false);
  });

  test('returns false for missing recoverable', () => {
    expect(isStructuredError({ code: 'TEST', message: 'test' })).toBe(false);
  });
});
