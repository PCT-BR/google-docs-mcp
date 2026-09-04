import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getSlidesClient } from '../../clients.js';
import { syncDriveIndexFile } from '../drive/driveIndex.js';

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

const cellLocationSchema = z
  .strictObject({
    rowIndex: z.number().int().min(0),
    columnIndex: z.number().int().min(0),
  })
  .describe('Optional table cell location when editing text inside a table cell.');

const textRangeSchema = z
  .strictObject({
    type: z.enum(['ALL', 'FROM_START_INDEX', 'FIXED_RANGE']).optional().default('ALL'),
    startIndex: z.number().int().min(0).optional(),
    endIndex: z.number().int().min(0).optional(),
  })
  .optional()
  .describe('Text range inside the object. Use ALL for the whole shape/table cell.');

const hexColorSchema = z
  .string()
  .regex(/^#?[0-9a-fA-F]{6}$/)
  .describe('RGB hex color, for example #1a73e8.');

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

function buildTextRange(range?: { type?: string; startIndex?: number; endIndex?: number }) {
  if (!range) return { type: 'ALL' };
  if (range.type === 'FIXED_RANGE') {
    if (typeof range.startIndex !== 'number' || typeof range.endIndex !== 'number') {
      throw new UserError('FIXED_RANGE requires both startIndex and endIndex.');
    }
    return { type: 'FIXED_RANGE', startIndex: range.startIndex, endIndex: range.endIndex };
  }
  if (range.type === 'FROM_START_INDEX') {
    if (typeof range.startIndex !== 'number') {
      throw new UserError('FROM_START_INDEX requires startIndex.');
    }
    return { type: 'FROM_START_INDEX', startIndex: range.startIndex };
  }
  return { type: 'ALL' };
}

function rgbColor(hex: string) {
  const normalized = hex.replace(/^#/, '');
  return {
    red: parseInt(normalized.slice(0, 2), 16) / 255,
    green: parseInt(normalized.slice(2, 4), 16) / 255,
    blue: parseInt(normalized.slice(4, 6), 16) / 255,
  };
}

function fieldList(fields: Record<string, unknown>) {
  return Object.entries(fields)
    .filter(([, value]) => typeof value !== 'undefined')
    .map(([field]) => field)
    .join(',');
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
        return stringify({
          ...summarizePresentation(response.data),
          indexSync: await syncDriveIndexFile(response.data.presentationId),
        });
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
    name: 'getSlide',
    description:
      'Reads one Google Slides page by slide object ID, including page elements and speaker notes metadata.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      pageObjectId: z.string().min(1).describe('Slide object ID to read.'),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Reading slide ${args.pageObjectId}`);
      try {
        const response = await slides.presentations.pages.get({
          presentationId: args.presentationId,
          pageObjectId: args.pageObjectId,
        });
        return stringify(response.data);
      } catch (error: any) {
        log.error(`Error reading slide: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to read slide: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'getSlideThumbnail',
    description:
      'Gets a temporary thumbnail URL for one slide. The URL is account-scoped and normally valid for about 30 minutes.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      pageObjectId: z.string().min(1).describe('Slide object ID to render as a thumbnail.'),
      mimeType: z.enum(['PNG', 'JPEG']).optional().default('PNG'),
      thumbnailSize: z.enum(['SMALL', 'MEDIUM', 'LARGE']).optional().default('LARGE'),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Getting thumbnail for slide ${args.pageObjectId}`);
      try {
        const response = await slides.presentations.pages.getThumbnail({
          presentationId: args.presentationId,
          pageObjectId: args.pageObjectId,
          'thumbnailProperties.mimeType': args.mimeType,
          'thumbnailProperties.thumbnailSize': args.thumbnailSize,
        });
        return stringify(response.data);
      } catch (error: any) {
        log.error(`Error getting slide thumbnail: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to get slide thumbnail: ${error.message || 'Unknown error'}`);
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
    name: 'insertSlideText',
    description:
      'Inserts text into a Slides shape or table cell at a text insertion index. Use object IDs from readPresentation/getSlide.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      objectId: z.string().min(1).describe('Shape, text box, or table object ID.'),
      text: z.string().min(1).describe('Text to insert.'),
      insertionIndex: z.number().int().min(0).optional().default(0),
      cellLocation: cellLocationSchema.optional(),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Inserting text into ${args.objectId}`);
      try {
        await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [
              {
                insertText: {
                  objectId: args.objectId,
                  insertionIndex: args.insertionIndex,
                  text: args.text,
                  ...(args.cellLocation ? { cellLocation: args.cellLocation } : {}),
                },
              },
            ],
          },
        });
        return stringify({
          objectId: args.objectId,
          insertedCharacters: args.text.length,
          insertionIndex: args.insertionIndex,
        });
      } catch (error: any) {
        log.error(`Error inserting slide text: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to insert slide text: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'replaceAllSlideText',
    description:
      'Replaces all matching text in a presentation, or only within selected slide page IDs.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      containsText: z.string().min(1).describe('Text to find.'),
      replaceText: z.string().describe('Replacement text. Use an empty string to remove matches.'),
      matchCase: z.boolean().optional().default(false),
      pageObjectIds: z
        .array(z.string().min(1))
        .optional()
        .describe('Optional slide page object IDs to limit replacement scope.'),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Replacing slide text "${args.containsText}"`);
      try {
        const response = await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [
              {
                replaceAllText: {
                  containsText: {
                    text: args.containsText,
                    matchCase: args.matchCase,
                  },
                  replaceText: args.replaceText,
                  ...(args.pageObjectIds ? { pageObjectIds: args.pageObjectIds } : {}),
                },
              },
            ],
          },
        });
        return stringify({
          occurrencesChanged: response.data.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0,
        });
      } catch (error: any) {
        log.error(`Error replacing slide text: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to replace slide text: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'deleteSlideText',
    description: 'Deletes text from a Slides shape or table cell. Defaults to all text.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      objectId: z.string().min(1).describe('Shape, text box, or table object ID.'),
      textRange: textRangeSchema,
      cellLocation: cellLocationSchema.optional(),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Deleting text from ${args.objectId}`);
      try {
        await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [
              {
                deleteText: {
                  objectId: args.objectId,
                  textRange: buildTextRange(args.textRange),
                  ...(args.cellLocation ? { cellLocation: args.cellLocation } : {}),
                },
              },
            ],
          },
        });
        return stringify({
          objectId: args.objectId,
          deletedTextRange: buildTextRange(args.textRange),
        });
      } catch (error: any) {
        log.error(`Error deleting slide text: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete slide text: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'updateSlideTextStyle',
    description:
      'Updates text styling in a Slides shape or table cell. Only provided style fields are changed.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      objectId: z.string().min(1).describe('Shape, text box, or table object ID.'),
      textRange: textRangeSchema,
      cellLocation: cellLocationSchema.optional(),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      underline: z.boolean().optional(),
      strikethrough: z.boolean().optional(),
      fontFamily: z.string().min(1).optional(),
      fontSize: z.number().positive().optional().describe('Font size in points.'),
      foregroundColor: hexColorSchema.optional(),
      backgroundColor: hexColorSchema.optional(),
      linkUrl: z.string().url().optional(),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Updating text style on ${args.objectId}`);
      try {
        const style: Record<string, unknown> = {
          bold: args.bold,
          italic: args.italic,
          underline: args.underline,
          strikethrough: args.strikethrough,
          fontFamily: args.fontFamily,
          fontSize: args.fontSize
            ? {
                magnitude: args.fontSize,
                unit: 'PT',
              }
            : undefined,
          foregroundColor: args.foregroundColor
            ? { opaqueColor: { rgbColor: rgbColor(args.foregroundColor) } }
            : undefined,
          backgroundColor: args.backgroundColor
            ? { opaqueColor: { rgbColor: rgbColor(args.backgroundColor) } }
            : undefined,
          link: args.linkUrl ? { url: args.linkUrl } : undefined,
        };
        const fields = fieldList(style);
        if (!fields) throw new UserError('At least one text style field must be provided.');

        await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [
              {
                updateTextStyle: {
                  objectId: args.objectId,
                  textRange: buildTextRange(args.textRange),
                  style,
                  fields,
                  ...(args.cellLocation ? { cellLocation: args.cellLocation } : {}),
                },
              },
            ],
          },
        });
        return stringify({ objectId: args.objectId, fields: fields.split(',') });
      } catch (error: any) {
        log.error(`Error updating slide text style: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to update slide text style: ${error.message || 'Unknown error'}`
        );
      }
    },
  });

  server.addTool({
    name: 'updateSlideParagraphStyle',
    description:
      'Updates paragraph style in a Slides shape or table cell. Only provided style fields are changed.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      objectId: z.string().min(1).describe('Shape, text box, or table object ID.'),
      textRange: textRangeSchema,
      cellLocation: cellLocationSchema.optional(),
      alignment: z.enum(['START', 'CENTER', 'END', 'JUSTIFIED']).optional(),
      lineSpacing: z.number().positive().optional().describe('Line spacing percentage.'),
      spaceAbove: z.number().min(0).optional().describe('Space above paragraph in points.'),
      spaceBelow: z.number().min(0).optional().describe('Space below paragraph in points.'),
      indentStart: z.number().min(0).optional().describe('Start indent in points.'),
      indentEnd: z.number().min(0).optional().describe('End indent in points.'),
      indentFirstLine: z.number().optional().describe('First-line indent in points.'),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Updating paragraph style on ${args.objectId}`);
      try {
        const style: Record<string, unknown> = {
          alignment: args.alignment,
          lineSpacing: args.lineSpacing,
          spaceAbove:
            typeof args.spaceAbove === 'number'
              ? { magnitude: args.spaceAbove, unit: 'PT' }
              : undefined,
          spaceBelow:
            typeof args.spaceBelow === 'number'
              ? { magnitude: args.spaceBelow, unit: 'PT' }
              : undefined,
          indentStart:
            typeof args.indentStart === 'number'
              ? { magnitude: args.indentStart, unit: 'PT' }
              : undefined,
          indentEnd:
            typeof args.indentEnd === 'number'
              ? { magnitude: args.indentEnd, unit: 'PT' }
              : undefined,
          indentFirstLine:
            typeof args.indentFirstLine === 'number'
              ? { magnitude: args.indentFirstLine, unit: 'PT' }
              : undefined,
        };
        const fields = fieldList(style);
        if (!fields) throw new UserError('At least one paragraph style field must be provided.');

        await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [
              {
                updateParagraphStyle: {
                  objectId: args.objectId,
                  textRange: buildTextRange(args.textRange),
                  style,
                  fields,
                  ...(args.cellLocation ? { cellLocation: args.cellLocation } : {}),
                },
              },
            ],
          },
        });
        return stringify({ objectId: args.objectId, fields: fields.split(',') });
      } catch (error: any) {
        log.error(`Error updating slide paragraph style: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to update slide paragraph style: ${error.message || 'Unknown error'}`
        );
      }
    },
  });

  server.addTool({
    name: 'createSlideBullets',
    description: 'Creates bullets for paragraphs in a Slides shape or table cell.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      objectId: z.string().min(1).describe('Shape, text box, or table object ID.'),
      textRange: textRangeSchema,
      cellLocation: cellLocationSchema.optional(),
      bulletPreset: z
        .enum([
          'BULLET_DISC_CIRCLE_SQUARE',
          'BULLET_DIAMONDX_ARROW3D_SQUARE',
          'BULLET_CHECKBOX',
          'NUMBERED_DIGIT_ALPHA_ROMAN',
          'NUMBERED_DIGIT_ALPHA_ROMAN_PARENS',
          'NUMBERED_DIGIT_NESTED',
        ])
        .optional()
        .default('BULLET_DISC_CIRCLE_SQUARE'),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Creating bullets in ${args.objectId}`);
      try {
        await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [
              {
                createParagraphBullets: {
                  objectId: args.objectId,
                  textRange: buildTextRange(args.textRange),
                  bulletPreset: args.bulletPreset,
                  ...(args.cellLocation ? { cellLocation: args.cellLocation } : {}),
                },
              },
            ],
          },
        });
        return stringify({ objectId: args.objectId, bulletPreset: args.bulletPreset });
      } catch (error: any) {
        log.error(`Error creating slide bullets: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to create slide bullets: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'deleteSlideBullets',
    description: 'Removes bullets from paragraphs in a Slides shape or table cell.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      objectId: z.string().min(1).describe('Shape, text box, or table object ID.'),
      textRange: textRangeSchema,
      cellLocation: cellLocationSchema.optional(),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Deleting bullets in ${args.objectId}`);
      try {
        await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [
              {
                deleteParagraphBullets: {
                  objectId: args.objectId,
                  textRange: buildTextRange(args.textRange),
                  ...(args.cellLocation ? { cellLocation: args.cellLocation } : {}),
                },
              },
            ],
          },
        });
        return stringify({ objectId: args.objectId, deletedBullets: true });
      } catch (error: any) {
        log.error(`Error deleting slide bullets: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete slide bullets: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'setSpeakerNotes',
    description:
      'Replaces speaker notes text for a slide. The notes page itself is read-only, but its speaker-notes shape text is editable.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      speakerNotesObjectId: z
        .string()
        .min(1)
        .describe('Speaker notes object ID from listSlides/readPresentation/getSlide.'),
      text: z.string().describe('New speaker notes text. Use an empty string to clear notes.'),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Setting speaker notes ${args.speakerNotesObjectId}`);
      try {
        const requests: any[] = [
          {
            deleteText: {
              objectId: args.speakerNotesObjectId,
              textRange: { type: 'ALL' },
            },
          },
        ];

        if (args.text.length > 0) {
          requests.push({
            insertText: {
              objectId: args.speakerNotesObjectId,
              insertionIndex: 0,
              text: args.text,
            },
          });
        }

        await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: { requests },
        });
        return stringify({
          speakerNotesObjectId: args.speakerNotesObjectId,
          characterCount: args.text.length,
        });
      } catch (error: any) {
        log.error(`Error setting speaker notes: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to set speaker notes: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'appendSpeakerNotes',
    description:
      'Appends text to a slide speaker-notes shape. Use setSpeakerNotes when replacing all notes.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      speakerNotesObjectId: z
        .string()
        .min(1)
        .describe('Speaker notes object ID from listSlides/readPresentation/getSlide.'),
      text: z.string().min(1).describe('Speaker notes text to append.'),
      insertionIndex: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          'Optional insertion index. Defaults to 0 because Slides notes shapes may be empty.'
        ),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Appending speaker notes ${args.speakerNotesObjectId}`);
      try {
        await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [
              {
                insertText: {
                  objectId: args.speakerNotesObjectId,
                  insertionIndex: args.insertionIndex ?? 0,
                  text: args.text,
                },
              },
            ],
          },
        });
        return stringify({
          speakerNotesObjectId: args.speakerNotesObjectId,
          insertedCharacters: args.text.length,
        });
      } catch (error: any) {
        log.error(`Error appending speaker notes: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to append speaker notes: ${error.message || 'Unknown error'}`);
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

  server.addTool({
    name: 'createSlideTable',
    description: 'Creates a native table on a slide. Coordinates and size are in points.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      pageObjectId: z.string().min(1).describe('Slide object ID where the table will be added.'),
      objectId: objectIdParam.optional(),
      rows: z.number().int().min(1).max(50),
      columns: z.number().int().min(1).max(20),
      x: dimensionParam.default(72),
      y: dimensionParam.default(120),
      width: dimensionParam.default(480),
      height: dimensionParam.default(240),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Creating table on slide ${args.pageObjectId}`);
      try {
        const response = await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [
              {
                createTable: {
                  objectId: args.objectId,
                  rows: args.rows,
                  columns: args.columns,
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
          table: response.data.replies?.[0]?.createTable,
          rows: args.rows,
          columns: args.columns,
        });
      } catch (error: any) {
        log.error(`Error creating slide table: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to create slide table: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'writeSlideTableCells',
    description:
      'Writes plain text values into native Slides table cells. Existing text in targeted cells is replaced.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      tableObjectId: z.string().min(1).describe('Table object ID from createSlideTable/getSlide.'),
      values: z
        .array(z.array(z.string()))
        .min(1)
        .describe('2D array of text values. Row and column indexes are zero-based.'),
      startRow: z.number().int().min(0).optional().default(0),
      startColumn: z.number().int().min(0).optional().default(0),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Writing table cells in ${args.tableObjectId}`);
      try {
        const requests = args.values.flatMap((row, rowOffset) =>
          row.flatMap((text, columnOffset) => {
            const cellLocation = {
              rowIndex: args.startRow + rowOffset,
              columnIndex: args.startColumn + columnOffset,
            };
            return [
              {
                deleteText: {
                  objectId: args.tableObjectId,
                  cellLocation,
                  textRange: { type: 'ALL' },
                },
              },
              ...(text.length > 0
                ? [
                    {
                      insertText: {
                        objectId: args.tableObjectId,
                        cellLocation,
                        insertionIndex: 0,
                        text,
                      },
                    },
                  ]
                : []),
            ];
          })
        );

        await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: { requests },
        });

        return stringify({
          tableObjectId: args.tableObjectId,
          rowsWritten: args.values.length,
          columnsWritten: Math.max(...args.values.map((row) => row.length)),
        });
      } catch (error: any) {
        log.error(`Error writing slide table cells: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to write slide table cells: ${error.message || 'Unknown error'}`
        );
      }
    },
  });

  server.addTool({
    name: 'createSheetsChartOnSlide',
    description:
      'Adds an embedded Google Sheets chart to a slide. Use linkingMode=LINKED to keep a refreshable link to the source chart.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      pageObjectId: z.string().min(1).describe('Slide object ID where the chart will be added.'),
      spreadsheetId: z
        .string()
        .min(1)
        .describe('Google Sheets spreadsheet ID containing the chart.'),
      chartId: z.number().int().describe('Embedded chart ID from the spreadsheet.'),
      objectId: objectIdParam.optional(),
      linkingMode: z.enum(['LINKED', 'NOT_LINKED_IMAGE']).optional().default('LINKED'),
      x: dimensionParam.default(72),
      y: dimensionParam.default(120),
      width: dimensionParam.default(480),
      height: dimensionParam.default(300),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Creating Sheets chart on slide ${args.pageObjectId}`);
      try {
        const response = await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [
              {
                createSheetsChart: {
                  objectId: args.objectId,
                  spreadsheetId: args.spreadsheetId,
                  chartId: args.chartId,
                  linkingMode: args.linkingMode,
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
          sheetsChart: response.data.replies?.[0]?.createSheetsChart,
          spreadsheetId: args.spreadsheetId,
          chartId: args.chartId,
          linkingMode: args.linkingMode,
        });
      } catch (error: any) {
        log.error(`Error creating Sheets chart on slide: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to create Sheets chart on slide: ${error.message || 'Unknown error'}`
        );
      }
    },
  });

  server.addTool({
    name: 'refreshSheetsChartOnSlide',
    description: 'Refreshes a linked Google Sheets chart embedded in a Slides presentation.',
    parameters: z.strictObject({
      presentationId: presentationIdParam,
      chartObjectId: z.string().min(1).describe('Slides page-element object ID for the chart.'),
    }),
    execute: async (args, { log }) => {
      const slides = await getSlidesClient();
      log.info(`Refreshing Sheets chart ${args.chartObjectId}`);
      try {
        await slides.presentations.batchUpdate({
          presentationId: args.presentationId,
          requestBody: {
            requests: [
              {
                refreshSheetsChart: {
                  objectId: args.chartObjectId,
                },
              },
            ],
          },
        });
        return stringify({ refreshedChartObjectId: args.chartObjectId });
      } catch (error: any) {
        log.error(`Error refreshing Sheets chart on slide: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to refresh Sheets chart on slide: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
