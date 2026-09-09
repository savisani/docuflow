import { describe, it, expect, beforeEach } from 'vitest';
import { useDocuFlowStore } from '../store';
import type { Command } from '../../engine/commands/types';

// ── Helpers ─────────────────────────────────────────────────────

function makeCommand(id: string, type: string = 'text'): Command {
  return {
    id,
    type,
    content: `test-${id}`,
    start: 0,
    duration: 2,
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

describe('addCommand deduplication', () => {
  beforeEach(() => {
    resetStore();
  });

  it('inserts a command normally when it is new', () => {
    const cmd = makeCommand('cmd-1');
    useDocuFlowStore.getState().addCommand(cmd);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe('cmd-1');
  });

  it('does NOT duplicate a command with the same id', () => {
    const cmd = makeCommand('cmd-1');
    useDocuFlowStore.getState().addCommand(cmd);
    useDocuFlowStore.getState().addCommand(cmd);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe('cmd-1');
  });

  it('adds a batch of compiled commands once', () => {
    const batch = [
      makeCommand('batch-1'),
      makeCommand('batch-2'),
      makeCommand('batch-3'),
    ];

    for (const cmd of batch) {
      useDocuFlowStore.getState().addCommand(cmd);
    }

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(3);
    expect(commands.map((c) => c.id)).toEqual(['batch-1', 'batch-2', 'batch-3']);
  });

  it('does NOT duplicate commands when the same batch is added again', () => {
    const batch = [
      makeCommand('batch-1'),
      makeCommand('batch-2'),
      makeCommand('batch-3'),
    ];

    // First add
    for (const cmd of batch) {
      useDocuFlowStore.getState().addCommand(cmd);
    }
    // Second add (same batch)
    for (const cmd of batch) {
      useDocuFlowStore.getState().addCommand(cmd);
    }

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(3);
    expect(commands.map((c) => c.id)).toEqual(['batch-1', 'batch-2', 'batch-3']);
  });

  it('inserts different commands with different IDs', () => {
    const cmd1 = makeCommand('unique-1');
    const cmd2 = makeCommand('unique-2');

    useDocuFlowStore.getState().addCommand(cmd1);
    useDocuFlowStore.getState().addCommand(cmd2);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(2);
    expect(commands.map((c) => c.id)).toEqual(['unique-1', 'unique-2']);
  });

  it('allows a newly generated plan with new command IDs to be added', () => {
    // First generation
    const gen1 = [makeCommand('gen1-1'), makeCommand('gen1-2')];
    for (const cmd of gen1) {
      useDocuFlowStore.getState().addCommand(cmd);
    }

    // Second generation (different IDs)
    const gen2 = [makeCommand('gen2-1'), makeCommand('gen2-2')];
    for (const cmd of gen2) {
      useDocuFlowStore.getState().addCommand(cmd);
    }

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(4);
    expect(commands.map((c) => c.id)).toEqual(['gen1-1', 'gen1-2', 'gen2-1', 'gen2-2']);
  });

  it('existing command behavior is unchanged (different IDs both inserted)', () => {
    const cmdA = makeCommand('a');
    const cmdB = makeCommand('b');
    const cmdC = makeCommand('c');

    useDocuFlowStore.getState().addCommand(cmdA);
    useDocuFlowStore.getState().addCommand(cmdB);
    useDocuFlowStore.getState().addCommand(cmdC);

    const { commands } = useDocuFlowStore.getState();
    expect(commands).toHaveLength(3);
    expect(commands[0].id).toBe('a');
    expect(commands[1].id).toBe('b');
    expect(commands[2].id).toBe('c');
  });
});
