import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter, MarkdownConversionError } from '../../types.js';
import { formatInsertResult, insertMarkdown } from '../../markdown-transformer/index.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'insertSegmentMarkdown',
    description:
      'Inserts formatted Markdown into a Google Docs segment such as a header, footer, or footnote. Supports paragraphs, headings, bold, italic, links, and lists; rejects Markdown tables and fenced code blocks.',
    parameters: DocumentIdParameter.extend({
      segmentId: z
        .string()
        .min(1)
        .describe('Header, footer, or footnote segment ID from listHeadersFooters/listFootnotes.'),
      markdown: z.string().min(1).describe('Markdown content to insert into the segment.'),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe('Segment-relative insertion index. Defaults to 0.'),
      tabId: z.string().optional().describe('Optional document tab ID for multi-tab documents.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Inserting markdown into segment ${args.segmentId}`);
      try {
        const result = await insertMarkdown(docs, args.documentId, args.markdown, {
          startIndex: args.index,
          segmentId: args.segmentId,
          tabId: args.tabId,
        });

        return `Successfully inserted ${args.markdown.length} characters of segment markdown.\n\n${formatInsertResult(result)}`;
      } catch (error: any) {
        log.error(`Error inserting segment markdown: ${error.message || error}`);
        if (error instanceof UserError || error instanceof MarkdownConversionError) throw error;
        throw new UserError(
          `Failed to insert segment markdown: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
