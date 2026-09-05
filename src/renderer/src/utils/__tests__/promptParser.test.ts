import { describe, test, expect } from 'vitest';
import { parsePromptAndNegativePrompt } from '../promptParser';
import { mergeNegativePrompts } from '../promptBuilder';

// ---------------------------------------------------------------------------
// parsePromptAndNegativePrompt
// ---------------------------------------------------------------------------

describe('parsePromptAndNegativePrompt', () => {
  test('parses prompt with negative prompt on separate line', () => {
    const input = 'A railway station\nNegative prompt: people, humans';
    const result = parsePromptAndNegativePrompt(input);
    expect(result.prompt).toBe('A railway station');
    expect(result.negativePrompt).toBe('people, humans');
  });

  test('returns full input as prompt when no negative prompt present', () => {
    const input = 'A realistic Indian railway station.';
    const result = parsePromptAndNegativePrompt(input);
    expect(result.prompt).toBe('A realistic Indian railway station.');
    expect(result.negativePrompt).toBe('');
  });

  test('handles lowercase "negative prompt:"', () => {
    const input = 'A railway station\nnegative prompt: people';
    const result = parsePromptAndNegativePrompt(input);
    expect(result.prompt).toBe('A railway station');
    expect(result.negativePrompt).toBe('people');
  });

  test('handles extra whitespace and newlines', () => {
    const input = '  A railway station  \n\n  Negative prompt:   people, humans  ';
    const result = parsePromptAndNegativePrompt(input);
    expect(result.prompt).toBe('A railway station');
    expect(result.negativePrompt).toBe('people, humans');
  });

  test('positive prompt does not contain "Negative prompt:" after parsing', () => {
    const input = 'A railway station\nNegative prompt: blurry';
    const result = parsePromptAndNegativePrompt(input);
    expect(result.prompt).not.toContain('Negative prompt:');
    expect(result.prompt).not.toContain('blurry');
  });

  test('handles "Negative:" prefix', () => {
    const input = 'A railway station\nNegative: blurry, low quality';
    const result = parsePromptAndNegativePrompt(input);
    expect(result.prompt).toBe('A railway station');
    expect(result.negativePrompt).toBe('blurry, low quality');
  });

  test('handles "negative:" prefix (lowercase)', () => {
    const input = 'A railway station\nnegative: blurry';
    const result = parsePromptAndNegativePrompt(input);
    expect(result.prompt).toBe('A railway station');
    expect(result.negativePrompt).toBe('blurry');
  });

  test('handles empty input', () => {
    const result = parsePromptAndNegativePrompt('');
    expect(result.prompt).toBe('');
    expect(result.negativePrompt).toBe('');
  });

  test('handles null/undefined input gracefully', () => {
    const result = parsePromptAndNegativePrompt(null as any);
    expect(result.prompt).toBe('');
    expect(result.negativePrompt).toBe('');
  });

  test('handles multi-line negative prompt', () => {
    const input = `1950s Indian railway station

Negative prompt: people, person, human, character,
figure, face, body, crowd`;
    const result = parsePromptAndNegativePrompt(input);
    expect(result.prompt).toBe('1950s Indian railway station');
    expect(result.negativePrompt).toContain('people');
    expect(result.negativePrompt).toContain('crowd');
  });

  test('handles negative prompt with no content after colon', () => {
    const input = 'A railway station\nNegative prompt:';
    const result = parsePromptAndNegativePrompt(input);
    expect(result.prompt).toBe('A railway station');
    expect(result.negativePrompt).toBe('');
  });
});

// ---------------------------------------------------------------------------
// mergeNegativePrompts
// ---------------------------------------------------------------------------

describe('mergeNegativePrompts', () => {
  test('returns system negative when no user negative provided', () => {
    const result = mergeNegativePrompts('blurry, low quality', undefined);
    expect(result).toBe('blurry, low quality');
  });

  test('returns system negative when user negative is empty', () => {
    const result = mergeNegativePrompts('blurry, low quality', '');
    expect(result).toBe('blurry, low quality');
  });

  test('appends user negative tokens not in system', () => {
    const result = mergeNegativePrompts('blurry, low quality', 'watermark, text');
    expect(result).toContain('blurry');
    expect(result).toContain('low quality');
    expect(result).toContain('watermark');
    expect(result).toContain('text');
  });

  test('deduplicates tokens', () => {
    const result = mergeNegativePrompts('blurry, low quality', 'blurry, watermark');
    // "blurry" should appear only once
    const occurrences = result.split(',').filter(t => t.trim().toLowerCase() === 'blurry');
    expect(occurrences.length).toBe(1);
    expect(result).toContain('watermark');
  });

  test('case-insensitive dedup', () => {
    const result = mergeNegativePrompts('Blurry, Low Quality', 'blurry, watermark');
    const occurrences = result.split(',').filter(t => t.trim().toLowerCase() === 'blurry');
    expect(occurrences.length).toBe(1);
  });
});
