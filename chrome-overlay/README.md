# Chrome build

Chrome's Manifest V3 requires a single `service_worker` background file
(no `background.scripts` array like Firefox, and no persistent `window`
global) and doesn't provide the `browser.*` namespace, so the Chrome build
is generated rather than loaded straight from `../firefox-extension/`:

- `manifest.json` — Chrome MV3 manifest (service worker background, no
  `browser_specific_settings`).
- `background.js` — the service worker entry point. It `importScripts()`s
  the shared `browser-polyfill.js`, `totp.js`, `crypto-vault.js`, and the
  shared vault logic (copied in as `background-core.js`) into one scope,
  mirroring how Firefox's `background.scripts` array loads them.
- `browser-polyfill.js` — aliases `globalThis.browser = chrome` where
  `browser` isn't already defined. Chrome's MV3 `chrome.*` APIs
  (`storage`, `runtime`, `action`) are already promise-based, so no
  callback-wrapping is needed beyond the alias.

The rest of the extension (`popup.html`/`.js`, `options.html`/`.js`,
`content.js`, `totp.js`, `crypto-vault.js`, `icons/`) is identical to the
Firefox version and is copied in unchanged by the build script — the shared
logic in `../firefox-extension/background.js` and everywhere else works as-is
against the `browser.*` alias.

## Build

From the repo root:

```sh
./build-chrome.sh
```

This regenerates `../chrome-extension/`. Run it again any time you change
something under `../firefox-extension/`.

## Load in Chrome

1. Run the build (above).
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the `chrome-extension/` folder.

Setup and usage are otherwise identical to the Firefox version — see
[../firefox-extension/README.md](../firefox-extension/README.md) for the vault setup,
security model, and how the login-page detection works.
