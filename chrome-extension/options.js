function send(msg) {
  return browser.runtime.sendMessage(msg);
}

function show(id, visible) {
  document.getElementById(id).classList.toggle("hidden", !visible);
}

function normalizeSecret(raw) {
  return raw.replace(/\s+/g, "").toUpperCase();
}

async function refreshVaultUI() {
  const status = await send({ type: "VAULT_STATUS" });

  show("setupSection", !status.hasVault);
  show("unlockSection", status.hasVault && status.mode === "encrypted" && !status.unlocked);
  show("unlockedSection", status.unlocked);
  show("lockBtn", status.mode === "encrypted");
  show("autoLockRow", status.mode === "encrypted");

  if (status.unlocked) {
    await renderAccounts();
    await loadSettingsIntoForm();
  }
}

async function renderAccounts() {
  const { accounts = [] } = await send({ type: "LIST_ACCOUNTS" });
  const tbody = document.querySelector("#accountsTable tbody");
  tbody.innerHTML = "";
  accounts.forEach((acc) => {
    const tr = document.createElement("tr");

    const labelTd = document.createElement("td");
    labelTd.textContent = acc.label || "(no label)";

    const emailTd = document.createElement("td");
    emailTd.textContent = acc.email;

    const actionTd = document.createElement("td");
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.className = "danger";
    removeBtn.addEventListener("click", async () => {
      await send({ type: "REMOVE_ACCOUNT", id: acc.id });
      renderAccounts();
    });
    actionTd.appendChild(removeBtn);

    tr.appendChild(labelTd);
    tr.appendChild(emailTd);
    tr.appendChild(actionTd);
    tbody.appendChild(tr);
  });
}

async function loadSettingsIntoForm() {
  const { settings = {} } = await send({ type: "GET_SETTINGS" });
  document.getElementById("autoClickAlternate").checked = settings.autoClickAlternate !== false;
  document.getElementById("autoSubmitPassword").checked = settings.autoSubmitPassword !== false;
  document.getElementById("autoSubmitCode").checked = !!settings.autoSubmitCode;
  document.getElementById("autoLockMinutes").value = String(settings.autoLockMinutes);
}

// --- Vault setup ---

document.getElementById("setupBtn").addEventListener("click", async () => {
  const status = document.getElementById("setupStatus");
  const passphrase = document.getElementById("setupPassphrase").value;
  const confirm = document.getElementById("setupPassphraseConfirm").value;

  if (passphrase.length < 8) {
    status.textContent = "Passphrase must be at least 8 characters.";
    return;
  }
  if (passphrase !== confirm) {
    status.textContent = "Passphrases don't match.";
    return;
  }

  const result = await send({ type: "SETUP_VAULT", passphrase });
  if (result && result.error) {
    status.textContent = "Couldn't create vault: " + result.error;
    return;
  }
  document.getElementById("setupPassphrase").value = "";
  document.getElementById("setupPassphraseConfirm").value = "";
  status.textContent = "";
  await refreshVaultUI();
});

document.getElementById("showSkipPassphrase").addEventListener("click", (e) => {
  e.preventDefault();
  show("skipPassphraseBox", true);
});

document.getElementById("confirmSkipPassphrase").addEventListener("click", async () => {
  const status = document.getElementById("skipStatus");
  const result = await send({ type: "SETUP_PLAIN_VAULT" });
  if (result && result.error) {
    status.textContent = "Couldn't continue: " + result.error;
    return;
  }
  await refreshVaultUI();
});

// --- Unlock ---

document.getElementById("unlockBtn").addEventListener("click", async () => {
  const status = document.getElementById("unlockStatus");
  const passphrase = document.getElementById("unlockPassphrase").value;
  const result = await send({ type: "UNLOCK_VAULT", passphrase });
  if (result && result.error) {
    status.textContent = result.error === "bad-passphrase" ? "Incorrect passphrase." : result.error;
    return;
  }
  document.getElementById("unlockPassphrase").value = "";
  status.textContent = "";
  await refreshVaultUI();
});

// --- Accounts ---

document.getElementById("add").addEventListener("click", async () => {
  const addBtn = document.getElementById("add");
  const label = document.getElementById("label").value.trim();
  const email = document.getElementById("email").value.trim();
  const secretRaw = document.getElementById("secret").value.trim();
  const status = document.getElementById("addStatus");

  if (!email || !secretRaw) {
    status.textContent = "Email and secret are required.";
    return;
  }

  const secret = normalizeSecret(secretRaw);
  if (!/^[A-Z2-7]+=*$/.test(secret)) {
    status.textContent = "Secret doesn't look like valid base32.";
    return;
  }

  addBtn.disabled = true;
  status.textContent = "Adding…";

  try {
    const result = await send({ type: "ADD_ACCOUNT", account: { label, email, secret } });
    if (result && result.error) {
      status.textContent = "Couldn't add account: " + result.error;
      return;
    }

    document.getElementById("label").value = "";
    document.getElementById("email").value = "";
    document.getElementById("secret").value = "";
    status.textContent = "Added.";
    setTimeout(() => (status.textContent = ""), 2000);
    await renderAccounts();
  } finally {
    addBtn.disabled = false;
  }
});

// --- Behavior settings ---

document.getElementById("saveSettings").addEventListener("click", async () => {
  const settingsUpdate = {
    autoClickAlternate: document.getElementById("autoClickAlternate").checked,
    autoSubmitPassword: document.getElementById("autoSubmitPassword").checked,
    autoSubmitCode: document.getElementById("autoSubmitCode").checked,
    autoLockMinutes: Number(document.getElementById("autoLockMinutes").value),
  };
  await send({ type: "SAVE_SETTINGS", settings: settingsUpdate });
  const status = document.getElementById("settingsStatus");
  status.textContent = "Saved.";
  setTimeout(() => (status.textContent = ""), 2000);
});

// --- Vault management ---

document.getElementById("lockBtn").addEventListener("click", async () => {
  await send({ type: "LOCK_VAULT" });
  await refreshVaultUI();
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  const confirmed = confirm(
    "This permanently deletes every saved account and secret. This cannot be undone. Continue?"
  );
  if (!confirmed) return;
  await send({ type: "RESET_VAULT" });
  await refreshVaultUI();
});

refreshVaultUI();
