import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDriveClient } from '../../clients.js';
import { escapeDriveQuery } from '../../driveQueryUtils.js';

/**
 * Convenience shortcuts for common MIME types.
 * Users can also pass any full MIME type string directly.
 */
const MIME_TYPE_SHORTCUTS: Record<string, string> = {
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
  folder: 'application/vnd.google-apps.folder',
  form: 'application/vnd.google-apps.form',
  pdf: 'application/pdf',
  zip: 'application/zip',
};

export type SearchIn = 'name' | 'content' | 'both';
export type DriveSearchOrderBy = 'name' | 'modifiedTime' | 'createdTime';
export type SortDirection = 'asc' | 'desc';

type DriveFile = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  size?: string | null;
  modifiedTime?: string | null;
  createdTime?: string | null;
  webViewLink?: string | null;
  owners?: Array<{ displayName?: string | null; emailAddress?: string | null }> | null;
  parents?: string[] | null;
};

export function resolveDriveMimeType(mimeType?: string): string | undefined {
  if (!mimeType) return undefined;
  return MIME_TYPE_SHORTCUTS[mimeType] ?? mimeType;
}

export function buildDriveSearchQuery(args: {
  query: string;
  searchIn: SearchIn;
  mimeType?: string;
  folderId?: string;
  modifiedAfter?: string;
}) {
  const conditions: string[] = ['trashed=false'];
  const escapedQuery = escapeDriveQuery(args.query);

  if (args.searchIn === 'name') {
    conditions.push(`name contains '${escapedQuery}'`);
  } else if (args.searchIn === 'content') {
    conditions.push(`fullText contains '${escapedQuery}'`);
  } else {
    conditions.push(`(name contains '${escapedQuery}' or fullText contains '${escapedQuery}')`);
  }

  const resolvedMimeType = resolveDriveMimeType(args.mimeType);
  if (resolvedMimeType) {
    conditions.push(`mimeType='${escapeDriveQuery(resolvedMimeType)}'`);
  }

  if (args.folderId) {
    conditions.push(`'${escapeDriveQuery(args.folderId)}' in parents`);
  }

  if (args.modifiedAfter) {
    const cutoff = new Date(args.modifiedAfter).toISOString();
    conditions.push(`modifiedTime > '${escapeDriveQuery(cutoff)}'`);
  }

  return conditions.join(' and ');
}

function mapDriveFile(file: DriveFile) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size != null ? Number(file.size) : null,
    modifiedTime: file.modifiedTime,
    createdTime: file.createdTime,
    owner: file.owners?.[0]?.displayName || null,
    url: file.webViewLink,
  };
}

function compareValues(a: unknown, b: unknown, direction: SortDirection) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  const result = left.localeCompare(right);
  return direction === 'desc' ? -result : result;
}

async function collectFolderIds(
  drive: any,
  rootFolderId: string,
  maxDepth: number,
  maxFolders: number
) {
  const folderIds = [rootFolderId];
  const queue: Array<{ id: string; depth: number }> = [{ id: rootFolderId, depth: 0 }];
  const seen = new Set([rootFolderId]);

  while (queue.length > 0 && folderIds.length < maxFolders) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    const response = await drive.files.list({
      q:
        `'${escapeDriveQuery(current.id)}' in parents and trashed=false and ` +
        "mimeType='application/vnd.google-apps.folder'",
      pageSize: Math.min(100, maxFolders - folderIds.length),
      fields: 'files(id,name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const folder of response.data.files || []) {
      if (!folder.id || seen.has(folder.id)) continue;
      seen.add(folder.id);
      folderIds.push(folder.id);
      queue.push({ id: folder.id, depth: current.depth + 1 });
      if (folderIds.length >= maxFolders) break;
    }
  }

  return folderIds;
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'searchDriveFiles',
    description:
      'Searches across all file types in Google Drive by name or content. ' +
      'Unlike searchDocuments (which only searches Google Docs), this tool finds Sheets, PDFs, ' +
      'presentations, folders, and any other Drive file. Supports filtering by MIME type, ' +
      'scoping to a specific direct folder or bounded recursive folder traversal, controllable sort order, and pagination via pageToken.',
    parameters: z.strictObject({
      query: z.string().min(1).describe('Search term to find in file names or content.'),
      searchIn: z
        .enum(['name', 'content', 'both'])
        .optional()
        .default('both')
        .describe(
          'Where to search: "name" matches file titles only, "content" searches inside files, ' +
            '"both" searches names and content (default).'
        ),
      mimeType: z
        .string()
        .optional()
        .describe(
          'Restrict search to a specific file type. ' +
            'Shortcuts: "document", "spreadsheet", "presentation", "folder", "form", "pdf", "zip". ' +
            'Or pass a full MIME type string.'
        ),
      folderId: z
        .string()
        .optional()
        .describe(
          'Restrict search to files directly inside this folder. Use "root" for the top-level Drive. ' +
            'Set recursive=true to search bounded descendants too. Omit to search all of Drive.'
        ),
      recursive: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'When folderId is provided, search the folder and bounded descendant folders by traversing them explicitly.'
        ),
      maxDepth: z
        .number()
        .int()
        .min(0)
        .max(10)
        .optional()
        .default(3)
        .describe('Maximum descendant folder depth for recursive folder searches.'),
      maxFolders: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(100)
        .describe('Maximum folders to inspect during recursive folder searches.'),
      orderBy: z
        .enum(['name', 'modifiedTime', 'createdTime'])
        .optional()
        .default('modifiedTime')
        .describe('Field to sort results by.'),
      sortDirection: z
        .enum(['asc', 'desc'])
        .optional()
        .default('desc')
        .describe('Sort direction: "asc" for oldest first, "desc" for newest first (default).'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(10)
        .describe('Maximum number of results to return per page (1-100).'),
      modifiedAfter: z
        .string()
        .optional()
        .describe(
          'Only return files modified after this date (ISO 8601 format, e.g. "2024-01-01").'
        ),
      pageToken: z
        .string()
        .optional()
        .describe(
          'Pagination token from a previous non-recursive searchDriveFiles response. ' +
            'Pass this to retrieve the next page of results.'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(
        `Searching Drive files for: "${args.query}" in ${args.searchIn}, ` +
          `mimeType=${args.mimeType || 'any'}, folder=${args.folderId || 'all'}, ` +
          `orderBy=${args.orderBy} ${args.sortDirection}`
      );

      try {
        const orderByParam = args.sortDirection === 'desc' ? `${args.orderBy} desc` : args.orderBy;
        // Drive rejects `orderBy` when `q` contains a `fullText` clause
        // ("Sorting is not supported for queries with fullText terms") —
        // only the "name" search mode avoids fullText.
        const includesFullText = args.searchIn !== 'name';

        if (args.recursive && !args.folderId) {
          throw new UserError('recursive=true requires folderId.');
        }

        if (args.recursive && args.pageToken) {
          throw new UserError('pageToken is not supported for recursive searches.');
        }

        if (args.recursive && args.folderId) {
          const folderIds = await collectFolderIds(
            drive,
            args.folderId,
            args.maxDepth,
            args.maxFolders
          );
          const collected: ReturnType<typeof mapDriveFile>[] = [];

          for (const folderId of folderIds) {
            if (collected.length >= args.maxResults) break;
            const queryString = buildDriveSearchQuery({
              query: args.query,
              searchIn: args.searchIn,
              mimeType: args.mimeType,
              folderId,
              modifiedAfter: args.modifiedAfter,
            });
            const response = await drive.files.list({
              q: queryString,
              pageSize: Math.min(100, args.maxResults - collected.length),
              ...(includesFullText ? {} : { orderBy: orderByParam }),
              fields:
                'files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink,owners(displayName,emailAddress),parents)',
              supportsAllDrives: true,
              includeItemsFromAllDrives: true,
            });
            collected.push(...(response.data.files || []).map(mapDriveFile));
          }

          const files = collected
            .sort((a, b) => compareValues(a[args.orderBy], b[args.orderBy], args.sortDirection))
            .slice(0, args.maxResults);

          return JSON.stringify(
            {
              files,
              total: files.length,
              recursive: true,
              foldersSearched: folderIds.length,
              hasMore: collected.length > args.maxResults,
            },
            null,
            2
          );
        }

        const queryString = buildDriveSearchQuery({
          query: args.query,
          searchIn: args.searchIn,
          mimeType: args.mimeType,
          folderId: args.folderId,
          modifiedAfter: args.modifiedAfter,
        });

        const response = await drive.files.list({
          q: queryString,
          pageSize: args.maxResults,
          ...(includesFullText ? {} : { orderBy: orderByParam }),
          pageToken: args.pageToken,
          fields:
            'nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink,owners(displayName,emailAddress),parents)',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });

        const files = (response.data.files || []).map(mapDriveFile);

        const result: Record<string, unknown> = { files, total: files.length };
        if (response.data.nextPageToken) {
          result.nextPageToken = response.data.nextPageToken;
          result.hasMore = true;
        } else {
          result.hasMore = false;
        }

        return JSON.stringify(result, null, 2);
      } catch (error: any) {
        log.error(`Error searching Drive files: ${error.message || error}`);
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure you have granted Google Drive access to the application.'
          );
        throw new UserError(`Failed to search files: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
