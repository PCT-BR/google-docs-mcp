import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getSheetsClient } from '../../clients.js';
import * as SheetsHelpers from '../../googleSheetsApiHelpers.js';

const spreadsheetIdParam = z
  .string()
  .describe('The spreadsheet ID — the long string between /d/ and /edit in a Google Sheets URL.');

const rangeParam = z.string().describe('A1 notation range, e.g. "Sheet1!A1:D20".');

const delimiterTypeSchema = z.enum([
  'COMMA',
  'SEMICOLON',
  'PERIOD',
  'SPACE',
  'CUSTOM',
  'AUTODETECT',
]);

async function parseGridRange(spreadsheetId: string, range: string) {
  const sheets = await getSheetsClient();
  const { sheetName, a1Range } = SheetsHelpers.parseRange(range);
  const sheetId = await SheetsHelpers.resolveSheetId(sheets, spreadsheetId, sheetName);
  return {
    sheets,
    gridRange: SheetsHelpers.parseA1ToGridRange(a1Range, sheetId),
  };
}

function ensureSingleColumn(range: ReturnType<typeof SheetsHelpers.parseA1ToGridRange>) {
  const startColumn = range.startColumnIndex;
  const endColumn = range.endColumnIndex;
  if (
    startColumn === undefined ||
    startColumn === null ||
    endColumn === undefined ||
    endColumn === null ||
    endColumn - startColumn !== 1
  ) {
    throw new UserError('textToColumns requires a bounded A1 range that spans exactly one column.');
  }
}

function stringify(data: unknown) {
  return JSON.stringify(data, null, 2);
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'trimWhitespace',
    description:
      'Trims leading/trailing whitespace and collapses repeated internal whitespace in every cell of a Google Sheets range.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      range: rangeParam,
    }),
    execute: async (args, { log }) => {
      log.info(`Trimming whitespace in ${args.range} in spreadsheet ${args.spreadsheetId}`);
      try {
        const { sheets, gridRange } = await parseGridRange(args.spreadsheetId, args.range);
        const response = await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: {
            requests: [
              {
                trimWhitespace: {
                  range: gridRange,
                },
              },
            ],
          },
        });

        return stringify({
          range: args.range,
          cellsChangedCount: response.data.replies?.[0]?.trimWhitespace?.cellsChangedCount ?? 0,
        });
      } catch (error: any) {
        log.error(`Error trimming whitespace: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to trim whitespace: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'textToColumns',
    description:
      'Splits one Google Sheets column into multiple columns using comma, semicolon, period, space, custom delimiter, or autodetect.',
    parameters: z
      .strictObject({
        spreadsheetId: spreadsheetIdParam,
        sourceRange: rangeParam.describe(
          'A1 source range spanning exactly one column, e.g. "Sheet1!A2:A100".'
        ),
        delimiterType: delimiterTypeSchema.describe('Delimiter mode to use.'),
        delimiter: z
          .string()
          .min(1)
          .optional()
          .describe('Required only when delimiterType is CUSTOM.'),
      })
      .superRefine((data, ctx) => {
        if (data.delimiterType === 'CUSTOM' && !data.delimiter) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['delimiter'],
            message: 'delimiter is required when delimiterType is CUSTOM.',
          });
        }
        if (data.delimiterType !== 'CUSTOM' && data.delimiter !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['delimiter'],
            message: 'delimiter is only allowed when delimiterType is CUSTOM.',
          });
        }
      }),
    execute: async (args, { log }) => {
      log.info(`Splitting ${args.sourceRange} in spreadsheet ${args.spreadsheetId}`);
      try {
        const { sheets, gridRange } = await parseGridRange(args.spreadsheetId, args.sourceRange);
        ensureSingleColumn(gridRange);

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: {
            requests: [
              {
                textToColumns: {
                  source: gridRange,
                  delimiterType: args.delimiterType,
                  delimiter: args.delimiter,
                },
              },
            ],
          },
        });

        return stringify({
          sourceRange: args.sourceRange,
          delimiterType: args.delimiterType,
          delimiter: args.delimiter,
        });
      } catch (error: any) {
        log.error(`Error splitting text to columns: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to split text to columns: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
