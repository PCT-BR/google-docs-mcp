import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient, getDriveClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

function stringify(data: unknown) {
  return JSON.stringify(data, null, 2);
}

function collectInlinePlacements(content: any[] = [], placements = new Map<string, any[]>()) {
  for (const structuralElement of content) {
    const paragraph = structuralElement.paragraph;
    if (paragraph?.elements) {
      for (const element of paragraph.elements) {
        const inlineObjectId = element.inlineObjectElement?.inlineObjectId;
        if (!inlineObjectId) continue;
        const existing = placements.get(inlineObjectId) ?? [];
        existing.push({
          startIndex: element.startIndex,
          endIndex: element.endIndex,
          suggestedInsertionIds: element.inlineObjectElement.suggestedInsertionIds,
          suggestedDeletionIds: element.inlineObjectElement.suggestedDeletionIds,
        });
        placements.set(inlineObjectId, existing);
      }
    }

    if (structuralElement.table?.tableRows) {
      for (const row of structuralElement.table.tableRows) {
        for (const cell of row.tableCells ?? []) {
          collectInlinePlacements(cell.content ?? [], placements);
        }
      }
    }
  }
  return placements;
}

function summarizeEmbeddedObject(object: any) {
  const embedded =
    object.inlineObjectProperties?.embeddedObject ??
    object.positionedObjectProperties?.embeddedObject;
  const image = embedded?.imageProperties;
  return {
    objectId: object.objectId,
    title: embedded?.title,
    description: embedded?.description,
    size: embedded?.size,
    sourceUri: image?.sourceUri,
    contentUri: image?.contentUri,
    cropProperties: image?.cropProperties,
  };
}

async function resolveImageUrl(args: {
  documentId: string;
  imageUrl?: string;
  localImagePath?: string;
}) {
  if (args.imageUrl) return args.imageUrl;
  if (!args.localImagePath) {
    throw new UserError('Either imageUrl or localImagePath must be provided.');
  }

  const drive = await getDriveClient();
  let parentFolderId: string | undefined;
  try {
    const docInfo = await drive.files.get({
      fileId: args.documentId,
      fields: 'parents',
      supportsAllDrives: true,
    });
    parentFolderId = docInfo.data.parents?.[0];
  } catch {
    parentFolderId = undefined;
  }

  return GDocsHelpers.uploadImageToDrive(drive, args.localImagePath, parentFolderId, false);
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'listDocumentImages',
    description:
      'Lists inline and positioned images in a Google Doc, including object IDs needed for replacement or deletion.',
    parameters: DocumentIdParameter.extend({
      tabId: z.string().optional().describe('Optional document tab ID to inspect.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Listing images in document ${args.documentId}`);
      try {
        const response = await docs.documents.get({
          documentId: args.documentId,
          includeTabsContent: Boolean(args.tabId),
          fields:
            'documentId,title,body(content),inlineObjects,positionedObjects,tabs(tabProperties(tabId,title),documentTab(body(content),inlineObjects,positionedObjects))',
        });

        const sources = args.tabId
          ? (response.data.tabs ?? [])
              .filter((tab) => tab.tabProperties?.tabId === args.tabId)
              .map((tab) => ({
                tabId: tab.tabProperties?.tabId,
                tabTitle: tab.tabProperties?.title,
                body: tab.documentTab?.body,
                inlineObjects: tab.documentTab?.inlineObjects ?? {},
                positionedObjects: tab.documentTab?.positionedObjects ?? {},
              }))
          : [
              {
                tabId: undefined,
                tabTitle: undefined,
                body: response.data.body,
                inlineObjects: response.data.inlineObjects ?? {},
                positionedObjects: response.data.positionedObjects ?? {},
              },
              ...(response.data.tabs ?? []).map((tab) => ({
                tabId: tab.tabProperties?.tabId,
                tabTitle: tab.tabProperties?.title,
                body: tab.documentTab?.body,
                inlineObjects: tab.documentTab?.inlineObjects ?? {},
                positionedObjects: tab.documentTab?.positionedObjects ?? {},
              })),
            ];

        if (args.tabId && sources.length === 0) {
          throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
        }

        const images = sources.flatMap((source) => {
          const placements = collectInlinePlacements(source.body?.content ?? []);
          const inlineImages = Object.values(source.inlineObjects).map((object: any) => ({
            kind: 'inline',
            tabId: source.tabId,
            tabTitle: source.tabTitle,
            placements: placements.get(object.objectId) ?? [],
            ...summarizeEmbeddedObject(object),
          }));
          const positionedImages = Object.values(source.positionedObjects).map((object: any) => ({
            kind: 'positioned',
            tabId: source.tabId,
            tabTitle: source.tabTitle,
            positioning: object.positionedObjectProperties?.positioning,
            ...summarizeEmbeddedObject(object),
          }));
          return [...inlineImages, ...positionedImages];
        });

        return stringify({
          documentId: response.data.documentId,
          title: response.data.title,
          images,
        });
      } catch (error: any) {
        log.error(`Error listing document images: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to list document images: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'replaceDocumentImage',
    description:
      'Replaces an existing inline or positioned image by exact image object ID. Use listDocumentImages first to get the object ID.',
    parameters: DocumentIdParameter.extend({
      imageObjectId: z.string().min(1).describe('Exact image object ID to replace.'),
      imageUrl: z.string().url().optional().describe('Publicly accessible replacement image URL.'),
      localImagePath: z
        .string()
        .optional()
        .describe('Absolute local image path to upload to Drive and use as replacement.'),
      imageReplaceMethod: z
        .enum(['CENTER_CROP', 'IMAGE_REPLACE_METHOD_UNSPECIFIED'])
        .optional()
        .default('CENTER_CROP'),
      tabId: z.string().optional().describe('Optional tab ID containing the image.'),
    })
      .refine((data) => data.imageUrl || data.localImagePath, {
        message: 'Either imageUrl or localImagePath must be provided.',
      })
      .refine((data) => !(data.imageUrl && data.localImagePath), {
        message: 'Provide only one of imageUrl or localImagePath, not both.',
      }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Replacing image ${args.imageObjectId} in document ${args.documentId}`);
      try {
        const uri = await resolveImageUrl(args);
        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [
              {
                replaceImage: {
                  imageObjectId: args.imageObjectId,
                  uri,
                  imageReplaceMethod: args.imageReplaceMethod,
                  tabId: args.tabId,
                },
              },
            ],
          },
        });

        return stringify({
          replacedImageObjectId: args.imageObjectId,
          imageReplaceMethod: args.imageReplaceMethod,
          tabId: args.tabId,
        });
      } catch (error: any) {
        log.error(`Error replacing document image: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to replace document image: ${error.message || 'Unknown error'}`
        );
      }
    },
  });

  server.addTool({
    name: 'deletePositionedObject',
    description:
      'Deletes a positioned object from a Google Doc by exact object ID. This is for positioned objects only, not inline images.',
    parameters: DocumentIdParameter.extend({
      objectId: z.string().min(1).describe('Exact positioned object ID to delete.'),
      tabId: z.string().optional().describe('Optional tab ID containing the positioned object.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(`Deleting positioned object ${args.objectId} in document ${args.documentId}`);
      try {
        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [
              {
                deletePositionedObject: {
                  objectId: args.objectId,
                  tabId: args.tabId,
                },
              },
            ],
          },
        });

        return stringify({
          deletedPositionedObjectId: args.objectId,
          tabId: args.tabId,
        });
      } catch (error: any) {
        log.error(`Error deleting positioned object: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to delete positioned object: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
