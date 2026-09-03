import { describe, expect, it } from 'vitest';
import {
  buildCreateNamedRangeRequest,
  buildDeleteNamedRangeRequest,
  buildReplaceNamedRangeRequest,
  buildSegmentTextRequest,
  buildUpdateDocumentStyleRequest,
  normalizeHeaderFooterType,
} from './advancedStructure.js';

describe('advanced Docs structure helpers', () => {
  it('normalizes legacy header and footer type aliases', () => {
    expect(normalizeHeaderFooterType('FIRST_PAGE_HEADER')).toBe('FIRST_PAGE');
    expect(normalizeHeaderFooterType('EVEN_PAGE_FOOTER')).toBe('EVEN_PAGE');
    expect(normalizeHeaderFooterType('DEFAULT')).toBe('DEFAULT');
  });

  it('builds segment insert requests for headers, footers, and footnotes', () => {
    expect(buildSegmentTextRequest('kix.header1', 'Hello', 0)).toEqual({
      insertText: {
        location: {
          segmentId: 'kix.header1',
          index: 0,
        },
        text: 'Hello',
      },
    });
  });

  it('builds named range requests with optional tab IDs', () => {
    expect(buildCreateNamedRangeRequest('client_name', 10, 22, 'tab-1')).toEqual({
      createNamedRange: {
        name: 'client_name',
        range: {
          startIndex: 10,
          endIndex: 22,
          tabId: 'tab-1',
        },
      },
    });
  });

  it('builds named range delete and replace requests', () => {
    expect(buildDeleteNamedRangeRequest({ namedRangeId: 'nr-1' })).toEqual({
      deleteNamedRange: {
        namedRangeId: 'nr-1',
      },
    });
    expect(buildReplaceNamedRangeRequest({ name: 'client_name', text: 'Ada' })).toEqual({
      replaceNamedRangeContent: {
        text: 'Ada',
        namedRangeName: 'client_name',
      },
    });
  });

  it('builds document style updates with field masks', () => {
    expect(
      buildUpdateDocumentStyleRequest({
        documentMode: 'PAGES',
        pageWidth: 8.5,
        pageHeight: 11,
        marginTop: 1,
        useFirstPageHeaderFooter: true,
        unit: 'IN',
      })
    ).toEqual({
      request: {
        updateDocumentStyle: {
          documentStyle: {
            documentFormat: {
              documentMode: 'PAGES',
            },
            pageSize: {
              width: {
                magnitude: 8.5,
                unit: 'IN',
              },
              height: {
                magnitude: 11,
                unit: 'IN',
              },
            },
            marginTop: {
              magnitude: 1,
              unit: 'IN',
            },
            useFirstPageHeaderFooter: true,
          },
          fields: 'pageSize,marginTop,useFirstPageHeaderFooter,documentFormat',
        },
      },
      fields: ['pageSize', 'marginTop', 'useFirstPageHeaderFooter', 'documentFormat'],
    });
  });
});
