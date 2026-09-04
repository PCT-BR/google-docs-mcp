---
name: google-docs-private
description: Use the private Google Docs MCP to create, read, edit, format, export, and structure personal Google Docs, including Markdown content, tabs, tables, images, comments, and precise text edits.
---

# Google Docs Private

Use `mcp__google_docs_mcp` Docs tools for personal Google Docs. Use Drive tools only to locate the document, export it, organize it, or update the optional Drive index after meaningful changes.

## Defaults

- Prefer `readDocument(format="markdown")` for prose editing and review.
- Use `readDocument(format="json")` or `findElement` when exact indices are needed.
- Prefer `appendMarkdown` for adding formatted sections.
- Ask before `replaceDocumentWithMarkdown` unless the target is the user's Drive index document or a test document created for the task.
- Ask before broad `findAndReplace` operations that may affect many occurrences.
- Verify meaningful writes with `readDocument`, `listTabs`, `listDocumentTables`, or `getTableStructure`.

## Main Tools

- Create/read/export: `createDocument`, `readDocument`, `downloadFile`.
- Suggestions read-only: `listDocumentSuggestions`, plus `readDocument(suggestionsViewMode=...)`.
- Markdown edits: `appendMarkdown`, `replaceDocumentWithMarkdown`, `replaceRangeWithMarkdown`.
- Precise edits: `findElement`, `insertText`, `deleteRange`, `modifyText`, `findAndReplace`.
- Styling: `batchApplyTextStyle`, `applyParagraphStyle`.
- Tabs: `listTabs`, `addTab`, `renameTab`.
- Tables: `insertTable`, `insertTableWithData`, `listDocumentTables`, `getTableStructure`, `replaceTableRowData`, `deleteTableRows`, `updateTableCellStyle`, `updateTableBorders`, `updateTableColumnWidth`, `updateTableRowStyle`, `cloneTable`.
- Rich elements: `insertImage`, `insertDateChip`, `insertPerson`, `insertRichLink`, `insertPageBreak`, `insertSectionBreak`, `updateSectionStyle`.
- Headers/footers: `listHeadersFooters`, `createHeader`, `createFooter`, `insertHeaderFooterText`, `deleteHeader`, `deleteFooter`.
- Footnotes: `insertFootnote`, `listFootnotes`, `insertFootnoteText`.
- Named ranges/templates: `createNamedRange`, `listNamedRanges`, `deleteNamedRange`, `replaceNamedRange`.
- Page format: `getDocumentPageFormat`, `setDocumentPageFormat`.

## Patterns

- For a new document from structured prose, create from Markdown and then read it back as Markdown.
- For a small targeted edit, locate text with `findElement(textQuery=...)` or use `modifyText` with `textToFind`.
- For many style changes, do one structure read or one search pass, then use `batchApplyTextStyle`.
- For tabs, use `listTabs` to get IDs, but verify content with `readDocument(tabId=...)`; live testing showed tab character counts can be unreliable.
- For tables, insert known data with `insertTableWithData`, then call `listDocumentTables` before applying table operations.
- For headers/footers, create the segment first, then insert text with `insertHeaderFooterText` using the returned segment ID.
- For template-like documents, create named ranges around placeholders and update later with `replaceNamedRange`.
- For page vs pageless or document-wide margins, inspect with `getDocumentPageFormat` before `setDocumentPageFormat`.

## Drive Index Coordination

When creating, renaming, moving, or substantially updating a user-facing Doc, update the Drive index if the user maintains one. The Drive index instructions live in `google-drive-private`.

## Known Gaps

This MCP still does not expose suggestion/tracked-change write actions, positioned object replacement, or full Markdown insertion inside header/footer/footnote segments. Suggestion write actions require Google Developer Preview support.
