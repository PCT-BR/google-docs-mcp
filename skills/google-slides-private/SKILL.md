---
name: google-slides-private
description: Use the private Google Docs MCP to create, read, and make initial edits to personal Google Slides presentations, including slides, text boxes, images, and Drive coordination.
---

# Google Slides Private

Use `mcp__google_docs_mcp` Slides tools for personal Google Slides. Use Drive tools only to locate, organize, export, share, or index the presentation.

## Defaults

- Start existing-presentation work with `readPresentation` or `listSlides` to get slide and speaker-notes object IDs.
- Use exact slide/page-element object IDs for edits and deletion.
- Ask before deleting a slide or page element unless the user explicitly identifies the target.
- Verify writes with `readPresentation` or `listSlides`.
- For inserted images, use only publicly reachable PNG, JPEG, or GIF URLs; Google fetches and stores a copy at insertion time.

## Main Tools

- Presentation lifecycle: `createPresentation`, `readPresentation`.
- Slides: `listSlides`, `getSlide`, `getSlideThumbnail`, `createSlide`, `deleteSlideObject`.
- Text and shapes: `createTextBox`, `insertSlideText`, `replaceAllSlideText`, `deleteSlideText`, `updateSlideTextStyle`, `updateSlideParagraphStyle`, `createSlideBullets`, `deleteSlideBullets`.
- Images: `createSlideImage`.
- Tables: `createSlideTable`, `writeSlideTableCells`.
- Sheets charts: `createSheetsChartOnSlide`, `refreshSheetsChartOnSlide`.
- Speaker notes: `setSpeakerNotes`, `appendSpeakerNotes`.

## Patterns

- For a new simple deck, create the presentation, create the needed slides, then add text boxes and images by slide ID.
- For template placeholders, use `replaceAllSlideText` with `pageObjectIds` when only selected slides should change.
- For text styling, use explicit object IDs and `textRange`; use `cellLocation` only when editing table-cell text.
- For visual checks, use `getSlideThumbnail`; it returns a temporary account-scoped URL.
- For presenter scripts, use `setSpeakerNotes` with the speaker notes object ID from `listSlides` or `readPresentation`.
- For simple data slides, create a native table with `createSlideTable`, then fill it with `writeSlideTableCells`.
- For analytical decks, create charts in Sheets first, then embed them with `createSheetsChartOnSlide`.
- For template-style work, first inspect placeholders with `readPresentation`; use `replaceAllSlideText` for text placeholders.
- `createPresentation` returns `indexSync` when the server has Drive index auto-sync enabled. For files the user will revisit often, use the Drive index tools when auto-sync is unavailable.

## Known Gaps

This MCP does not yet expose video, grouping, z-order controls, or image replacement/properties for Slides.
