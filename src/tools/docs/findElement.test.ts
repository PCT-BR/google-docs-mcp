import { describe, it, expect, vi } from 'vitest';
import { findElements } from '../../googleDocsApiHelpers.js';

// Build a mock Docs client whose documents.get returns a fixed body.content.
const mockDocsWith = (content: any[]): any => ({
  documents: {
    get: vi.fn(async () => ({ data: { body: { content } } })),
  },
});

describe('findElements', () => {
  describe('textQuery', () => {
    it('returns every non-overlapping occurrence with exact index ranges', async () => {
      // "alpha beta alpha\n" occupies indices 1..18; "alpha" at offsets 0 and 11.
      const docs = mockDocsWith([
        {
          paragraph: {
            elements: [{ startIndex: 1, endIndex: 18, textRun: { content: 'alpha beta alpha\n' } }],
          },
        },
      ]);

      const hits = await findElements(docs, 'doc123', { textQuery: 'alpha' });
      expect(hits.length).toBe(2);
      expect(hits[0]).toEqual({
        type: 'text',
        instance: 1,
        startIndex: 1,
        endIndex: 6,
        text: 'alpha',
      });
      expect(hits[1]).toEqual({
        type: 'text',
        instance: 2,
        startIndex: 12,
        endIndex: 17,
        text: 'alpha',
      });
      // Every returned range width must equal the query length (safe for deleteRange).
      for (const h of hits) expect(h.endIndex - h.startIndex).toBe('alpha'.length);
    });

    it('matches a phrase split across runs by a mid-phrase style boundary (cross-run)', async () => {
      // "alpha" is stored as two runs because "pha" carries different styling:
      //   run "al"   at [1,3)  -> 'a'@1, 'l'@2
      //   run "pha\n" at [3,7) -> 'p'@3, 'h'@4, 'a'@5, '\n'@6
      // Per-run searching would miss "alpha" (no single run contains it); per-paragraph
      // concatenation with a per-char index map finds it at the exact range [1,6).
      const docs = mockDocsWith([
        {
          paragraph: {
            elements: [
              { startIndex: 1, endIndex: 3, textRun: { content: 'al' } },
              { startIndex: 3, endIndex: 7, textRun: { content: 'pha\n' } },
            ],
          },
        },
      ]);

      const hits = await findElements(docs, 'doc123', { textQuery: 'alpha' });
      expect(hits).toEqual([
        { type: 'text', instance: 1, startIndex: 1, endIndex: 6, text: 'alpha' },
      ]);
      expect(hits[0].endIndex - hits[0].startIndex).toBe('alpha'.length);
    });

    it('does NOT span an inline object between two runs (no over-wide range that would over-delete)', async () => {
      // run "ab" [1,3), an inline image at [3,4) (occupies an index, no textRun text),
      // run "cd\n" [4,7). Concatenating across the image would let "bc" falsely match and
      // return [2,5) — width 3 > 2 — whose deleteRange would delete the image. The
      // discontinuity break prevents that: each contiguous run is its own search unit.
      const docs = mockDocsWith([
        {
          paragraph: {
            elements: [
              { startIndex: 1, endIndex: 3, textRun: { content: 'ab' } },
              // Under the field mask a real inline object returns as just
              // {startIndex,endIndex}; the code keys on the absent textRun.content,
              // not on inlineObjectElement (shown here only to label the gap).
              { startIndex: 3, endIndex: 4, inlineObjectElement: { inlineObjectId: 'img1' } },
              { startIndex: 4, endIndex: 7, textRun: { content: 'cd\n' } },
            ],
          },
        },
      ]);
      // A query straddling the image must not match.
      expect(await findElements(docs, 'doc123', { textQuery: 'bc' })).toEqual([]);
      // Text on each side still matches, with an exact contiguous range.
      const cd = await findElements(docs, 'doc123', { textQuery: 'cd' });
      expect(cd).toEqual([{ type: 'text', instance: 1, startIndex: 4, endIndex: 6, text: 'cd' }]);
      expect(cd[0].endIndex - cd[0].startIndex).toBe('cd'.length);
    });

    it('does NOT span a numeric index gap between runs with no intervening element', async () => {
      // Two text runs whose indices are non-contiguous (gap at 3..4) with nothing
      // between them in the elements array. Exercises the `startIndex !== lastIndex+1`
      // discontinuity break (distinct from the inline-object/else path above).
      const docs = mockDocsWith([
        {
          paragraph: {
            elements: [
              { startIndex: 1, endIndex: 3, textRun: { content: 'ab' } },
              { startIndex: 5, endIndex: 8, textRun: { content: 'cd\n' } },
            ],
          },
        },
      ]);
      // "bc" straddles the gap -> no match.
      expect(await findElements(docs, 'doc123', { textQuery: 'bc' })).toEqual([]);
      // Each side still matches at its true index.
      expect(await findElements(docs, 'doc123', { textQuery: 'cd' })).toEqual([
        { type: 'text', instance: 1, startIndex: 5, endIndex: 7, text: 'cd' },
      ]);
    });

    it('does NOT match across a paragraph boundary (paragraph is a hard boundary)', async () => {
      // "alpha" / "beta" live in separate paragraphs; a query spanning the break must not match.
      const docs = mockDocsWith([
        {
          paragraph: {
            elements: [{ startIndex: 1, endIndex: 7, textRun: { content: 'alpha\n' } }],
          },
        },
        {
          paragraph: {
            elements: [{ startIndex: 7, endIndex: 12, textRun: { content: 'beta\n' } }],
          },
        },
      ]);
      expect(await findElements(docs, 'doc123', { textQuery: 'alpha\nbeta' })).toEqual([]);
    });

    it('indexes table-cell text by its run start, not by concatenated-text offset (structural-gap regression)', async () => {
      // A leading body paragraph precedes the table, and the cell's text run sits at a
      // HIGH document index (103) far from its concatenated-text offset (6). A naive
      // concatenate-and-remap approach would map "beta" to ~index 7 (firstRunStart +
      // fullTextOffset); per-run matching must return the run's real index, 103.
      const docs = mockDocsWith([
        {
          paragraph: {
            elements: [{ startIndex: 1, endIndex: 7, textRun: { content: 'alpha\n' } }],
          },
        },
        {
          startIndex: 100,
          endIndex: 120,
          table: {
            rows: 1,
            columns: 1,
            tableRows: [
              {
                tableCells: [
                  {
                    content: [
                      {
                        paragraph: {
                          elements: [
                            { startIndex: 103, endIndex: 108, textRun: { content: 'beta\n' } },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ]);

      const hits = await findElements(docs, 'doc123', { textQuery: 'beta' });
      expect(hits.length).toBe(1);
      // "beta" is at offset 0 of the run that starts at index 103 -> [103, 107].
      expect(hits[0]).toEqual({
        type: 'text',
        instance: 1,
        startIndex: 103,
        endIndex: 107,
        text: 'beta',
      });
      expect(hits[0].endIndex - hits[0].startIndex).toBe('beta'.length);
    });

    it('returns an empty array when the text is absent', async () => {
      const docs = mockDocsWith([
        {
          paragraph: { elements: [{ startIndex: 1, endIndex: 6, textRun: { content: 'abcd\n' } }] },
        },
      ]);
      expect(await findElements(docs, 'doc123', { textQuery: 'zzz' })).toEqual([]);
    });
  });

  describe('elementType listing', () => {
    it('lists tables with their range and a size preview', async () => {
      const docs = mockDocsWith([
        { startIndex: 20, endIndex: 40, table: { rows: 2, columns: 3, tableRows: [] } },
      ]);
      const hits = await findElements(docs, 'doc123', { elementType: 'table' });
      expect(hits).toEqual([{ type: 'table', startIndex: 20, endIndex: 40, text: 'table 2x3' }]);
    });

    it('lists top-level body paragraphs (newline-stripped preview) and not table-cell paragraphs', async () => {
      const docs = mockDocsWith([
        {
          startIndex: 1,
          endIndex: 17,
          paragraph: {
            elements: [{ startIndex: 1, endIndex: 17, textRun: { content: 'intro paragraph\n' } }],
          },
        },
        {
          startIndex: 100,
          endIndex: 120,
          table: {
            rows: 1,
            columns: 1,
            tableRows: [
              {
                tableCells: [
                  {
                    content: [
                      {
                        paragraph: {
                          elements: [
                            { startIndex: 103, endIndex: 113, textRun: { content: 'cell para\n' } },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ]);
      const hits = await findElements(docs, 'doc123', { elementType: 'paragraph' });
      // Only the top-level body paragraph — the cell paragraph is not descended into.
      expect(hits).toEqual([
        { type: 'paragraph', startIndex: 1, endIndex: 17, text: 'intro paragraph' },
      ]);
    });

    it('rejects unsupported element types (list/image) regardless of textQuery', async () => {
      const docs = mockDocsWith([]);
      await expect(
        findElements(docs, 'doc123', { elementType: 'image', textQuery: 'x' })
      ).rejects.toThrow();
      await expect(findElements(docs, 'doc123', { elementType: 'list' })).rejects.toThrow();
    });
  });

  describe('combined elementType + textQuery', () => {
    it('returns both the structural listing and the text matches', async () => {
      const docs = mockDocsWith([
        {
          paragraph: {
            elements: [{ startIndex: 1, endIndex: 14, textRun: { content: 'foundme here\n' } }],
          },
        },
        { startIndex: 50, endIndex: 70, table: { rows: 1, columns: 1, tableRows: [] } },
      ]);
      const hits = await findElements(docs, 'doc123', {
        elementType: 'table',
        textQuery: 'foundme',
      });
      const tables = hits.filter((h) => h.type === 'table');
      const texts = hits.filter((h) => h.type === 'text');
      expect(tables.length).toBe(1);
      expect(texts.length).toBe(1);
      expect(tables[0]).toEqual({ type: 'table', startIndex: 50, endIndex: 70, text: 'table 1x1' });
      expect(texts[0]).toEqual({
        type: 'text',
        instance: 1,
        startIndex: 1,
        endIndex: 8,
        text: 'foundme',
      });
    });
  });

  it('requires at least one of textQuery or elementType', async () => {
    const docs = mockDocsWith([]);
    await expect(findElements(docs, 'doc123', {})).rejects.toThrow(
      /textQuery.*elementType|elementType.*textQuery/
    );
  });
});
