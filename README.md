# Language Annotator

[![Version](https://img.shields.io/badge/version-1.4.10-d91f26)](./manifest.json)
[![Chrome](https://img.shields.io/badge/Chrome-Extension-1a73e8?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/language-annotator/pplocadbndpadfenglgleehcfjaciobg)
[![Firefox](https://img.shields.io/badge/Firefox-Add--on-ff7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/zh-TW/firefox/addon/language-annotator/)
[![Manifest](https://img.shields.io/badge/manifest-Chrome%20MV3%20%7C%20Firefox%20MV2-6b7280)](./manifests)

Language Annotator is a browser extension for learning vocabulary directly on the pages you already read.

Instead of moving words into a separate flashcard app first, it keeps the learning loop inside normal browsing:

- highlight saved words on real pages,
- translate selected text in place,
- add words from page context,
- collect example sentences automatically,
- enrich words with dictionary and lemma data,
- group related inflected forms into word families,
- and review everything again in practice mode.

- Chrome Web Store: https://chromewebstore.google.com/detail/language-annotator/pplocadbndpadfenglgleehcfjaciobg
- Firefox Add-ons: https://addons.mozilla.org/zh-TW/firefox/addon/language-annotator/

## Why this project exists

Most vocabulary tools interrupt reading. They ask you to leave the article, copy text somewhere else, then study in a disconnected environment.

Language Annotator is built around a different assumption: the page you are reading is already the best source of context.

That makes the extension useful for:

- language learners reading news, blogs, and forums,
- bilingual readers who want instant support without breaking focus,
- people building domain vocabulary from real documents,
- anyone who wants to collect words from actual usage instead of isolated lists.

## What it does

### On-page learning

- Highlights saved words while you browse.
- Supports word-family highlighting for related inflected forms.
- Shows hover cards with meaning, examples, pronunciation, and dictionary info.
- Lets you translate selected text without leaving the page.
- Adds a right-click context menu for saving a word from the current page.

### Vocabulary enrichment

- Stores a base form when lemma support exists for the source language.
- Fetches dictionary entries for supported languages.
- Collects example sentences from the page automatically.
- Uses `sentencex-wasm` plus repair rules to improve sentence extraction quality.
- Supports simple bulk import from pasted text, `.txt`, or first-column `.csv`.

### Review workflow

- Popup for quick review and lightweight management.
- Full-screen word manager for editing, searching, dictionary inspection, and example management.
- Practice mode with mixed question types, cloze prompts, streaks, overtime, and learned-word marking.

### Product support

- Multi-language UI.
- Replayable onboarding tours across popup, options, words page, practice page, and on-page surfaces.
- Local-first storage with compact cross-device sync.
- Excluded-domain controls for sites you do not want the extension to process.

## How the learning loop works

1. Read normally on any page.
2. Select text or right-click a word to capture it.
3. Save a meaning, then let the extension enrich it with dictionary, lemma, and family-form data.
4. Keep browsing and encounter the word again as a highlight on real pages.
5. Accumulate examples automatically.
6. Review the word later in the popup, full-screen manager, or practice mode.

## Core capabilities

### Word highlighting and family forms

- Saved words are highlighted with a primary style.
- Related forms from the same word family are highlighted with a secondary style.
- Family hover cards focus on the visible surface form while still showing the saved root word.
- Clicking a root highlight and clicking a family highlight trigger different actions by design.

### Translation and dictionary lookup

- Translation uses Google Translate.
- Dictionary lookup is available only when source language is set manually, not `auto`.
- Current dictionary routing:
  - `id-*`: Free Dictionary API
  - `en-*`: Free Dictionary API
  - `ja-*`: Jotoba
  - other supported non-`auto` languages: Free Dictionary API
- Dictionary lookup is guarded to single-word, letter-containing queries within a bounded length range.

### Example collection

- Examples are extracted from the page context while browsing.
- Low-information, noisy, duplicate, and near-duplicate snippets are filtered out.
- Learned words are skipped for new example collection.
- Each word keeps up to 20 unpinned examples; pinned examples are preserved outside that cap.

### Storage and sync

- `chrome.storage.local` holds the active local dataset.
- `chrome.storage.sync` stores a compact cloud copy for cross-device sync.
- Word data is sharded in sync storage to stay within quota.
- Important changes sync immediately.
- High-frequency enrichment changes sync in deferred batches.
- If sync quota gets tight, the cloud copy is compacted before older synced entries are trimmed.

## Main surfaces

- `popup.html`
  - quick review, quick management, launch points to larger flows
- `words.html`
  - full-screen vocabulary manager with inline editing, search, examples, and dictionary sections
- `practice.html`
  - round-based review mode with recall, comprehension, and cloze questions
- `options.html`
  - source language, UI language, dictionary toggle, excluded domains, import/export, sync actions
- `content.js`
  - on-page highlighting, translation overlay, add-word modal, example collection, content tours

## UI style

The project follows a warm, paper-like interface language inspired by the everyday atmosphere of Isao Takahata's films.

- calm editorial hierarchy instead of dashboard styling
- warm paper tones and terracotta accents instead of cold product colors
- serif headings with readable sans-serif body text
- gentle material depth instead of glossy or futuristic effects
- stronger festive motion reserved mainly for `practice.html`

See [docs/ui-style-guide.md](./docs/ui-style-guide.md) for the full visual direction and design rules.

## Supported UI languages

Current UI coverage includes:

- `zh-TW`
- `zh-CN`
- `en`
- `fr`
- `pt`
- `ar`
- `hi`
- `ja`
- `ko`
- `id`
- `ru`
- `es`

## Install for development

### Chrome

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select this project folder

### Firefox

1. Open `about:debugging`
2. Go to `This Firefox`
3. Click `Load Temporary Add-on`
4. Select the extension `manifest.json`

## Recommended first-run setup

Open `Options` and configure:

- source language
- UI language
- auto-translate on selection
- dictionary lookup if the chosen source language supports it
- excluded domains if needed

If you want dictionary behavior, do not leave source language as `auto`.

## Development notes

### Project layout

- `background.js`
  - runtime service worker, translation, dictionary, lemma, context-menu wiring
- `content.js`
  - on-page runtime entry point
- `storage.js`
  - local/sync storage API, sharding, compaction, deferred/immediate sync
- `words.js`
  - full-screen word manager
- `practice.js`
  - review game logic and UI
- `options.js`
  - settings, import/export, simple import enrichment flow
- `lib/`
  - shared utilities for dictionary, lemma, translation, examples, sentence splitting, content UI, and page processing
- `tests/`
  - browser-run smoke and unit suites

### Build packages

Chrome package:

```bash
./scripts/build-extension.sh chrome
```

Firefox package:

```bash
./scripts/build-extension.sh firefox
```

Output archives are written to `dist/`.

### Run tests

Run the full headless suite:

```bash
bash tests/run-headless-tests.sh
```

Test coverage summary lives in [tests/README.md](./tests/README.md).

## Network requests

The extension talks to third-party services only for user-facing language features.

Current host permissions:

- `https://translate.googleapis.com/*`
- `https://kateglo.lostfocus.org/*`
- `https://freedictionaryapi.com/*`
- `https://jotoba.de/*`
- `https://media.githubusercontent.com/*`

These are used for translation, dictionary lookup, and lemma-support resources. The extension does not fetch remote JavaScript for execution as extension logic.

## Privacy

Primary learning data stays in the browser. A compact sync copy may also be stored through browser sync storage when available.

See [PRIVACY.md](./PRIVACY.md) for the full policy.

For store-submission context and permission rationale, see [docs/store-review-notes.md](./docs/store-review-notes.md).

## Browser support

- Chrome: supported
- Firefox: supported
- Edge: expected to work via the Chromium package, but validate core flows before distribution

## Troubleshooting

### No dictionary results

- Make sure source language is not `auto`
- Make sure the query is a single word
- Some words may not exist in the upstream dictionary source

### Words do not highlight on a page

- Check whether the domain is excluded
- Check whether the word is already marked as learned
- Reload the page after reloading the extension

### `Extension context invalidated` appears in the console

This usually happens after reloading the extension while an old tab is still running old content scripts. Refresh the page.

## Version

Current manifest version: `1.4.10`.
