import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { docs_v1 } from 'googleapis';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

const HeaderFooterTypeSchema = z
  .enum([
    'DEFAULT',
    'FIRST_PAGE',
    'EVEN_PAGE',
    'FIRST_PAGE_HEADER',
    'EVEN_PAGE_HEADER',
    'FIRST_PAGE_FOOTER',
    'EVEN_PAGE_FOOTER',
  ])
  .optional()
  .default('DEFAULT');

const UnitSchema = z.enum(['PT', 'IN']).optional().default('PT');

export function normalizeHeaderFooterType(type: string): string {
  if (type === 'FIRST_PAGE_HEADER' || type === 'FIRST_PAGE_FOOTER') return 'FIRST_PAGE';
  if (type === 'EVEN_PAGE_HEADER' || type === 'EVEN_PAGE_FOOTER') return 'EVEN_PAGE';
  return type;
}

export function buildSegmentTextRequest(segmentId: string, text: string, index = 0) {
  return {
    insertText: {
      location: {
        segmentId,
        index,
      },
      text,
    },
  } satisfies docs_v1.Schema$Request;
}

export function buildCreateNamedRangeRequest(
  name: string,
  startIndex: number,
  endIndex: number,
  tabId?: string
) {
  const range: any = { startIndex, endIndex };
  if (tabId) range.tabId = tabId;

  return {
    createNamedRange: {
      name,
      range,
    },
  } satisfies docs_v1.Schema$Request;
}

export function buildDeleteNamedRangeRequest(args: { name?: string; namedRangeId?: string }) {
  if (!args.name && !args.namedRangeId) {
    throw new UserError('Provide either name or namedRangeId.');
  }

  return {
    deleteNamedRange: {
      ...(args.name ? { name: args.name } : { namedRangeId: args.namedRangeId }),
    },
  } satisfies docs_v1.Schema$Request;
}

export function buildReplaceNamedRangeRequest(args: {
  text: string;
  name?: string;
  namedRangeId?: string;
}) {
  if (!args.name && !args.namedRangeId) {
    throw new UserError('Provide either name or namedRangeId.');
  }

  return {
    replaceNamedRangeContent: {
      text: args.text,
      ...(args.name ? { namedRangeName: args.name } : { namedRangeId: args.namedRangeId }),
    },
  } satisfies docs_v1.Schema$Request;
}

export interface DocumentStyleUpdateInput {
  pageWidth?: number;
  pageHeight?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  marginHeader?: number;
  marginFooter?: number;
  useFirstPageHeaderFooter?: boolean;
  useEvenPageHeaderFooter?: boolean;
  documentMode?: 'PAGES' | 'PAGELESS';
  unit?: 'PT' | 'IN';
}

function size(value: number, unit: 'PT' | 'IN') {
  return { magnitude: value, unit };
}

export function buildUpdateDocumentStyleRequest(input: DocumentStyleUpdateInput) {
  const unit = input.unit ?? 'PT';
  const documentStyle: any = {};
  const fields: string[] = [];

  if (input.pageWidth !== undefined || input.pageHeight !== undefined) {
    documentStyle.pageSize = {};
    if (input.pageWidth !== undefined) documentStyle.pageSize.width = size(input.pageWidth, unit);
    if (input.pageHeight !== undefined) documentStyle.pageSize.height = size(input.pageHeight, unit);
    fields.push('pageSize');
  }
  if (input.marginTop !== undefined) {
    documentStyle.marginTop = size(input.marginTop, unit);
    fields.push('marginTop');
  }
  if (input.marginBottom !== undefined) {
    documentStyle.marginBottom = size(input.marginBottom, unit);
    fields.push('marginBottom');
  }
  if (input.marginLeft !== undefined) {
    documentStyle.marginLeft = size(input.marginLeft, unit);
    fields.push('marginLeft');
  }
  if (input.marginRight !== undefined) {
    documentStyle.marginRight = size(input.marginRight, unit);
    fields.push('marginRight');
  }
  if (input.marginHeader !== undefined) {
    documentStyle.marginHeader = size(input.marginHeader, unit);
    fields.push('marginHeader');
  }
  if (input.marginFooter !== undefined) {
    documentStyle.marginFooter = size(input.marginFooter, unit);
    fields.push('marginFooter');
  }
  if (input.useFirstPageHeaderFooter !== undefined) {
    documentStyle.useFirstPageHeaderFooter = input.useFirstPageHeaderFooter;
    fields.push('useFirstPageHeaderFooter');
  }
  if (input.useEvenPageHeaderFooter !== undefined) {
    documentStyle.useEvenPageHeaderFooter = input.useEvenPageHeaderFooter;
    fields.push('useEvenPageHeaderFooter');
  }
  if (input.documentMode !== undefined) {
    documentStyle.documentFormat = { documentMode: input.documentMode };
    fields.push('documentFormat');
  }

  if (fields.length === 0) {
    throw new UserError(
      'No document style options were provided. Set at least one page size, margin, header/footer, or documentMode option.'
    );
  }

  return {
    request: {
      updateDocumentStyle: {
        documentStyle,
        fields: fields.join(','),
      },
    } satisfies docs_v1.Schema$Request,
    fields,
  };
}

function extractText(content: any[] = []) {
  let text = '';
  for (const element of content) {
    const paragraphElements = element.paragraph?.elements ?? [];
    for (const paragraphElement of paragraphElements) {
      if (paragraphElement.textRun?.content) text += paragraphElement.textRun.content;
    }
    const rows = element.table?.tableRows ?? [];
    for (const row of rows) {
      for (const cell of row.tableCells ?? []) {
        text += extractText(cell.content ?? []);
      }
    }
  }
  return text;
}

function summarizeSegments(segments: Record<string, any> | undefined) {
  return Object.entries(segments ?? {}).map(([id, segment]) => ({
    id,
    text: extractText(segment.content ?? []).trim(),
    content: segment.content ?? [],
  }));
}

function summarizeNamedRanges(namedRanges: Record<string, any> | undefined) {
  const output: Array<{ name: string; id?: string; ranges: any[] }> = [];
  for (const [name, data] of Object.entries(namedRanges ?? {})) {
    for (const namedRange of data.namedRanges ?? []) {
      output.push({
        name,
        id: namedRange.namedRangeId,
        ranges: namedRange.ranges ?? [],
      });
    }
  }
  return output;
}

function summarizeFootnotes(footnotes: Record<string, any> | undefined) {
  return Object.entries(footnotes ?? {}).map(([id, footnote]) => ({
    id,
    text: extractText(footnote.content ?? '').trim(),
    content: footnote.content ?? [],
  }));
}

export function registerAdvancedStructureTools(server: FastMCP) {
  server.addTool({
    name: 'listHeadersFooters',
    description:
      'Lists document headers and footers, including their segment IDs and current text. Use segment IDs with insertHeaderFooterText.',
    parameters: DocumentIdParameter,
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Listing headers and footers for doc ${args.documentId}`);
      const res = await docs.documents.get({
        documentId: args.documentId,
        fields: 'documentId,title,documentStyle,headers,footers',
      });

      return JSON.stringify(
        {
          documentId: res.data.documentId,
          title: res.data.title,
          documentStyle: res.data.documentStyle,
          headers: summarizeSegments(res.data.headers as Record<string, any> | undefined),
          footers: summarizeSegments(res.data.footers as Record<string, any> | undefined),
        },
        null,
        2
      );
    },
  });

  server.addTool({
    name: 'createHeader',
    description:
      'Creates a Google Docs header and returns the header segment ID. For custom text, call insertHeaderFooterText with the returned ID.',
    parameters: DocumentIdParameter.extend({
      type: HeaderFooterTypeSchema.describe('Header type. Prefer DEFAULT, FIRST_PAGE, or EVEN_PAGE.'),
      sectionBreakIndex: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe('Section break location index. Use 0 for the first section.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      const type = normalizeHeaderFooterType(args.type);
      log.info(`Creating ${type} header for doc ${args.documentId}`);
      const response = await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [
        {
          createHeader: {
            type,
            sectionBreakLocation: { index: args.sectionBreakIndex },
          },
        } as any,
      ]);
      const headerId = response.replies?.[0]?.createHeader?.headerId;
      return JSON.stringify({ documentId: args.documentId, headerId, type }, null, 2);
    },
  });

  server.addTool({
    name: 'createFooter',
    description:
      'Creates a Google Docs footer and returns the footer segment ID. For custom text, call insertHeaderFooterText with the returned ID.',
    parameters: DocumentIdParameter.extend({
      type: HeaderFooterTypeSchema.describe('Footer type. Prefer DEFAULT, FIRST_PAGE, or EVEN_PAGE.'),
      sectionBreakIndex: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe('Section break location index. Use 0 for the first section.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      const type = normalizeHeaderFooterType(args.type);
      log.info(`Creating ${type} footer for doc ${args.documentId}`);
      const response = await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [
        {
          createFooter: {
            type,
            sectionBreakLocation: { index: args.sectionBreakIndex },
          },
        } as any,
      ]);
      const footerId = response.replies?.[0]?.createFooter?.footerId;
      return JSON.stringify({ documentId: args.documentId, footerId, type }, null, 2);
    },
  });

  server.addTool({
    name: 'insertHeaderFooterText',
    description:
      'Inserts plain text into a header, footer, or other segment by segment ID. Use listHeadersFooters to discover IDs.',
    parameters: DocumentIdParameter.extend({
      segmentId: z.string().min(1).describe('Header/footer segment ID.'),
      text: z.string().min(1).describe('Plain text to insert.'),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe('Index within the header/footer segment. Defaults to 0.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Inserting segment text in doc ${args.documentId}, segment ${args.segmentId}`);
      await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [
        buildSegmentTextRequest(args.segmentId, args.text, args.index),
      ]);
      return `Successfully inserted text into segment ${args.segmentId}.`;
    },
  });

  server.addTool({
    name: 'deleteHeader',
    description: 'Deletes a Google Docs header by header segment ID.',
    parameters: DocumentIdParameter.extend({
      headerId: z.string().min(1).describe('Header segment ID to delete.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Deleting header ${args.headerId} from doc ${args.documentId}`);
      await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [
        { deleteHeader: { headerId: args.headerId } },
      ]);
      return `Successfully deleted header ${args.headerId}.`;
    },
  });

  server.addTool({
    name: 'deleteFooter',
    description: 'Deletes a Google Docs footer by footer segment ID.',
    parameters: DocumentIdParameter.extend({
      footerId: z.string().min(1).describe('Footer segment ID to delete.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Deleting footer ${args.footerId} from doc ${args.documentId}`);
      await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [
        { deleteFooter: { footerId: args.footerId } },
      ]);
      return `Successfully deleted footer ${args.footerId}.`;
    },
  });

  server.addTool({
    name: 'insertFootnote',
    description:
      'Inserts a footnote reference at a document index and returns the footnote segment ID.',
    parameters: DocumentIdParameter.extend({
      index: z.number().int().min(1).describe('Document body index for the footnote reference.'),
      tabId: z
        .string()
        .optional()
        .describe('Optional document tab ID when inserting into a tabbed document.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      const location: any = { index: args.index };
      if (args.tabId) location.tabId = args.tabId;
      log.info(`Inserting footnote in doc ${args.documentId} at index ${args.index}`);
      const response = await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [
        { createFootnote: { location } } as any,
      ]);
      const footnoteId = response.replies?.[0]?.createFootnote?.footnoteId;
      return JSON.stringify({ documentId: args.documentId, footnoteId, index: args.index }, null, 2);
    },
  });

  server.addTool({
    name: 'listFootnotes',
    description: 'Lists all footnotes in a Google Doc, including IDs and current text.',
    parameters: DocumentIdParameter,
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Listing footnotes for doc ${args.documentId}`);
      const res = await docs.documents.get({
        documentId: args.documentId,
        fields: 'documentId,title,footnotes',
      });
      return JSON.stringify(
        {
          documentId: res.data.documentId,
          title: res.data.title,
          footnotes: summarizeFootnotes(res.data.footnotes as Record<string, any> | undefined),
        },
        null,
        2
      );
    },
  });

  server.addTool({
    name: 'insertFootnoteText',
    description:
      'Inserts plain text into an existing footnote segment. Use insertFootnote or listFootnotes to get the footnote ID.',
    parameters: DocumentIdParameter.extend({
      footnoteId: z.string().min(1).describe('Footnote segment ID.'),
      text: z.string().min(1).describe('Plain text to insert into the footnote.'),
      index: z.number().int().min(0).optional().default(0).describe('Index inside the footnote.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Inserting footnote text in doc ${args.documentId}, footnote ${args.footnoteId}`);
      await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [
        buildSegmentTextRequest(args.footnoteId, args.text, args.index),
      ]);
      return `Successfully inserted text into footnote ${args.footnoteId}.`;
    },
  });

  server.addTool({
    name: 'createNamedRange',
    description:
      'Creates a named range over a body text range. Useful for stable placeholders and repeatable template edits.',
    parameters: DocumentIdParameter.extend({
      name: z.string().min(1).describe('Named range name.'),
      startIndex: z.number().int().min(1).describe('Start index, inclusive.'),
      endIndex: z.number().int().min(1).describe('End index, exclusive.'),
      tabId: z.string().optional().describe('Optional tab ID for tabbed documents.'),
    }).refine((data) => data.endIndex > data.startIndex, {
      message: 'endIndex must be greater than startIndex',
      path: ['endIndex'],
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Creating named range ${args.name} in doc ${args.documentId}`);
      const response = await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [
        buildCreateNamedRangeRequest(args.name, args.startIndex, args.endIndex, args.tabId),
      ]);
      const namedRangeId = response.replies?.[0]?.createNamedRange?.namedRangeId;
      return JSON.stringify(
        {
          documentId: args.documentId,
          name: args.name,
          namedRangeId,
          startIndex: args.startIndex,
          endIndex: args.endIndex,
        },
        null,
        2
      );
    },
  });

  server.addTool({
    name: 'listNamedRanges',
    description: 'Lists all named ranges in a Google Doc with IDs and ranges.',
    parameters: DocumentIdParameter,
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Listing named ranges for doc ${args.documentId}`);
      const res = await docs.documents.get({
        documentId: args.documentId,
        fields: 'documentId,title,namedRanges',
      });
      return JSON.stringify(
        {
          documentId: res.data.documentId,
          title: res.data.title,
          namedRanges: summarizeNamedRanges(res.data.namedRanges as Record<string, any> | undefined),
        },
        null,
        2
      );
    },
  });

  server.addTool({
    name: 'deleteNamedRange',
    description: 'Deletes a named range by name or namedRangeId. The content itself is not deleted.',
    parameters: DocumentIdParameter.extend({
      name: z.string().min(1).optional().describe('Named range name.'),
      namedRangeId: z.string().min(1).optional().describe('Named range ID.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Deleting named range from doc ${args.documentId}`);
      await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [
        buildDeleteNamedRangeRequest({ name: args.name, namedRangeId: args.namedRangeId }),
      ]);
      return `Successfully deleted named range ${args.name ?? args.namedRangeId}.`;
    },
  });

  server.addTool({
    name: 'replaceNamedRange',
    description:
      'Replaces the content of a named range by name or namedRangeId with plain text. Good for template placeholders.',
    parameters: DocumentIdParameter.extend({
      text: z.string().describe('Replacement plain text.'),
      name: z.string().min(1).optional().describe('Named range name.'),
      namedRangeId: z.string().min(1).optional().describe('Named range ID.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Replacing named range content in doc ${args.documentId}`);
      await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [
        buildReplaceNamedRangeRequest({
          text: args.text,
          name: args.name,
          namedRangeId: args.namedRangeId,
        }),
      ]);
      return `Successfully replaced named range ${args.name ?? args.namedRangeId}.`;
    },
  });

  server.addTool({
    name: 'getDocumentPageFormat',
    description:
      'Reads document-level page settings, including page size, margins, header/footer options, and page vs pageless mode when available.',
    parameters: DocumentIdParameter,
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Reading document style for doc ${args.documentId}`);
      const res = await docs.documents.get({
        documentId: args.documentId,
        fields: 'documentId,title,documentStyle',
      });
      const documentStyle = res.data.documentStyle as any;
      const documentMode = documentStyle?.documentFormat?.documentMode ?? 'PAGES';
      return JSON.stringify(
        {
          documentId: res.data.documentId,
          title: res.data.title,
          documentStyle,
          documentMode,
          isPageless: documentMode === 'PAGELESS',
        },
        null,
        2
      );
    },
  });

  server.addTool({
    name: 'setDocumentPageFormat',
    description:
      'Updates document-level page settings such as page size, margins, header/footer options, and page/pageless mode.',
    parameters: DocumentIdParameter.extend({
      documentMode: z.enum(['PAGES', 'PAGELESS']).optional().describe('Document mode.'),
      pageWidth: z.number().positive().optional().describe('Page width in the selected unit.'),
      pageHeight: z.number().positive().optional().describe('Page height in the selected unit.'),
      marginTop: z.number().nonnegative().optional().describe('Top margin.'),
      marginBottom: z.number().nonnegative().optional().describe('Bottom margin.'),
      marginLeft: z.number().nonnegative().optional().describe('Left margin.'),
      marginRight: z.number().nonnegative().optional().describe('Right margin.'),
      marginHeader: z.number().nonnegative().optional().describe('Header margin.'),
      marginFooter: z.number().nonnegative().optional().describe('Footer margin.'),
      useFirstPageHeaderFooter: z
        .boolean()
        .optional()
        .describe('Whether first page header/footer variants are enabled.'),
      useEvenPageHeaderFooter: z
        .boolean()
        .optional()
        .describe('Whether even page header/footer variants are enabled.'),
      unit: UnitSchema.describe('Measurement unit for size and margin values.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Updating document style for doc ${args.documentId}`);
      const built = buildUpdateDocumentStyleRequest(args);
      await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [built.request]);
      return `Successfully updated document page format fields: ${built.fields.join(', ')}.`;
    },
  });
}
