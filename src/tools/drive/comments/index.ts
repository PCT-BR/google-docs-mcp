import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDriveClient } from '../../../clients.js';

const fileIdParam = z.string().describe('The Google Drive file ID.');
const commentIdParam = z.string().describe('The Drive comment ID.');
const replyIdParam = z.string().describe('The Drive comment reply ID.');

const commentFields =
  'id,content,htmlContent,quotedFileContent,anchor,author(displayName,emailAddress),createdTime,modifiedTime,deleted,resolved,replies(id,content,htmlContent,author(displayName,emailAddress),createdTime,modifiedTime,deleted,action)';

const replyFields =
  'id,content,htmlContent,author(displayName,emailAddress),createdTime,modifiedTime,deleted,action';

function stringify(data: unknown) {
  return JSON.stringify(data, null, 2);
}

function normalizeAnchor(anchor?: string): string | undefined {
  if (!anchor?.trim()) return undefined;
  try {
    JSON.parse(anchor);
    return anchor;
  } catch {
    throw new UserError('anchor must be a valid JSON string when provided.');
  }
}

export function registerDriveCommentTools(server: FastMCP) {
  server.addTool({
    name: 'createFileComment',
    description:
      'Creates a Drive comment on any Drive file. Optional anchor JSON is stored by Drive but may appear unanchored in Google Workspace editors.',
    parameters: z.strictObject({
      fileId: fileIdParam,
      content: z.string().min(1).describe('Plain text comment content.'),
      anchor: z
        .string()
        .optional()
        .describe('Optional Drive anchor JSON string. Editor UIs may not render custom anchors.'),
      quotedText: z.string().optional().describe('Optional quoted file content for context.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Creating Drive comment on file ${args.fileId}`);
      try {
        const response = await drive.comments.create({
          fileId: args.fileId,
          fields: commentFields,
          requestBody: {
            content: args.content,
            anchor: normalizeAnchor(args.anchor),
            ...(args.quotedText
              ? {
                  quotedFileContent: {
                    value: args.quotedText,
                    mimeType: 'text/plain',
                  },
                }
              : {}),
          },
        });
        return stringify(response.data);
      } catch (error: any) {
        log.error(`Error creating Drive comment: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to create file comment: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'listFileComments',
    description:
      'Lists Drive comments for any Drive file. Deleted comments are omitted unless includeDeleted is true.',
    parameters: z.strictObject({
      fileId: fileIdParam,
      includeDeleted: z.boolean().optional().default(false),
      pageSize: z.number().int().min(1).max(100).optional().default(100),
      pageToken: z.string().optional(),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Listing Drive comments for file ${args.fileId}`);
      try {
        const response = await drive.comments.list({
          fileId: args.fileId,
          includeDeleted: args.includeDeleted,
          pageSize: args.pageSize,
          pageToken: args.pageToken,
          fields: `nextPageToken,comments(${commentFields})`,
        });
        return stringify({
          comments: response.data.comments ?? [],
          nextPageToken: response.data.nextPageToken,
        });
      } catch (error: any) {
        log.error(`Error listing Drive comments: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to list file comments: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'getFileComment',
    description: 'Gets one Drive comment, including replies, by exact comment ID.',
    parameters: z.strictObject({
      fileId: fileIdParam,
      commentId: commentIdParam,
      includeDeleted: z.boolean().optional().default(false),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Getting Drive comment ${args.commentId}`);
      try {
        const response = await drive.comments.get({
          fileId: args.fileId,
          commentId: args.commentId,
          includeDeleted: args.includeDeleted,
          fields: commentFields,
        });
        return stringify(response.data);
      } catch (error: any) {
        log.error(`Error getting Drive comment: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to get file comment: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'updateFileComment',
    description: 'Updates the plain text content of a Drive comment by exact comment ID.',
    parameters: z.strictObject({
      fileId: fileIdParam,
      commentId: commentIdParam,
      content: z.string().min(1),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Updating Drive comment ${args.commentId}`);
      try {
        const response = await drive.comments.update({
          fileId: args.fileId,
          commentId: args.commentId,
          fields: commentFields,
          requestBody: { content: args.content },
        });
        return stringify(response.data);
      } catch (error: any) {
        log.error(`Error updating Drive comment: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to update file comment: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'deleteFileComment',
    description: 'Deletes a Drive comment by exact comment ID.',
    parameters: z.strictObject({
      fileId: fileIdParam,
      commentId: commentIdParam,
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Deleting Drive comment ${args.commentId}`);
      try {
        await drive.comments.delete({
          fileId: args.fileId,
          commentId: args.commentId,
        });
        return stringify({ deletedCommentId: args.commentId });
      } catch (error: any) {
        log.error(`Error deleting Drive comment: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete file comment: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'createFileCommentReply',
    description: 'Creates a reply on a Drive comment, or resolves/reopens it via action.',
    parameters: z
      .strictObject({
        fileId: fileIdParam,
        commentId: commentIdParam,
        content: z.string().min(1).optional(),
        action: z.enum(['resolve', 'reopen']).optional(),
      })
      .refine((data) => data.content || data.action, {
        message: 'Provide content or action.',
      }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Creating Drive comment reply on ${args.commentId}`);
      try {
        const response = await drive.replies.create({
          fileId: args.fileId,
          commentId: args.commentId,
          fields: replyFields,
          requestBody: {
            content: args.content,
            action: args.action,
          },
        });
        return stringify(response.data);
      } catch (error: any) {
        log.error(`Error creating Drive reply: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to create file comment reply: ${error.message || 'Unknown error'}`
        );
      }
    },
  });

  server.addTool({
    name: 'updateFileCommentReply',
    description: 'Updates the plain text content of a Drive comment reply by exact reply ID.',
    parameters: z.strictObject({
      fileId: fileIdParam,
      commentId: commentIdParam,
      replyId: replyIdParam,
      content: z.string().min(1),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Updating Drive comment reply ${args.replyId}`);
      try {
        const response = await drive.replies.update({
          fileId: args.fileId,
          commentId: args.commentId,
          replyId: args.replyId,
          fields: replyFields,
          requestBody: { content: args.content },
        });
        return stringify(response.data);
      } catch (error: any) {
        log.error(`Error updating Drive reply: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to update file comment reply: ${error.message || 'Unknown error'}`
        );
      }
    },
  });

  server.addTool({
    name: 'deleteFileCommentReply',
    description: 'Deletes a Drive comment reply by exact reply ID.',
    parameters: z.strictObject({
      fileId: fileIdParam,
      commentId: commentIdParam,
      replyId: replyIdParam,
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Deleting Drive comment reply ${args.replyId}`);
      try {
        await drive.replies.delete({
          fileId: args.fileId,
          commentId: args.commentId,
          replyId: args.replyId,
        });
        return stringify({ deletedReplyId: args.replyId });
      } catch (error: any) {
        log.error(`Error deleting Drive reply: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to delete file comment reply: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
