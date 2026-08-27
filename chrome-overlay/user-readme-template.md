# Microsoft MFA TOTP Autofill (Chrome)

A Chrome extension that helps you sign in to Microsoft accounts faster by:

1. Watching for the Microsoft sign-in email field and remembering which
   account you're signing into (in-tab only, via `sessionStorage`).
2. Detecting when a password manager (browser-native or an extension like
   Bitwarden/1Password) has filled the password field, and clicking
   Next/Sign in for you.
3. Automatically clicking "I can't use my Microsoft Authenticator app right
   now" / "Sign in another way" style links, when present, to reach the
   one-time-code entry screen.
4. Generating a standard RFC 6238 TOTP code locally (Web Crypto API, no
   network calls) for the matching account and autofilling it into the code
   field.

Password-manager detection uses a "value stopped changing for 500ms"
heuristic — which also keeps it from submitting while you're still typing
manually. Toggle this off in settings if you'd rather press Next yourself.

This only works for accounts where **you** have added the TOTP secret in the
extension's options page — i.e. the same kind of secret you'd otherwise put
into an authenticator app. It does not intercept, phish, or bypass anyone
else's MFA.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.

(Chrome removes unpacked extensions if you delete this folder, and shows an
"unsupported developer extension" banner on startup unless it's published to
the Chrome Web Store — that's expected for a locally loaded extension.)

## Setup

1. Click the extension icon → **Manage accounts & settings**.
2. The first time, you'll be asked to create a vault:
   - **Recommended:** set a passphrase (8+ characters). Every TOTP secret is
     then encrypted at rest; the extension holds the decryption key in
     memory only for your current browser session (see "Security model"
     below).
   - **Or:** click "I don't want a passphrase" if you'd rather skip the
     unlock step entirely. This stores secrets unencrypted — see the
     warning shown before confirming.
3. For each Microsoft account, add:
   - The sign-in email
   - The **base32 TOTP secret** — this is the same secret Microsoft shows
     you (usually as a QR code / "can't scan?" text code) when you set up
     an authenticator app under Security info. You'll need to add this
     extension as an additional authenticator method during that setup
     flow so Microsoft accepts a TOTP code as a verification option.
4. Optionally enable "automatically submit the form after filling the code."

## How detection works

The content script uses a mix of CSS selectors and case-insensitive text
matching since Microsoft's login UI changes over time and across tenants.
The text search walks into any open shadow DOM it finds (parts of
Microsoft's newer sign-in UI use it), and re-checks the page once a second
in addition to reacting to DOM changes, so it isn't solely dependent on
`MutationObserver` picking up every update. It won't re-click the same
link/tile twice within a few seconds, but will click it again after that if
it's still there — this matters on multi-step flows (e.g. a passkey failure
screen that offers "Sign in another way" again).

If Microsoft changes their markup and the extension stops finding a field or
link, open `chrome://extensions`, click **service worker** / **inspect
views** on this extension, and check the console for `[MS TOTP Autofill]`
debug logs.

## Security model

**Encrypted mode (default path in setup):**

- Secrets are encrypted with AES-256-GCM using a key derived from your
  passphrase via PBKDF2-SHA256 (210,000 iterations) with a random per-vault
  salt. The passphrase itself is never stored anywhere.
- The derived key lives **only** in the background service worker's memory.
  It is never written to disk, never sent to the popup or options page, and
  never sent to the content script running on the Microsoft login page.
- The content script (which runs in the context of a live web page — the
  least-trusted part of the extension) never has access to secrets or the
  passphrase at all. It sends the background script an email address and
  gets back a plain 6-digit code, nothing else. Even a fully compromised
  login page in that tab can't extract your other secrets or the vault key.
- The vault **auto-locks after 15 minutes** of inactivity by default. This
  is configurable in settings (1 min – 1 hour, or "Never" to keep it
  unlocked until you lock it yourself or the browser closes). You can also
  lock it manually from the popup or options page at any time. While
  locked, autofill is disabled and a small banner on the login page tells
  you to unlock via the toolbar icon.
- There is no password recovery. If you forget the passphrase, "Reset vault"
  in settings is the only way forward, and it deletes every stored account.

**No-passphrase mode (explicit opt-out):**

- If you choose "I don't want a passphrase," secrets are stored as plain
  text in `chrome.storage.local`, scoped to this extension. Anyone with
  access to your OS user profile, or malware running as you, could read
  them. There's no lock/unlock step — it behaves like the encrypted mode
  minus the encryption, so it stays fully convenient.
- Only choose this on a machine you trust and control.

**In both modes:**

- The captured email is kept in `sessionStorage` for the current tab only
  and is cleared when the tab/session ends — it is never sent anywhere.
- All TOTP computation happens locally via `crypto.subtle`; the extension
  makes no network requests of its own.
- `host_permissions` and content-script `matches` are scoped to genuine
  Microsoft sign-in domains only, so the autofill/auto-click logic never
  runs on a look-alike phishing domain.
