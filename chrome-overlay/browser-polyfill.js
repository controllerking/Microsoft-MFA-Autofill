// Minimal `browser.*` shim for Chrome. All the WebExtension APIs this
// extension uses (storage, runtime, action) are promise-based in Chrome's
// MV3 implementation already, so no callback-to-promise wrapping is needed
// here — the shared logic in background-core.js / popup.js / options.js /
// content.js just needs a `browser` global that aliases `chrome`.
if (typeof browser === "undefined") {
  globalThis.browser = chrome;
}
