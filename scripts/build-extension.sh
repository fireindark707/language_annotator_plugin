#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "Usage: ./scripts/build-extension.sh <chrome|firefox>"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_DIR="$ROOT_DIR/manifests"
DIST_DIR="$ROOT_DIR/dist"

case "$TARGET" in
  chrome)
    SRC_MANIFEST="$MANIFEST_DIR/manifest.chrome.json"
    ;;
  firefox)
    SRC_MANIFEST="$MANIFEST_DIR/manifest.firefox.json"
    ;;
  *)
    echo "Unsupported target: $TARGET"
    echo "Use one of: chrome, firefox"
    exit 1
    ;;
esac

if [[ ! -f "$SRC_MANIFEST" ]]; then
  echo "Manifest template not found: $SRC_MANIFEST"
  exit 1
fi

mkdir -p "$DIST_DIR"
cp "$SRC_MANIFEST" "$ROOT_DIR/manifest.json"

VERSION="$(grep -o '"version":[[:space:]]*"[^"]*"' "$ROOT_DIR/manifest.json" | head -n1 | cut -d'"' -f4)"
ZIP_PATH="$DIST_DIR/language-annotator-${TARGET}-v${VERSION}.zip"

(
  cd "$ROOT_DIR"
  rm -f "$ZIP_PATH"
  zip -qr "$ZIP_PATH" . \
    -x ".git/*" \
    -x ".vscode/*" \
    -x "dist/*" \
    -x "manifests/*" \
    -x "scripts/*" \
    -x "*.pem" \
    -x "*.crx"
)

echo "Built $TARGET package:"
echo "  $ZIP_PATH"
echo "Active manifest:"
echo "  $ROOT_DIR/manifest.json"
