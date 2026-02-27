# Language Annotator

[![Version](https://img.shields.io/badge/version-1.3-d91f26)](./manifest.json)
[![Chrome](https://img.shields.io/badge/Chrome-Extension-1a73e8?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/language-annotator/pplocadbndpadfenglgleehcfjaciobg)
[![Firefox](https://img.shields.io/badge/Firefox-Add--on-ff7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/zh-TW/firefox/addon/language-annotator/)
[![Manifest](https://img.shields.io/badge/manifest-Chrome%20MV3%20%7C%20Firefox%20MV2-6b7280)](./manifests)
[![License](https://img.shields.io/badge/license-MIT-111827)](./LICENSE)

Language Annotator is a Chrome/Firefox extension for contextual vocabulary learning while browsing.

It highlights your saved words, translates selected text, lets you quickly add words, and continuously accumulates useful example sentences from real pages.

- [Chrome Web Store](https://chromewebstore.google.com/detail/language-annotator/pplocadbndpadfenglgleehcfjaciobg)
- [Firefox Add-ons](https://addons.mozilla.org/zh-TW/firefox/addon/language-annotator/)

## What’s New (v1.3)

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

## Quick Start

1. Install unpacked extension
   - Chrome: `chrome://extensions` -> Developer mode -> Load unpacked
   - Firefox: `about:debugging` -> This Firefox -> Load Temporary Add-on
2. Open `Options` and set:
   - source language (recommended: not `auto` if using dictionary),
   - UI language,
   - auto-translate on selection,
   - excluded domains.
3. Browse and use:
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

Current manifest version: `1.3`.
