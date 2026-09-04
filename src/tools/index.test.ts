import type { FastMCP } from 'fastmcp';
import { describe, expect, it } from 'vitest';
import { parseEnabledToolGroups, registerAllTools, TOOL_GROUPS } from './index.js';
import { getScopesForToolGroups } from '../googleScopes.js';

type ToolConfig = Parameters<FastMCP['addTool']>[0];

function captureTools(groups: Parameters<typeof registerAllTools>[1]) {
  const tools: ToolConfig[] = [];
  const server = {
    addTool: (tool: ToolConfig) => {
      tools.push(tool);
    },
  };

  registerAllTools(server as FastMCP, groups);
  return tools.map((tool) => tool.name);
}

describe('parseEnabledToolGroups', () => {
  it('defaults to every tool group', () => {
    expect(parseEnabledToolGroups(undefined)).toEqual([...TOOL_GROUPS]);
    expect(parseEnabledToolGroups('  ')).toEqual([...TOOL_GROUPS]);
  });

  it('normalizes comma-separated tool group names in default order', () => {
    expect(parseEnabledToolGroups('sheets, docs, sheets')).toEqual(['docs', 'sheets']);
  });

  it('treats all as the default full registration', () => {
    expect(parseEnabledToolGroups('all')).toEqual([...TOOL_GROUPS]);
  });

  it('rejects unknown tool groups', () => {
    expect(() => parseEnabledToolGroups('docs,unknown')).toThrow('Unknown MCP_TOOL_GROUPS');
  });
});

describe('registerAllTools', () => {
  it('registers only the selected groups', () => {
    const toolNames = captureTools(['docs']);

    expect(toolNames).toContain('readDocument');
    expect(toolNames).toContain('appendText');
    expect(toolNames).not.toContain('listSpreadsheets');
    expect(toolNames).not.toContain('sendEmail');
  });

  it('can combine multiple selected groups', () => {
    const toolNames = captureTools(['docs', 'sheets']);

    expect(toolNames).toContain('readDocument');
    expect(toolNames).toContain('listSpreadsheets');
    expect(toolNames).not.toContain('sendEmail');
  });

  it('exposes private Drive index tools with the drive group', () => {
    const toolNames = captureTools(['drive']);

    expect(toolNames).toContain('findOrCreateDriveIndex');
    expect(toolNames).toContain('refreshDriveIndex');
    expect(toolNames).toContain('searchDriveIndex');
    expect(toolNames).toContain('updateDriveIndexEntry');
  });

  it('exposes Drive revision tools with the drive group', () => {
    const toolNames = captureTools(['drive']);

    expect(toolNames).toContain('listFileRevisions');
    expect(toolNames).toContain('getFileRevision');
    expect(toolNames).toContain('exportFileRevision');
    expect(toolNames).toContain('updateFileRevision');
    expect(toolNames).toContain('deleteFileRevision');
  });

  it('exposes generic Drive comment tools with the drive group', () => {
    const toolNames = captureTools(['drive']);

    expect(toolNames).toContain('createFileComment');
    expect(toolNames).toContain('listFileComments');
    expect(toolNames).toContain('getFileComment');
    expect(toolNames).toContain('updateFileComment');
    expect(toolNames).toContain('deleteFileComment');
    expect(toolNames).toContain('createFileCommentReply');
    expect(toolNames).toContain('updateFileCommentReply');
    expect(toolNames).toContain('deleteFileCommentReply');
  });

  it('exposes Google Docs comment tools with the docs group', () => {
    const toolNames = captureTools(['docs']);

    expect(toolNames).toContain('listComments');
    expect(toolNames).toContain('createComment');
    expect(toolNames).toContain('addComment');
    expect(toolNames).toContain('replyToComment');
    expect(toolNames).toContain('resolveComment');
    expect(toolNames).toContain('deleteComment');
  });

  it('exposes advanced Google Docs structure tools with the docs group', () => {
    const toolNames = captureTools(['docs']);

    expect(toolNames).toContain('listHeadersFooters');
    expect(toolNames).toContain('createHeader');
    expect(toolNames).toContain('createFooter');
    expect(toolNames).toContain('insertFootnote');
    expect(toolNames).toContain('listFootnotes');
    expect(toolNames).toContain('createNamedRange');
    expect(toolNames).toContain('replaceNamedRange');
    expect(toolNames).toContain('getDocumentPageFormat');
    expect(toolNames).toContain('setDocumentPageFormat');
    expect(toolNames).toContain('listDocumentSuggestions');
    expect(toolNames).toContain('listDocumentImages');
    expect(toolNames).toContain('replaceDocumentImage');
    expect(toolNames).toContain('deletePositionedObject');
    expect(toolNames).toContain('insertSegmentMarkdown');
  });

  it('exposes advanced Sheets layout tools with the sheets group', () => {
    const toolNames = captureTools(['sheets']);

    expect(toolNames).toContain('setBasicFilter');
    expect(toolNames).toContain('createFilterView');
    expect(toolNames).toContain('insertRows');
    expect(toolNames).toContain('deleteColumns');
    expect(toolNames).toContain('mergeCells');
    expect(toolNames).toContain('unmergeCells');
    expect(toolNames).toContain('updateChart');
  });

  it('exposes stable Sheets gap tools with the sheets group', () => {
    const toolNames = captureTools(['sheets']);

    expect(toolNames).toContain('createSheetNamedRange');
    expect(toolNames).toContain('listSheetNamedRanges');
    expect(toolNames).toContain('updateSheetNamedRange');
    expect(toolNames).toContain('deleteSheetNamedRange');
    expect(toolNames).toContain('trimWhitespace');
    expect(toolNames).toContain('textToColumns');
    expect(toolNames).toContain('createPivotTable');
    expect(toolNames).toContain('listPivotTables');
    expect(toolNames).toContain('getPivotTable');
    expect(toolNames).toContain('updatePivotTable');
    expect(toolNames).toContain('deletePivotTable');
  });

  it('exposes initial Google Slides tools with the slides group', () => {
    const toolNames = captureTools(['slides']);

    expect(toolNames).toContain('createPresentation');
    expect(toolNames).toContain('readPresentation');
    expect(toolNames).toContain('listSlides');
    expect(toolNames).toContain('getSlide');
    expect(toolNames).toContain('getSlideThumbnail');
    expect(toolNames).toContain('createSlide');
    expect(toolNames).toContain('deleteSlideObject');
    expect(toolNames).toContain('createTextBox');
    expect(toolNames).toContain('setSpeakerNotes');
    expect(toolNames).toContain('appendSpeakerNotes');
    expect(toolNames).toContain('createSlideImage');
    expect(toolNames).toContain('createSlideTable');
    expect(toolNames).toContain('writeSlideTableCells');
    expect(toolNames).toContain('createSheetsChartOnSlide');
    expect(toolNames).toContain('refreshSheetsChartOnSlide');
    expect(toolNames).not.toContain('readDocument');
  });
});

describe('getScopesForToolGroups', () => {
  it('returns only scopes required by selected groups', () => {
    expect(getScopesForToolGroups(['docs', 'drive', 'sheets', 'utils'])).toEqual([
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
    ]);
  });

  it('includes the presentations scope only when Slides is enabled', () => {
    expect(getScopesForToolGroups(['docs', 'drive', 'sheets', 'utils'])).not.toContain(
      'https://www.googleapis.com/auth/presentations'
    );
    expect(getScopesForToolGroups(['slides'])).toEqual([
      'https://www.googleapis.com/auth/presentations',
    ]);
  });

  it('includes restricted Gmail scope only when Gmail tools are enabled', () => {
    expect(getScopesForToolGroups(['docs'])).not.toContain(
      'https://www.googleapis.com/auth/gmail.modify'
    );
    expect(getScopesForToolGroups(['gmail'])).toEqual([
      'https://www.googleapis.com/auth/gmail.modify',
    ]);
  });
});
