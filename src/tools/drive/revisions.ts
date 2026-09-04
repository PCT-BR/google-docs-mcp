import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getAuthClient, getDriveClient } from '../../clients.js';
import { EXPORT_MIME_TO_EXTENSION, isTextMimeType } from './downloadFile.js';

const fileIdParam = z.string().describe('The Google Drive file ID.');
const revisionIdParam = z.string().describe('The revision ID from listFileRevisions.');

const revisionFields =
  'id,mimeType,modifiedTime,keepForever,published,publishedOutsideDomain,publishAuto,lastModifyingUser(displayName,emailAddress),originalFilename,size,exportLinks';

function stringify(data: unknown) {
  return JSON.stringify(data, null, 2);
}

function isWorkspaceMimeType(mime?: string | null): boolean {
  return Boolean(mime?.startsWith('application/vnd.google-apps.'));
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'listFileRevisions',
    description:
      'Lists Drive revisions for a file. Google may omit older revisions for heavily edited Docs, Sheets, and Slides.',
    parameters: z.strictObject({
      fileId: fileIdParam,
      pageSize: z.number().int().min(1).max(200).optional().default(100),
      pageToken: z.string().optional(),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Listing revisions for file ${args.fileId}`);
      try {
        const response = await drive.revisions.list({
          fileId: args.fileId,
          pageSize: args.pageSize,
          pageToken: args.pageToken,
          fields: `nextPageToken,revisions(${revisionFields})`,
        });

        return stringify({
          revisions: response.data.revisions ?? [],
          nextPageToken: response.data.nextPageToken,
          limitation:
            'For large Google Workspace revision histories, the Drive API may omit older revisions.',
        });
      } catch (error: any) {
        log.error(`Error listing revisions: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to list revisions: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'getFileRevision',
    description: 'Gets metadata for a Drive file revision, including export links when available.',
    parameters: z.strictObject({
      fileId: fileIdParam,
      revisionId: revisionIdParam,
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Getting revision ${args.revisionId} for file ${args.fileId}`);
      try {
        const response = await drive.revisions.get({
          fileId: args.fileId,
          revisionId: args.revisionId,
          fields: revisionFields,
        });
        return stringify(response.data);
      } catch (error: any) {
        log.error(`Error getting revision: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to get revision: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'exportFileRevision',
    description:
      'Exports or downloads a Drive file revision inline. Google Workspace revisions use revision exportLinks; binary revisions use media download.',
    parameters: z.strictObject({
      fileId: fileIdParam,
      revisionId: revisionIdParam,
      mimeType: z
        .string()
        .optional()
        .describe(
          'Required for Google Workspace revisions, e.g. "text/plain" or "application/pdf".'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      const auth = await getAuthClient();
      log.info(`Exporting revision ${args.revisionId} for file ${args.fileId}`);
      try {
        const revision = await drive.revisions.get({
          fileId: args.fileId,
          revisionId: args.revisionId,
          fields: revisionFields,
        });
        const revisionMime = revision.data.mimeType ?? undefined;
        const exportMime = args.mimeType ?? revisionMime ?? 'application/octet-stream';
        let buffer: Buffer;

        if (isWorkspaceMimeType(revisionMime)) {
          if (!args.mimeType) {
            throw new UserError(
              'mimeType is required when exporting a Google Workspace revision. Use getFileRevision to inspect exportLinks.'
            );
          }
          const exportUrl = revision.data.exportLinks?.[args.mimeType];
          if (!exportUrl) {
            throw new UserError(
              `Revision cannot be exported as "${args.mimeType}". Available export MIME types: ${Object.keys(revision.data.exportLinks ?? {}).join(', ')}`
            );
          }
          const response = await auth.request<ArrayBuffer>({
            url: exportUrl,
            responseType: 'arraybuffer',
          });
          buffer = Buffer.from(response.data);
        } else {
          const response = await drive.revisions.get(
            {
              fileId: args.fileId,
              revisionId: args.revisionId,
              alt: 'media',
            },
            { responseType: 'arraybuffer' }
          );
          buffer = Buffer.from(response.data as ArrayBuffer);
        }

        const fileName = `revision-${args.revisionId}${EXPORT_MIME_TO_EXTENSION[exportMime] ?? ''}`;
        if (isTextMimeType(exportMime)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: buffer.toString('utf-8'),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'resource' as const,
              resource: {
                uri: `gdrive-revision:///${args.fileId}/${args.revisionId}/${fileName}`,
                blob: buffer.toString('base64'),
                mimeType: exportMime,
              },
            },
            {
              type: 'text' as const,
              text: stringify({
                fileName,
                mimeType: exportMime,
                sizeBytes: buffer.length,
              }),
            },
          ],
        };
      } catch (error: any) {
        log.error(`Error exporting revision: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to export revision: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'updateFileRevision',
    description:
      'Updates mutable Drive revision metadata such as keepForever for binary files and publish settings for eligible Workspace files.',
    parameters: z
      .strictObject({
        fileId: fileIdParam,
        revisionId: revisionIdParam,
        keepForever: z.boolean().optional(),
        published: z.boolean().optional(),
        publishAuto: z.boolean().optional(),
      })
      .refine(
        (data) =>
          data.keepForever !== undefined ||
          data.published !== undefined ||
          data.publishAuto !== undefined,
        { message: 'At least one update field must be provided.' }
      ),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Updating revision ${args.revisionId} for file ${args.fileId}`);
      try {
        const requestBody = {
          keepForever: args.keepForever,
          published: args.published,
          publishAuto: args.publishAuto,
        };
        const response = await drive.revisions.update({
          fileId: args.fileId,
          revisionId: args.revisionId,
          requestBody,
          fields: revisionFields,
        });
        return stringify(response.data);
      } catch (error: any) {
        log.error(`Error updating revision: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to update revision: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'deleteFileRevision',
    description:
      'Permanently deletes an eligible binary Drive revision. Google Workspace editor revisions cannot be deleted through the API.',
    parameters: z.strictObject({
      fileId: fileIdParam,
      revisionId: revisionIdParam,
      confirmPermanent: z
        .boolean()
        .describe('Must be true. Revision deletion is permanent and cannot be undone.'),
    }),
    execute: async (args, { log }) => {
      if (!args.confirmPermanent) {
        throw new UserError('Set confirmPermanent=true to permanently delete a file revision.');
      }
      const drive = await getDriveClient();
      log.info(`Deleting revision ${args.revisionId} for file ${args.fileId}`);
      try {
        const revision = await drive.revisions.get({
          fileId: args.fileId,
          revisionId: args.revisionId,
          fields: 'id,mimeType',
        });
        if (isWorkspaceMimeType(revision.data.mimeType)) {
          throw new UserError(
            'Google Workspace editor revisions cannot be deleted through the Drive API.'
          );
        }

        await drive.revisions.delete({
          fileId: args.fileId,
          revisionId: args.revisionId,
        });
        return stringify({ deletedRevisionId: args.revisionId });
      } catch (error: any) {
        log.error(`Error deleting revision: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete revision: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
