#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHROME_BIN="${CHROME_BIN:-$(command -v google-chrome || true)}"

if [[ -z "$CHROME_BIN" ]]; then
  echo "google-chrome not found. Set CHROME_BIN to a Chromium-compatible browser."
  exit 1
fi

TEST_FILES=(
  "$ROOT_DIR/tests/storage-core.html"
  "$ROOT_DIR/tests/runtime-dependencies-smoke.html"
  "$ROOT_DIR/tests/translation-utils.html"
  "$ROOT_DIR/tests/example-utils.html"
  "$ROOT_DIR/tests/content-dictionary-utils.html"
  "$ROOT_DIR/tests/content-addword.html"
  "$ROOT_DIR/tests/content-translation.html"
  "$ROOT_DIR/tests/content-page-processing.html"
  "$ROOT_DIR/tests/content-bootstrap.html"
  "$ROOT_DIR/tests/words-logic.html"
  "$ROOT_DIR/tests/practice-logic.html"
  "$ROOT_DIR/tests/background-dictionary-flow.html"
  "$ROOT_DIR/tests/simplemma-smoke.html"
  "$ROOT_DIR/tests/dictionary-url-smoke.html"
)

FAILURES=0
for test_file in "${TEST_FILES[@]}"; do
  echo "Running $(basename "$test_file")"
  output="$($CHROME_BIN --headless=new --disable-gpu --virtual-time-budget=15000 --dump-dom "file://$test_file")"
  echo "$output" | sed -n '/<pre id="test-output"/,/<\/pre>/p' | sed 's/<[^>]*>//g'
  if ! echo "$output" | grep -q 'TEST_PASS'; then
    echo "FAILED: $(basename "$test_file")"
    FAILURES=$((FAILURES + 1))
  fi
  echo
 done

if [[ "$FAILURES" -gt 0 ]]; then
  echo "$FAILURES test suite(s) failed."
  exit 1
fi

echo "All headless tests passed."
