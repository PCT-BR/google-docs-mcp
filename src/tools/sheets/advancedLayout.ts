import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getSheetsClient } from '../../clients.js';
import * as SheetsHelpers from '../../googleSheetsApiHelpers.js';

const spreadsheetIdParam = z
  .string()
  .describe('The spreadsheet ID — the long string between /d/ and /edit in a Google Sheets URL.');

const rangeParam = z.string().describe('A1 notation range, e.g. "Sheet1!A1:D20".');

const dimension = z.enum(['ROWS', 'COLUMNS']);

export function oneBasedRowsToDimensionRange(sheetId: number, startRow: number, endRow: number) {
  if (endRow < startRow) throw new UserError('endRow must be greater than or equal to startRow.');
  return {
    sheetId,
    dimension: 'ROWS',
    startIndex: startRow - 1,
    endIndex: endRow,
  };
}

export function oneBasedColumnsToDimensionRange(
  sheetId: number,
  startColumn: number,
  endColumn: number
) {
  if (endColumn < startColumn)
    throw new UserError('endColumn must be greater than or equal to startColumn.');
  return {
    sheetId,
    dimension: 'COLUMNS',
    startIndex: startColumn - 1,
    endIndex: endColumn,
  };
}

export function columnLettersToOneBased(column: string) {
  return SheetsHelpers.colLettersToIndex(column) + 1;
}

function buildDimensionRange(args: {
  sheetId: number;
  dimension: 'ROWS' | 'COLUMNS';
  startIndex: number;
  endIndex: number;
}) {
  return {
    sheetId: args.sheetId,
    dimension: args.dimension,
    startIndex: args.startIndex - 1,
    endIndex: args.endIndex,
  };
}

async function executeInsertDimension(
  args: {
    spreadsheetId: string;
    sheetName?: string;
    dimension: 'ROWS' | 'COLUMNS';
    startIndex: number;
    endIndex: number;
    inheritFromBefore?: boolean;
  },
  log: any
) {
  const sheets = await getSheetsClient();
  log.info(`Inserting ${args.dimension} ${args.startIndex}-${args.endIndex}`);
  try {
    const sheetId = await SheetsHelpers.resolveSheetId(sheets, args.spreadsheetId, args.sheetName);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: args.spreadsheetId,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: buildDimensionRange({ ...args, sheetId }),
              inheritFromBefore: args.inheritFromBefore ?? false,
            },
          },
        ],
      },
    });
    return `Inserted ${args.dimension.toLowerCase()} ${args.startIndex}-${args.endIndex}.`;
  } catch (error: any) {
    log.error(`Error inserting dimension: ${error.message || error}`);
    if (error instanceof UserError) throw error;
    throw new UserError(`Failed to insert dimension: ${error.message || 'Unknown error'}`);
  }
}

async function executeDeleteDimension(
  args: {
    spreadsheetId: string;
    sheetName?: string;
    dimension: 'ROWS' | 'COLUMNS';
    startIndex: number;
    endIndex: number;
  },
  log: any
) {
  const sheets = await getSheetsClient();
  log.info(`Deleting ${args.dimension} ${args.startIndex}-${args.endIndex}`);
  try {
    const sheetId = await SheetsHelpers.resolveSheetId(sheets, args.spreadsheetId, args.sheetName);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: args.spreadsheetId,
      requestBody: {
        requests: [{ deleteDimension: { range: buildDimensionRange({ ...args, sheetId }) } }],
      },
    });
    return `Deleted ${args.dimension.toLowerCase()} ${args.startIndex}-${args.endIndex}.`;
  } catch (error: any) {
    log.error(`Error deleting dimension: ${error.message || error}`);
    if (error instanceof UserError) throw error;
    throw new UserError(`Failed to delete dimension: ${error.message || 'Unknown error'}`);
  }
}

async function executeMoveDimension(
  args: {
    spreadsheetId: string;
    sheetName?: string;
    dimension: 'ROWS' | 'COLUMNS';
    startIndex: number;
    endIndex: number;
    destinationIndex: number;
  },
  log: any
) {
  const sheets = await getSheetsClient();
  log.info(`Moving ${args.dimension} ${args.startIndex}-${args.endIndex}`);
  try {
    const sheetId = await SheetsHelpers.resolveSheetId(sheets, args.spreadsheetId, args.sheetName);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: args.spreadsheetId,
      requestBody: {
        requests: [
          {
            moveDimension: {
              source: buildDimensionRange({ ...args, sheetId }),
              destinationIndex: args.destinationIndex - 1,
            },
          },
        ],
      },
    });
    return `Moved ${args.dimension.toLowerCase()} ${args.startIndex}-${args.endIndex}.`;
  } catch (error: any) {
    log.error(`Error moving dimension: ${error.message || error}`);
    if (error instanceof UserError) throw error;
    throw new UserError(`Failed to move dimension: ${error.message || 'Unknown error'}`);
  }
}

function registerSetBasicFilter(server: FastMCP) {
  server.addTool({
    name: 'setBasicFilter',
    description: 'Enables the standard Google Sheets filter dropdowns on an A1 range.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      range: rangeParam,
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(`Setting basic filter on ${args.range} in spreadsheet ${args.spreadsheetId}`);
      try {
        const { sheetName, a1Range } = SheetsHelpers.parseRange(args.range);
        const sheetId = await SheetsHelpers.resolveSheetId(sheets, args.spreadsheetId, sheetName);
        const gridRange = SheetsHelpers.parseA1ToGridRange(a1Range, sheetId);
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: { requests: [{ setBasicFilter: { filter: { range: gridRange } } }] },
        });
        return `Basic filter set on "${args.range}".`;
      } catch (error: any) {
        log.error(`Error setting basic filter: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to set basic filter: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

function registerClearBasicFilter(server: FastMCP) {
  server.addTool({
    name: 'clearBasicFilter',
    description: 'Clears the standard Google Sheets filter from a sheet.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      sheetName: z.string().optional().describe('Sheet/tab name. Defaults to the first sheet.'),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(`Clearing basic filter in spreadsheet ${args.spreadsheetId}`);
      try {
        const sheetId = await SheetsHelpers.resolveSheetId(
          sheets,
          args.spreadsheetId,
          args.sheetName
        );
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: { requests: [{ clearBasicFilter: { sheetId } }] },
        });
        return `Basic filter cleared${args.sheetName ? ` on "${args.sheetName}"` : ''}.`;
      } catch (error: any) {
        log.error(`Error clearing basic filter: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to clear basic filter: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

function registerFilterViews(server: FastMCP) {
  server.addTool({
    name: 'createFilterView',
    description: 'Creates a named Google Sheets filter view on an A1 range.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      title: z.string().min(1).describe('Filter view title.'),
      range: rangeParam,
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(`Creating filter view "${args.title}" in spreadsheet ${args.spreadsheetId}`);
      try {
        const { sheetName, a1Range } = SheetsHelpers.parseRange(args.range);
        const sheetId = await SheetsHelpers.resolveSheetId(sheets, args.spreadsheetId, sheetName);
        const gridRange = SheetsHelpers.parseA1ToGridRange(a1Range, sheetId);
        const response = await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: {
            requests: [{ addFilterView: { filter: { title: args.title, range: gridRange } } }],
          },
        });
        const filterViewId = response.data.replies?.[0]?.addFilterView?.filter?.filterViewId;
        return `Filter view created${filterViewId ? ` (ID: ${filterViewId})` : ''}.`;
      } catch (error: any) {
        log.error(`Error creating filter view: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to create filter view: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'listFilterViews',
    description: 'Lists filter views in a spreadsheet or specific sheet.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      sheetName: z.string().optional().describe('Optional sheet/tab name filter.'),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(`Listing filter views in spreadsheet ${args.spreadsheetId}`);
      try {
        const response = await sheets.spreadsheets.get({
          spreadsheetId: args.spreadsheetId,
          fields: 'sheets(properties(sheetId,title),filterViews)',
        });
        const filterViews = (response.data.sheets ?? []).flatMap((sheet) => {
          if (args.sheetName && sheet.properties?.title !== args.sheetName) return [];
          return (sheet.filterViews ?? []).map((view) => ({
            sheetName: sheet.properties?.title,
            sheetId: sheet.properties?.sheetId,
            filterViewId: view.filterViewId,
            title: view.title,
            range: view.range,
          }));
        });
        return JSON.stringify({ filterViews, total: filterViews.length }, null, 2);
      } catch (error: any) {
        log.error(`Error listing filter views: ${error.message || error}`);
        throw new UserError(`Failed to list filter views: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'updateFilterView',
    description: 'Updates a filter view title and/or range.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      filterViewId: z.number().int().describe('Numeric filter view ID.'),
      title: z.string().optional().describe('New title.'),
      range: rangeParam.optional().describe('New A1 range for the filter view.'),
    }),
    execute: async (args, { log }) => {
      if (!args.title && !args.range) throw new UserError('Provide title and/or range.');
      const sheets = await getSheetsClient();
      log.info(`Updating filter view ${args.filterViewId}`);
      try {
        let range;
        if (args.range) {
          const parsed = SheetsHelpers.parseRange(args.range);
          const sheetId = await SheetsHelpers.resolveSheetId(
            sheets,
            args.spreadsheetId,
            parsed.sheetName
          );
          range = SheetsHelpers.parseA1ToGridRange(parsed.a1Range, sheetId);
        }
        const fields = [args.title ? 'title' : null, args.range ? 'range' : null]
          .filter(Boolean)
          .join(',');
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: {
            requests: [
              {
                updateFilterView: {
                  filter: { filterViewId: args.filterViewId, title: args.title, range },
                  fields,
                },
              },
            ],
          },
        });
        return `Filter view ${args.filterViewId} updated.`;
      } catch (error: any) {
        log.error(`Error updating filter view: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to update filter view: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'deleteFilterView',
    description: 'Deletes a named filter view by numeric ID.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      filterViewId: z.number().int().describe('Numeric filter view ID to delete.'),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(`Deleting filter view ${args.filterViewId}`);
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: { requests: [{ deleteFilterView: { filterId: args.filterViewId } }] },
        });
        return `Filter view ${args.filterViewId} deleted.`;
      } catch (error: any) {
        log.error(`Error deleting filter view: ${error.message || error}`);
        throw new UserError(`Failed to delete filter view: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

function registerDimensionTools(server: FastMCP) {
  const base = z.strictObject({
    spreadsheetId: spreadsheetIdParam,
    sheetName: z.string().optional().describe('Sheet/tab name. Defaults to the first sheet.'),
    dimension,
    startIndex: z.number().int().min(1).describe('1-based start row or column index, inclusive.'),
    endIndex: z.number().int().min(1).describe('1-based end row or column index, inclusive.'),
  });

  server.addTool({
    name: 'insertDimension',
    description:
      'Inserts rows or columns into a sheet. Uses 1-based inclusive indexes; dimension is ROWS or COLUMNS.',
    parameters: base.extend({
      inheritFromBefore: z
        .boolean()
        .optional()
        .default(false)
        .describe('Whether inserted cells inherit formatting from before the range.'),
    }),
    execute: async (args, { log }) => {
      return executeInsertDimension(args, log);
    },
  });

  server.addTool({
    name: 'deleteDimension',
    description:
      'Deletes rows or columns from a sheet. Uses 1-based inclusive indexes; dimension is ROWS or COLUMNS.',
    parameters: base,
    execute: async (args, { log }) => executeDeleteDimension(args, log),
  });

  server.addTool({
    name: 'moveDimension',
    description:
      'Moves rows or columns within a sheet. Uses 1-based inclusive source indexes and a 1-based destination index.',
    parameters: base.extend({
      destinationIndex: z.number().int().min(1).describe('1-based destination row/column index.'),
    }),
    execute: async (args, { log }) => executeMoveDimension(args, log),
  });

  const rowBase = z.strictObject({
    spreadsheetId: spreadsheetIdParam,
    sheetName: z.string().optional().describe('Sheet/tab name. Defaults to the first sheet.'),
    startRow: z.number().int().min(1).describe('1-based start row, inclusive.'),
    endRow: z.number().int().min(1).describe('1-based end row, inclusive.'),
  });
  const columnBase = z.strictObject({
    spreadsheetId: spreadsheetIdParam,
    sheetName: z.string().optional().describe('Sheet/tab name. Defaults to the first sheet.'),
    startColumn: z.number().int().min(1).describe('1-based start column, inclusive.'),
    endColumn: z.number().int().min(1).describe('1-based end column, inclusive.'),
  });

  server.addTool({
    name: 'insertRows',
    description: 'Inserts rows into a sheet using 1-based inclusive row numbers.',
    parameters: rowBase.extend({
      inheritFromBefore: z.boolean().optional().default(false),
    }),
    execute: async (args, { log }) =>
      executeInsertDimension(
        {
          spreadsheetId: args.spreadsheetId,
          sheetName: args.sheetName,
          dimension: 'ROWS',
          startIndex: args.startRow,
          endIndex: args.endRow,
          inheritFromBefore: args.inheritFromBefore,
        },
        log
      ),
  });

  server.addTool({
    name: 'deleteRows',
    description: 'Deletes rows from a sheet using 1-based inclusive row numbers.',
    parameters: rowBase,
    execute: async (args, { log }) =>
      executeDeleteDimension(
        {
          spreadsheetId: args.spreadsheetId,
          sheetName: args.sheetName,
          dimension: 'ROWS',
          startIndex: args.startRow,
          endIndex: args.endRow,
        },
        log
      ),
  });

  server.addTool({
    name: 'moveRows',
    description: 'Moves rows within a sheet using 1-based inclusive row numbers.',
    parameters: rowBase.extend({
      destinationRow: z.number().int().min(1).describe('1-based destination row.'),
    }),
    execute: async (args, { log }) =>
      executeMoveDimension(
        {
          spreadsheetId: args.spreadsheetId,
          sheetName: args.sheetName,
          dimension: 'ROWS',
          startIndex: args.startRow,
          endIndex: args.endRow,
          destinationIndex: args.destinationRow,
        },
        log
      ),
  });

  server.addTool({
    name: 'insertColumns',
    description: 'Inserts columns into a sheet using 1-based inclusive column numbers.',
    parameters: columnBase.extend({
      inheritFromBefore: z.boolean().optional().default(false),
    }),
    execute: async (args, { log }) =>
      executeInsertDimension(
        {
          spreadsheetId: args.spreadsheetId,
          sheetName: args.sheetName,
          dimension: 'COLUMNS',
          startIndex: args.startColumn,
          endIndex: args.endColumn,
          inheritFromBefore: args.inheritFromBefore,
        },
        log
      ),
  });

  server.addTool({
    name: 'deleteColumns',
    description: 'Deletes columns from a sheet using 1-based inclusive column numbers.',
    parameters: columnBase,
    execute: async (args, { log }) =>
      executeDeleteDimension(
        {
          spreadsheetId: args.spreadsheetId,
          sheetName: args.sheetName,
          dimension: 'COLUMNS',
          startIndex: args.startColumn,
          endIndex: args.endColumn,
        },
        log
      ),
  });

  server.addTool({
    name: 'moveColumns',
    description: 'Moves columns within a sheet using 1-based inclusive column numbers.',
    parameters: columnBase.extend({
      destinationColumn: z.number().int().min(1).describe('1-based destination column.'),
    }),
    execute: async (args, { log }) =>
      executeMoveDimension(
        {
          spreadsheetId: args.spreadsheetId,
          sheetName: args.sheetName,
          dimension: 'COLUMNS',
          startIndex: args.startColumn,
          endIndex: args.endColumn,
          destinationIndex: args.destinationColumn,
        },
        log
      ),
  });
}

function registerMergeTools(server: FastMCP) {
  server.addTool({
    name: 'mergeCells',
    description: 'Merges cells in an A1 range using MERGE_ALL, MERGE_ROWS, or MERGE_COLUMNS.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      range: rangeParam,
      mergeType: z.enum(['MERGE_ALL', 'MERGE_ROWS', 'MERGE_COLUMNS']).default('MERGE_ALL'),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(`Merging cells in ${args.range}`);
      try {
        const { sheetName, a1Range } = SheetsHelpers.parseRange(args.range);
        const sheetId = await SheetsHelpers.resolveSheetId(sheets, args.spreadsheetId, sheetName);
        const gridRange = SheetsHelpers.parseA1ToGridRange(a1Range, sheetId);
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: {
            requests: [{ mergeCells: { range: gridRange, mergeType: args.mergeType } }],
          },
        });
        return `Merged cells in "${args.range}".`;
      } catch (error: any) {
        log.error(`Error merging cells: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to merge cells: ${error.message || 'Unknown error'}`);
      }
    },
  });

  server.addTool({
    name: 'unmergeCells',
    description: 'Unmerges cells in an A1 range.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      range: rangeParam,
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient();
      log.info(`Unmerging cells in ${args.range}`);
      try {
        const { sheetName, a1Range } = SheetsHelpers.parseRange(args.range);
        const sheetId = await SheetsHelpers.resolveSheetId(sheets, args.spreadsheetId, sheetName);
        const gridRange = SheetsHelpers.parseA1ToGridRange(a1Range, sheetId);
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: { requests: [{ unmergeCells: { range: gridRange } }] },
        });
        return `Unmerged cells in "${args.range}".`;
      } catch (error: any) {
        log.error(`Error unmerging cells: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to unmerge cells: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

function registerUpdateChart(server: FastMCP) {
  server.addTool({
    name: 'updateChart',
    description:
      'Updates an existing chart title, basic chart type, or legend position. Use insertChart to create a chart and capture its chart ID first.',
    parameters: z.strictObject({
      spreadsheetId: spreadsheetIdParam,
      chartId: z.number().int().describe('Numeric chart ID.'),
      title: z.string().optional().describe('New chart title.'),
      chartType: z
        .enum(['BAR', 'COLUMN', 'LINE', 'AREA', 'SCATTER'])
        .optional()
        .describe('New basic chart type. Pie/donut/treemap conversion is not supported here.'),
      legendPosition: z
        .enum(['BOTTOM_LEGEND', 'LEFT_LEGEND', 'RIGHT_LEGEND', 'TOP_LEGEND', 'NO_LEGEND'])
        .optional()
        .describe('New basic chart legend position.'),
    }),
    execute: async (args, { log }) => {
      if (!args.title && !args.chartType && !args.legendPosition) {
        throw new UserError('Provide title, chartType, and/or legendPosition.');
      }
      const sheets = await getSheetsClient();
      log.info(`Updating chart ${args.chartId}`);
      try {
        const spreadsheet = await sheets.spreadsheets.get({
          spreadsheetId: args.spreadsheetId,
          fields: 'sheets(charts(chartId,spec,position))',
        });
        const chart = (spreadsheet.data.sheets ?? [])
          .flatMap((sheet) => sheet.charts ?? [])
          .find((candidate) => candidate.chartId === args.chartId);

        if (!chart?.spec) throw new UserError(`Chart ${args.chartId} was not found.`);
        if ((args.chartType || args.legendPosition) && !chart.spec.basicChart) {
          throw new UserError('Only basic charts support chartType and legendPosition updates.');
        }

        const spec = {
          ...chart.spec,
          ...(args.title ? { title: args.title } : {}),
          basicChart: chart.spec.basicChart
            ? {
                ...chart.spec.basicChart,
                ...(args.chartType ? { chartType: args.chartType } : {}),
                ...(args.legendPosition ? { legendPosition: args.legendPosition } : {}),
              }
            : chart.spec.basicChart,
        };

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: args.spreadsheetId,
          requestBody: {
            requests: [
              {
                updateChartSpec: {
                  chartId: args.chartId,
                  spec,
                },
              },
            ],
          },
        });
        return `Chart ${args.chartId} updated.`;
      } catch (error: any) {
        log.error(`Error updating chart: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to update chart: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

export function registerAdvancedLayoutTools(server: FastMCP) {
  registerSetBasicFilter(server);
  registerClearBasicFilter(server);
  registerFilterViews(server);
  registerDimensionTools(server);
  registerMergeTools(server);
  registerUpdateChart(server);
}
