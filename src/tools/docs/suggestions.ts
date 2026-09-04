import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';

const suggestionKeyToKind: Record<string, string> = {
  suggestedInsertionIds: 'insertion',
  suggestedDeletionIds: 'deletion',
  suggestedTextStyleChanges: 'textStyle',
  suggestedParagraphStyleChanges: 'paragraphStyle',
  suggestedNamedStylesChanges: 'namedStyles',
  suggestedDocumentStyleChanges: 'documentStyle',
  suggestedTableCellStyleChanges: 'tableCellStyle',
  suggestedTableRowStyleChanges: 'tableRowStyle',
  suggestedBulletChanges: 'bullet',
  suggestedPositionedObjectPropertiesChanges: 'positionedObjectProperties',
  suggestedInlineObjectPropertiesChanges: 'inlineObjectProperties',
};

function stringify(data: unknown) {
  return JSON.stringify(data, null, 2);
}

function collectSuggestions(value: unknown, path: string[] = [], found = new Map<string, any>()) {
  if (!value || typeof value !== 'object') return found;

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSuggestions(item, [...path, String(index)], found));
    return found;
  }

  const record = value as Record<string, unknown>;
  const range = {
    startIndex: typeof record.startIndex === 'number' ? record.startIndex : undefined,
    endIndex: typeof record.endIndex === 'number' ? record.endIndex : undefined,
  };

  for (const [key, kind] of Object.entries(suggestionKeyToKind)) {
    const raw = record[key];
    const ids = Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === 'string')
      : raw && typeof raw === 'object'
        ? Object.keys(raw)
        : [];

    for (const id of ids) {
      const existing = found.get(id) ?? {
        suggestionId: id,
        kinds: new Set<string>(),
        occurrences: [],
      };
      existing.kinds.add(kind);
      existing.occurrences.push({
        path: [...path, key].join('.'),
        ...range,
      });
      found.set(id, existing);
    }
  }

  for (const [key, child] of Object.entries(record)) {
    collectSuggestions(child, [...path, key], found);
  }

  return found;
}

function serializeSuggestions(found: Map<string, any>) {
  return [...found.values()].map((item) => ({
    suggestionId: item.suggestionId,
    kinds: [...item.kinds],
    occurrences: item.occurrences,
  }));
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'listDocumentSuggestions',
    description:
      'Lists suggestion IDs and affected JSON paths in a Google Doc. This is read-only; accepting/rejecting suggestions requires Developer Preview tools.',
    parameters: z.strictObject({
      documentId: z
        .string()
        .describe('The document ID — the long string between /d/ and /edit in a Google Docs URL.'),
      tabId: z.string().optional().describe('Optional document tab ID to inspect.'),
      maxSuggestions: z.number().int().min(1).max(500).optional().default(200),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Listing suggestions for document ${args.documentId}`);
      try {
        const response = await docs.documents.get({
          documentId: args.documentId,
          includeTabsContent: Boolean(args.tabId),
          suggestionsViewMode: 'SUGGESTIONS_INLINE',
          fields: '*',
        });

        const source = args.tabId
          ? (response.data.tabs ?? []).find((tab) => tab.tabProperties?.tabId === args.tabId)
          : response.data;

        if (!source) {
          throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
        }

        const suggestions = serializeSuggestions(collectSuggestions(source)).slice(
          0,
          args.maxSuggestions
        );

        return stringify({
          documentId: args.documentId,
          tabId: args.tabId,
          suggestions,
          truncated: suggestions.length >= args.maxSuggestions,
        });
      } catch (error: any) {
        log.error(`Error listing document suggestions: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to list document suggestions: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
