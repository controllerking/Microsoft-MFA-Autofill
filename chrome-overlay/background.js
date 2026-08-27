// Chrome MV3 service worker entry point. Firefox loads totp.js,
// crypto-vault.js and background.js as separate scripts that share one
// background-page global scope; Chrome MV3 only supports a single service
// worker file, so this pulls the same shared scripts in via importScripts()
// (which runs them in this same global scope, same as Firefox) after
// installing the browser->chrome shim they rely on.
importScripts("browser-polyfill.js", "totp.js", "crypto-vault.js", "background-core.js");
