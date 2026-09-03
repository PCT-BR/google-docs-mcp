---
name: google-drive-private
description: Use the private Google Docs MCP for personal Google Drive search, folders, file organization, sharing, exporting, deletion, and a maintained Drive index document. Does not edit Docs or Sheets content except for the index document.
---

# Google Drive Private

Use `mcp__google_docs_mcp` Drive tools for the user's private Google Drive. This skill owns file discovery, folder browsing, organization, sharing, export/download, reversible deletion, and the optional Drive index document.

## Defaults

- Search or inspect before creating duplicates.
- Use `listFolderContents(folderId=...)` for a known folder. `searchDriveFiles(folderId=...)` now uses `parents` and supports bounded recursive search with `recursive`, `maxDepth`, and `maxFolders`.
- Treat the Drive index as a fast navigation aid, not as source of truth. Verify important results with live Drive tools before reading, editing, sharing, moving, or deleting.
- Ask before sharing publicly, granting writer access, trashing files, or permanently deleting files.
- Use `deleteFile(permanent=false)` by default for delete requests. Require explicit confirmation for `permanent=true`.
- Slides may be listed, searched, and exported through Drive, but this MCP does not edit Slides.

## Main Tools

- Browse and search: `listDriveFiles`, `searchDriveFiles`, `listFolderContents`, `listDocuments`, `listSpreadsheets`.
- Organize: `createFolder`, `moveFile`, `copyFile`, `renameFile`, `deleteFile`.
- Access: `setFilePermission`.
- Export/download: `downloadFile`.
- Drive index: `findOrCreateDriveIndex`, `readDriveIndex`, `refreshDriveIndex`, `searchDriveIndex`, `updateDriveIndexEntry`.

## Drive Index

Use an index document when the user wants easier personal Drive navigation or repeated searches. Read [references/drive-index.md](references/drive-index.md) before creating, refreshing, or using the index.
