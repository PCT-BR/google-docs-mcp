# Private Google Workspace MCP Patterns

This skill is adapted from practical testing against the user's `google_docs_mcp` server and from the workflow categories in `andmarios/google-workspace-skill` commit `37bb0587abd91524c75df901c848a0794a9b59e4`.

## Tested Compatibility

Tested successfully on 2026-09-03:

- Drive: create folder, list folder contents, copy file, rename file, export/download Google Docs as Markdown content, move folder to trash.
- Docs: create from Markdown, read as Markdown, append Markdown, find and replace, find text indices, create/read/write tabs, insert populated table, list tables, style table cells, batch text styling.
- Sheets: create with initial data, metadata, read, write, batch write, append rows, rename sheet, add sheet, freeze rows/columns, set borders, format cells, dropdown validation, conditional formatting, insert chart, create/list structured table, add cell notes.

Known limitations from testing:

- `listTabs(includeContent=true)` returned `characterCount: 0` even after a tab had content. Use `readDocument` with the returned `tabId` to verify tab content.
- `searchDriveFiles(folderId=...)` has been patched to use `parents` and supports bounded recursive search. For direct folder browsing, `listFolderContents(folderId=...)` is still simpler.
- Sheets comments created through Drive-style comments are not truly anchored in the Sheets UI. Prefer `createSheetsCellNote` when the review note must visibly attach to a cell.
- Google Slides scope may be present, and presentations can be listed/exported through Drive, but there are no Slides editing tools in this MCP yet.

## Drive Patterns

Use Drive search for broad discovery:

- `listDriveFiles` for browsing by MIME shortcut such as `document`, `spreadsheet`, `presentation`, `folder`, `pdf`.
- `searchDriveFiles` for name/content search across Drive.
- Use `searchDriveFiles(recursive=true, folderId=..., maxDepth=...)` for bounded folder tree search.
- `listFolderContents` for a known folder ID or root browsing.
- `downloadFile(returnAs="content")` for inline export when supported, or `returnAs="url"` when a downloadable URL is more appropriate.
- Use `findOrCreateDriveIndex`, `refreshDriveIndex`, `searchDriveIndex`, and `updateDriveIndexEntry` for the optional personal Drive index.

Permission changes are high impact:

- Ask before `setFilePermission(type="anyone", ...)`.
- Ask before granting `writer` access to a user/group.
- Prefer `allowFileDiscovery=false` for link sharing unless discoverability is explicitly requested.

Deletion:

- Use `deleteFile(permanent=false)` for normal delete requests.
- Require explicit confirmation before `permanent=true`.

## Docs Patterns

For simple document work:

- Create with `createDocument(contentFormat="markdown")` when initial content has headings, lists, links, or emphasis.
- Read with `readDocument(format="markdown")` before editing content-level prose.
- Append with `appendMarkdown` for formatted sections.
- Use `replaceDocumentWithMarkdown` only after confirmation if replacing a whole document body.

For precise edits:

- Use `findElement(textQuery=...)` to locate `startIndex` and `endIndex`.
- Use `modifyText` for small atomic replace/insert plus styling.
- Use `batchApplyTextStyle` for many style changes; prefer precomputed index ranges from one JSON read for large batches.
- Use `findAndReplace` for all-occurrence replacement only after confirming broad replacement intent.

For tabs:

- Use `listTabs` to discover IDs.
- Pass `tabId` to `readDocument`, `appendMarkdown`, `insertText`, and relevant table/style tools.
- Verify a tab by reading it directly; do not rely on the tab character count.

For tables:

- Use `insertTableWithData` when data is known upfront.
- Use `listDocumentTables` before table-specific operations.
- Use `getTableStructure` before replacing rows or applying table-specific styling.
- Use `updateTableCellStyle`, `updateTableBorders`, `updateTableColumnWidth`, and `updateTableRowStyle` for formatting.

For advanced document structure:

- Use `listHeadersFooters`, `createHeader`, `createFooter`, `insertHeaderFooterText`, `deleteHeader`, and `deleteFooter`.
- Use `insertFootnote`, `listFootnotes`, and `insertFootnoteText`.
- Use `createNamedRange`, `listNamedRanges`, `deleteNamedRange`, and `replaceNamedRange` for repeatable template fields.
- Use `getDocumentPageFormat` before `setDocumentPageFormat` when changing margins, page size, header/footer variants, or page/pageless mode.

Docs features from `andmarios/google-workspace-skill` that are not clearly covered by this MCP include suggestions/tracked changes, positioned object replacement, and rich Markdown insertion inside header/footer/footnote segments.

## Sheets Patterns

Start every non-trivial spreadsheet task with `getSpreadsheetInfo` to learn sheet titles, numeric sheet IDs, and dimensions. Use A1 notation with sheet names for value operations.

Data operations:

- `readSpreadsheet` for a range.
- `writeSpreadsheet` to overwrite a range.
- `batchWrite` for multiple ranges in one API call.
- `appendRows` for adding rows after existing data.
- `clearRange` only after confirmation.
- Use `valueInputOption="USER_ENTERED"` for formulas, dates, and values that should behave as if typed into Sheets.
- Use `valueRenderOption="FORMULA"` when the user asks to inspect formulas.

Sheet management:

- `addSheet`, `renameSheet`, `duplicateSheet`, `copySheetTo`, `deleteSheet`.
- Ask before deleting a sheet tab.

Formatting and structure:

- `formatCells` for bold, colors, alignment, wrap, and number formats.
- `setCellBorders` for borders.
- `setColumnWidths`, `setRowHeights`, `autoResizeColumns`, `autoResizeRows`.
- `freezeRowsAndColumns` for header rows/columns.
- `addConditionalFormatting`, `getConditionalFormatting`, and `deleteConditionalFormatting`.
- `setBasicFilter`, `clearBasicFilter`, `createFilterView`, `listFilterViews`, `updateFilterView`, and `deleteFilterView`.
- `insertRows`, `deleteRows`, `moveRows`, `insertColumns`, `deleteColumns`, `moveColumns`.
- `mergeCells` and `unmergeCells`.
- `setDropdownValidation` for common status/choice columns.
- `protectRange` for warning or locked ranges.

Tables and charts:

- `createTable`, `listTables`, `getTable`, `appendTableRows`, `updateTableRange`, and `deleteTable`.
- `insertChart`, `updateChart`, and `deleteChart`.

Sheets features from `andmarios/google-workspace-skill` that are not clearly covered by this MCP include pivot tables, Sheets named ranges, trim whitespace, and text-to-columns.

## Mapping From `andmarios/google-workspace-skill`

Mostly supported:

- Docs read/create/append/replace/find/format/tabs/tables/images/export.
- Sheets read/create/write/append/format/sheet tabs/conditional formatting/validation/charts/tables/protection.
- Drive list/search/folder/copy/move/rename/delete/share/download/export.

Partially supported:

- Drive comments and revisions: Docs comments may be limited; Sheets has comment/note tools. Revision and change tracking were not exposed.
- Advanced Docs layout: section breaks, page breaks, headers/footers, footnotes, named ranges, and page format tools are available; suggestions/tracked changes are not exposed.
- Advanced Sheets manipulation: strong for formatting/tables/charts/filters/merges/row-column transforms, weaker for pivots, named ranges, trim whitespace, and text-to-columns.

Not supported in this MCP configuration:

- Gmail, Calendar, Contacts.
- Slides creation/editing, despite Drive visibility and export support.
- The `gws-cli` command interface itself; use MCP tools directly.
