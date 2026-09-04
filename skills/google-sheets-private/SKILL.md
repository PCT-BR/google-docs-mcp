---
name: google-sheets-private
description: Use the private Google Docs MCP to create, read, edit, format, analyze, chart, validate, and structure personal Google Sheets through ranges, formulas, sheet tabs, comments, notes, and tables.
---

# Google Sheets Private

Use `mcp__google_docs_mcp` Sheets tools for personal Google Sheets. Use Drive tools only to locate the spreadsheet, export it, organize it, or update the optional Drive index after meaningful changes.

## Defaults

- Start non-trivial work with `getSpreadsheetInfo` to discover sheet titles, numeric sheet IDs, dimensions, and URL.
- Use explicit A1 ranges with sheet names when possible, for example `Tasks!A1:E20`.
- Use `valueInputOption="USER_ENTERED"` for formulas, dates, percentages, and values that should behave as typed by a user.
- Use `valueRenderOption="FORMULA"` when inspecting formulas.
- Ask before clearing ranges, deleting sheet tabs, deleting tables, deleting charts, or changing protections.
- Verify writes by reading back the affected range or metadata.

## Main Tools

- Create/read/write: `createSpreadsheet`, `getSpreadsheetInfo`, `readSpreadsheet`, `writeSpreadsheet`, `batchWrite`, `appendRows`, `clearRange`.
- Sheet tabs: `addSheet`, `renameSheet`, `duplicateSheet`, `copySheetTo`, `deleteSheet`.
- Formatting: `formatCells`, `readCellFormat`, `setCellBorders`, `copyFormatting`, `setColumnWidths`, `setRowHeights`, `autoResizeColumns`, `autoResizeRows`, `freezeRowsAndColumns`, `groupRows`.
- Validation and protection: `setDropdownValidation`, `protectRange`.
- Conditional formatting: `addConditionalFormatting`, `getConditionalFormatting`, `deleteConditionalFormatting`.
- Tables: `createTable`, `listTables`, `getTable`, `appendTableRows`, `updateTableRange`, `deleteTable`.
- Filters and layout: `setBasicFilter`, `clearBasicFilter`, `createFilterView`, `listFilterViews`, `updateFilterView`, `deleteFilterView`, `insertRows`, `deleteRows`, `moveRows`, `insertColumns`, `deleteColumns`, `moveColumns`, `mergeCells`, `unmergeCells`, `trimWhitespace`, `textToColumns`.
- Named ranges: `createSheetNamedRange`, `listSheetNamedRanges`, `updateSheetNamedRange`, `deleteSheetNamedRange`.
- Pivot tables: `createPivotTable`, `listPivotTables`, `getPivotTable`, `updatePivotTable`, `deletePivotTable`.
- Charts: `insertChart`, `updateChart`, `deleteChart`.
- Review notes: `createSheetsCellNote`, `createSheetsComment`, `listSheetsComments`, `getSheetsComment`, `replyToSheetsComment`, `resolveSheetsComment`, `deleteSheetsComment`.

## Patterns

- For new structured data, create the spreadsheet with initial rows, then format the header and freeze row 1.
- For several updates, prefer `batchWrite` over repeated single-range writes.
- For status columns, use `setDropdownValidation`; strict dropdowns are good for task/status trackers.
- For visible review notes attached to a cell, prefer `createSheetsCellNote`. Drive-style Sheets comments are not truly anchored in the Sheets UI.
- For filters, prefer `setBasicFilter` for one active sheet-level filter and filter views when the user needs saved views.
- For row/column structure changes, use the dedicated row/column aliases before generic dimension operations.
- For reusable formula/chart/table references, use native Sheets named ranges rather than remembering raw A1 coordinates.
- For imported CSV-like content inside a column, use `textToColumns`; for cleanup after paste/import, use `trimWhitespace`.
- For pivot summaries, use source column offsets from the source range; inspect headers first so offsets are chosen deliberately.
- For charts, create with `insertChart` and use `updateChart` for title/range/basic chart updates.
- For table-like data, use native Sheets tables with `createTable` and append with `appendTableRows`.

## Drive Index Coordination

When creating, renaming, moving, or substantially updating a user-facing Sheet, update the Drive index if the user maintains one. The Drive index instructions live in `google-drive-private`.

## Known Gaps

This MCP still does not expose Developer Preview native cell comments. Use cell notes or Drive-style comments for review until preview support is intentionally enabled.
