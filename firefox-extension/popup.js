let accounts = [];
let refreshHandle = null;

function send(msg) {
  return browser.runtime.sendMessage(msg);
}

function show(id, visible) {
  document.getElementById(id).classList.toggle("hidden", !visible);
}

async function init() {
  const status = await send({ type: "VAULT_STATUS" });

  show("noVaultSection", !status.hasVault);
  show("lockedSection", status.hasVault && !status.unlocked);
  show("unlockedSection", status.unlocked);
  document.getElementById("lockBtn").classList.toggle("hidden", status.mode !== "encrypted");

  if (status.unlocked) {
    await initAccountList();
  }
}

async function initAccountList() {
  const { accounts: list = [] } = await send({ type: "LIST_ACCOUNTS" });
  accounts = list;

  const select = document.getElementById("accountSelect");
  select.innerHTML = "";

  if (accounts.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No accounts configured";
    select.appendChild(opt);
    select.disabled = true;
    document.getElementById("code").textContent = "------";
    return;
  }

  accounts.forEach((acc, i) => {
    const opt = document.createElement("option");
    opt.value = acc.id;
    opt.textContent = acc.label || acc.email;
    select.appendChild(opt);
  });

  select.addEventListener("change", updateCode);
  await updateCode();
  if (refreshHandle) clearInterval(refreshHandle);
  refreshHandle = setInterval(updateCode, 1000);
}

async function updateCode() {
  const select = document.getElementById("accountSelect");
  if (!select.value) return;

  const result = await send({ type: "GENERATE_CODE_FOR_ID", id: select.value });
  if (!result || result.error || result.locked || result.notFound) {
    document.getElementById("code").textContent = "------";
    document.getElementById("countdown").textContent = "";
    return;
  }
  document.getElementById("code").textContent = result.code;
  document.getElementById("countdown").textContent = `refreshes in ${result.secondsRemaining}s`;
}

document.getElementById("unlockBtn").addEventListener("click", async () => {
  const passphrase = document.getElementById("unlockPassphrase").value;
  const errorEl = document.getElementById("unlockError");
  const result = await send({ type: "UNLOCK_VAULT", passphrase });
  if (result && result.error) {
    errorEl.textContent = result.error === "bad-passphrase" ? "Incorrect passphrase." : result.error;
    return;
  }
  document.getElementById("unlockPassphrase").value = "";
  errorEl.textContent = "";
  await init();
});

document.getElementById("lockBtn").addEventListener("click", async () => {
  if (refreshHandle) clearInterval(refreshHandle);
  await send({ type: "LOCK_VAULT" });
  await init();
});

document.getElementById("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

init();
