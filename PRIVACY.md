# Privacy Policy

**Microsoft MFA TOTP Autofill** is a browser extension that generates
one-time codes locally and autofills them on Microsoft sign-in pages. It is
not affiliated with, endorsed by, or associated with Microsoft Corporation.

## Data collection

None. This extension makes no network requests of its own, has no server,
and sends no data anywhere — not to its author, not to any third party, not
to Microsoft, not for analytics or crash reporting.

## Data stored

Everything this extension stores stays on your device, inside your
browser's own extension storage:

- **Account labels, sign-in emails, and TOTP secrets** you add, via
  `browser.storage.local` (Firefox) / `chrome.storage.local` (Chrome) —
  scoped to this extension, never synced or transmitted.
  - In the default **encrypted** vault mode, secrets are encrypted at rest
    with AES-256-GCM using a key derived from your passphrase (PBKDF2-SHA256,
    210,000 iterations). The passphrase itself is never stored, and the
    derived decryption key exists only in the background script's memory for
    your current browser session.
  - In the optional **no-passphrase** mode (an explicit opt-in you have to
    click through a warning to enable), secrets are stored unencrypted in
    the same local, per-extension storage.
- **The sign-in email captured on a Microsoft login page**, via
  `sessionStorage`, scoped to that browser tab only and cleared when the
  tab/session ends.
- **Your settings** (auto-submit toggles, auto-lock timeout), via the same
  local extension storage.

None of the above ever leaves your device.

## Permissions

`host_permissions` and the content script's site matches are limited to
genuine Microsoft sign-in domains (`*.microsoftonline.com`, `login.live.com`,
etc.) so the extension's autofill/auto-click logic only ever runs there —
never on an unrelated site, and never on a look-alike phishing domain. The
`storage` permission is used solely for the local data described above.

## Third parties

None. There are no analytics SDKs, no ad networks, no crash reporters, and
no calls to any external service.

## Changes

If this policy changes, the updated version will be posted in this file in
the project's repository.

## Contact

Open an issue on the project's GitHub repository.
