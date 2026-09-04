import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getSlidesClient } from '../../clients.js';

const presentationIdParam = z
  .string()
  .describe('The presentation ID — the long string between /d/ and /edit in a Google Slides URL.');

const objectIdParam = z
  .string()
  .min(5)
  .max(50)
  .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_:-]*$/)
  .describe('Optional object ID. Must be unique and valid for the Slides API.');

const dimensionParam = z
  .number()
  .positive()
  .describe('Size or position in points, the unit used by Google Slides API transforms.');

const shapeTypeSchema = z
  .enum(['TEXT_BOX', 'RECTANGLE', 'ROUND_RECTANGLE', 'ELLIPSE', 'TRIANGLE', 'DIAMOND'])
  .default('TEXT_BOX');

function stringify(data: unknown) {
  return JSON.stringify(data, null, 2);
}

function elementProperties(
  pageObjectId: string,
  x: number,
  y: number,
  width: number,
  height: number
) {
  return {
    pageObjectId,
    size: {
      width: { magnitude: width, unit: 'PT' },
      height: { magnitude: height, unit: 'PT' },
    },
    transform: {
      scaleX: 1,
      scaleY: 1,
      translateX: x,
      translateY: y,
      unit: 'PT',
    },
  };
}

function summarizePresentation(presentation: any) {
  return {
    presentationId: presentation.presentationId,
    title: presentation.title,
    url: presentation.presentationId
      ? `https://docs.google.com/presentation/d/${presentation.presentationId}`
      : undefined,
    revisionId: presentation.revisionId,
    pageSize: presentation.pageSize,
    slideCount: presentation.slides?.length ?? 0,
    slides: (presentation.slides ?? []).map((slide: any, index: number) => ({
      index,
      objectId: slide.objectId,
      pageType: slide.pageType,
      elementCount: slide.pageElements?.length ?? 0,
      speakerNotesObjectId: slide.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId,
    })),
  };
}

export function registerSlidesTools(server: FastMCP) {
  server.addTool({
    name: 'createPresentation',
    description: 'Creates a new Google Slides presentation in the authenticated user’s Drive.',
    parameters: z.strictObject({
      title: z.string().min(1).describe('Presentation title.'),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Creating presentation "${args.title}"`);
      try {
        const response = await slides.presentations.create({
          requestBody: { title: args.title },
        });
        return stringify(summarizePresentation(response.data));
      } catch (error: any) {
        log.error(`Error creating presentation: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to create presentation: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'readPresentation',
    description:
      'Reads Google Slides presentation metadata and slide/page-element structure without exporting visual thumbnails.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Reading presentation ${args.presentationId}`);
      try {
        const response = await slides.presentations.get({
          presentationId: args.presentationId,
        });
        return stringify(summarizePresentation(response.data));
      } catch (error: any) {
        log.error(`Error reading presentation: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to read presentation: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'listSlides',
    description: 'Lists slides in a Google Slides presentation with slide IDs and element counts.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Listing slides for presentation ${args.presentationId}`);
      try {
        const response = await slides.presentations.get({
          presentationId: args.presentationId,
          fields:
            'presentationId,title,slides(objectId,pageType,pageElements(objectId),slideProperties(notesPage(notesProperties(speakerNotesObjectId))))',
        });
        return stringify(summarizePresentation(response.data));
      } catch (error: any) {
        log.error(`Error listing slides: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to list slides: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'createSlide',
    description: 'Creates a new slide, blank by default, optionally at a specific insertion index.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      objectId: objectIdParam.optional(),
      insertionIndex: z.number().int().min(0).optional(),
      predefinedLayout: z
        .enum(['BLANK', 'TITLE', 'TITLE_AND_BODY', 'TITLE_AND_TWO_COLUMNS', 'SECTION_HEADER'])
        .default('BLANK')
        .describe('Predefined Slides layout for the new slide.'),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Creating slide in presentation ${args.presentationId}`);
      try {
        const response = await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [
              {
                createSlide: {
                  objectId: args.objectId,
                  insertionIndex: args.insertionIndex,
                  slideLayoutReference: {
                    predefinedLayout: args.predefinedLayout,
                  },
                },
              },
            ],
          },
        });

        return stringify({
          slide: response.data.replies?.[0]?.createSlide,
        });
      } catch (error: any) {
        log.error(`Error creating slide: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to create slide: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'deleteSlideObject',
    description:
      'Deletes a slide or page element from a Google Slides presentation by exact object ID.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      objectId: z.string().min(1).describe('Exact slide or page-element object ID to delete.'),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Deleting object ${args.objectId} from presentation ${args.presentationId}`);
      try {
        await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [{ deleteObject: { objectId: args.objectId } }],
          },
        });
        return stringify({ deletedObjectId: args.objectId });
      } catch (error: any) {
        log.error(`Error deleting slide object: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete slide object: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'createTextBox',
    description:
      'Creates a shape or text box on a slide and optionally inserts text. Coordinates and size are in points.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      pageObjectId: z.string().min(1).describe('Slide object ID where the text box will be added.'),
      objectId: objectIdParam.optional(),
      text: z.string().optional().describe('Text to insert after creating the shape.'),
      shapeType: shapeTypeSchema,
      x: dimensionParam.default(72),
      y: dimensionParam.default(72),
      width: dimensionParam.default(360),
      height: dimensionParam.default(80),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Creating text box on slide ${args.pageObjectId}`);
      try {
        const objectId = args.objectId ?? `textbox_${Date.now().toString(36)}`;
        const requests: any[] = [
          {
            createShape: {
              objectId,
              shapeType: args.shapeType,
              elementProperties: elementProperties(
                args.pageObjectId,
                args.x,
                args.y,
                args.width,
                args.height
              ),
            },
          },
        ];

        if (args.text) {
          requests.push({
            insertText: {
              objectId,
              insertionIndex: 0,
              text: args.text,
            },
          });
        }

        const response = await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: { requests },
        });

        return stringify({
          objectId,
          createShape: response.data.replies?.[0]?.createShape,
          insertedText: args.text ?? null,
        });
      } catch (error: any) {
        log.error(`Error creating text box: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to create text box: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'createSlideImage',
    description:
      'Adds an image to a slide from a publicly accessible PNG, JPEG, or GIF URL. Google fetches and stores a copy at insertion time.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      pageObjectId: z.string().min(1).describe('Slide object ID where the image will be added.'),
      imageUrl: z.string().url().max(2048).describe('Publicly accessible image URL.'),
      objectId: objectIdParam.optional(),
      x: dimensionParam.default(72),
      y: dimensionParam.default(180),
      width: dimensionParam.default(360),
      height: dimensionParam.default(240),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Creating image on slide ${args.pageObjectId}`);
      try {
        const response = await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [
              {
                createImage: {
                  objectId: args.objectId,
                  url: args.imageUrl,
                  elementProperties: elementProperties(
                    args.pageObjectId,
                    args.x,
                    args.y,
                    args.width,
                    args.height
                  ),
                },
              },
            ],
          },
        });

        return stringify({
          image: response.data.replies?.[0]?.createImage,
        });
      } catch (error: any) {
        log.error(`Error creating slide image: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to create slide image: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
