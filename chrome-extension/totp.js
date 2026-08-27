// RFC 4648 base32 decode + RFC 6238 TOTP generation using WebCrypto.
// Exposed on globalThis.MSTOTP so background.js (loaded after this file) can
// use it. Uses globalThis rather than window since this script also runs in
// a Chrome MV3 service worker, which has no window.

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(input).replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();

  let bits = "";
  for (const char of cleaned) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue; // skip invalid characters defensively
    bits += val.toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

function counterToBuffer(counter) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  // Split into high/low 32-bit halves since JS bitwise ops are 32-bit.
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  view.setUint32(0, high);
  view.setUint32(4, low);
  return buf;
}

async function hotp(secretBytes, counter, digits, algorithm) {
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, counterToBuffer(counter));
  const bytes = new Uint8Array(signature);
  const offset = bytes[bytes.length - 1] & 0x0f;
  const binCode =
    ((bytes[offset] & 0x7f) << 24) |
    ((bytes[offset + 1] & 0xff) << 16) |
    ((bytes[offset + 2] & 0xff) << 8) |
    (bytes[offset + 3] & 0xff);
  const mod = 10 ** digits;
  return (binCode % mod).toString().padStart(digits, "0");
}

/**
 * Generate the current TOTP code for a base32 secret.
 * @param {string} secretBase32
 * @param {{period?: number, digits?: number, algorithm?: string}} [opts]
 * @returns {Promise<{code: string, secondsRemaining: number}>}
 */
async function generateTOTP(secretBase32, opts = {}) {
  const period = opts.period || 30;
  const digits = opts.digits || 6;
  const algorithm = opts.algorithm || "SHA-1";

  const secretBytes = base32Decode(secretBase32);
  const nowSeconds = Date.now() / 1000;
  const counter = Math.floor(nowSeconds / period);
  const code = await hotp(secretBytes, counter, digits, algorithm);
  const secondsRemaining = period - (Math.floor(nowSeconds) % period);
  return { code, secondsRemaining };
}

globalThis.MSTOTP = { generateTOTP, base32Decode };
