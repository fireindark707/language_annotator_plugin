#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHROME_BIN="${CHROME_BIN:-$(command -v google-chrome || true)}"
SERVER_PORT="${TEST_SERVER_PORT:-8765}"
SERVER_HOST="127.0.0.1"
SERVER_PID=""

if [[ -z "$CHROME_BIN" ]]; then
  echo "google-chrome not found. Set CHROME_BIN to a Chromium-compatible browser."
  exit 1
fi

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT

TEST_FILES=(
  "$ROOT_DIR/tests/storage-core.html"
  "$ROOT_DIR/tests/storage-api.html"
  "$ROOT_DIR/tests/runtime-dependencies-smoke.html"
  "$ROOT_DIR/tests/sentence-splitter.html"
  "$ROOT_DIR/tests/translation-utils.html"
  "$ROOT_DIR/tests/lemma-utils.html"
  "$ROOT_DIR/tests/ui-tour.html"
  "$ROOT_DIR/tests/ui-i18n.html"
  "$ROOT_DIR/tests/ui-toast.html"
  "$ROOT_DIR/tests/example-utils.html"
  "$ROOT_DIR/tests/content-dictionary-utils.html"
  "$ROOT_DIR/tests/content-ui.html"
  "$ROOT_DIR/tests/content-addword.html"
  "$ROOT_DIR/tests/content-lookup-ui.html"
  "$ROOT_DIR/tests/content-page-processing.html"
  "$ROOT_DIR/tests/content-bootstrap.html"
  "$ROOT_DIR/tests/content-flow.html"
  "$ROOT_DIR/tests/options-ui.html"
  "$ROOT_DIR/tests/popup-dependencies-smoke.html"
  "$ROOT_DIR/tests/popup-ui.html"
  "$ROOT_DIR/tests/words-logic.html"
  "$ROOT_DIR/tests/practice-logic.html"
  "$ROOT_DIR/tests/practice-ui.html"
  "$ROOT_DIR/tests/background-dictionary-flow.html"
  "$ROOT_DIR/tests/background-wiring.html"
  "$ROOT_DIR/tests/simplemma-smoke.html"
  "$ROOT_DIR/tests/dictionary-url-smoke.html"
  "$ROOT_DIR/tests/wordfreq-features.html"
  "$ROOT_DIR/tests/real-article-id.html"
  "$ROOT_DIR/tests/real-article-id2.html"
  "$ROOT_DIR/tests/epub-parser.html"
  "$ROOT_DIR/tests/epub-clever-translate.html"
  "$ROOT_DIR/tests/epub-contextual-translate.html"
  "$ROOT_DIR/tests/mobi-parser.html"
  "$ROOT_DIR/tests/pdf-adapter.html"
  "$ROOT_DIR/tests/epub-reader-internal-links.html"
  "$ROOT_DIR/tests/epub-reader-toc.html"
  "$ROOT_DIR/tests/epub-reader-para.html"
  "$ROOT_DIR/tests/epub-reader-utils.html"
)

FAILURES=0
for test_file in "${TEST_FILES[@]}"; do
  echo "Running $(basename "$test_file")"
  test_name="$(basename "$test_file")"
  if [[ "$test_name" == "sentence-splitter.html" || "$test_name" == "real-article-id.html" || "$test_name" == "real-article-id2.html" || "$test_name" == "epub-parser.html" || "$test_name" == "mobi-parser.html" ]]; then
    if [[ -z "$SERVER_PID" ]]; then
      cd "$ROOT_DIR"
      python3 -m http.server "$SERVER_PORT" --bind "$SERVER_HOST" >/tmp/la-test-http.log 2>&1 &
      SERVER_PID=$!
      sleep 1
    fi
    target_url="http://$SERVER_HOST:$SERVER_PORT/tests/$test_name"
    vt_budget=15000
    [[ "$test_name" == "mobi-parser.html" ]] && vt_budget=45000
    chrome_args=(--headless=new --disable-gpu --virtual-time-budget=$vt_budget --dump-dom "$target_url")
  else
    target_url="file://$test_file"
    chrome_args=(--headless=new --disable-gpu --allow-file-access-from-files --virtual-time-budget=15000 --dump-dom "$target_url")
  fi
  output="$($CHROME_BIN "${chrome_args[@]}")"
  echo "$output" | sed -n '/<pre id="test-output"/,/<\/pre>/p' | sed 's/<[^>]*>//g'
  if ! echo "$output" | grep -q 'id="test-summary">TEST_PASS<'; then
    echo "FAILED: $test_name"
    FAILURES=$((FAILURES + 1))
  fi
  echo
 done

if [[ "$FAILURES" -gt 0 ]]; then
  echo "$FAILURES test suite(s) failed."
  exit 1
fi

echo "All headless tests passed."
