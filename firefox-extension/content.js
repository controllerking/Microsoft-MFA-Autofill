// Runs on Microsoft sign-in domains. Watches the DOM through the multi-step
// login flow: capture email -> try to escape the Authenticator push prompt ->
// fill the one-time-code field with a locally generated TOTP.

const DEFAULT_SETTINGS = {
  autoClickAlternate: true,
  autoSubmitCode: false,
  autoSubmitPassword: true,
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
  // Deliberately narrow and exact. A broader match here (e.g. input[type=
  // 'tel'], or a substring match on id/name) risks hitting some unrelated
  // input on a completely different screen and silently writing a TOTP
  // code into it — which actually happened once with a type='tel' fallback
  // that was tried and reverted. Better to occasionally miss a variant
  // screen than to ever write into the wrong field.
  otcSelectors: [
    "input[name='otc']",
    "input[autocomplete='one-time-code']",
    "#idTxtBx_SAOTCC_OTC",
  ],
};

// How long a password value must stay unchanged before we treat it as
// "settled" (i.e. a manager finished filling it, not a human mid-keystroke)
// and click Next/Sign in.
const PASSWORD_SETTLE_MS = 500;

const SESSION_EMAIL_KEY = "ms-totp-autofill:email";

function log(...args) {
  console.debug("[MS TOTP Autofill]", ...args);
}

// Some sign-in flows (e.g. a "resume" URL after switching verification
// methods) never show a visible email input at all — the account is already
// known and carried in the URL's query string instead. Fall back to that so
// we still have something to look up the account by.
function getUrlEmailHint() {
  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of ["username", "login_hint", "upn"]) {
      const value = params.get(key);
      if (value && value.includes("@")) return value;
    }
  } catch {
    /* ignore malformed URLs */
  }
  return "";
}

function getSessionEmail() {
  let stored = "";
  try {
    stored = window.sessionStorage.getItem(SESSION_EMAIL_KEY) || "";
  } catch {
    /* ignore storage errors (e.g. private browsing edge cases) */
  }
  return stored || getUrlEmailHint();
}

function setSessionEmail(email) {
  try {
    window.sessionStorage.setItem(SESSION_EMAIL_KEY, email);
  } catch {
    /* ignore storage errors (e.g. private browsing edge cases) */
  }
}

// This script never reads accounts or secrets from storage directly — it
// only asks the background script (which holds the decryption key in
// memory, if unlocked) for a computed code. That way a compromised or
// malicious page in this tab can, at worst, request a code for whatever
// email is on screen — it can never read the vault itself.
async function loadSettings() {
  let response;
  try {
    response = await browser.runtime.sendMessage({ type: "GET_SETTINGS" });
  } catch (err) {
    if (isContextInvalidated(err)) throw err; // let tick() stop the polling loop
    log("Failed to reach background script for settings:", err);
  }
  return { ...DEFAULT_SETTINGS, ...((response && response.settings) || {}) };
}

// Reloading/updating the extension while this tab is still open severs this
// content script's connection to it — every browser.runtime.* call then
// throws this same error, forever, since the page is never told to stop.
// Recognize it so tick()'s setInterval can tear itself down instead of
// spamming the extension's error console once a second indefinitely.
function isContextInvalidated(err) {
  return !!err && /context invalidated/i.test(err.message || "");
}

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  );
}

function firstMatch(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) return el;
  }
  return null;
}

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor && descriptor.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function watchEmailField(settings) {
  const el = firstMatch(settings.emailSelectors);
  if (!el || el.dataset.msTotpWatched) return;
  el.dataset.msTotpWatched = "1";

  const capture = () => {
    const value = el.value && el.value.trim();
    if (value && value.includes("@")) {
      setSessionEmail(value);
      log("Captured email:", value);
    }
  };
  el.addEventListener("input", capture);
  el.addEventListener("blur", capture);
  capture();
}

function normalizeText(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// Microsoft's newer sign-in UI uses web components with (open) shadow DOM in
// places, and a plain `document.querySelectorAll` never sees inside those —
// it silently returns nothing, as if the element didn't exist. Walk the
// light DOM and recurse into any open shadow roots we find.
function collectAllElements(root, out) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    out.push(node);
    if (node.shadowRoot) collectAllElements(node.shadowRoot, out);
    node = walker.nextNode();
  }
}

// Walk up from a matched text node's element looking for the actual
// clickable ancestor. Microsoft's sign-in-option tiles vary across tenants
// and rebrands — sometimes the label text sits a few elements below the
// interactive node (icon wrapper, text span, etc.) — so we don't assume the
// element carrying the text is itself clickable. Stops at a shadow root
// boundary since a real ancestor search shouldn't cross back out of it.
function findClickableAncestor(el) {
  let node = el;
  for (let i = 0; i < 6 && node && node.nodeType === 1; i++) {
    const role = node.getAttribute && node.getAttribute("role");
    if (
      node.tagName === "A" ||
      node.tagName === "BUTTON" ||
      role === "button" ||
      role === "link" ||
      role === "option" ||
      (node.hasAttribute && node.hasAttribute("tabindex"))
    ) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
}

// Returns { el, text } for the best match, or null. A wrapping container
// whose only content is the actual label element matches too (its
// textContent is identical), so picking by "shortest text" alone breaks
// ties in document order — which favors the *outer* container, since a
// TreeWalker visits parents before their children. Clicking that outer
// container is wrong: click events bubble from the target up to ancestors,
// never down to descendants, so a click dispatched on a wrapper never
// reaches a handler that's actually bound to (or delegated for) the inner
// element. Instead, explicitly keep only the innermost matches — elements
// with no other match nested inside them.
function findClickableByText(patterns) {
  const regexes = patterns.map((p) => new RegExp(p, "i"));
  const all = [];
  collectAllElements(document.body, all);

  const matches = [];
  for (const el of all) {
    if (!isVisible(el)) continue;
    const text = normalizeText(el.textContent);
    if (!text || text.length > 100) continue;
    if (regexes.some((re) => re.test(text))) matches.push({ el, text });
  }
  if (matches.length === 0) return null;

  const leaves = matches.filter(
    ({ el }) => !matches.some((other) => other.el !== el && el.contains(other.el))
  );
  const target = leaves[0] || matches[0];
  return { el: findClickableAncestor(target.el) || target.el, text: target.text };
}

// Plain el.click() only synthesizes a "click" event. Some component
// libraries track press state off mousedown/pointerdown (for styling, or to
// distinguish a click from a drag) and only wire up navigation on
// mouseup/pointerup, so a bare click() can be silently swallowed. Fire a
// fuller, bubbling event sequence to cover both patterns.
//
// Scope this to the alternate-verification tile/link clicks ONLY. Applying
// it to Microsoft's own submit buttons (password/OTC "Verify") previously
// caused an uncaught exception inside their Knockout click handler
// (primaryButton_onClick threw on `e.type` with `e` undefined) — the extra
// synthetic mousedown/mouseup events apparently confused whatever
// double-invocation wiring that page's component uses, and the exception
// aborted the actual verification submit. Plain .click() is what those
// buttons expect.
function simulateClick(el) {
  const opts = { bubbles: true, cancelable: true, view: window };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    try {
      const EventCtor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      el.dispatchEvent(new EventCtor(type, opts));
    } catch {
      /* PointerEvent isn't constructible in every context; safe to skip */
    }
  }
  el.click();
}

// Re-clicking the same label shortly after we already clicked it is almost
// always us reacting to the click's own side effects (a debounced tick
// firing again before the page has moved on), not a genuine new prompt.
// But unlike a permanent per-element flag, this doesn't get stuck: if
// Microsoft's SPA reuses the same DOM node across unrelated screens (e.g.
// the "Sign in another way" link persisting through a passkey failure
// retry), we still click it again once the cooldown passes.
const CLICK_COOLDOWN_MS = 4000;
// A multi-step flow (error screen -> option list -> another option list...)
// can otherwise chain through several auto-clicks within about a second of
// each other, which is jarring and gives no chance to actually see what
// happened. Two paces enforce a human-perceptible cadence without ever
// requiring a person to intervene: a newly-seen option must sit unclicked
// for a moment first (also avoids clicking mid-transition-animation), and
// clicks overall are spaced at least this far apart regardless of text.
const MATCH_SETTLE_MS = 300;
const MIN_CLICK_GAP_MS = 750;

let pendingMatchText = null;
let pendingMatchSince = 0;
let lastClickedText = null;
let lastClickedAt = 0;
let lastAnyClickAt = 0;
let lastNoMatchLogAt = 0;

function tryClickAlternateVerification(settings) {
  if (!settings.autoClickAlternate) return false;
  const match = findClickableByText(settings.switchLinkPatterns);
  const now = Date.now();

  if (!match) {
    pendingMatchText = null;
    // Throttled so it's visible for debugging without spamming the console.
    if (now - lastNoMatchLogAt > 5000) {
      lastNoMatchLogAt = now;
      log(
        "autoClickAlternate is on but no matching text found on this screen.",
        "frame url:", location.href,
        "| is top frame:", window.top === window.self,
        "| body children:", document.body ? document.body.children.length : "(no body)"
      );
    }
    return false;
  }

  // Nothing to pace the very first click against — react the instant it's
  // found instead of waiting out the settle delay. The settle/gap pacing
  // below only matters for a chained sequence of auto-clicks, where it
  // keeps the flow from blowing through several screens unreadably fast.
  const isFirstClickEver = lastAnyClickAt === 0;

  if (match.text !== pendingMatchText) {
    pendingMatchText = match.text;
    pendingMatchSince = now;
    if (!isFirstClickEver) return false;
  }

  const settled = isFirstClickEver || now - pendingMatchSince >= MATCH_SETTLE_MS;
  const paced = now - lastAnyClickAt >= MIN_CLICK_GAP_MS;
  const notCoolingDown = !(match.text === lastClickedText && now - lastClickedAt < CLICK_COOLDOWN_MS);
  if (!settled || !paced || !notCoolingDown) return false;

  lastClickedText = match.text;
  lastClickedAt = now;
  lastAnyClickAt = now;
  log(
    "Clicking alternate verification option:",
    match.text,
    "| element:",
    match.el.tagName,
    match.el.outerHTML.slice(0, 150)
  );
  simulateClick(match.el);
  return true;
}

function watchPasswordField(settings) {
  const el = firstMatch(settings.passwordSelectors);
  if (!el || el.dataset.msTotpPwWatched) return;
  el.dataset.msTotpPwWatched = "1";
  // Most managers dispatch input/change when they fill a field; react
  // immediately instead of waiting for the next debounced tick.
  const recheck = () => tryAutoSubmitPassword(settings);
  el.addEventListener("input", recheck);
  el.addEventListener("change", recheck);
}

const pwWatch = { el: null, value: "", timer: null };

function isAutofilled(el) {
  try {
    return el.matches(":autofill") || el.matches(":-webkit-autofill");
  } catch {
    return false;
  }
}

function clickPasswordSubmit(settings, pwEl) {
  const form = pwEl.closest("form");
  // Do not pass the complete selector list to querySelector(). It returns the
  // first matching element in *document order*, not the first selector in
  // the list. On Microsoft's password screen that can be the Back control,
  // even though #idSIButton9 (Sign in) is listed first in the settings.
  // Prefer Microsoft's known primary button explicitly.
  let btn = (form && form.querySelector("#idSIButton9")) || firstMatch(["#idSIButton9"]);

  // Some Microsoft variants do not use idSIButton9. In those, accept only a
  // visible submit control whose displayed/accessibility text says Next or
  // Sign in; never choose an arbitrary submit control such as Back.
  if (!btn) {
    const scope = form || document;
    const candidates = scope.querySelectorAll("input[type='submit'], button[type='submit']");
    btn = Array.from(candidates).find((candidate) => {
      if (!isVisible(candidate)) return false;
      const label = normalizeText(
        candidate.value || candidate.getAttribute("aria-label") || candidate.textContent
      ).toLowerCase();
      return label === "next" || label === "sign in";
    });
  }
  if (btn) {
    pwEl.dataset.msTotpPwHandled = "1";
    log("Auto-submitting password step");
    btn.click();
  }
}

function tryAutoSubmitPassword(settings) {
  if (!settings.autoSubmitPassword) return;
  const pwEl = firstMatch(settings.passwordSelectors);
  if (!pwEl || pwEl.dataset.msTotpPwHandled) return;

  const value = pwEl.value;
  if (!value) {
    if (pwWatch.timer) clearTimeout(pwWatch.timer);
    pwWatch.el = null;
    pwWatch.value = "";
    pwWatch.timer = null;
    return;
  }

  // Browser-native autofill is detectable immediately and reliably; trust it
  // right away instead of waiting out the settle timer.
  if (isAutofilled(pwEl)) {
    clickPasswordSubmit(settings, pwEl);
    return;
  }

  // Extension-based password managers (Bitwarden, 1Password, etc.) usually
  // set .value via script without triggering the native autofill state, so
  // fall back to: wait for the value to stop changing, then submit. This
  // also naturally avoids submitting while a human is still typing.
  if (pwEl === pwWatch.el && value === pwWatch.value) return; // timer already running for this value

  if (pwWatch.timer) clearTimeout(pwWatch.timer);
  pwWatch.el = pwEl;
  pwWatch.value = value;
  pwWatch.timer = setTimeout(() => {
    if (pwEl.value === value && isVisible(pwEl) && !pwEl.dataset.msTotpPwHandled) {
      clickPasswordSubmit(settings, pwEl);
    }
  }, PASSWORD_SETTLE_MS);
}

function showLockedBanner() {
  if (document.getElementById("ms-totp-autofill-locked-banner")) return;
  const banner = document.createElement("div");
  banner.id = "ms-totp-autofill-locked-banner";
  banner.textContent =
    "\u{1F512} MS TOTP Autofill is locked — click the toolbar icon to unlock and autofill your code.";
  banner.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#202020;color:#fff;" +
    "font:14px -apple-system,Segoe UI,Roboto,sans-serif;padding:8px 12px;text-align:center;";
  document.documentElement.appendChild(banner);
}

let lastOtcNotFoundLogAt = 0;
let lastNoEmailLogAt = 0;

async function tryFillOtc(settings) {
  const el = firstMatch(settings.otcSelectors);
  if (!el) {
    const now = Date.now();
    if (now - lastOtcNotFoundLogAt > 5000) {
      lastOtcNotFoundLogAt = now;
      log("No one-time-code field matched on this screen (otcSelectors:", settings.otcSelectors, ")");
    }
    return;
  }
  if (el.dataset.msTotpFilled) return;

  const email = getSessionEmail();
  if (!email) {
    const now = Date.now();
    if (now - lastNoEmailLogAt > 5000) {
      lastNoEmailLogAt = now;
      log("One-time-code field found, but no email captured yet — can't look up an account.");
    }
    return;
  }

  let response;
  try {
    response = await browser.runtime.sendMessage({ type: "GENERATE_CODE_FOR_EMAIL", email });
  } catch (err) {
    if (isContextInvalidated(err)) throw err; // let tick() stop the polling loop
    log("Failed to reach background script:", err);
    return;
  }

  if (!response || response.error) {
    log("Could not generate code:", response && response.error);
    return;
  }
  if (response.locked) {
    log("Vault is locked — cannot autofill until unlocked via the toolbar popup.");
    showLockedBanner();
    return;
  }
  if (response.notFound) {
    log("One-time-code field found but no matching account for email:", email);
    return;
  }

  setNativeValue(el, response.code);
  el.dataset.msTotpFilled = "1";
  log("Autofilled TOTP for", response.label || response.email);

  if (settings.autoSubmitCode) {
    const form = el.closest("form");
    const submitBtn =
      (form && form.querySelector("input[type='submit'], button[type='submit']")) ||
      document.querySelector("#idSubmit_SAOTCC_Continue, input[type='submit']");
    if (submitBtn) submitBtn.click();
  }
}

async function tick() {
  const settings = await loadSettings();
  watchEmailField(settings);
  const passwordField = firstMatch(settings.passwordSelectors);

  // Once the one-time-code field is actually on screen, we've arrived where
  // we wanted to be. The code-entry screen commonly has its own "Sign in
  // another way" escape hatch (in case someone wants to switch methods
  // instead of entering a code) — matching that here would make the
  // extension bounce back to the option list, re-select the same "use a
  // verification code" option, land back here, see the same link again,
  // and loop forever. So the alternate-verification click is only ever
  // relevant *before* the code field shows up, never after.
  // The password page itself includes a "Sign in another way" link. That is
  // an escape hatch, not a verification prompt, so clicking it here takes the
  // user away from the password screen before #idSIButton9 can be submitted.
  if (!firstMatch(settings.otcSelectors) && !passwordField) {
    tryClickAlternateVerification(settings);
  }

  watchPasswordField(settings);
  tryAutoSubmitPassword(settings);
  await tryFillOtc(settings);
}

let debounceHandle = null;
function scheduleTick() {
  if (debounceHandle) clearTimeout(debounceHandle);
  debounceHandle = setTimeout(runTick, 250);
}

const observer = new MutationObserver(scheduleTick);
observer.observe(document.documentElement, { childList: true, subtree: true });

// MutationObserver's `subtree` option doesn't cross shadow DOM boundaries,
// so changes inside a shadow root (used by parts of Microsoft's newer
// sign-in UI) can happen without ever triggering scheduleTick above. A
// slow periodic poll is a cheap safety net against missing those.
const pollHandle = setInterval(runTick, 1000);

// Runs tick() and, if the extension was reloaded/updated out from under this
// already-open tab, stops all further polling instead of retrying forever —
// there's nothing this content script can do to reconnect; only a page
// reload fixes it.
async function runTick() {
  try {
    await tick();
  } catch (err) {
    if (!isContextInvalidated(err)) throw err;
    log("Extension was reloaded — stopping autofill on this page. Reload the tab to resume.");
    clearInterval(pollHandle);
    observer.disconnect();
  }
}

// Logged once per frame this script is injected into. If the credential
// picker lives in a frame whose URL isn't covered by manifest.json's
// content_scripts.matches, this line simply never appears for that frame —
// there's no other log to indicate the absence, so this is what proves it.
log("Content script loaded. frame url:", location.href, "| is top frame:", window.top === window.self);

runTick();
