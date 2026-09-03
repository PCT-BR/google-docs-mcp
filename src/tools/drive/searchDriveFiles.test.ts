import { describe, expect, it } from 'vitest';
import { buildDriveSearchQuery, resolveDriveMimeType } from './searchDriveFiles.js';

describe('resolveDriveMimeType', () => {
  it('resolves supported shortcuts', () => {
    expect(resolveDriveMimeType('document')).toBe('application/vnd.google-apps.document');
    expect(resolveDriveMimeType('spreadsheet')).toBe('application/vnd.google-apps.spreadsheet');
  });

  it('passes through full MIME types', () => {
    expect(resolveDriveMimeType('image/png')).toBe('image/png');
  });
});

describe('buildDriveSearchQuery', () => {
  it('uses direct parent filtering for folder searches', () => {
    const query = buildDriveSearchQuery({
      query: 'Budget',
      searchIn: 'name',
      folderId: 'folder123',
    });

    expect(query).toContain("'folder123' in parents");
    expect(query).not.toContain('ancestors');
  });

  it('escapes search text and MIME filters', () => {
    const query = buildDriveSearchQuery({
      query: "Bob's report",
      searchIn: 'both',
      mimeType: 'document',
    });

    expect(query).toContain("Bob\\'s report");
    expect(query).toContain("mimeType='application/vnd.google-apps.document'");
  });

  it('adds ISO modifiedAfter filters', () => {
    const query = buildDriveSearchQuery({
      query: 'invoice',
      searchIn: 'content',
      modifiedAfter: '2026-09-03',
    });

    expect(query).toContain("fullText contains 'invoice'");
    expect(query).toContain("modifiedTime > '2026-09-03T00:00:00.000Z'");
  });
});
