# Store Review Notes

## Purpose

Language Annotator is a contextual vocabulary-learning extension. It highlights saved words on web pages, translates selected text, helps users add new words, collects example sentences, enriches entries with dictionary data, and supports review and practice workflows.

## Why `<all_urls>` Content Script Access Is Needed

The extension works directly on normal web pages. It needs content-script access across websites in order to:

- highlight saved vocabulary inside page content
- react to selected text for translation
- allow users to add newly encountered words from arbitrary pages
- collect example sentences from the pages the user is actively reading

Without broad page access, the core learning workflow would only work on a small subset of websites and would not match the intended product behavior.

## Why These Host Permissions Are Needed

The extension makes outbound requests only to provide user-facing language features:

- `https://translate.googleapis.com/*`
  - translate selected text or single-word queries
- `https://kateglo.lostfocus.org/*`
  - Indonesian dictionary lookup
- `https://freedictionaryapi.com/*`
  - dictionary lookup for supported languages
- `https://jotoba.de/*`
  - Japanese dictionary lookup
- `https://media.githubusercontent.com/*`
  - lemma-support dictionary data used by `simplemma`

These requests are feature-specific and are not used to load remote executable code.

## Why `unlimitedStorage` Is Needed

The extension stores:

- saved vocabulary
- collected example sentences
- lemma/base-form data
- related word-family forms
- compact dictionary metadata
- sync and tutorial state

For active learners with many saved words and examples, default local storage limits are too restrictive. `unlimitedStorage` allows the extension to keep a larger local corpus on-device.

## Remote Code Policy

The extension does not download and execute remote JavaScript as extension logic.

Remote requests are limited to:

- translation responses
- dictionary responses
- lemma-support dictionary data

Packaged code is shipped inside the extension bundle.

## Sync Behavior

The extension uses `chrome.storage.sync` to keep a compact cross-device copy of vocabulary data and selected settings.

Sync behavior is intentionally conservative:

- important changes such as adding or deleting words sync immediately
- high-frequency enrichment updates are batched
- if sync quota is tight, cloud payloads are compacted before older synced entries are trimmed
- local data remains the primary source of truth

## Privacy Notes

See:

- [../PRIVACY.md](../PRIVACY.md)
