---
name: google-drive-private
description: Use the private Google Docs MCP for personal Google Drive search, folders, file organization, sharing, comments, exporting, revisions, deletion, and a maintained Drive index document. Does not edit Docs, Sheets, or Slides content except for the index document.
---

# Google Drive Private

Use `mcp__google_docs_mcp` Drive tools for the user's private Google Drive. This skill owns file discovery, folder browsing, organization, sharing, comments, export/download, revisions, reversible deletion, and the optional Drive index document.

## Defaults

- Search or inspect before creating duplicates.
- Use `listFolderContents(folderId=...)` for a known folder. `searchDriveFiles(folderId=...)` now uses `parents` and supports bounded recursive search with `recursive`, `maxDepth`, and `maxFolders`.
- Treat the Drive index as a fast navigation aid, not as source of truth. Verify important results with live Drive tools before reading, editing, sharing, moving, or deleting.
- Ask before sharing publicly, granting writer access, trashing files, or permanently deleting files.
- Use `deleteFile(permanent=false)` by default for delete requests. Require explicit confirmation for `permanent=true`.
- For Slides content edits, use `google-slides-private`; Drive handles search, organization, export, sharing, and revisions.

## Main Tools

- Browse and search: `listDriveFiles`, `searchDriveFiles`, `listFolderContents`, `listDocuments`, `listSpreadsheets`.
- Organize: `createFolder`, `moveFile`, `copyFile`, `renameFile`, `deleteFile`.
- Access: `setFilePermission`.
- Export/download: `downloadFile`.
- Comments: `createFileComment`, `listFileComments`, `getFileComment`, `updateFileComment`, `deleteFileComment`, `createFileCommentReply`, `updateFileCommentReply`, `deleteFileCommentReply`.
- Revisions: `listFileRevisions`, `getFileRevision`, `exportFileRevision`, `updateFileRevision`, `deleteFileRevision`.
- Drive index: `findOrCreateDriveIndex`, `readDriveIndex`, `refreshDriveIndex`, `searchDriveIndex`, `updateDriveIndexEntry`.

## Revisions

- Google may omit older revisions for heavily edited Docs, Sheets, and Slides.
- Use `exportFileRevision` with an explicit MIME type for Google Workspace files.
- Permanent revision deletion is only supported for eligible binary file revisions and requires `confirmPermanent=true`.

## Comments

- Generic Drive comments work across file types, including Docs, Sheets, Slides, PDFs, and binary files.
- Custom Drive anchor JSON may be stored by Drive but can appear unanchored in Google Workspace editor UIs.
- For Docs text ranges and Sheets cell/range review, prefer the service-specific comment tools when a friendlier wrapper is available.

## Drive Index

Use an index document when the user wants easier personal Drive navigation or repeated searches. Read [references/drive-index.md](references/drive-index.md) before creating, refreshing, or using the index.
