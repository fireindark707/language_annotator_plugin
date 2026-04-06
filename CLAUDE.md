# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build

```bash
# Build for Chrome (MV3) or Firefox (MV2)
bash scripts/build-extension.sh chrome
bash scripts/build-extension.sh firefox
# Output: dist/language-annotator-{target}-v{version}.zip
# Also copies the correct manifest to manifest.json at the root
```

Manifests live in `manifests/manifest.chrome.json` and `manifests/manifest.firefox.json`. Firefox puts all host permissions inside `permissions[]` (no separate `host_permissions` key).

## Tests

Tests are browser-run HTML files under `tests/` — not Node.js. Run all suites headlessly:

```bash
bash tests/run-headless-tests.sh
```

To run a single suite, open its HTML file directly in a browser (e.g., `tests/storage-core.html`).

## Architecture

**No build pipeline.** Plain JS throughout — no transpilation, no bundling step for source files. `packages/` contains pre-built third-party bundles (simplemma, sentencex-wasm, wordfreq).

### Message-passing boundary

`background.js` (service worker) owns all network I/O: translation via Google Translate, dictionary lookups, and lemma resolution. Content scripts request these via `chrome.runtime.sendMessage`. Never do network calls from content scripts.

### Storage model

- `chrome.storage.local` — full active dataset
- `chrome.storage.sync` — sharded compact copy for cloud backup
- `storage.js` wraps all access; `lib/storage-merge-utils.js` handles conflict resolution
- Important changes sync immediately; example enrichment is deferred/batched

### Content script layers

Page-side code is split into modules loaded via `content_scripts` in order:
1. `lib/wordfreq-utils.js` — must load first, exposes `globalThis.WordfreqUtils`
2. `lib/content-page-processing.js` — DOM scanning, highlight injection
3. `lib/content-addword.js` — add-word modal
4. `lib/content-lookup-ui.js` — hover cards, translation overlay
5. `lib/content-ui.js` — shared UI primitives
6. `content.js` — orchestration, event wiring

### Dictionary routing (`lib/dictionary-utils.js`)

- `id-*` → Kateglo
- `en-*` → Free Dictionary API
- `ja-*` → Jotoba
- others → Free Dictionary API
- Guard: source language must not be `auto`; word must contain a letter and be within length bounds

### UI style

Warm paper-like aesthetic inspired by Isao Takahata films. Serif headings, warm tones, terracotta accents. Details in `docs/ui-style-guide.md`.
