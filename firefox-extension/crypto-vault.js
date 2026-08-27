// Passphrase-based encryption for TOTP secrets at rest.
// PBKDF2 (SHA-256) derives an AES-256-GCM key from the user's passphrase;
// the passphrase itself is never stored, and the derived key only ever
// lives in background.js's memory (see vaultKey there), never in
// browser.storage or in the content script / popup contexts.

function toBase64(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveVaultKey(passphrase, saltBytes, iterations) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function vaultEncrypt(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

async function vaultDecrypt(key, { iv, ciphertext }) {
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    key,
    fromBase64(ciphertext)
  );
  return new TextDecoder().decode(plainBuf);
}

globalThis.MSVault = {
  toBase64,
  fromBase64,
  deriveVaultKey,
  vaultEncrypt,
  vaultDecrypt,
  PBKDF2_ITERATIONS: 210000,
};
