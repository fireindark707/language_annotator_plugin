#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHROME_BIN="${CHROME_BIN:-$(command -v google-chrome || true)}"
SERVER_PORT="${TRANSLATOR_COMPARE_PORT:-8766}"
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

cd "$ROOT_DIR"
python3 -m http.server "$SERVER_PORT" --bind "$SERVER_HOST" >/tmp/la-translator-compare-http.log 2>&1 &
SERVER_PID=$!
sleep 1

TARGET_URL="http://$SERVER_HOST:$SERVER_PORT/tests/translator-comparison.html"
"$CHROME_BIN" --headless=new --disable-gpu --virtual-time-budget=20000 --dump-dom "$TARGET_URL"
