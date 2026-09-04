import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import type { sheets_v4 } from 'googleapis';
import { getSheetsClient } from '../../clients.js';
import * as SheetsHelpers from '../../googleSheetsApiHelpers.js';

const spreadsheetIdParam = z
  .string()
  .describe('The spreadsheet ID — the long string between /d/ and /edit in a Google Sheets URL.');

const a1RangeParam = z.string().describe('A1 notation range, e.g. "Data!A1:E200".');

const sortOrderSchema = z.enum(['ASCENDING', 'DESCENDING']).default('ASCENDING');
const valueLayoutSchema = z.enum(['HORIZONTAL', 'VERTICAL']).default('HORIZONTAL');
const summarizeFunctionSchema = z.enum([
  'SUM',
  'COUNTA',
  'COUNT',
  'AVERAGE',
  'MAX',
  'MIN',
  'CUSTOM',
]);

const pivotGroupSchema = z.strictObject({
  sourceColumnOffset: z
    .number()
    .int()
    .min(0)
    .describe('Zero-based column offset within sourceRange. For A:E, A is 0 and B is 1.'),
  label: z.string().optional(),
  showTotals: z.boolean().default(true),
  sortOrder: sortOrderSchema,
});

const pivotValueSchema = z
  .strictObject({
    sourceColumnOffset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Zero-based source column offset. Omit only for CUSTOM formula values.'),
    summarizeFunction: summarizeFunctionSchema.default('SUM'),
    name: z.string().optional(),
    formula: z
      .string()
      .optional()
      .describe('Formula for CUSTOM pivot values. Must start with "=".'),
  })
  .superRefine((data, ctx) => {
    if (data.summarizeFunction === 'CUSTOM') {
      if (!data.formula?.startsWith('=')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['formula'],
          message: 'CUSTOM pivot values require formula starting with "=".',
        });
      }
      if (data.sourceColumnOffset !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceColumnOffset'],
          message: 'CUSTOM pivot values use formula and must not set sourceColumnOffset.',
        });
      }
    } else if (data.sourceColumnOffset === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceColumnOffset'],
        message: 'sourceColumnOffset is required unless summarizeFunction is CUSTOM.',
      });
    }
  });

const pivotFilterSchema = z.strictObject({
  sourceColumnOffset: z.number().int().min(0),
  visibleValues: z.array(z.string()).optional(),
  visibleByDefault: z.boolean().optional(),
});

const pivotDefinitionSchema = z.strictObject({
  rows: z.array(pivotGroupSchema).default([]),
  columns: z.array(pivotGroupSchema).default([]),
  values: z.array(pivotValueSchema).min(1),
  filters: z.array(pivotFilterSchema).default([]),
  valueLayout: valueLayoutSchema,
});

type PivotDefinitionInput = z.infer<typeof pivotDefinitionSchema>;

function stringify(data: unknown) {
  return JSON.stringify(data, null, 2);
}

async function parseRange(spreadsheetId: string, range: string) {
  const sheets = await getSheetsClient();
  const { sheetName, a1Range } = SheetsHelpers.parseRange(range);
  const sheetId = await SheetsHelpers.resolveSheetId(sheets, spreadsheetId, sheetName);
  return {
    sheets,
    sheetName,
    sheetId,
    gridRange: SheetsHelpers.parseA1ToGridRange(a1Range, sheetId),
  };
}

async function parseAnchor(spreadsheetId: string, anchorCell: string) {
  const parsed = await parseRange(spreadsheetId, anchorCell);
  const { startRowIndex, endRowIndex, startColumnIndex, endColumnIndex } = parsed.gridRange;
  if (
    startRowIndex === undefined ||
    startRowIndex === null ||
    endRowIndex === undefined ||
    endRowIndex === null ||
    startColumnIndex === undefined ||
    startColumnIndex === null ||
    endColumnIndex === undefined ||
    endColumnIndex === null ||
    endRowIndex - startRowIndex !== 1 ||
    endColumnIndex - startColumnIndex !== 1
  ) {
    throw new UserError('anchorCell must be a single bounded cell such as "Pivot!A1".');
  }

  return {
    ...parsed,
    rowIndex: startRowIndex,
    columnIndex: startColumnIndex,
    a1Cell: SheetsHelpers.rowColToA1(startRowIndex, startColumnIndex),
  };
}

function buildPivotTable(
  source: sheets_v4.Schema$GridRange,
  definition: PivotDefinitionInput
): sheets_v4.Schema$PivotTable {
  return {
    source,
    rows: definition.rows.map((row) => ({
      sourceColumnOffset: row.sourceColumnOffset,
      label: row.label,
      showTotals: row.showTotals,
      sortOrder: row.sortOrder,
    })),
    columns: definition.columns.map((column) => ({
      sourceColumnOffset: column.sourceColumnOffset,
      label: column.label,
      showTotals: column.showTotals,
      sortOrder: column.sortOrder,
    })),
    values: definition.values.map((value) => ({
      sourceColumnOffset: value.sourceColumnOffset,
      summarizeFunction: value.summarizeFunction,
      name: value.name,
      formula: value.formula,
    })),
    filterSpecs: definition.filters.map((filter) => ({
      columnOffsetIndex: filter.sourceColumnOffset,
      filterCriteria: {
        visibleValues: filter.visibleValues,
        visibleByDefault: filter.visibleByDefault,
      },
    })),
    valueLayout: definition.valueLayout,
  };
}

function anchoredRange(sheetId: number, rowIndex: number, columnIndex: number) {
  return {
    sheetId,
    startRowIndex: rowIndex,
    endRowIndex: rowIndex + 1,
    startColumnIndex: columnIndex,
    endColumnIndex: columnIndex + 1,
  };
}

function findPivotTables(spreadsheet: sheets_v4.Schema$Spreadsheet) {
  const pivots: unknown[] = [];
  for (const sheet of spreadsheet.sheets ?? []) {
    const title = sheet.properties?.title ?? 'Untitled';
    const sheetId = sheet.properties?.sheetId;
    for (const data of sheet.data ?? []) {
      const startRow = data.startRow ?? 0;
      const startColumn = data.startColumn ?? 0;
      for (const [rowOffset, row] of (data.rowData ?? []).entries()) {
        for (const [columnOffset, cell] of (row.values ?? []).entries()) {
          if (!cell.pivotTable) continue;
          const rowIndex = startRow + rowOffset;
          const columnIndex = startColumn + columnOffset;
          pivots.push({
            sheetName: title,
            sheetId,
            anchorCell: `${title}!${SheetsHelpers.rowColToA1(rowIndex, columnIndex)}`,
            rowIndex,
            columnIndex,
            pivotTable: cell.pivotTable,
          });
        }
      }
    }
  }
  return pivots;
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'createPivotTable',
    description:
      'Creates a native Google Sheets pivot table at a single anchor cell. Existing content in the pivot output area may be overwritten by Sheets rendering.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      sourceRange: a1RangeParam.describe('Source data range, usually including header row.'),
      destinationCell: a1RangeParam.describe('Single anchor cell for the pivot, e.g. "Pivot!A1".'),
      definition: pivotDefinitionSchema,
    }),
    execute: async (args, { log }) => {
      log.info(`Creating pivot table in spreadsheet ${args.spreadsheetId}`);
      try {
        const source = await parseRange(args.spreadsheetId, args.sourceRange);
        const destination = await parseAnchor(args.spreadsheetId, args.destinationCell);
        const pivotTable = buildPivotTable(source.gridRange, args.definition);

        await destination.sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: {
            requests: [
              {
                updateCells: {
                  start: {
                    sheetId: destination.sheetId,
                    rowIndex: destination.rowIndex,
                    columnIndex: destination.columnIndex,
                  },
                  rows: [{ values: [{ pivotTable }] }],
                  fields: 'pivotTable',
                },
              },
            ],
          },
        });

        return stringify({
          anchorCell: args.destinationCell,
          pivotTable,
        });
      } catch (error: any) {
        log.error(`Error creating pivot table: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to create pivot table: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'listPivotTables',
    description:
      'Lists native pivot tables in a spreadsheet. Provide sheetName to avoid scanning every grid in large spreadsheets.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      sheetName: z.string().optional().describe('Optional sheet/tab to scan for pivot anchors.'),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(`Listing pivot tables in spreadsheet ${args.spreadsheetId}`);
      try {
        const ranges = args.sheetName ? [args.sheetName] : undefined;
        const response = await sheets.spreadsheets.get({
          spreadsheetId: args.spreadsheetId,
          includeGridData: true,
          ranges,
          fields:
            'spreadsheetId,sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(pivotTable))))',
        });
        return stringify({ pivotTables: findPivotTables(response.data) });
      } catch (error: any) {
        log.error(`Error listing pivot tables: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to list pivot tables: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'getPivotTable',
    description: 'Gets the native pivot table definition anchored at one exact cell.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      anchorCell: a1RangeParam.describe('Single pivot anchor cell, e.g. "Pivot!A1".'),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(`Getting pivot table at ${args.anchorCell}`);
      try {
        const anchor = await parseAnchor(args.spreadsheetId, args.anchorCell);
        const response = await sheets.spreadsheets.get({
          spreadsheetId: args.spreadsheetId,
          includeGridData: true,
          ranges: [args.anchorCell],
          fields:
            'spreadsheetId,sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(pivotTable))))',
        });
        const pivot = findPivotTables(response.data)[0];
        if (!pivot) {
          throw new UserError(
            `No pivot table found at ${anchor.sheetName ?? ''}!${anchor.a1Cell}.`
          );
        }
        return stringify(pivot);
      } catch (error: any) {
        log.error(`Error getting pivot table: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to get pivot table: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'updatePivotTable',
    description: 'Replaces the native pivot table definition at an exact anchor cell.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      anchorCell: a1RangeParam.describe('Single pivot anchor cell, e.g. "Pivot!A1".'),
      sourceRange: a1RangeParam.describe('Source data range, usually including header row.'),
      definition: pivotDefinitionSchema,
    }),
    execute: async (args, { log }) => {
      log.info(`Updating pivot table at ${args.anchorCell}`);
      try {
        const source = await parseRange(args.spreadsheetId, args.sourceRange);
        const anchor = await parseAnchor(args.spreadsheetId, args.anchorCell);
        const pivotTable = buildPivotTable(source.gridRange, args.definition);

        await anchor.sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: {
            requests: [
              {
                updateCells: {
                  start: {
                    sheetId: anchor.sheetId,
                    rowIndex: anchor.rowIndex,
                    columnIndex: anchor.columnIndex,
                  },
                  rows: [{ values: [{ pivotTable }] }],
                  fields: 'pivotTable',
                },
              },
            ],
          },
        });

        return stringify({ anchorCell: args.anchorCell, pivotTable });
      } catch (error: any) {
        log.error(`Error updating pivot table: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to update pivot table: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'deletePivotTable',
    description:
      'Deletes the native pivot table definition from one exact anchor cell. It does not clear the rendered result range.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      anchorCell: a1RangeParam.describe('Single pivot anchor cell, e.g. "Pivot!A1".'),
    }),
    execute: async (args, { log }) => {
      log.info(`Deleting pivot table at ${args.anchorCell}`);
      try {
        const anchor = await parseAnchor(args.spreadsheetId, args.anchorCell);
        await anchor.sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: {
            requests: [
              {
                updateCells: {
                  range: anchoredRange(anchor.sheetId, anchor.rowIndex, anchor.columnIndex),
                  rows: [{ values: [{}] }],
                  fields: 'pivotTable',
                },
              },
            ],
          },
        });

        return stringify({ deletedPivotAnchor: args.anchorCell });
      } catch (error: any) {
        log.error(`Error deleting pivot table: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete pivot table: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
