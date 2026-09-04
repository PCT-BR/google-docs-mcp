# Private Workspace Gaps And Google Slides Plan

Status: in progress

Target deployment: private personal Google account on Railway, without Firestore.

## Goals

- Close every currently identified gap in Docs, Drive, and Sheets when the public Google APIs support it.
- Add Google Slides as an independent tool group and Codex skill.
- Keep Gmail, Calendar, Contacts, and Apps Script optional and disabled in the private deployment.
- Preserve least-privilege OAuth configuration and the stateless Railway deployment.
- Distinguish stable features from Google Developer Preview features and hard API limitations.

## Feasibility Summary

| Area   | Gap                                                   | Feasibility                                                  | Delivery rule                                                    |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Docs   | Read suggestions and accepted/rejected previews       | Stable                                                       | Implemented first pass                                           |
| Docs   | Create, accept, reject, or delete suggestions         | Developer Preview                                            | Feature flag; do not require for private free account            |
| Docs   | Replace images and delete positioned objects          | Stable                                                       | Implemented first pass                                           |
| Docs   | Rich content in header/footer/footnote segments       | Stable with segment constraints                              | Refactor Markdown targeting and reject unsupported constructs    |
| Drive  | Revisions and historical exports                      | Stable, but history may be incomplete                        | Implemented first pass with explicit limitations                 |
| Drive  | Generic comments and anchors                          | Stable, but editor apps display custom anchors as unanchored | Implemented generic file tools with honest descriptions          |
| Drive  | Automatic Drive index maintenance                     | Application feature                                          | Implement opt-in post-write synchronization                      |
| Sheets | Pivot tables                                          | Stable                                                       | Implemented first pass around the anchor cell                    |
| Sheets | Named ranges                                          | Stable                                                       | Implemented first pass                                           |
| Sheets | Trim whitespace                                       | Stable                                                       | Implemented first pass                                           |
| Sheets | Text to columns                                       | Stable                                                       | Implemented first pass                                           |
| Sheets | Native cell comments                                  | Developer Preview                                            | Optional; retain cell notes and Drive-comment fallback           |
| Slides | Core creation, reading, editing, media, tables, notes | Stable                                                       | Initial tool group plus thumbnails and speaker notes implemented |
| Slides | Animations, transitions, notes-master editing         | Not exposed by the public API                                | Document as hard limitations                                     |

Developer Preview is not a baseline dependency. Google currently requires an application to the Workspace Developer Preview Program with a Workspace account and Cloud project. The stable MCP must remain fully useful without it, including for a personal free Google account.

## Track A: Close Existing Gaps

### A1. Shared Foundations

Add reusable infrastructure before adding tools:

- `src/tools/shared/batchUpdate.ts`: normalized Google error handling and optional write-control support.
- `src/tools/shared/fieldMask.ts`: validate explicit field masks; never default destructive updates to `*`.
- `src/tools/sheets/rangeHelpers.ts`: central A1 to `GridRange` and single-cell coordinate conversion.
- `src/tools/drive/revisionHelpers.ts`: MIME-aware historical export and download behavior.
- Registration tests in `src/tools/index.test.ts` for every new stable and preview-gated tool.

Acceptance:

- Helpers are unit-tested independently.
- Tool schemas remain strict Zod objects.
- Every destructive operation has explicit wording and a narrow target.

### A2. Sheets Stable Gaps

Create `src/tools/sheets/namedRanges.ts`:

- `createSheetNamedRange(spreadsheetId, name, range)`
- `listSheetNamedRanges(spreadsheetId)`
- `updateSheetNamedRange(spreadsheetId, namedRangeId, name?, range?)`
- `deleteSheetNamedRange(spreadsheetId, namedRangeId)`

Create `src/tools/sheets/dataCleanup.ts`:

- `trimWhitespace(spreadsheetId, range)`
- `textToColumns(spreadsheetId, sourceRange, delimiterType, delimiter?)`

Rules:

- `textToColumns` must require a one-column source range.
- Allowed delimiter types: `COMMA`, `SEMICOLON`, `PERIOD`, `SPACE`, `CUSTOM`, `AUTODETECT`.
- `CUSTOM` requires `delimiter`; all other modes reject it.
- Both tools return the affected range and read it back when practical.

Create `src/tools/sheets/pivotTables.ts`:

- `createPivotTable(spreadsheetId, sourceRange, destinationCell, rows, columns, values, filters?)`
- `listPivotTables(spreadsheetId, sheetName?)`
- `getPivotTable(spreadsheetId, sheetName, anchorCell)`
- `updatePivotTable(spreadsheetId, sheetName, anchorCell, definition)`
- `deletePivotTable(spreadsheetId, sheetName, anchorCell)`

Implementation details:

- A pivot table is stored in the single anchor cell's `pivotTable` field.
- Create/update use `updateCells(fields="pivotTable")`.
- Delete clears only the anchor cell's `pivotTable` field, not the rendered result range.
- Use human-oriented source column selectors, resolved to zero-based source offsets.
- Support common summarize functions first: `SUM`, `COUNTA`, `COUNT`, `AVERAGE`, `MAX`, `MIN`, and `CUSTOM` formula.
- Return the normalized pivot definition after writes.

Tests:

- Named-range CRUD request payloads and duplicate-name behavior.
- A1 validation for cleanup operations.
- Pivot source offsets, destination anchor, grouping, values, filters, and deletion.
- One live spreadsheet smoke test covering all four gap categories.

### A3. Docs Stable Gaps

Create `src/tools/docs/suggestions.ts` with stable read support:

- Extend `readDocument` with `suggestionsViewMode` values `INLINE`, `ACCEPTED_PREVIEW`, and `REJECTED_PREVIEW`.
- `listDocumentSuggestions(documentId, tabId?)` extracts suggestion IDs, affected ranges, kind, and proposed content/style changes from document JSON.
- Do not describe preview modes as changing the document; they only change the returned representation.

Create `src/tools/docs/objects.ts`:

- `listDocumentImages(documentId, tabId?)`
- `replaceDocumentImage(documentId, imageObjectId, imageUrl, imageReplaceMethod?, tabId?)`
- `deletePositionedObject(documentId, objectId, tabId?)`

Rules:

- `replaceDocumentImage` supports both inline and positioned image object IDs where Google accepts them.
- Reuse the secure image URL strategy already used by `insertImage`.
- Return the object's previous metadata and verify the new source/metadata after replacement.
- Deletion requires an exact object ID and must never infer a target from visual order alone.

Refactor Markdown insertion for non-body segments:

- Generalize Markdown request locations to support `{index, segmentId, tabId}`.
- Add `insertSegmentMarkdown(documentId, segmentId, markdown, index?, tabId?)`.
- Add convenience aliases `insertHeaderMarkdown`, `insertFooterMarkdown`, and `insertFootnoteMarkdown` only if they materially improve tool selection.
- First support paragraphs, headings where accepted, bold, italic, underline, links, lists, and line breaks.
- Detect and reject unsupported segment constructs before sending a partial batch, especially tables or elements Google forbids in a segment.
- Keep `insertHeaderFooterText` and `insertFootnoteText` as simple low-level tools.

Tests:

- Suggestion parsing for text insertion, deletion, and style suggestions.
- Inline and positioned image discovery/replacement payloads.
- Segment-aware Markdown request indexes and field locations.
- Live test with one header, footer, and footnote.

### A4. Drive Revisions And Generic Comments

Create `src/tools/drive/revisions.ts`:

- `listFileRevisions(fileId, pageSize?, pageToken?)`
- `getFileRevision(fileId, revisionId)`
- `exportFileRevision(fileId, revisionId, mimeType, returnAs?)`
- `updateFileRevision(fileId, revisionId, keepForever?, published?, publishAuto?)`
- `deleteFileRevision(fileId, revisionId, confirmPermanent)` for eligible binary revisions only

Rules:

- State that Google may omit older revisions for heavily edited Docs, Sheets, and Slides.
- Historical Google Workspace files use revision `exportLinks`; binary revisions use media download.
- `keepForever` and revision deletion apply only where Google permits them.
- Revision deletion must require `confirmPermanent=true` and reject Google Workspace editor files.

Generalize existing comments into `src/tools/drive/comments/`:

- `createFileComment(fileId, content, anchor?)`
- `listFileComments(fileId, includeDeleted?, pageToken?)`
- `getFileComment(fileId, commentId)`
- `updateFileComment(fileId, commentId, content)`
- `deleteFileComment(fileId, commentId)`
- `createFileCommentReply`, `updateFileCommentReply`, `deleteFileCommentReply`

Reuse the implementation from Docs/Sheets aliases to avoid two separate comment stacks. Preserve service-specific aliases for compatibility.

Important limitation:

- Drive stores custom anchor JSON, but Google Workspace editors may show these comments as unanchored. Tool descriptions must not promise a visible cell/text anchor.

### A5. Opt-In Drive Index Synchronization

Add environment configuration:

```text
MCP_DRIVE_INDEX_AUTO_UPDATE=false
MCP_DRIVE_INDEX_DOCUMENT_ID=
```

Implement `src/tools/drive/indexSync.ts`:

- A post-write hook receives a typed event: create, copy, rename, move, trash, restore, permission change, or content update.
- When enabled and an index ID is configured, fetch current file metadata and call the existing index upsert logic.
- Trashed files are marked as trashed or removed according to one documented policy; do not silently erase user notes.
- Index-update failure must not make the primary Google operation appear to have failed. Return `indexSync: {status, error?}` with the tool result.
- Prevent recursion when the modified file is the index document itself.

Delivery stages:

1. Integrate file lifecycle tools: create, copy, rename, move, trash, restore, and sharing.
2. Integrate Docs, Sheets, and Slides creation tools.
3. Mark content edits with a lightweight modified-time refresh rather than rebuilding the full index.
4. Add `refreshDriveIndexIncremental` using Drive Changes page tokens stored inside the index document metadata section. This remains user-triggered or scheduled by the MCP client; no background worker is required.

### A6. Developer Preview Tools

Gate all preview tools behind:

```text
MCP_ENABLE_GOOGLE_PREVIEW_TOOLS=false
```

Docs preview tools:

- `suggestDocumentEdit`: apply supported Docs batch requests with `writeControl.writeMode="SUGGEST"`.
- `acceptDocumentSuggestion`
- `rejectDocumentSuggestion`
- `deleteDocumentSuggestion`
- Native Docs comment-thread tools only after confirming they improve on the Drive fallback.

Sheets preview tools:

- `createNativeSheetsComment`
- `replyToNativeSheetsComment`
- `updateNativeSheetsCommentPost`
- `deleteNativeSheetsComment`
- `deleteNativeSheetsCommentReply`

Engineering constraints:

- Confirm the installed `googleapis` release contains the preview schemas. Upgrade intentionally or use the dedicated preview client; do not scatter untyped casts through tool files.
- Surface `commentUpdateState` and partial failure states from batch responses.
- The server must start and all stable tools must work when preview access is absent.
- For a personal free account without Preview enrollment, keep current Drive comments and Sheets cell notes as the supported fallback.

## Track B: Google Slides

### B1. Service And OAuth Foundation

Add `slides` to `GOOGLE_TOOL_GROUPS` and map it to:

```text
https://www.googleapis.com/auth/presentations
```

Changes:

- `src/googleScopes.ts`: group and scope.
- `src/tools/index.ts`: register `registerSlidesTools`.
- `src/clients.ts`: initialize `slides_v1.Slides` and add `getSlidesClient()`.
- `src/remoteWrapper.ts`: add a per-request Slides client.
- `src/tools/slides/index.ts`: central registration.
- `src/tools/index.test.ts`: group, scope, and registration coverage.

Deployment:

- Enable Google Slides API in the existing Google Cloud project.
- Change Railway to `MCP_TOOL_GROUPS=docs,drive,sheets,slides,utils`.
- Reconnect LibreChat and Codex so Google grants the new `presentations` scope.
- Keep the existing broad Drive scope because this private MCP searches and organizes the whole personal Drive. `drive.file` alone would not preserve that behavior.

### B2. Read And Lifecycle Tools

Create:

- `createPresentation(title, parentFolderId?)`
- `getPresentation(presentationId, includeMasters?, includeLayouts?, includeNotes?)`
- `listSlides(presentationId)`
- `getSlide(presentationId, slideObjectId)`
- `getSlideThumbnail(presentationId, slideObjectId, size?)`
- `createSlide(presentationId, layout?, insertionIndex?)`
- `duplicateSlide(presentationId, slideObjectId, insertionIndex?)`
- `moveSlides(presentationId, slideObjectIds, insertionIndex)`
- `deleteSlide(presentationId, slideObjectId)`
- `setSlideSkipped(presentationId, slideObjectId, isSkipped)`

Add a normalized `readPresentation` response for agents:

- Presentation title, ID, URL, page size.
- Ordered slides with IDs.
- Flattened text by element and table cell.
- Element IDs, kinds, positions, dimensions, and alt text.
- Layout/master references.
- Optional speaker notes.

### B3. Text, Shapes, And Layout

Create text tools:

- `createTextBox`
- `insertSlideText`
- `replaceAllSlideText`
- `deleteSlideText`
- `updateSlideTextStyle`
- `updateSlideParagraphStyle`
- `createSlideBullets`
- `deleteSlideBullets`

Create element/layout tools:

- `createShape`
- `updateShapeProperties`
- `updatePageElementTransform`
- `updatePageBackground`
- `createLine`
- `updateLineProperties`
- `groupSlideObjects`
- `ungroupSlideObjects`
- `updateSlideObjectZOrder`
- `updateSlideObjectAltText`
- `deleteSlideObject`

Use points in public tool parameters and convert to EMU internally. Offer sensible shape/text-box defaults, but always return generated object IDs for follow-up edits.

### B4. Images, Video, And Sheets Charts

Create:

- `insertSlideImage`
- `replaceSlideImage`
- `updateSlideImageProperties`
- `insertSlideVideo`
- `updateSlideVideoProperties`
- `insertSheetsChartInSlide`
- `refreshSheetsChartInSlide`

Rules:

- Slides image creation requires a publicly retrievable URL and supports PNG, JPEG, and GIF within Google's current limits.
- Reuse the existing upload strategy, but never make a private Drive image public without explicit authorization.
- Prefer a caller-provided URL or a short-lived download proxy URL for private images.
- Linked Sheets charts require Sheets/Drive access already present in this deployment.

### B5. Tables And Speaker Notes

Create table tools:

- `createSlideTable`
- `writeSlideTableCell`
- `insertSlideTableRows`, `deleteSlideTableRow`
- `insertSlideTableColumns`, `deleteSlideTableColumn`
- `mergeSlideTableCells`, `unmergeSlideTableCells`
- `updateSlideTableCellStyle`
- `updateSlideTableBorders`
- `updateSlideTableRowProperties`, `updateSlideTableColumnProperties`

Create notes tools:

- `readSpeakerNotes(presentationId, slideObjectId)`
- `replaceSpeakerNotes(presentationId, slideObjectId, text)`
- `appendSpeakerNotes(presentationId, slideObjectId, text)`

Only the speaker-notes text shape is editable. Notes page properties and the notes master remain read-only.

### B6. Template And Agent-Level Workflows

Add high-value composite tools after low-level operations are stable:

- `createPresentationFromTemplate(templateId, title, parentFolderId?, textReplacements?, imageReplacements?, chartReplacements?)`
- `fillPresentationTemplate(presentationId, textReplacements?, imageReplacements?, chartReplacements?, slideObjectIds?)`
- `createSlideWithContent(presentationId, layout, title?, body?, notes?, imageUrl?)`

Template flow:

1. Copy the source presentation with Drive `files.copy`.
2. Apply text replacements in one Slides `batchUpdate`.
3. Apply image and linked-chart replacements.
4. Read back the presentation and report replacement counts and unresolved placeholders.
5. Update the Drive index when enabled.

Do not modify the original template.

### B7. Slides Skill

Create `skills/google-slides-private/`:

- `SKILL.md`: discovery, creation, layout selection, element IDs, template workflow, notes, and verification.
- `agents/openai.yaml`: display metadata.
- `references/slides-layout-and-units.md`: points, EMU transforms, object IDs, layouts, and placeholders.

Update:

- `skills/google-workspace-private/SKILL.md` to route Slides tasks.
- `skills/google-drive-private/SKILL.md` to distinguish Drive-level Slides operations from content editing.
- README capability tables and Google Cloud setup.

## API Limits That Remain After Delivery

These should remain documented rather than simulated:

- Developer Preview features are unavailable unless Google approves the Cloud project and Workspace account.
- Drive revision lists can omit old revisions from long histories.
- Drive custom comment anchors are not guaranteed to appear anchored in Google editors.
- Slides animations and transitions are not represented by a public batch-update request.
- Slides notes masters are read-only; only speaker-note text is editable.
- Slides image insertion requires Google to retrieve the image URL.
- Full fidelity import/export and rendering are controlled by Google; thumbnail and PPTX/PDF export should be used for verification, not treated as editable source equivalence.

## Test Strategy

For every lot:

```bash
npm run build
npm test
npm run format:check
```

Unit tests:

- Request builders, field masks, ID/range conversions, and response normalization.
- Tool registration by enabled group.
- Error mapping for 400, 403, 404, quota errors, and unsupported preview access.
- No public sharing or permanent deletion as an implicit side effect.

Live smoke fixtures, gated by environment variables:

- One temporary Doc for suggestions read modes, image replacement, and segment Markdown.
- One temporary Sheet for named ranges, cleanup, text-to-columns, and pivots.
- One temporary binary file and Workspace file for revision behavior.
- One temporary presentation covering lifecycle, text, image, table, notes, chart, template copy, thumbnail, and export.
- Cleanup uses trash by default; permanent revision deletion gets a separate opt-in test.

Visual verification for Slides:

- Fetch slide thumbnails after meaningful visual writes.
- Verify the thumbnail is nonblank and expected elements appear.
- Export the final smoke deck as PDF or PPTX and confirm all slides are present.

## Suggested Delivery Order

1. Sheets named ranges, trim whitespace, and text-to-columns.
2. Sheets pivot tables.
3. Docs suggestion read modes and object/image tools.
4. Docs segment-aware Markdown.
5. Drive revisions and generalized comments.
6. Opt-in Drive index synchronization.
7. Slides foundation, read model, and slide lifecycle.
8. Slides text, shapes, positioning, and styling.
9. Slides media, charts, tables, and speaker notes.
10. Slides template workflows and skill.
11. Developer Preview tools only after account/project enrollment is confirmed.

Each item should land as a reviewable commit with focused tests. Deploy after stable tracks 1-6, then deploy Slides after tracks 7-10 so OAuth scope changes happen once. Preview tools should be a separate deployment decision.

## Definition Of Done

- Every stable gap listed in this document has an exposed, documented, tested MCP tool.
- Preview-only gaps either work behind the feature flag or remain explicitly blocked by account eligibility.
- `MCP_TOOL_GROUPS=docs,drive,sheets,slides,utils` exposes only those service groups and scopes.
- LibreChat and Codex complete OAuth and list all enabled tools after a stateless Railway restart.
- The service works without Firestore.
- All meaningful writes are verified by API readback; Slides visual changes also use thumbnails.
- Skills in `skills/` match the deployed tool surface and no implemented capability remains under Known Gaps.

## Official References

- Docs requests: https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request
- Docs comments and suggestions: https://developers.google.com/workspace/docs/api/how-tos/suggestions
- Workspace Developer Preview: https://developers.google.com/workspace/preview
- Sheets requests: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request
- Sheets pivot tables: https://developers.google.com/workspace/sheets/api/guides/pivot-tables
- Drive comments: https://developers.google.com/workspace/drive/api/guides/manage-comments
- Drive revisions: https://developers.google.com/workspace/drive/api/guides/manage-revisions
- Slides API: https://developers.google.com/workspace/slides/api/reference/rest
- Slides requests: https://developers.google.com/workspace/slides/api/reference/rest/v1/presentations/request
- Slides scopes: https://developers.google.com/workspace/slides/api/scopes
- Slides templates: https://developers.google.com/workspace/slides/api/guides/merge
- Slides speaker notes: https://developers.google.com/workspace/slides/api/guides/notes
