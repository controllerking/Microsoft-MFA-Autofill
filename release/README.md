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
