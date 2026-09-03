# Priorities 1-3 Development Plan

Scope: private Google Workspace MCP for Drive, Docs, and Sheets. Keep Gmail, Calendar, Contacts, Firestore, and full Slides editing out of this plan.

## Goals

- Add a Drive index workflow so agents can maintain a lightweight Google Doc index of folders and files.
- Fix and test Drive search within a folder or folder subtree.
- Make Docs comments fully usable and visible in the active MCP deployment.
- Add high-value Sheets operations from the compatibility gap: filters, row/column structural edits, merge/unmerge, and chart updates.
- Add useful Docs document features: headers/footers, footnotes, named ranges/placeholders, and page format detection/update.

## Non-Goals

- No Gmail, Calendar, Contacts.
- No full Google Slides editing in this batch.
- No permanent background crawler or external database.
- No Firestore requirement for the Drive index.

## Priority 1

### P1.1 Drive Index Tools

Add tools under `src/tools/drive/` or `src/tools/utils/driveIndex/`.

Proposed tools:

- `findOrCreateDriveIndex`
- `readDriveIndex`
- `refreshDriveIndex`
- `searchDriveIndex`
- `updateDriveIndexEntry`

Recommended index document title: `Codex Drive Index`.

Recommended index format:

- Markdown Google Doc.
- Sections: folders, Docs, Sheets, Slides/other files.
- Rows include title/name, file ID, MIME type, parent/folder hint, modified time, URL, optional notes.
- Include `Last refreshed` timestamp.

Implementation notes:

- Use Drive API for live listing and Docs/Markdown tools or Docs API batch updates for index document updates.
- Treat the index as cache only. Tool descriptions should say to verify live Drive data before mutating files.
- Keep refresh bounded. Support `folderId`, `maxDepth`, `mimeTypes`, and `maxFiles` parameters so a user does not accidentally crawl a huge Drive.
- For incremental updates, `updateDriveIndexEntry` can read current Markdown, update a matching ID row, or append a row under the best section.

Tests:

- Unit test Markdown generation from mock Drive file records.
- Unit test parsing/updating an existing index row by file ID.
- Unit test bounded traversal/depth behavior.
- Tool registration test confirms all Drive index tools are exposed when `drive` and `docs` groups are enabled, or document in README if `utils` is also required.

Acceptance:

- Can create the index document if missing.
- Can refresh root-level index from live Drive data.
- Can search the index by title/name/type.
- Can update one entry after create/rename/move/share.
- Does not permanently delete or publicly share anything.

### P1.2 Fix `searchDriveFiles(folderId=...)`

Current live behavior: `searchDriveFiles` with a newly-created folder ID returned `Invalid Value`. Existing implementation uses `'<folderId>' in ancestors`, which may not be valid for Drive API v3 file search.

Implementation path:

1. Reproduce with a live or mocked query.
2. Replace unsupported ancestor query behavior.
3. For direct folder search, use `'<folderId>' in parents`.
4. For recursive subtree search, add an explicit traversal helper:
   - list descendants folder-by-folder with `files.list`
   - run search within each direct folder using parent filters
   - cap with `maxDepth` and `maxFolders`
5. Update tool description so behavior is honest: direct parent search by default, optional recursive traversal if implemented.

Tests:

- Unit test query builder for root, direct folder, name/content/mime filters.
- Mock recursive traversal with nested folders.
- Regression test for fullText sorting rule already in the file.

Acceptance:

- `searchDriveFiles(folderId=<folder>, searchIn="name")` works for files directly in the folder.
- Recursive behavior works only when explicitly requested and bounded.
- Errors mention the invalid query shape if Google rejects it.

### P1.3 Docs Comments Exposure/Audit

Code already exists:

- `src/tools/docs/comments/listComments.ts`
- `getComment.ts`
- `addComment.ts`
- `replyToComment.ts`
- `resolveComment.ts`
- `deleteComment.ts`
- registered from `src/tools/docs/index.ts`

Implementation path:

1. Confirm these tools are present in generated/cached tool list and runtime when `MCP_TOOL_GROUPS=docs,drive,sheets,utils`.
2. If not exposed, inspect `cachedToolsList.ts`, build output, deployment branch, and tool name collisions.
3. Add tests for registration and basic parameter schemas.
4. Live smoke test on a temporary Google Doc:
   - create comment
   - list comment
   - reply
   - resolve
   - optionally delete if safe

Potential fixes:

- Rename `addComment` to `createComment` or add alias if tool naming caused discoverability confusion.
- Improve descriptions to mention Google Docs explicitly.
- Ensure Drive scope is included for comment operations.

Acceptance:

- MCP client sees all Docs comment tools.
- Create/list/get/reply/resolve/delete work or limitations are documented.

## Priority 2

### P2.1 Sheets Filters And Filter Views

Add tools under `src/tools/sheets/`.

Proposed tools:

- `setBasicFilter`
- `clearBasicFilter`
- `createFilterView`
- `listFilterViews`
- `updateFilterView`
- `deleteFilterView`

Implementation notes:

- Use Sheets API `setBasicFilter`, `clearBasicFilter`, `addFilterView`, `updateFilterView`, `deleteFilterView`.
- Accept A1 ranges where possible; reuse or add an A1-to-GridRange helper.
- Include `sheetName` alternative for user ergonomics.

Tests:

- Unit test A1 range conversion.
- Unit test request payloads for basic filter and filter views.
- Registration test.

Acceptance:

- Can enable/clear basic filters on a range.
- Can create/list/update/delete named filter views.

### P2.2 Sheets Row/Column Structural Operations

Proposed tools:

- `insertRows`
- `deleteRows`
- `moveRows`
- `insertColumns`
- `deleteColumns`
- `moveColumns`

Implementation notes:

- Use Sheets API `insertDimension`, `deleteDimension`, `moveDimension`.
- Parameters should be human-oriented: 1-based rows, A1 columns or 1-based column indexes.
- Ask/describe destructive behavior for delete tools.
- Validate bounds against `getSpreadsheetInfo` where needed or let API return a clear error.

Tests:

- Unit test index conversion.
- Unit test payloads for row vs column.
- Registration test.

Acceptance:

- Can insert/delete/move rows and columns without touching cell values outside the targeted dimension operation.

### P2.3 Sheets Merge/Unmerge

Proposed tools:

- `mergeCells`
- `unmergeCells`

Implementation notes:

- Use Sheets API `mergeCells` and `unmergeCells`.
- Accept A1 ranges and a merge type: `MERGE_ALL`, `MERGE_ROWS`, `MERGE_COLUMNS`.

Tests:

- Unit test GridRange conversion.
- Unit test merge type payload.

Acceptance:

- Can merge and unmerge a range.

### P2.4 Chart Update

Proposed tool:

- `updateChart`

Implementation notes:

- Use Sheets API `updateChartSpec`.
- Consider a minimal first version: update title, chart type, legend position, and data range.
- If preserving existing chart spec requires reading spreadsheet metadata, implement helper to fetch chart spec by ID first.

Tests:

- Unit test update spec merging.
- Error test when chart ID is not found.

Acceptance:

- Can update title/type/legend for an existing chart without recreating it.

## Priority 3

### P3.1 Docs Headers And Footers

Proposed tools:

- `listHeadersFooters`
- `createHeader`
- `createFooter`
- `insertHeaderFooterText`
- `deleteHeader`
- `deleteFooter`

Implementation notes:

- Use Docs API `createHeader`, `createFooter`, `insertText`, `deleteHeader`, `deleteFooter`.
- Segment IDs are different from body indexes; descriptions must explain that.

Tests:

- Unit test request payloads.
- Structure parsing test for listing header/footer IDs.

Acceptance:

- Can create a default header/footer and insert text into it.

### P3.2 Docs Footnotes

Proposed tools:

- `insertFootnote`
- `listFootnotes`
- `insertFootnoteText`

Implementation notes:

- Use Docs API `createFootnote` and segment insertion.
- Make it clear that footnote text uses the footnote segment ID.

Tests:

- Unit test create footnote request.
- Unit test extraction of footnote IDs from document JSON.

Acceptance:

- Can create a footnote and insert text in the footnote body.

### P3.3 Docs Named Ranges And Placeholders

Proposed tools:

- `createNamedRange`
- `listNamedRanges`
- `deleteNamedRange`
- `replaceNamedRange`
- optionally `fillDocumentTemplate`

Implementation notes:

- Use Docs API named ranges.
- `replaceNamedRange` should support lookup by name or ID.
- `fillDocumentTemplate` can be a higher-level utility that maps placeholder names to replacement Markdown/text.

Tests:

- Unit test range lookup by name/ID.
- Unit test replacement request order: delete old range content, insert new content.
- Test duplicate named range names produce clear ambiguity errors.

Acceptance:

- Can create, list, replace, and delete named ranges.
- Template workflow is usable for personal recurring docs.

### P3.4 Page Format Detection/Update

Proposed tools:

- `getDocumentPageFormat`
- `setDocumentPageFormat`

Implementation notes:

- Detect page mode from document style where available.
- Support pageless/pages only if exposed by Google Docs API version in use.
- If the API does not expose the exact mode reliably, implement only `getDocumentStyle`/`updateDocumentStyle` for margins/page size and document the gap.

Tests:

- Unit test document style parsing.
- Unit test update payloads for margins/page size/page format when supported.

Acceptance:

- Can inspect document style.
- Can update supported style fields safely.

## Suggested Branching

Use one branch for the batch, but land in reviewable commits:

```text
branch: private-workspace-priority-1-3

commit 1: Fix Drive folder search
commit 2: Add Drive index tools
commit 3: Audit/expose Docs comment tools
commit 4: Add Sheets filters and filter views
commit 5: Add Sheets row/column and merge tools
commit 6: Add chart update
commit 7: Add Docs headers/footers and footnotes
commit 8: Add Docs named ranges and document style tools
commit 9: Update README and private skills
```

## Test Strategy

Run on every commit:

```bash
npm run build
npm test
```

Add focused tests next to each tool. Prefer unit tests for request payloads and registration, with one optional live smoke test file per service guarded by environment variables.

Minimum live smoke before deploying:

- Drive: create folder, create index, refresh index, search index, trash folder.
- Docs: create doc, add/list/reply/resolve comment, create header/footer or named range if implemented.
- Sheets: create sheet, set filter, insert row, merge/unmerge, create/update chart.

## Deployment Notes

Keep Railway environment scoped:

```text
MCP_TOOL_GROUPS=docs,drive,sheets,utils
```

OAuth scopes may need review after adding tools:

- Drive index and comments require Drive read/write scope already used by Drive tools.
- Docs headers/footers/footnotes/named ranges require Docs document scope already used by Docs tools.
- Sheets filters/structural/chart tools require Sheets scope already used by Sheets tools.

No new Gmail, Calendar, Contacts, or Slides scopes should be added for this plan.

## Skill Updates After Implementation

Update local skills after the MCP tools exist:

- `google-drive-private`: add Drive index tools as first-class tools and remove folder search workaround if fixed.
- `google-docs-private`: move implemented Docs features out of Known Gaps.
- `google-sheets-private`: move filters, structural ops, merge/unmerge, and chart updates out of Known Gaps.
- `google-workspace-private`: keep as router only.
