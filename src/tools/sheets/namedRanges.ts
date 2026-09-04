import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getSheetsClient } from '../../clients.js';
import * as SheetsHelpers from '../../googleSheetsApiHelpers.js';

const spreadsheetIdParam = z
  .string()
  .describe('The spreadsheet ID — the long string between /d/ and /edit in a Google Sheets URL.');

const rangeParam = z
  .string()
  .describe('A1 notation range for the named range, e.g. "Sheet1!A1:D20".');

async function toGridRange(spreadsheetId: string, range: string) {
  const sheets = await getSheetsClient();
  const { sheetName, a1Range } = SheetsHelpers.parseRange(range);
  const sheetId = await SheetsHelpers.resolveSheetId(sheets, spreadsheetId, sheetName);
  return {
    sheets,
    gridRange: SheetsHelpers.parseA1ToGridRange(a1Range, sheetId),
  };
}

function stringify(data: unknown) {
  return JSON.stringify(data, null, 2);
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'createSheetNamedRange',
    description:
      'Creates a native Google Sheets named range. Use this for stable reusable range names in formulas, validations, pivots, and charts.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      name: z.string().min(1).describe('Name for the range, e.g. "RevenueTable".'),
      range: rangeParam,
    }),
    execute: async (args, { log }) => {
      log.info(`Creating named range ${args.name} in spreadsheet ${args.spreadsheetId}`);
      try {
        const { sheets, gridRange } = await toGridRange(args.spreadsheetId, args.range);
        const response = await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: {
            requests: [
              {
                addNamedRange: {
                  namedRange: {
                    name: args.name,
                    range: gridRange,
                  },
                },
              },
            ],
          },
        });

        return stringify({
          namedRange: response.data.replies?.[0]?.addNamedRange?.namedRange,
        });
      } catch (error: any) {
        log.error(`Error creating named range: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to create named range: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'listSheetNamedRanges',
    description: 'Lists native named ranges in a Google Sheet, including IDs needed for updates.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(`Listing named ranges in spreadsheet ${args.spreadsheetId}`);
      try {
        const response = await sheets.spreadsheets.get({
          spreadsheetId: args.spreadsheetId,
          fields: 'spreadsheetId,properties.title,namedRanges',
          includeGridData: false,
        });

        return stringify({
          spreadsheetId: response.data.spreadsheetId,
          title: response.data.properties?.title,
          namedRanges: response.data.namedRanges ?? [],
        });
      } catch (error: any) {
        log.error(`Error listing named ranges: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to list named ranges: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'updateSheetNamedRange',
    description:
      'Updates a native Google Sheets named range by ID. Provide the namedRangeId from listSheetNamedRanges.',
    parameters: z
      .strictObject({
        spreadsheetId: spreadsheetIdParam,
        namedRangeId: z.string().min(1).describe('The native named range ID to update.'),
        name: z.string().min(1).optional().describe('New range name.'),
        range: rangeParam.optional().describe('New A1 range.'),
      })
      .refine((data) => data.name !== undefined || data.range !== undefined, {
        message: 'At least one of name or range must be provided.',
      }),
    execute: async (args, { log }) => {
      log.info(`Updating named range ${args.namedRangeId} in spreadsheet ${args.spreadsheetId}`);
      try {
        const sheets = await getSheetsClient();
        const fields: string[] = [];
        const namedRange: Record<string, unknown> = {
          namedRangeId: args.namedRangeId,
        };

        if (args.name !== undefined) {
          namedRange.name = args.name;
          fields.push('name');
        }

        if (args.range !== undefined) {
          const { gridRange } = await toGridRange(args.spreadsheetId, args.range);
          namedRange.range = gridRange;
          fields.push('range');
        }

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: {
            requests: [
              {
                updateNamedRange: {
                  namedRange,
                  fields: fields.join(','),
                },
              },
            ],
          },
        });

        return stringify({
          namedRange,
        });
      } catch (error: any) {
        log.error(`Error updating named range: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to update named range: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'deleteSheetNamedRange',
    description:
      'Deletes a native Google Sheets named range by ID. This removes the named range definition, not the cell contents.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      namedRangeId: z.string().min(1).describe('The native named range ID to delete.'),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(`Deleting named range ${args.namedRangeId} in spreadsheet ${args.spreadsheetId}`);
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: {
            requests: [
              {
                deleteNamedRange: {
                  namedRangeId: args.namedRangeId,
                },
              },
            ],
          },
        });

        return stringify({
          deletedNamedRangeId: args.namedRangeId,
        });
      } catch (error: any) {
        log.error(`Error deleting named range: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete named range: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
