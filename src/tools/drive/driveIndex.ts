import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { drive_v3 } from 'googleapis';
import { getDocsClient, getDriveClient } from '../../clients.js';
import { escapeDriveQuery } from '../../driveQueryUtils.js';
import { executeBatchUpdate } from '../../googleDocsApiHelpers.js';
import { insertMarkdown } from '../../markdown-transformer/index.js';

export const DEFAULT_DRIVE_INDEX_TITLE = 'Codex Drive Index';
export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
export const DOC_MIME_TYPE = 'application/vnd.google-apps.document';
export const SHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet';
export const SLIDES_MIME_TYPE = 'application/vnd.google-apps.presentation';

export interface DriveIndexEntry {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string | null;
  url?: string | null;
  parents?: string[] | null;
  notes?: string;
}

function sectionForMimeType(mimeType: string) {
  if (mimeType === FOLDER_MIME_TYPE) return 'Folders';
  if (mimeType === DOC_MIME_TYPE) return 'Google Docs';
  if (mimeType === SHEET_MIME_TYPE) return 'Google Sheets';
  return 'Slides And Other Files';
}

function escapeCell(value: unknown) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function toEntry(file: drive_v3.Schema$File): DriveIndexEntry | null {
  if (!file.id || !file.name || !file.mimeType) return null;
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    url: file.webViewLink,
    parents: file.parents,
  };
}

function rowForEntry(entry: DriveIndexEntry) {
  if (entry.mimeType === FOLDER_MIME_TYPE) {
    return `| ${escapeCell(entry.name)} | ${escapeCell(entry.id)} | ${escapeCell(
      entry.parents?.join(',') || 'root'
    )} | ${escapeCell(entry.modifiedTime)} |`;
  }

  if (entry.mimeType === DOC_MIME_TYPE || entry.mimeType === SHEET_MIME_TYPE) {
    return `| ${escapeCell(entry.name)} | ${escapeCell(entry.id)} | ${escapeCell(
      entry.parents?.join(',') || 'root'
    )} | ${escapeCell(entry.modifiedTime)} | ${escapeCell(entry.notes)} |`;
  }

  return `| ${escapeCell(entry.name)} | ${escapeCell(entry.id)} | ${escapeCell(
    entry.mimeType
  )} | ${escapeCell(entry.parents?.join(',') || 'root')} | ${escapeCell(
    entry.modifiedTime
  )} | ${escapeCell(entry.notes)} |`;
}

export function buildDriveIndexMarkdown(entries: DriveIndexEntry[], refreshedAt = new Date()) {
  const bySection = new Map<string, DriveIndexEntry[]>();
  for (const entry of entries) {
    const section = sectionForMimeType(entry.mimeType);
    const sectionEntries = bySection.get(section) ?? [];
    sectionEntries.push(entry);
    bySection.set(section, sectionEntries);
  }

  for (const sectionEntries of bySection.values()) {
    sectionEntries.sort((a, b) => a.name.localeCompare(b.name));
  }

  const lines = [
    '# Codex Drive Index',
    '',
    `Last refreshed: ${refreshedAt.toISOString()}`,
    '',
    '## How To Use',
    '',
    'This index helps Codex find personal Drive files faster. Verify important entries against live Drive before editing, sharing, moving, or deleting.',
    '',
    '## Folders',
    '',
    '| Name | ID | Path hint | Modified |',
    '| --- | --- | --- | --- |',
    ...(bySection.get('Folders') ?? []).map(rowForEntry),
    '',
    '## Google Docs',
    '',
    '| Title | ID | Folder hint | Modified | Notes |',
    '| --- | --- | --- | --- | --- |',
    ...(bySection.get('Google Docs') ?? []).map(rowForEntry),
    '',
    '## Google Sheets',
    '',
    '| Title | ID | Folder hint | Modified | Notes |',
    '| --- | --- | --- | --- | --- |',
    ...(bySection.get('Google Sheets') ?? []).map(rowForEntry),
    '',
    '## Slides And Other Files',
    '',
    '| Title | ID | Type | Folder hint | Modified | Notes |',
    '| --- | --- | --- | --- | --- | --- |',
    ...(bySection.get('Slides And Other Files') ?? []).map(rowForEntry),
    '',
  ];

  return lines.join('\n');
}

export function searchDriveIndexMarkdown(markdown: string, query: string, maxResults: number) {
  const normalized = query.toLowerCase();
  const results: Array<{ section: string; line: string }> = [];
  let section = '';

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (!line.startsWith('|') || line.includes('---')) continue;
    if (line.toLowerCase().includes(normalized)) {
      results.push({ section, line });
      if (results.length >= maxResults) break;
    }
  }

  return results;
}

export function upsertDriveIndexEntry(markdown: string, entry: DriveIndexEntry) {
  const newRow = rowForEntry(entry);
  const lines = markdown.split(/\r?\n/);
  const idPattern = new RegExp(`\\|[^\\n]*\\s${entry.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s[^\\n]*\\|`);

  const existingIndex = lines.findIndex((line) => idPattern.test(line));
  if (existingIndex >= 0) {
    lines[existingIndex] = newRow;
    return lines.join('\n');
  }

  const sectionTitle = `## ${sectionForMimeType(entry.mimeType)}`;
  const sectionIndex = lines.findIndex((line) => line.trim() === sectionTitle);
  if (sectionIndex < 0) {
    return `${markdown.trimEnd()}\n\n${sectionTitle}\n\n${newRow}\n`;
  }

  let sectionEnd = lines.length;
  for (let i = sectionIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      sectionEnd = i;
      break;
    }
  }

  let insertAt = sectionEnd;
  for (let i = sectionIndex + 1; i < sectionEnd; i++) {
    if (lines[i].startsWith('|')) insertAt = i + 1;
  }

  lines.splice(insertAt, 0, newRow);
  return lines.join('\n');
}

async function findIndexDocument(
  drive: drive_v3.Drive,
  title: string,
  parentFolderId?: string
) {
  const conditions = [
    'trashed=false',
    `name='${escapeDriveQuery(title)}'`,
    `mimeType='${DOC_MIME_TYPE}'`,
  ];
  if (parentFolderId) conditions.push(`'${escapeDriveQuery(parentFolderId)}' in parents`);

  const response = await drive.files.list({
    q: conditions.join(' and '),
    pageSize: 10,
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink,parents)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return response.data.files?.[0] ?? null;
}

async function createIndexDocument(
  drive: drive_v3.Drive,
  docs: any,
  title: string,
  parentFolderId?: string
) {
  const response = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: DOC_MIME_TYPE,
      ...(parentFolderId ? { parents: [parentFolderId] } : {}),
    },
    fields: 'id,name,mimeType,modifiedTime,webViewLink,parents',
    supportsAllDrives: true,
  });

  if (!response.data.id) throw new UserError('Google Drive created the index but returned no ID.');
  const markdown = buildDriveIndexMarkdown([], new Date());
  await insertMarkdown(docs, response.data.id, markdown, {
    startIndex: 1,
    firstHeadingAsTitle: true,
  });

  return response.data;
}

async function readIndexMarkdown(drive: drive_v3.Drive, documentId: string) {
  const response = await drive.files.export(
    { fileId: documentId, mimeType: 'text/markdown' },
    { responseType: 'text' }
  );
  return String((response as any).data ?? '');
}

async function replaceIndexMarkdown(docs: any, documentId: string, markdown: string) {
  const doc = await docs.documents.get({
    documentId,
    fields: 'body(content(startIndex,endIndex))',
  });
  const content = doc.data.body?.content ?? [];
  const endIndex = content.length ? content[content.length - 1].endIndex! - 1 : 1;

  if (endIndex > 1) {
    await executeBatchUpdate(docs, documentId, [
      { deleteContentRange: { range: { startIndex: 1, endIndex } } },
    ]);
  }

  await insertMarkdown(docs, documentId, markdown, {
    startIndex: 1,
    firstHeadingAsTitle: true,
  });
}

async function collectDriveEntries(
  drive: drive_v3.Drive,
  rootFolderId: string,
  maxDepth: number,
  maxFiles: number
) {
  const entries: DriveIndexEntry[] = [];
  const queue: Array<{ id: string; depth: number }> = [{ id: rootFolderId, depth: 0 }];
  const seenFolders = new Set([rootFolderId]);

  while (queue.length > 0 && entries.length < maxFiles) {
    const current = queue.shift()!;
    const response = await drive.files.list({
      q: `'${escapeDriveQuery(current.id)}' in parents and trashed=false`,
      pageSize: Math.min(100, maxFiles - entries.length),
      orderBy: 'folder,name',
      fields: 'files(id,name,mimeType,modifiedTime,webViewLink,parents)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const file of response.data.files ?? []) {
      const entry = toEntry(file);
      if (!entry) continue;
      entries.push(entry);

      if (
        entry.mimeType === FOLDER_MIME_TYPE &&
        current.depth < maxDepth &&
        !seenFolders.has(entry.id)
      ) {
        seenFolders.add(entry.id);
        queue.push({ id: entry.id, depth: current.depth + 1 });
      }

      if (entries.length >= maxFiles) break;
    }
  }

  return { entries, foldersVisited: seenFolders.size };
}

const indexLookupParams = z.strictObject({
  title: z
    .string()
    .optional()
    .default(DEFAULT_DRIVE_INDEX_TITLE)
    .describe('Title of the Drive index Google Doc. Defaults to "Codex Drive Index".'),
  parentFolderId: z
    .string()
    .optional()
    .describe('Optional folder where the index document should be found or created.'),
});

function registerFindOrCreateDriveIndex(server: FastMCP) {
  server.addTool({
    name: 'findOrCreateDriveIndex',
    description:
      'Finds the private Drive index Google Doc by title, or creates it if missing. The index is a lightweight Markdown document used as a navigation cache, not a source of truth.',
    parameters: indexLookupParams,
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      const docs = await getDocsClient();
      log.info(`Finding or creating Drive index "${args.title}"`);

      try {
        const existing = await findIndexDocument(drive, args.title, args.parentFolderId);
        const file = existing ?? (await createIndexDocument(drive, docs, args.title, args.parentFolderId));
        return JSON.stringify(
          {
            id: file.id,
            name: file.name,
            url: file.webViewLink,
            created: !existing,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error finding/creating Drive index: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to find or create Drive index: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

function registerReadDriveIndex(server: FastMCP) {
  server.addTool({
    name: 'readDriveIndex',
    description: 'Reads the Drive index Google Doc as Markdown. Finds it by title if documentId is omitted.',
    parameters: indexLookupParams.extend({
      documentId: z
        .string()
        .optional()
        .describe('Optional explicit index document ID. If omitted, the tool searches by title.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Reading Drive index ${args.documentId || args.title}`);

      try {
        const indexDoc = args.documentId
          ? { id: args.documentId, name: args.title }
          : await findIndexDocument(drive, args.title, args.parentFolderId);
        if (!indexDoc?.id) throw new UserError(`Drive index "${args.title}" was not found.`);
        const markdown = await readIndexMarkdown(drive, indexDoc.id);
        return markdown;
      } catch (error: any) {
        log.error(`Error reading Drive index: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to read Drive index: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

function registerRefreshDriveIndex(server: FastMCP) {
  server.addTool({
    name: 'refreshDriveIndex',
    description:
      'Refreshes the Drive index from live Drive data. Traversal is bounded by maxDepth and maxFiles so it is safe for personal Drive use.',
    parameters: indexLookupParams.extend({
      rootFolderId: z
        .string()
        .optional()
        .default('root')
        .describe('Folder to index from. Use "root" for top-level Drive.'),
      maxDepth: z.number().int().min(0).max(10).optional().default(1),
      maxFiles: z.number().int().min(1).max(1000).optional().default(200),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      const docs = await getDocsClient();
      log.info(`Refreshing Drive index "${args.title}" from folder ${args.rootFolderId}`);

      try {
        const existing =
          (await findIndexDocument(drive, args.title, args.parentFolderId)) ??
          (await createIndexDocument(drive, docs, args.title, args.parentFolderId));
        if (!existing.id) throw new UserError('Drive index has no document ID.');

        const { entries, foldersVisited } = await collectDriveEntries(
          drive,
          args.rootFolderId,
          args.maxDepth,
          args.maxFiles
        );
        const markdown = buildDriveIndexMarkdown(entries, new Date());
        await replaceIndexMarkdown(docs, existing.id, markdown);

        return JSON.stringify(
          {
            id: existing.id,
            name: existing.name,
            url: existing.webViewLink,
            indexedEntries: entries.length,
            foldersVisited,
            rootFolderId: args.rootFolderId,
            maxDepth: args.maxDepth,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error refreshing Drive index: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to refresh Drive index: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

function registerSearchDriveIndex(server: FastMCP) {
  server.addTool({
    name: 'searchDriveIndex',
    description:
      'Searches the Drive index document by text and returns matching table rows. Verify results with live Drive tools before mutating files.',
    parameters: indexLookupParams.extend({
      documentId: z
        .string()
        .optional()
        .describe('Optional explicit index document ID. If omitted, the tool searches by title.'),
      query: z.string().min(1).describe('Text to search in the index.'),
      maxResults: z.number().int().min(1).max(100).optional().default(20),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Searching Drive index for "${args.query}"`);

      try {
        const indexDoc = args.documentId
          ? { id: args.documentId, name: args.title }
          : await findIndexDocument(drive, args.title, args.parentFolderId);
        if (!indexDoc?.id) throw new UserError(`Drive index "${args.title}" was not found.`);
        const markdown = await readIndexMarkdown(drive, indexDoc.id);
        const matches = searchDriveIndexMarkdown(markdown, args.query, args.maxResults);
        return JSON.stringify({ matches, total: matches.length }, null, 2);
      } catch (error: any) {
        log.error(`Error searching Drive index: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to search Drive index: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

function registerUpdateDriveIndexEntry(server: FastMCP) {
  server.addTool({
    name: 'updateDriveIndexEntry',
    description:
      'Updates or appends one file row in the Drive index from live Drive metadata. Use after creating, renaming, moving, or meaningfully editing a file.',
    parameters: indexLookupParams.extend({
      documentId: z
        .string()
        .optional()
        .describe('Optional explicit index document ID. If omitted, the tool searches by title.'),
      fileId: z.string().min(1).describe('Drive file ID to update in the index.'),
      notes: z.string().optional().describe('Optional note to store in the index row.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      const docs = await getDocsClient();
      log.info(`Updating Drive index entry for file ${args.fileId}`);

      try {
        const indexDoc = args.documentId
          ? { id: args.documentId, name: args.title }
          : await findIndexDocument(drive, args.title, args.parentFolderId);
        if (!indexDoc?.id) throw new UserError(`Drive index "${args.title}" was not found.`);

        const fileResponse = await drive.files.get({
          fileId: args.fileId,
          fields: 'id,name,mimeType,modifiedTime,webViewLink,parents',
          supportsAllDrives: true,
        });
        const entry = toEntry(fileResponse.data);
        if (!entry) throw new UserError(`File ${args.fileId} was not found or lacks metadata.`);
        entry.notes = args.notes;

        const markdown = await readIndexMarkdown(drive, indexDoc.id);
        const updated = upsertDriveIndexEntry(markdown, entry);
        await replaceIndexMarkdown(docs, indexDoc.id, updated);

        return JSON.stringify(
          {
            indexDocumentId: indexDoc.id,
            fileId: entry.id,
            name: entry.name,
            section: sectionForMimeType(entry.mimeType),
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error updating Drive index entry: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to update Drive index entry: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

export function registerDriveIndexTools(server: FastMCP) {
  registerFindOrCreateDriveIndex(server);
  registerReadDriveIndex(server);
  registerRefreshDriveIndex(server);
  registerSearchDriveIndex(server);
  registerUpdateDriveIndexEntry(server);
}
