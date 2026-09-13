import { describe, it, expect, beforeEach } from 'vitest';
import { useDocuFlowStore } from '../store';
import type { Command } from '../../engine/commands/types';

// ── Helpers ─────────────────────────────────────────────────────

function makeShowCommand(
  id: string,
  opts: { start: number; duration: number; asset?: string; layer?: number; x?: number; y?: number; scale?: number; opacity?: number }
): Command {
  return {
    id,
    type: 'show',
    start: opts.start,
    duration: opts.duration,
    asset: opts.asset ?? 'image1',
    layer: opts.layer ?? 0,
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    scale: opts.scale ?? 1,
    opacity: opts.opacity ?? 1,
  } as Command;
}

function resetStore() {
  useDocuFlowStore.setState({
    commands: [],
    assets: [],
    timeline: undefined,
    selectedCommandId: null,
    selectedCommandIds: [],
    history: [],
    historyIndex: -1,
    batchActive: false,
    batchSnapshot: null,
    settings: {
      width: 1920,
      height: 1080,
      fps: 30,
      title: 'test',
    },
    voiceover: null,
  });
}

// ── Tests ───────────────────────────────────────────────────────

describe('splitCommandAtTime', () => {
  beforeEach(() => {
    resetStore();
  });

  it('splits a 10s clip at 4s into 0-4 and 4-10', () => {
    const cmd = makeShowCommand('cmd-1', { start: 0, duration: 10 });
    useDocuFlowStore.getState().addCommand(cmd);

    useDocuFlowStore.getState().splitCommandAtTime('cmd-1', 4);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(2);

    const left = commands.find((c) => c.id === 'cmd-1');
    const right = commands.find((c) => c.id !== 'cmd-1');

    expect(left).toBeDefined();
    expect(right).toBeDefined();

    expect(left!.start).toBe(0);
    expect((left as any).duration).toBe(4);

    expect(right!.start).toBe(4);
    expect((right as any).duration).toBe(6);
  });

  it('splits a 5-15s clip at 9s into 5-9 and 9-15', () => {
    const cmd = makeShowCommand('cmd-1', { start: 5, duration: 10 });
    useDocuFlowStore.getState().addCommand(cmd);

    useDocuFlowStore.getState().splitCommandAtTime('cmd-1', 9);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(2);

    const left = commands.find((c) => c.id === 'cmd-1');
    const right = commands.find((c) => c.id !== 'cmd-1');

    expect(left!.start).toBe(5);
    expect((left as any).duration).toBe(4);

    expect(right!.start).toBe(9);
    expect((right as any).duration).toBe(6);
  });

  it('does not split at exact start (cutTime <= cmdStart)', () => {
    const cmd = makeShowCommand('cmd-1', { start: 5, duration: 10 });
    useDocuFlowStore.getState().addCommand(cmd);

    useDocuFlowStore.getState().splitCommandAtTime('cmd-1', 5);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe('cmd-1');
  });

  it('does not split at exact end (cutTime >= cmdEnd)', () => {
    const cmd = makeShowCommand('cmd-1', { start: 5, duration: 10 });
    useDocuFlowStore.getState().addCommand(cmd);

    useDocuFlowStore.getState().splitCommandAtTime('cmd-1', 15);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe('cmd-1');
  });

  it('does not split before clip start', () => {
    const cmd = makeShowCommand('cmd-1', { start: 5, duration: 10 });
    useDocuFlowStore.getState().addCommand(cmd);

    useDocuFlowStore.getState().splitCommandAtTime('cmd-1', 3);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe('cmd-1');
  });

  it('does not split after clip end', () => {
    const cmd = makeShowCommand('cmd-1', { start: 5, duration: 10 });
    useDocuFlowStore.getState().addCommand(cmd);

    useDocuFlowStore.getState().splitCommandAtTime('cmd-1', 20);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe('cmd-1');
  });

  it('splitting B does not modify A or C', () => {
    const cmdA = makeShowCommand('cmd-a', { start: 0, duration: 5, asset: 'imageA' });
    const cmdB = makeShowCommand('cmd-b', { start: 5, duration: 5, asset: 'imageB' });
    const cmdC = makeShowCommand('cmd-c', { start: 10, duration: 5, asset: 'imageC' });

    useDocuFlowStore.getState().addCommand(cmdA);
    useDocuFlowStore.getState().addCommand(cmdB);
    useDocuFlowStore.getState().addCommand(cmdC);

    useDocuFlowStore.getState().splitCommandAtTime('cmd-b', 7);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(4);

    const a = commands.find((c) => c.id === 'cmd-a');
    const bLeft = commands.find((c) => c.id === 'cmd-b');
    const bRight = commands.find((c) => c.id !== 'cmd-a' && c.id !== 'cmd-b' && c.id !== 'cmd-c');
    const c = commands.find((c) => c.id === 'cmd-c');

    // A unchanged
    expect(a!.start).toBe(0);
    expect((a as any).duration).toBe(5);
    expect((a as any).asset).toBe('imageA');

    // B split correctly
    expect(bLeft!.start).toBe(5);
    expect((bLeft as any).duration).toBe(2);
    expect(bRight!.start).toBe(7);
    expect((bRight as any).duration).toBe(3);

    // C unchanged
    expect(c!.start).toBe(10);
    expect((c as any).duration).toBe(5);
    expect((c as any).asset).toBe('imageC');
  });

  it('targets correct clip on different tracks', () => {
    const cmdTrack1 = makeShowCommand('track1', { start: 0, duration: 10, layer: 0, asset: 'imageA' });
    const cmdTrack2 = makeShowCommand('track2', { start: 0, duration: 10, layer: 1, asset: 'imageB' });

    useDocuFlowStore.getState().addCommand(cmdTrack1);
    useDocuFlowStore.getState().addCommand(cmdTrack2);

    useDocuFlowStore.getState().splitCommandAtTime('track2', 4);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(3);

    // Track 1 unchanged
    const track1 = commands.find((c) => c.id === 'track1');
    expect(track1!.start).toBe(0);
    expect((track1 as any).duration).toBe(10);

    // Track 2 split
    const track2Left = commands.find((c) => c.id === 'track2');
    const track2Right = commands.find((c) => c.id !== 'track1' && c.id !== 'track2');
    expect(track2Left!.start).toBe(0);
    expect((track2Left as any).duration).toBe(4);
    expect(track2Right!.start).toBe(4);
    expect((track2Right as any).duration).toBe(6);
  });

  it('preserves command properties after split', () => {
    const cmd = makeShowCommand('cmd-1', {
      start: 0,
      duration: 10,
      asset: 'image1',
      layer: 2,
      x: 100,
      y: 200,
      scale: 1.5,
      opacity: 0.8,
    });
    useDocuFlowStore.getState().addCommand(cmd);

    useDocuFlowStore.getState().splitCommandAtTime('cmd-1', 4);

    const { commands } = useDocuFlowStore.getState();
    const left = commands.find((c) => c.id === 'cmd-1');
    const right = commands.find((c) => c.id !== 'cmd-1');

    // Both preserve original properties
    for (const piece of [left, right]) {
      expect(piece).toBeDefined();
      expect((piece as any).asset).toBe('image1');
      expect((piece as any).layer).toBe(2);
      expect((piece as any).x).toBe(100);
      expect((piece as any).y).toBe(200);
      expect((piece as any).scale).toBe(1.5);
      expect((piece as any).opacity).toBe(0.8);
    }
  });

  it('generates unique IDs for left and right', () => {
    const cmd = makeShowCommand('cmd-1', { start: 0, duration: 10 });
    useDocuFlowStore.getState().addCommand(cmd);

    useDocuFlowStore.getState().splitCommandAtTime('cmd-1', 4);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(2);

    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(2); // all unique
  });

  it('exact coverage: left.end === cutTime, right.start === cutTime', () => {
    const cmd = makeShowCommand('cmd-1', { start: 2, duration: 8 });
    useDocuFlowStore.getState().addCommand(cmd);

    useDocuFlowStore.getState().splitCommandAtTime('cmd-1', 5);

    const { commands } = useDocuFlowStore.getState();
    const left = commands.find((c) => c.id === 'cmd-1');
    const right = commands.find((c) => c.id !== 'cmd-1');

    const leftEnd = left!.start + (left as any).duration;
    const rightEnd = right!.start + (right as any).duration;

    expect(leftEnd).toBe(5);
    expect(right!.start).toBe(5);
    expect(rightEnd).toBe(10); // original end
  });

  it('does nothing for non-existent command', () => {
    useDocuFlowStore.getState().splitCommandAtTime('nonexistent', 5);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(0);
  });

  it('does nothing for command without duration', () => {
    const cmd = { id: 'cmd-1', type: 'hide', start: 5 } as Command;
    useDocuFlowStore.getState().addCommand(cmd);

    useDocuFlowStore.getState().splitCommandAtTime('cmd-1', 7);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(1);
  });

  it('selects the right segment after split', () => {
    const cmd = makeShowCommand('cmd-1', { start: 0, duration: 10 });
    useDocuFlowStore.getState().addCommand(cmd);

    useDocuFlowStore.getState().splitCommandAtTime('cmd-1', 4);

    const { selectedCommandId, selectedCommandIds } = useDocuFlowStore.getState();
    // The right segment (new ID) should be selected
    const rightCmd = useDocuFlowStore.getState().commands.find((c) => c.id !== 'cmd-1');
    expect(selectedCommandId).toBe(rightCmd!.id);
    expect(selectedCommandIds).toContain(rightCmd!.id);
  });

  it('handles frame-accurate split (fps=30)', () => {
    // 3s clip at 30fps = 90 frames
    // Cut at 1.5s = 45 frames
    const cmd = makeShowCommand('cmd-1', { start: 0, duration: 3 });
    useDocuFlowStore.getState().addCommand(cmd);

    useDocuFlowStore.getState().splitCommandAtTime('cmd-1', 1.5);

    const { commands } = useDocuFlowStore.getState();
    const left = commands.find((c) => c.id === 'cmd-1');
    const right = commands.find((c) => c.id !== 'cmd-1');

    // With fps=30: rightDuration = Math.round((3 - 1.5) * 30) / 30 = Math.round(45) / 30 = 45/30 = 1.5
    expect((left as any).duration).toBeCloseTo(1.5, 10);
    expect((right as any).duration).toBeCloseTo(1.5, 10);
  });

  it('multiple sequential splits produce correct segments', () => {
    const cmd = makeShowCommand('cmd-1', { start: 0, duration: 10 });
    useDocuFlowStore.getState().addCommand(cmd);

    // First cut at 3s
    useDocuFlowStore.getState().splitCommandAtTime('cmd-1', 3);
    // Second cut at 7s (on the right segment)
    const rightId = useDocuFlowStore.getState().commands.find((c) => c.id !== 'cmd-1')?.id;
    if (rightId) {
      useDocuFlowStore.getState().splitCommandAtTime(rightId, 7);
    }

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(3);

    const sorted = [...commands].sort((a, b) => a.start - b.start);
    expect(sorted[0].start).toBe(0);
    expect((sorted[0] as any).duration).toBe(3);

    expect(sorted[1].start).toBe(3);
    expect((sorted[1] as any).duration).toBe(4);

    expect(sorted[2].start).toBe(7);
    expect((sorted[2] as any).duration).toBe(3);
  });
});
