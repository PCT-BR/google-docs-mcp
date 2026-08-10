import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MANIFEST_SOURCE,
  MANIFEST_FILE_NAME,
  ensureManifest,
  inferFileType,
  mergeFiles,
  toApiFiles,
} from './appsScriptShared.js';

describe('inferFileType', () => {
  it('treats the manifest as JSON', () => {
    expect(inferFileType('appsscript')).toBe('JSON');
    expect(inferFileType('appsscript.json')).toBe('JSON');
  });

  it('treats .html as HTML', () => {
    expect(inferFileType('sidebar.html')).toBe('HTML');
    expect(inferFileType('Sidebar.HTML')).toBe('HTML');
  });

  it('defaults everything else to SERVER_JS', () => {
    expect(inferFileType('Code')).toBe('SERVER_JS');
    expect(inferFileType('Code.gs')).toBe('SERVER_JS');
    expect(inferFileType('utils.js')).toBe('SERVER_JS');
  });
});

describe('toApiFiles', () => {
  it('strips known extensions from the file name', () => {
    const files = toApiFiles([{ name: 'Code.gs', source: 'function a() {}' }]);
    expect(files).toEqual([{ name: 'Code', type: 'SERVER_JS', source: 'function a() {}' }]);
  });

  it('keeps an explicit type over the inferred one', () => {
    const files = toApiFiles([{ name: 'Page', type: 'HTML', source: '<div></div>' }]);
    expect(files[0].type).toBe('HTML');
  });

  it('does not strip a dot that is not a known extension', () => {
    const files = toApiFiles([{ name: 'my.helper', source: '' }]);
    expect(files[0].name).toBe('my.helper');
  });
});

describe('mergeFiles', () => {
  const existing = [
    { name: 'appsscript', type: 'JSON', source: '{}' },
    { name: 'Code', type: 'SERVER_JS', source: 'old' },
    { name: 'Utils', type: 'SERVER_JS', source: 'keep me' },
  ];

  it('replaces files with the same name', () => {
    const merged = mergeFiles(existing, [{ name: 'Code', type: 'SERVER_JS', source: 'new' }]);
    expect(merged.find((f) => f.name === 'Code')?.source).toBe('new');
  });

  it('keeps files that are not part of the update', () => {
    const merged = mergeFiles(existing, [{ name: 'Code', type: 'SERVER_JS', source: 'new' }]);
    expect(merged.find((f) => f.name === 'Utils')?.source).toBe('keep me');
    expect(merged).toHaveLength(3);
  });

  it('appends files that did not exist yet', () => {
    const merged = mergeFiles(existing, [{ name: 'New', type: 'SERVER_JS', source: 'x' }]);
    expect(merged).toHaveLength(4);
  });
});

describe('ensureManifest', () => {
  it('leaves the payload untouched when it already carries a manifest', () => {
    const files = [{ name: MANIFEST_FILE_NAME, type: 'JSON', source: '{"runtimeVersion":"V8"}' }];
    expect(ensureManifest(files, [])).toEqual(files);
  });

  it('reuses the manifest already in the project', () => {
    const existing = [
      { name: MANIFEST_FILE_NAME, type: 'JSON', source: '{"timeZone":"Asia/Tokyo"}' },
    ];
    const result = ensureManifest([{ name: 'Code', type: 'SERVER_JS', source: '' }], existing);
    expect(result[0]).toEqual(existing[0]);
    expect(result).toHaveLength(2);
  });

  it('falls back to a default manifest when the project has none', () => {
    const result = ensureManifest([{ name: 'Code', type: 'SERVER_JS', source: '' }], []);
    expect(result[0].name).toBe(MANIFEST_FILE_NAME);
    expect(result[0].source).toBe(DEFAULT_MANIFEST_SOURCE);
  });

  it('produces a manifest that is valid JSON', () => {
    expect(() => JSON.parse(DEFAULT_MANIFEST_SOURCE)).not.toThrow();
  });
});
