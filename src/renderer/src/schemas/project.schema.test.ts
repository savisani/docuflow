import { describe, test, expect } from 'vitest';
import { ProjectSchema } from './project.schema';

describe('ProjectSchema', () => {
  const validProject = {
    version: 1,
    settings: { width: 1920, height: 1080, fps: 30 },
    assets: [
      {
        id: 'asset-1',
        logicalId: 'logical-1',
        filename: 'photo.jpg',
        type: 'image',
        mimeType: 'image/jpeg',
      },
    ],
    commands: [
      {
        id: 'cmd-1',
        type: 'show',
        start: 0,
        duration: 5,
        asset: 'asset-1',
      },
    ],
  };

  test('accepts valid project', () => {
    const result = ProjectSchema.safeParse(validProject);
    expect(result.success).toBe(true);
  });

  test('accepts project with all optional fields', () => {
    const result = ProjectSchema.safeParse({
      ...validProject,
      voiceover: { assetId: 'asset-1', language: 'en' },
      transcript: {
        language: 'en',
        text: 'Hello world',
        segments: [
          { id: 'seg-1', text: 'Hello', start: 0, end: 1 },
        ],
      },
      sceneMarkers: [
        { id: 'marker-1', start: 0, end: 5, transcriptSegmentIds: ['seg-1'] },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('accepts empty project', () => {
    const result = ProjectSchema.safeParse({
      version: 1,
      settings: { width: 1920, height: 1080, fps: 30 },
      assets: [],
      commands: [],
    });
    expect(result.success).toBe(true);
  });

  test('rejects missing version', () => {
    const result = ProjectSchema.safeParse({
      settings: { width: 1920, height: 1080, fps: 30 },
      assets: [],
      commands: [],
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing settings', () => {
    const result = ProjectSchema.safeParse({
      version: 1,
      assets: [],
      commands: [],
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid settings width', () => {
    const result = ProjectSchema.safeParse({
      version: 1,
      settings: { width: -1, height: 1080, fps: 30 },
      assets: [],
      commands: [],
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid command in project', () => {
    const result = ProjectSchema.safeParse({
      version: 1,
      settings: { width: 1920, height: 1080, fps: 30 },
      assets: [],
      commands: [
        { id: 'cmd-1', type: 'invalidType', start: 0 },
      ],
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid asset in project', () => {
    const result = ProjectSchema.safeParse({
      version: 1,
      settings: { width: 1920, height: 1080, fps: 30 },
      assets: [
        { id: 'a', logicalId: 'l', filename: 'f.png', type: 'invalid', mimeType: 'image/png' },
      ],
      commands: [],
    });
    expect(result.success).toBe(false);
  });

  test('rejects transcript with missing segments', () => {
    const result = ProjectSchema.safeParse({
      version: 1,
      settings: { width: 1920, height: 1080, fps: 30 },
      assets: [],
      commands: [],
      transcript: {
        language: 'en',
        text: 'Hello',
        // segments is missing
      },
    });
    expect(result.success).toBe(false);
  });

  test('rejects sceneMarker with missing transcriptSegmentIds', () => {
    const result = ProjectSchema.safeParse({
      version: 1,
      settings: { width: 1920, height: 1080, fps: 30 },
      assets: [],
      commands: [],
      sceneMarkers: [
        { id: 'm', start: 0, end: 5 },
      ],
    });
    expect(result.success).toBe(false);
  });
});
