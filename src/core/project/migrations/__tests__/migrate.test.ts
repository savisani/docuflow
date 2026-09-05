import { describe, test, expect } from 'vitest';
import { migrateProject, isSupportedVersion, CURRENT_PROJECT_VERSION } from '../index';
import type { RawProject } from '../types';

function makeRawProject(overrides?: Partial<RawProject>): RawProject {
  return {
    version: CURRENT_PROJECT_VERSION,
    settings: { width: 1920, height: 1080, fps: 30 },
    assets: [],
    commands: [],
    ...overrides,
  };
}

describe('CURRENT_PROJECT_VERSION', () => {
  test('is a positive integer', () => {
    expect(CURRENT_PROJECT_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(CURRENT_PROJECT_VERSION)).toBe(true);
  });
});

describe('migrateProject', () => {
  describe('current version', () => {
    test('returns project unchanged when at current version', () => {
      const input = makeRawProject();
      const result = migrateProject(input);

      expect(result).toHaveProperty('project');
      expect('project' in result && result.project).toBe(input);
      expect('migrated' in result && result.migrated).toBe(false);
      expect('fromVersion' in result && result.fromVersion).toBe(CURRENT_PROJECT_VERSION);
    });

    test('does not mutate the input', () => {
      const input = makeRawProject({ version: CURRENT_PROJECT_VERSION });
      const original = JSON.parse(JSON.stringify(input));
      migrateProject(input);
      expect(input).toEqual(original);
    });
  });

  describe('future version', () => {
    test('rejects version > CURRENT_PROJECT_VERSION', () => {
      const input = makeRawProject({ version: CURRENT_PROJECT_VERSION + 1 });
      const result = migrateProject(input);

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('PROJECT_VERSION_UNSUPPORTED');
        expect(result.error).toContain('not supported');
        expect(result.error).toContain(String(CURRENT_PROJECT_VERSION));
        expect(result.context).toEqual({
          projectVersion: CURRENT_PROJECT_VERSION + 1,
          currentVersion: CURRENT_PROJECT_VERSION,
        });
      }
    });

    test('rejects very large version number', () => {
      const input = makeRawProject({ version: 999 });
      const result = migrateProject(input);
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('PROJECT_VERSION_UNSUPPORTED');
      }
    });
  });

  describe('missing version', () => {
    test('rejects undefined version (no version = unsupported)', () => {
      const input = makeRawProject({ version: undefined });
      const result = migrateProject(input);

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('PROJECT_MIGRATION');
      }
    });

    test('rejects null version', () => {
      const input = makeRawProject({ version: null as any });
      const result = migrateProject(input);

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('PROJECT_MIGRATION');
      }
    });

    test('rejects string version', () => {
      const input = makeRawProject({ version: '1' as any });
      const result = migrateProject(input);

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('PROJECT_MIGRATION');
      }
    });

    test('rejects negative version', () => {
      const input = makeRawProject({ version: -1 });
      const result = migrateProject(input);

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('PROJECT_MIGRATION');
      }
    });

    test('rejects zero version', () => {
      const input = makeRawProject({ version: 0 });
      const result = migrateProject(input);

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.code).toBe('PROJECT_MIGRATION');
      }
    });
  });

  describe('older version with no migrations registered', () => {
    test('version 1 with CURRENT_PROJECT_VERSION = 1 is a no-op', () => {
      const input = makeRawProject({ version: 1 });
      const result = migrateProject(input);

      expect('project' in result).toBe(true);
      if ('project' in result) {
        expect(result.migrated).toBe(false);
        expect(result.fromVersion).toBe(1);
      }
    });
  });

  describe('idempotence', () => {
    test('migrating current version twice yields same result', () => {
      const input = makeRawProject();
      const first = migrateProject(input);
      const second = migrateProject(input);

      expect('project' in first && first.project).toBe(input);
      expect('project' in second && second.project).toBe(input);
    });
  });

  describe('preserves project data', () => {
    test('preserves settings', () => {
      const input = makeRawProject({
        settings: { width: 3840, height: 2160, fps: 60 },
      });
      const result = migrateProject(input);

      expect('project' in result && result.project.settings).toEqual({ width: 3840, height: 2160, fps: 60 });
    });

    test('preserves assets', () => {
      const assets = [
        { id: 'a1', logicalId: 'image1', filename: 'photo.jpg', type: 'image', mimeType: 'image/jpeg' },
      ];
      const input = makeRawProject({ assets });
      const result = migrateProject(input);

      expect('project' in result && result.project.assets).toEqual(assets);
    });

    test('preserves commands', () => {
      const commands = [
        { id: 'cmd1', type: 'show', start: 0, duration: 5, asset: 'a1' },
      ];
      const input = makeRawProject({ commands });
      const result = migrateProject(input);

      expect('project' in result && result.project.commands).toEqual(commands);
    });
  });
});

describe('isSupportedVersion', () => {
  test('returns true for current version', () => {
    expect(isSupportedVersion(CURRENT_PROJECT_VERSION)).toBe(true);
  });

  test('returns true for version 1', () => {
    expect(isSupportedVersion(1)).toBe(true);
  });

  test('returns false for version 0', () => {
    expect(isSupportedVersion(0)).toBe(false);
  });

  test('returns false for negative version', () => {
    expect(isSupportedVersion(-1)).toBe(false);
  });

  test('returns false for future version', () => {
    expect(isSupportedVersion(CURRENT_PROJECT_VERSION + 1)).toBe(false);
  });

  test('returns false for very large version', () => {
    expect(isSupportedVersion(999)).toBe(false);
  });
});
