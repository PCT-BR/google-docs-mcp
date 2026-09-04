import { describe, expect, it } from 'vitest';
import {
  DOC_MIME_TYPE,
  FOLDER_MIME_TYPE,
  SHEET_MIME_TYPE,
  SLIDES_MIME_TYPE,
  buildDriveIndexMarkdown,
  findDriveIndexEntryNotes,
  searchDriveIndexMarkdown,
  upsertDriveIndexEntry,
} from './driveIndex.js';

describe('buildDriveIndexMarkdown', () => {
  it('groups entries by Google file type', () => {
    const markdown = buildDriveIndexMarkdown(
      [
        { id: 'sheet1', name: 'Budget', mimeType: SHEET_MIME_TYPE },
        { id: 'doc1', name: 'Notes', mimeType: DOC_MIME_TYPE },
        { id: 'folder1', name: 'Projects', mimeType: FOLDER_MIME_TYPE },
        { id: 'slides1', name: 'Deck', mimeType: SLIDES_MIME_TYPE },
      ],
      new Date('2026-09-03T12:00:00Z')
    );

    expect(markdown).toContain('Last refreshed: 2026-09-03T12:00:00.000Z');
    expect(markdown).toContain('| Projects | folder1 | root |  |');
    expect(markdown).toContain('| Notes | doc1 | root |  |  |');
    expect(markdown).toContain('| Budget | sheet1 | root |  |  |');
    expect(markdown).toContain(
      '| Deck | slides1 | application/vnd.google-apps.presentation | root |  |  |'
    );
  });
});

describe('searchDriveIndexMarkdown', () => {
  it('returns matching table rows with section names', () => {
    const markdown = buildDriveIndexMarkdown(
      [{ id: 'doc1', name: 'Project Brief', mimeType: DOC_MIME_TYPE }],
      new Date('2026-09-03T12:00:00Z')
    );

    expect(searchDriveIndexMarkdown(markdown, 'brief', 10)).toEqual([
      {
        section: 'Google Docs',
        line: '| Project Brief | doc1 | root |  |  |',
      },
    ]);
  });
});

describe('upsertDriveIndexEntry', () => {
  it('replaces an existing row by file ID', () => {
    const original = buildDriveIndexMarkdown(
      [{ id: 'doc1', name: 'Old title', mimeType: DOC_MIME_TYPE }],
      new Date('2026-09-03T12:00:00Z')
    );

    const updated = upsertDriveIndexEntry(original, {
      id: 'doc1',
      name: 'New title',
      mimeType: DOC_MIME_TYPE,
      notes: 'renamed',
    });

    expect(updated).toContain('| New title | doc1 | root |  | renamed |');
    expect(updated).not.toContain('Old title');
  });

  it('appends a new row inside the correct existing section table', () => {
    const original = buildDriveIndexMarkdown([], new Date('2026-09-03T12:00:00Z'));
    const updated = upsertDriveIndexEntry(original, {
      id: 'sheet1',
      name: 'Budget',
      mimeType: SHEET_MIME_TYPE,
    });

    expect(updated).toContain(
      '## Google Sheets\n\n| Title | ID | Folder hint | Modified | Notes |\n| --- | --- | --- | --- | --- |\n| Budget | sheet1 | root |  |  |'
    );
  });
});

describe('findDriveIndexEntryNotes', () => {
  it('returns the existing notes cell for a file row', () => {
    const markdown = buildDriveIndexMarkdown(
      [
        {
          id: 'doc1',
          name: 'Project Brief',
          mimeType: DOC_MIME_TYPE,
          notes: 'owner note with A | B',
        },
      ],
      new Date('2026-09-03T12:00:00Z')
    );

    expect(findDriveIndexEntryNotes(markdown, 'doc1')).toBe('owner note with A | B');
  });

  it('returns undefined when no notes cell exists', () => {
    const markdown = buildDriveIndexMarkdown(
      [{ id: 'folder1', name: 'Projects', mimeType: FOLDER_MIME_TYPE }],
      new Date('2026-09-03T12:00:00Z')
    );

    expect(findDriveIndexEntryNotes(markdown, 'folder1')).toBeUndefined();
  });
});
