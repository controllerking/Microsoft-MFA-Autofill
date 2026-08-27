#!/usr/bin/env bash
# Packages the two things users actually install: a Firefox zip and a
# Chrome zip, dropped in release/. Excludes dev-only files (build scripts,
# the chrome-overlay source, cross-links to sibling dev folders).
set -euo pipefail
cd "$(dirname "$0")"

./build-chrome.sh

OUT=release
rm -rf "$OUT"
mkdir -p "$OUT"

# --- Firefox package ---
FF_STAGE=$(mktemp -d)
trap 'rm -rf "$FF_STAGE"' EXIT
cp firefox-extension/manifest.json firefox-extension/background.js \
   firefox-extension/totp.js firefox-extension/crypto-vault.js \
   firefox-extension/content.js firefox-extension/popup.html \
   firefox-extension/popup.js firefox-extension/options.html \
   firefox-extension/options.js "$FF_STAGE"/
cp -r firefox-extension/icons "$FF_STAGE"/
cp LICENSE PRIVACY.md "$FF_STAGE"/
# Drop the "Chrome version" section (it only makes sense pointing at sibling
# dev folders, which don't exist once this is zipped standalone), and point
# the LICENSE/PRIVACY links at the copies now sitting alongside it instead
# of the source tree's "../".
awk '/^## Chrome version$/{skip=1} /^## Setup$/{skip=0} !skip' \
  firefox-extension/README.md \
  | sed -e 's#(\.\./PRIVACY\.md)#(PRIVACY.md)#' -e 's#(\.\./LICENSE)#(LICENSE)#' \
  > "$FF_STAGE"/README.md

(cd "$FF_STAGE" && zip -rq "$OLDPWD/$OUT/ms-totp-autofill-firefox.zip" .)

# --- Chrome package ---
(cd chrome-extension && zip -rq "$OLDPWD/$OUT/ms-totp-autofill-chrome.zip" .)

# --- Chrome .crx (packed, signed with the private key in keys/) ---
if [ -f keys/chrome-extension.pem ] && command -v google-chrome >/dev/null 2>&1; then
  google-chrome --headless --no-sandbox \
    --pack-extension=chrome-extension \
    --pack-extension-key=keys/chrome-extension.pem \
    >/dev/null 2>&1
  mv chrome-extension.crx "$OUT"/ms-totp-autofill-chrome.crx
else
  echo "Skipping .crx: need keys/chrome-extension.pem and google-chrome on PATH."
fi

cat > "$OUT"/README.md <<'EOF'
# Downloads

- **Firefox:** `ms-totp-autofill-firefox.zip`
- **Chrome:** `ms-totp-autofill-chrome.zip` (unpacked) or
  `ms-totp-autofill-chrome.crx` (packed, signed)

Unzip one, then:

- **Firefox:** open `about:debugging#/runtime/this-firefox` -> **Load
  Temporary Add-on...** -> select `manifest.json` inside the unzipped folder.
- **Chrome:** open `chrome://extensions` -> enable **Developer mode** ->
  **Load unpacked** -> select the unzipped folder. (Chrome blocks dragging a
  `.crx` in directly unless it's from the Web Store; the unpacked zip is the
  reliable path for local installs.)

Each zip includes its own README with setup steps and the security model.

## Regenerating the .crx

`ms-totp-autofill-chrome.crx` is signed with the private key in `../keys/`
(gitignored — never commit it). To repack after a source change: Chrome's
`chrome://extensions` -> **Pack extension** -> Extension root directory:
`chrome-extension/`, Private key file: `keys/chrome-extension.pem`.
EOF

echo "Built:"
ls -la "$OUT"
