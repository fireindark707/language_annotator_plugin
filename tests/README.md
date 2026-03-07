# Test Matrix

This project uses browser-run smoke/unit suites under `tests/` so test code stays out of the extension package.

Current coverage mapped to README features:

- `storage-core.html`
  - sync shard splitting
  - sync compaction
  - merge logic for examples / word records
- `storage-api.html`
  - export/import public API
  - UI language fallback
  - excluded domain normalization
- `runtime-dependencies-smoke.html`
  - shared globals required by entry scripts are present
  - required methods exist before hard dependency cleanup
- `translation-utils.html`
  - runtime translation requests
  - Google Translate request composition
  - translation task queue concurrency
- `ui-tour.html`
  - first-run tour rendering
  - seen-state persistence / reset
  - locale fallback
- `ui-i18n.html`
  - required key coverage across all supported UI languages
  - lang/dir mapping
  - english fallback
- `ui-toast.html`
  - toast style/wrap creation
  - toast auto-removal
- `words-logic.html`
  - dictionary query normalization
  - dictionary / lemma language support
  - word count formatting
  - lemma backfill flow
- `example-utils.html`
  - example normalization
  - pinned/unpinned sorting
  - example cap policy
  - low-information filtering
  - similarity / containment dedupe
  - sentence segmentation garbage filtering
- `practice-logic.html`
  - practice pool filtering
  - cloze stimulus generation
  - reviewed-word deduplication
  - low-word onboarding state
- `background-dictionary-flow.html`
  - dictionary source routing
  - surface + lemma dual-query composition
  - lemma fallback behavior
- `background-wiring.html`
  - onInstalled / onStartup wiring
  - context-menu click handling
  - runtime message wiring for translate / lemma / dictionary
- `content-dictionary-utils.html`
  - content dictionary section mapping
  - passive/interactive dictionary rendering
- `content-addword.html`
  - add-word modal DOM builder
  - add-word target word / lemma state
  - add-word dictionary selection state
  - add-word translation prefill
  - add-word dictionary metadata prefill
  - user-edited protection
- `content-lookup-ui.html`
  - instant translation box
  - translation-box dictionary rendering
  - hover preview card
  - preview example translation
- `content-page-processing.html`
  - page text-node scanning
  - highlight fragment building
  - word-boundary matching
  - example candidate collection
- `content-bootstrap.html`
  - content.js bootstrap with required globals
  - content.js delegation into translation/page-processing modules
- `content-flow.html`
  - selection -> translation box flow
  - translation box dictionary sections
  - add-word modal open/save flow
  - highlight flow on a real fixture node
- `options-ui.html`
  - settings hydration
  - autosave flows
  - excluded-domain editing
  - sync / export / import / help actions
- `popup-dependencies-smoke.html`
  - popup shared example/translation dependencies are present
- `popup-ui.html`
  - popup rendering
  - toolbar navigation
  - audio / examples actions
  - learned / delete flows
- `simplemma-smoke.html`
  - bundled simplemma integration
  - remote lemma dictionaries
- `practice-ui.html`
  - low-word onboarding
  - question answer flow
  - summary learned-word apply
  - cloze translate action
- `dictionary-url-smoke.html`
  - remote dictionary assets are actual JSON, not Git LFS pointer text

Run all suites:

```bash
bash tests/run-headless-tests.sh
```
