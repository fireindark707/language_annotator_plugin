# Language Annotator

[![Version](https://img.shields.io/badge/version-1.4.1-d91f26)](./manifest.json)
[![Chrome](https://img.shields.io/badge/Chrome-Extension-1a73e8?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/language-annotator/pplocadbndpadfenglgleehcfjaciobg)
[![Firefox](https://img.shields.io/badge/Firefox-Add--on-ff7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/zh-TW/firefox/addon/language-annotator/)
[![Manifest](https://img.shields.io/badge/manifest-Chrome%20MV3%20%7C%20Firefox%20MV2-6b7280)](./manifests)
[![License](https://img.shields.io/badge/license-MIT-111827)](./LICENSE)

Language Annotator is a browser extension for contextual vocabulary learning while you browse real web pages.

It turns everyday reading into an active study loop:

- highlight saved words in the wild,
- translate selected text instantly,
- add new words from the page,
- accumulate example sentences automatically,
- enrich entries with dictionary data,
- and review everything again in practice mode.

- [Chrome Web Store](https://chromewebstore.google.com/detail/language-annotator/pplocadbndpadfenglgleehcfjaciobg)
- [Firefox Add-ons](https://addons.mozilla.org/zh-TW/firefox/addon/language-annotator/)

## Why It Matters

Most vocabulary tools make you leave the page you are reading.

Language Annotator does the opposite:

- it stays inside your normal browsing flow,
- captures useful context from real articles and posts,
- and helps you turn repeated encounters into durable memory.

This makes it useful for language learners, migrant workers, bilingual readers, researchers, and anyone building vocabulary through real-world reading instead of isolated word lists.

## What’s New (v1.4.1)

- Guided onboarding system added across the extension:
  - popup tutorial,
  - settings tutorial,
  - fullscreen word manager tutorial,
  - practice-mode tutorial,
  - on-page tutorial for highlighted words,
  - on-page tutorial for selection + dictionary results.
- Tutorial replay button added to major surfaces.
- Tutorial copy now covers all supported UI languages:
  - `zh-TW`, `zh-CN`, `en`, `fr`, `pt`, `ar`, `hi`, `ja`, `ko`, `id`, `ru`, `es`.
- Practice mode onboarding now handles low-data state:
  - if fewer than 4 valid learning words exist, users see a focused reminder instead of a broken/empty tutorial.
- Version sync updated to `1.4.1` across Chrome and Firefox manifests.

## What’s New (v1.4)

- Practice mode major upgrade:
  - 10-question rounds with overtime extension based on streak,
  - stronger feedback loop (answer flash, streak/combo effects, pronunciation playback),
  - cloze questions with optional inline translation.
- Practice mode localization expanded:
  - full i18n coverage for practice UI strings across supported UI languages.
- UI/UX refinement for practice flow:
  - clearer chips/status hierarchy and improved round summary visibility.
- Continued dictionary + example learning pipeline improvements from v1.3 are preserved.

- Dictionary integration in translation/add-word flow.
- Multi-source dictionary strategy:
  - Indonesian (`id-*`): Kateglo
  - English (`en-*`): Free Dictionary API
  - Japanese (`ja-*`): Jotoba
  - Other supported non-`auto` languages: Wiktionary REST API
- Add Word dialog now supports:
  - multiple dictionary definitions,
  - one-click "apply this definition",
  - dictionary data persistence (`entries + selectedIndex`).
- Full-screen word page (`words.html`) supports:
  - dictionary section per word,
  - dictionary-aware search (word/meaning/dictionary text).
- Stability improvements:
  - safer API JSON parsing (handles HTML/error responses gracefully),
  - quieter handling for extension-context invalidation after hot reload.

## Core Features

- Word highlighting on web pages for saved vocabulary.
- Right-click add word (`context menu`) with prefilled translation.
- Popup + full-page manager (`popup.html`, `words.html`).
- Mark learned / unmark / pronounce / delete.
- Automatic translation overlay for selected text (optional).
- Multi-language UI.
- Sync across devices via sharded `storage.sync`.
- Import/export vocabulary data.
- Editable excluded-domain list.
- Guided onboarding and replayable product tours.

## Automatic Example Collection

- Automatically extracts example sentences for saved words while browsing.
- Quality filters:
  - skips low-information snippets,
  - skips URL/script/style-like noise,
  - deduplicates by exact, containment, and similarity checks.
- Per-word example policy:
  - up to 20 unpinned examples,
  - pinned examples are kept and not counted in that 20.
- Each example stores:
  - sentence text,
  - source URL (domain link),
  - capture timestamp,
  - optional translation cache.
- Example operations:
  - pin/unpin,
  - delete.
- Learned words are skipped for new example collection.

## Dictionary Behavior

- Dictionary lookup is available only when source language is manually selected (not `auto`).
- Lookup trigger guardrails:
  - single-word query,
  - length between `2` and `32`,
  - must contain letters (not pure digits/symbols).
- Add Word flow:
  - default still uses Google translation in input,
  - dictionary appears as selectable alternatives,
  - clicking "帶入" replaces input with selected dictionary definition.

## Guided Onboarding

The extension now includes replayable spotlight tutorials for major surfaces:

- `popup.html`
- `options.html`
- `words.html`
- `practice.html`
- highlighted words on web pages
- selected-text translation + dictionary overlays

Tutorial goals:

- reduce feature discovery friction,
- teach the right action in the right context,
- keep advanced features visible without overwhelming first-time users.

Current tutorial UI-language coverage:

- Traditional Chinese
- Simplified Chinese
- English
- French
- Portuguese
- Arabic
- Hindi
- Japanese
- Korean
- Indonesian
- Russian
- Spanish

## Quick Start

1. Install unpacked extension
   - Chrome: `chrome://extensions` -> Developer mode -> Load unpacked
   - Firefox: `about:debugging` -> This Firefox -> Load Temporary Add-on
2. Open `Options` and set:
   - source language (recommended: not `auto` if using dictionary),
   - UI language,
   - auto-translate on selection,
   - excluded domains.
3. Follow the built-in tutorials:
   - use the `?` button in popup, settings, fullscreen manager, and practice mode,
   - on pages, hover highlighted words or select text to trigger contextual onboarding.
4. Browse and use:
   - select text for translation overlay,
   - right-click to add new word,
   - open popup/fullscreen manager to review and manage words/examples.

## Settings Guide

`options.html` includes:

- source language,
- UI language,
- auto-translate toggle,
- dictionary toggle (shown only when source language supports dictionary),
- excluded domains,
- import/export.

## Full-Screen Manager (`words.html`)

- Bigger browsing/editing workspace for all words.
- Sort modes:
  - newest first,
  - alphabetical.
- Search supports:
  - word text,
  - meaning,
  - dictionary definitions.
- Per-word expandable sections:
  - examples,
  - dictionary entries.

## Storage & Sync

- `chrome.storage.local`: active runtime data.
- `chrome.storage.sync`: cross-device backup.
- Words are synced via shard model:
  - meta key: `words_meta_v2`
  - shard keys: `words_shard_v2_*`
- Automatic compact levels are applied if sync quota is tight.

## Build & Packaging

Manifests:

- `manifests/manifest.chrome.json`
- `manifests/manifest.firefox.json`

Build:

```bash
./scripts/build-extension.sh chrome
./scripts/build-extension.sh firefox
```

Outputs:

- `dist/language-annotator-chrome-v<version>.zip`
- `dist/language-annotator-firefox-v<version>.zip`

## Browser Support

- Chrome: supported
- Firefox: supported
- Edge: Chromium build is expected to work with the Chrome manifest package; validate third-party API access and core flows before store submission.

## Troubleshooting

- `Extension context invalidated` in console:
  - usually appears after extension reload while old tabs still run old scripts;
  - refresh the page after reloading extension.
- Dictionary returns empty:
  - verify source language is not `auto`,
  - verify query is a single valid word,
  - some words/languages may not exist in upstream dictionary data.
- No highlight on a site:
  - check excluded domain list,
  - verify word is not marked as learned.

## Version

Current manifest version: `1.4.1`.
