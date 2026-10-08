import { describe, test, expect } from 'vitest';
import { join } from 'path';
import { resolveSaveBytesPath } from './saveBytesPath';

describe('resolveSaveBytesPath', () => {
  test('explicit destPath is respected exactly', () => {
    const destPath = join('D:', 'projects', 'layers', 'bg.png');
    const result = resolveSaveBytesPath({
      destPath,
      baseDir: join('D:', 'projects', 'other'),
      filename: 'ignored.png',
    });
    expect(result.filePath).toBe(destPath);
    expect(result.dir).toBe(join('D:', 'projects', 'layers'));
  });

  test('baseDir pointing at a project file resolves to its directory under generated/images', () => {
    const result = resolveSaveBytesPath({
      baseDir: join('D:', 'projects', 'demo.docuflow.json'),
      baseDirIsFile: true,
      filename: 'layer.png',
    });
    expect(result.dir).toBe(join('D:', 'projects', 'generated', 'images'));
    expect(result.filePath).toBe(join('D:', 'projects', 'generated', 'images', 'layer.png'));
  });

  test('baseDir pointing at a directory keeps generated/images under it', () => {
    const result = resolveSaveBytesPath({
      baseDir: join('D:', 'projects', 'demo'),
      baseDirIsFile: false,
      filename: 'layer.png',
    });
    expect(result.filePath).toBe(join('D:', 'projects', 'demo', 'generated', 'images', 'layer.png'));
  });

  test('falls back to userData/docuflow-generated when no baseDir or destPath', () => {
    const result = resolveSaveBytesPath({
      filename: 'layer.png',
      userDataDir: join('C:', 'Users', 'dev', 'AppData', 'DocuFlow'),
    });
    expect(result.dir).toBe(join('C:', 'Users', 'dev', 'AppData', 'DocuFlow', 'docuflow-generated'));
    expect(result.filePath).toBe(
      join('C:', 'Users', 'dev', 'AppData', 'DocuFlow', 'docuflow-generated', 'layer.png'),
    );
  });

  test('generates a timestamped default filename when omitted', () => {
    const result = resolveSaveBytesPath({ baseDir: '/tmp/project' });
    expect(result.filePath).toMatch(/docuflow-\d+-[a-z0-9]+\.png$/);
    expect(result.dir).toBe(join('/tmp/project', 'generated', 'images'));
  });

  test('throws when no destination information is available', () => {
    expect(() => resolveSaveBytesPath({})).toThrow(/userDataDir is required/);
  });
});
