# Privacy Policy

## Overview

Language Annotator stores and processes vocabulary data to provide word highlighting, translation, dictionary lookup, example collection, sync, and practice features.

This project is designed to keep primary learning data in the user's browser whenever possible.

## Data Stored Locally

The extension stores the following data in browser local storage:

- saved words
- meanings and notes
- learned status
- lemma / base-form data
- related word-family forms
- automatically collected example sentences
- example metadata such as source URL and timestamp
- dictionary summaries associated with saved words
- language settings
- excluded domains
- tutorial state

## Data Synced Across Devices

If browser sync is available, the extension writes a compact copy of vocabulary data and relevant settings to browser sync storage.

This sync data may include:

- saved words
- meanings
- learned status
- compact example data
- lemma / base-form data
- compact dictionary metadata
- selected settings

When sync quota is limited, the extension prioritizes keeping essential word data and may reduce heavy cloud-only payloads before trimming older synced entries. Local data remains intact unless the user explicitly changes or deletes it.

## Third-Party Network Requests

The extension sends text or single-word queries to third-party services only when needed to provide requested functionality.

Current services include:

- `https://translate.googleapis.com/`
  - used for machine translation
- `https://kateglo.lostfocus.org/`
  - used for Indonesian dictionary lookup
- `https://freedictionaryapi.com/`
  - used for dictionary lookup in supported languages
- `https://jotoba.de/`
  - used for Japanese dictionary lookup
- `https://media.githubusercontent.com/`
  - used to retrieve dictionary data for lemma analysis

Examples of data that may be sent:

- selected text for translation
- a single queried word for dictionary lookup
- a single queried word or base form for lemma-related lookup

## What Is Not Collected

The extension is not designed to:

- sell personal data
- use browsing content for advertising
- build external user profiles
- download and execute remote JavaScript code as extension logic

## User Control

Users can:

- add or delete saved words
- mark words as learned
- export or import vocabulary data
- disable automatic translation
- disable dictionary lookup
- exclude domains from processing
- manually trigger sync

## Security Notes

- Primary vocabulary data is stored locally in the browser.
- Sync uses browser-provided sync storage.
- External requests are limited to translation, dictionary, and lemma-support resources needed for extension features.

## Contact

If you publish this extension publicly, add your preferred contact email or support page here before store submission.
