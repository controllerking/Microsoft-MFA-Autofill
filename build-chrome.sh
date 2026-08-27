#!/usr/bin/env bash
# Assembles chrome-extension/ (a loadable Chrome MV3 build) from the shared
# source in firefox-extension/ plus the Chrome-only overlay in
# chrome-overlay/. Run this again any time firefox-extension/ changes to
# keep the Chrome build in sync.
set -euo pipefail
cd "$(dirname "$0")"

SRC=firefox-extension
OVERLAY=chrome-overlay
OUT=chrome-extension

rm -rf "$OUT"
mkdir -p "$OUT"

# Files shared byte-for-byte between both browsers.
cp "$SRC"/totp.js "$SRC"/crypto-vault.js "$OUT"/
cp "$SRC"/popup.html "$SRC"/popup.js "$OUT"/
cp "$SRC"/options.html "$SRC"/options.js "$OUT"/
cp "$SRC"/content.js "$OUT"/
cp -r "$SRC"/icons "$OUT"/

# The vault/message-handling logic, renamed so it can be pulled into the
# Chrome service worker via importScripts() without colliding with the
# Chrome-only background.js entry point below.
cp "$SRC"/background.js "$OUT"/background-core.js

# Chrome-only overlay: manifest, service worker entry, browser->chrome shim,
# user-facing README (the dev-facing chrome-overlay/README.md stays out of
# the shipped package).
cp "$OVERLAY"/manifest.json "$OUT"/manifest.json
cp "$OVERLAY"/background.js "$OUT"/background.js
cp "$OVERLAY"/browser-polyfill.js "$OUT"/browser-polyfill.js
cp "$OVERLAY"/user-readme-template.md "$OUT"/README.md
cp LICENSE PRIVACY.md "$OUT"/

# popup.html and options.html call browser.runtime.* directly; give them the
# shim before their own script runs.
perl -0pi -e 's#<script src="popup.js"></script>#<script src="browser-polyfill.js"></script>\n    <script src="popup.js"></script>#' "$OUT"/popup.html
perl -0pi -e 's#<script src="options.js"></script>#<script src="browser-polyfill.js"></script>\n      <script src="options.js"></script>#' "$OUT"/options.html

echo "Built $OUT/ — in Chrome, open chrome://extensions, enable Developer mode, and 'Load unpacked' that folder."
