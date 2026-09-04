---
name: google-slides-private
description: Use the private Google Docs MCP to create, read, and make initial edits to personal Google Slides presentations, including slides, text boxes, images, and Drive coordination.
---

# Google Slides Private

Use `mcp__google_docs_mcp` Slides tools for personal Google Slides. Use Drive tools only to locate, organize, export, share, or index the presentation.

## Defaults

- Start existing-presentation work with `readPresentation` or `listSlides` to get slide object IDs.
- Use exact slide/page-element object IDs for edits and deletion.
- Ask before deleting a slide or page element unless the user explicitly identifies the target.
- Verify writes with `readPresentation` or `listSlides`.
- For inserted images, use only publicly reachable PNG, JPEG, or GIF URLs; Google fetches and stores a copy at insertion time.

## Main Tools

- Presentation lifecycle: `createPresentation`, `readPresentation`.
- Slides: `listSlides`, `createSlide`, `deleteSlideObject`.
- Text and shapes: `createTextBox`.
- Images: `createSlideImage`.

## Patterns

- For a new simple deck, create the presentation, create the needed slides, then add text boxes and images by slide ID.
- For template-style work, first inspect placeholders with `readPresentation`; richer placeholder replacement is planned but not exposed yet.
- For files the user will revisit often, update the Drive index after creating or meaningfully editing the presentation.

## Known Gaps

This MCP does not yet expose rich text styling, speaker notes editing, tables, charts from Sheets, template placeholder replacement, thumbnails, video, grouping, or z-order controls for Slides.
