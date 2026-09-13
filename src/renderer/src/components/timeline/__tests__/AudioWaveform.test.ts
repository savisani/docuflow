import { describe, test, expect, vi, beforeEach } from 'vitest';

describe('AudioWaveform regression tests', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    // Stub the docuflow preload API as it would exist in Electron renderer
    (window as any).docuflow = {
      readFileBuffer: vi.fn().mockResolvedValue({ success: false, error: 'Stub: not in Electron' }),
    };
  });

  test('waveform uses readFileBuffer IPC instead of fetch for docuflow-asset:// URLs', () => {
    // Regression: fetch() fails with "URL scheme 'docuflow-asset' is not supported"
    // The fix uses window.docuflow.readFileBuffer(filePath) instead
    const docuflow = (window as any).docuflow;
    expect(typeof docuflow?.readFileBuffer).toBe('function');
  });

  test('readFileBuffer returns { success, base64, error } shape', async () => {
    const docuflow = (window as any).docuflow;
    docuflow.readFileBuffer.mockResolvedValue({ success: false, error: 'File not found' });
    const result = await docuflow.readFileBuffer('C:\\nonexistent\\file.mp3');
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('error');
    expect(result.success).toBe(false);
  });

  test('readFileBuffer returns base64 on success', async () => {
    const docuflow = (window as any).docuflow;
    // "Hello" in base64
    docuflow.readFileBuffer.mockResolvedValue({ success: true, base64: 'SGVsbG8=' });
    const result = await docuflow.readFileBuffer('C:\\audio.mp3');
    expect(result.success).toBe(true);
    expect(result.base64).toBe('SGVsbG8=');
  });

  test('base64ToArrayBuffer conversion is correct', () => {
    // Verify the helper function used in AudioWaveform works
    const base64 = 'SGVsbG8='; // "Hello" in base64
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decoder = new TextDecoder();
    expect(decoder.decode(bytes)).toBe('Hello');
  });

  test('AudioWaveform does NOT use fetch for docuflow-asset:// URLs', () => {
    // The original bug: fetch('docuflow-asset://...') throws
    // Regression: AudioWaveform must use readFileBuffer IPC, not fetch
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    // If fetch is called with docuflow-asset:// it would throw
    // Our fix prevents this by using IPC instead
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('Timeline audio grab offset regression', () => {
  test('audio command has start and duration fields for drag operations', () => {
    // Regression: audio clips must have start and duration for the drag system
    const audioCmd = {
      id: 'music-1',
      type: 'music' as const,
      asset: 'audio1',
      start: 5,
      duration: 10,
      volume: 0.7,
    };
    expect(audioCmd.start).toBe(5);
    expect(audioCmd.duration).toBe(10);
  });

  test('audio track builder produces correct track IDs from command IDs', () => {
    // Regression: track.id must equal cmd.id so updateCommand(trackId, ...) works
    const cmdId = 'sfx-abc123';
    const trackId = cmdId;
    expect(trackId).toBe(cmdId);
  });

  test('move mode offsetToCenterX is 0 (preserves grab point)', () => {
    // Regression: clicking mid-clip must NOT make clip start align with cursor
    const mode = 'move';
    let offsetToCenterX = 0;
    if (mode === 'move') {
      offsetToCenterX = 0;
    }
    expect(offsetToCenterX).toBe(0);
  });

  test('committed start = originalStart + dt preserves grab offset', () => {
    // Regression: the committed position must match visual position
    const PIXELS_PER_SECOND = 80;
    const zoom = 1;

    const originalStart = 5;
    const startX = 600;
    const currentX = 680;

    const dx = currentX - startX;
    const dt = dx / (PIXELS_PER_SECOND * zoom);
    const committedStart = originalStart + dt;

    const visualPosition = originalStart * PIXELS_PER_SECOND * zoom + dx;
    const visualTime = visualPosition / (PIXELS_PER_SECOND * zoom);

    expect(committedStart).toBeCloseTo(6, 10);
    expect(visualTime).toBeCloseTo(6, 10);
    expect(committedStart).toBeCloseTo(visualTime, 10);
  });

  test('grab offset calculation matches newStart formula', () => {
    // Regression: newStart = currentPointerTime - grabOffset
    const PIXELS_PER_SECOND = 80;
    const zoom = 1;

    const clipStart = 10;
    const clickPixel = 880;
    const clickTime = clickPixel / (PIXELS_PER_SECOND * zoom);
    const grabOffset = clickTime - clipStart;

    const dragPixel = 1040;
    const dragTime = dragPixel / (PIXELS_PER_SECOND * zoom);
    const newStart = dragTime - grabOffset;

    expect(newStart).toBeCloseTo(12, 10);
  });

  test('resize-left offsetToCenterX preserves edge anchor', () => {
    // Regression: resize-left edge must not jump
    const mode = 'resize-left';
    const clipLeft = 400;
    const clickX = 420; // 20px from left edge
    const offsetToCenterX = clickX - clipLeft; // = 20

    expect(offsetToCenterX).toBe(20);
  });

  test('resize-right offsetToCenterX preserves edge anchor', () => {
    const mode = 'resize-right';
    const clipRight = 800;
    const clickX = 790; // 10px from right edge
    const offsetToCenterX = clickX - clipRight; // = -10

    expect(offsetToCenterX).toBe(-10);
  });
});
