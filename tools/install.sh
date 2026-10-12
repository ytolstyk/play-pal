#!/bin/bash
# Build, ad-hoc sign and install Play Pal into /Applications (Apple Silicon).
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="Play Pal"
BUNDLE_ID="com.local.playpal"
BUILT="dist/mac-arm64/$APP_NAME.app"
DEST="/Applications/$APP_NAME.app"

# Node may run under Rosetta; force arm64 so native deps and Electron match the app.
export npm_config_arch=arm64 npm_config_platform=darwin

[ -d node_modules ] || npm ci
[ -f node_modules/electron/path.txt ] || node node_modules/electron/install.js
[ -f build/icon.icns ] || python3 tools/make-icon.py

npm run package

# A fixed designated requirement keeps the code identity stable across rebuilds.
codesign --force --deep --sign - -r="designated => identifier \"$BUNDLE_ID\"" "$BUILT"

# Quit a running copy so it can be replaced (Note Offs are flushed on quit).
if pgrep -f "$APP_NAME.app/Contents/MacOS" >/dev/null; then
  osascript -e "tell application \"$APP_NAME\" to quit" || true
  for _ in $(seq 1 20); do
    pgrep -f "$APP_NAME.app/Contents/MacOS" >/dev/null || break
    sleep 0.5
  done
  if pgrep -f "$APP_NAME.app/Contents/MacOS" >/dev/null; then
    echo "$APP_NAME is still running. Quit it and re-run." >&2
    exit 1
  fi
fi

rm -rf "$DEST"
cp -R "$BUILT" "$DEST"
echo "Installed $DEST"
[ "${1:-}" = "--open" ] && open "$DEST" || true
