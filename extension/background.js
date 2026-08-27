// Owns the vault: the derived encryption key lives only here, in memory,
// for the current browser session. Content scripts and the popup never see
// raw TOTP secrets or the passphrase — they message this script and get
// back only what they need (a computed code, or account metadata).
//
// Two vault modes:
//  - "encrypted" (recommended, default path in the UI): secrets are
//    AES-GCM encrypted with a key derived from a user passphrase via
//    PBKDF2. The key only ever lives in this script's memory and is
//    cleared on lock/auto-lock/browser restart.
//  - "plain": an explicit opt-out for users who don't want a passphrase
//    prompt. Secrets are stored as-is in browser.storage.local. The
//    toolbar badge shows a persistent warning in this mode.

const DEFAULT_SETTINGS = {
  autoClickAlternate: true,
  autoSubmitCode: false,
  autoSubmitPassword: true,
  // Minutes of inactivity before the vault auto-locks; 0 disables auto-lock.
  autoLockMinutes: 15,
  switchLinkPatterns: [
    "can.?t use.*authenticator",
    "sign in another way",
    "use a different verification option",
    "use a verification code",
    "i can.?t use my microsoft authenticator app right now",
    "use my password",
  ],
  emailSelectors: ["input[type='email']", "input[name='loginfmt']"],
  passwordSelectors: ["input[type='password']", "input[name='passwd']", "#i0118"],
  passwordSubmitSelectors: ["#idSIButton9", "input[type='submit']", "button[type='submit']"],
  otcSelectors: [
    "input[name='otc']",
    "input[autocomplete='one-time-code']",
    "#idTxtBx_SAOTCC_OTC",
  ],
};

const VAULT_VERIFIER_PLAINTEXT = "ms-totp-autofill-vault-check";

let vaultKey = null; // only set/used in "encrypted" mode
let autoLockTimer = null;

async function scheduleAutoLock() {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = null;

  const { autoLockMinutes } = await getSettings();
  if (!autoLockMinutes || autoLockMinutes <= 0) return; // auto-lock disabled
  autoLockTimer = setTimeout(lockVault, autoLockMinutes * 60 * 1000);
}

async function touchActivity() {
  if (vaultKey) await scheduleAutoLock();
}

async function updateBadge() {
  const vault = await getVaultRecord();
  if (vault && vault.mode === "plain") {
    // No passphrase means nothing to lock/unlock — stay out of the way.
    browser.action.setBadgeText({ text: "" });
    browser.action.setTitle({ title: "MS TOTP Autofill" });
    return;
  }
  const locked = !vaultKey;
  browser.action.setBadgeText({ text: locked ? "\u{1F512}" : "" });
  browser.action.setBadgeBackgroundColor({ color: "#b00020" });
  browser.action.setTitle({ title: locked ? "MS TOTP Autofill — locked" : "MS TOTP Autofill" });
}

function lockVault() {
  vaultKey = null;
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = null;
  updateBadge();
}

async function getVaultRecord() {
  const { vault } = await browser.storage.local.get("vault");
  return vault || null;
}

async function isUnlocked() {
  const vault = await getVaultRecord();
  return !!vault && (vault.mode === "plain" || !!vaultKey);
}

async function setupEncryptedVault(passphrase) {
  const existing = await getVaultRecord();
  if (existing) throw new Error("vault-exists");
  if (!passphrase || passphrase.length < 8) throw new Error("passphrase-too-short");

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = MSVault.PBKDF2_ITERATIONS;
  const key = await MSVault.deriveVaultKey(passphrase, salt, iterations);
  const verifier = await MSVault.vaultEncrypt(key, VAULT_VERIFIER_PLAINTEXT);

  await browser.storage.local.set({
    vault: { mode: "encrypted", salt: MSVault.toBase64(salt), iterations, verifier },
  });

  vaultKey = key;
  await scheduleAutoLock();
  updateBadge();
}

async function setupPlainVault() {
  const existing = await getVaultRecord();
  if (existing) throw new Error("vault-exists");
  await browser.storage.local.set({ vault: { mode: "plain" } });
  updateBadge();
}

async function unlockVault(passphrase) {
  const vault = await getVaultRecord();
  if (!vault || vault.mode !== "encrypted") throw new Error("no-vault");

  const salt = MSVault.fromBase64(vault.salt);
  const key = await MSVault.deriveVaultKey(passphrase, salt, vault.iterations);

  let check;
  try {
    check = await MSVault.vaultDecrypt(key, vault.verifier);
  } catch {
    throw new Error("bad-passphrase");
  }
  if (check !== VAULT_VERIFIER_PLAINTEXT) throw new Error("bad-passphrase");

  vaultKey = key;
  await scheduleAutoLock();
  updateBadge();
}

async function resetVault() {
  lockVault();
  await browser.storage.local.set({ vault: null, accounts: [] });
  updateBadge();
}

async function addAccount({ label, email, secret }) {
  const vault = await getVaultRecord();
  if (!vault) throw new Error("no-vault");
  if (!email || !secret) throw new Error("missing-fields");

  const { accounts = [] } = await browser.storage.local.get("accounts");

  if (vault.mode === "plain") {
    accounts.push({ id: crypto.randomUUID(), label: label || "", email, secret });
  } else {
    if (!vaultKey) throw new Error("locked");
    const encryptedSecret = await MSVault.vaultEncrypt(vaultKey, secret);
    accounts.push({ id: crypto.randomUUID(), label: label || "", email, encryptedSecret });
    await touchActivity();
  }
  await browser.storage.local.set({ accounts });
}

async function removeAccount(id) {
  const { accounts = [] } = await browser.storage.local.get("accounts");
  await browser.storage.local.set({ accounts: accounts.filter((a) => a.id !== id) });
}

async function listAccountsMeta() {
  const { accounts = [] } = await browser.storage.local.get("accounts");
  return accounts.map(({ id, label, email }) => ({ id, label, email }));
}

async function findAccountRecord(predicate) {
  const { accounts = [] } = await browser.storage.local.get("accounts");
  return accounts.find(predicate) || null;
}

async function generateCodeForAccount(account) {
  const secret = account.secret !== undefined
    ? account.secret
    : await MSVault.vaultDecrypt(vaultKey, account.encryptedSecret);
  const result = await generateTOTP(secret);
  await touchActivity();
  return { code: result.code, secondsRemaining: result.secondsRemaining, label: account.label, email: account.email };
}

// Only these fields are ever user-configurable (via the options page).
// Everything else in DEFAULT_SETTINGS — switchLinkPatterns, emailSelectors,
// otcSelectors, passwordSelectors, passwordSubmitSelectors — is an
// implementation detail that must always come from the current code, never
// get frozen into storage. (History: SAVE_SETTINGS used to persist the
// *entire* merged settings object, so the first time anyone ever saved
// settings, whatever those arrays looked like at that moment got pinned
// forever — silently ignoring every pattern added in later versions. This
// whitelist is what prevents that from happening again, and also heals an
// already-poisoned stored object without needing a migration step: any
// stray non-whitelisted key just gets dropped the next time settings are
// read or saved.)
const USER_SETTABLE_KEYS = ["autoClickAlternate", "autoSubmitCode", "autoSubmitPassword", "autoLockMinutes"];

function pickUserSettableKeys(obj) {
  const picked = {};
  for (const key of USER_SETTABLE_KEYS) {
    if (obj && key in obj) picked[key] = obj[key];
  }
  return picked;
}

async function getSettings() {
  const { settings } = await browser.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...pickUserSettableKeys(settings) };
}

async function handleMessage(msg) {
  switch (msg.type) {
    case "VAULT_STATUS": {
      const vault = await getVaultRecord();
      return {
        hasVault: !!vault,
        mode: vault ? vault.mode : null,
        unlocked: await isUnlocked(),
      };
    }
    case "SETUP_VAULT": {
      await setupEncryptedVault(msg.passphrase);
      return { ok: true };
    }
    case "SETUP_PLAIN_VAULT": {
      await setupPlainVault();
      return { ok: true };
    }
    case "UNLOCK_VAULT": {
      await unlockVault(msg.passphrase);
      return { ok: true };
    }
    case "LOCK_VAULT": {
      lockVault();
      return { ok: true };
    }
    case "RESET_VAULT": {
      await resetVault();
      return { ok: true };
    }
    case "ADD_ACCOUNT": {
      await addAccount(msg.account);
      return { ok: true };
    }
    case "REMOVE_ACCOUNT": {
      await removeAccount(msg.id);
      return { ok: true };
    }
    case "LIST_ACCOUNTS": {
      return { accounts: await listAccountsMeta() };
    }
    case "GENERATE_CODE_FOR_EMAIL": {
      if (!(await isUnlocked())) return { locked: true };
      const normalized = (msg.email || "").trim().toLowerCase();
      const account = await findAccountRecord((a) => a.email.trim().toLowerCase() === normalized);
      if (!account) return { notFound: true };
      return await generateCodeForAccount(account);
    }
    case "GENERATE_CODE_FOR_ID": {
      if (!(await isUnlocked())) return { locked: true };
      const account = await findAccountRecord((a) => a.id === msg.id);
      if (!account) return { notFound: true };
      return await generateCodeForAccount(account);
    }
    case "GET_SETTINGS": {
      return { settings: await getSettings() };
    }
    case "SAVE_SETTINGS": {
      const { settings: rawStored } = await browser.storage.local.get("settings");
      const toStore = pickUserSettableKeys({ ...rawStored, ...msg.settings });
      await browser.storage.local.set({ settings: toStore });
      if (vaultKey) await scheduleAutoLock(); // apply a changed auto-lock interval right away
      return { ok: true };
    }
    default:
      return undefined;
  }
}

browser.runtime.onMessage.addListener((msg) => {
  return handleMessage(msg).catch((err) => ({ error: err.message || String(err) }));
});

browser.runtime.onInstalled.addListener(updateBadge);
browser.runtime.onStartup.addListener(updateBadge);
updateBadge();
