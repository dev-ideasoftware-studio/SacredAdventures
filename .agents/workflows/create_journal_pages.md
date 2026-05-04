---
description: How to create and format new Journal or Logbook pages
---
# Journal Page Creation Workflow

When instructed to create, modify, or add new Logbook/Journal pages to `Component.Logbook.html`, follow these strict styling and formatting instructions to preserve the web-responsive layout system:

## 1. Typography and CSS Classes
Do **NOT** use hardcoded Tailwind classes (e.g., `text-sm`, `text-2xl`, `leading-tight`) for the core text of the journal. The fluid container sizes and Javascript text-shrinking algorithms have been removed in favor of strict, clean CSS media queries.

Instead, always rely strictly on these three semantic classes which are globally controlled by responsive `@media` queries in the stylesheet:
- `<h2 class="page-title">`: Used for the main cover page or highly prominent titles.
- `<h2 class="page-subtitle">`: Used for standard page headers (e.g., Character Names, Section Titles).
- `<div class="book-text">`: Used as the wrapper for all body paragraphs.

## 2. Paragraph Balancing (No Scrollbars)
To ensure the journal pages display beautifully without triggering vertical scrollbars across mobile and desktop, page payloads must be carefully balanced:
- Never exceed **3 short paragraphs** (or equivalent visual weight) per page.
- Wrap all body paragraphs within `<div class="book-text"> <p>...</p> <p>...</p> </div>`.
- If there is too much text, you must manually cut it into separate `window.addPage()` calls rather than attempting to rely on an auto-pagination Javascript loop.

## 3. CTA Buttons
Whenever inserting interactive CTA buttons (like `FIND HER` or `START GAME`), use the standard `.toy-btn` classes without overriding their dimensions. The global stylesheet enforces a strict `48px` height and `7px` border-radius constraint.
```html
<button class="toy-btn toy-btn-purple shadow-md hover:scale-105 transition-transform" ...>
    <i class="fa-solid fa-play mr-2 text-lg"></i> BUTTON TEXT
</button>
```

## 4. `window.addPage` Generation
When injecting data into `window.addPage(...)`, use the explicit `JournalMasterAI` templates available:
- `renderTitlePage`
- `renderPortraitPage`
- `renderStorybookPage`
- `renderWraparoundTutorialPage`

Ensure the text arrays passed to these functions are kept concise (3 strings max) so the layout engine can breathe.
