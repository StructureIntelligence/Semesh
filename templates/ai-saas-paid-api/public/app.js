// Browser state persists the effect-zero quote's exact invoke bytes and the replay key before the
// effect-capable request. Before an Invocation ID is known, retry reuses those bytes; afterward the
// client sends the saved ID to a read-only observation endpoint and never repeats upstream invoke.

const $ = (selector) => document.querySelector(selector);
const runBtn = $("#runBtn");
const statusEl = $("#status");
const resultPanel = $("#resultPanel");
const resultEl = $("#result");
const costTag = $("#costTag");
const REQUEST_STORAGE_KEY = "semesh.ai-saas-paid-api.pending-request.v2";
const REQUEST_KEY = /^[A-Za-z0-9._:-]{8,200}$/;

function validPrepared(value, idempotencyKey) {
  return value && typeof value === "object" &&
    typeof value.action_path === "string" && typeof value.invoke_body === "string" &&
    typeof value.deadline === "string" && value.idempotency_key === idempotencyKey &&
    value.quote_evidence && typeof value.quote_evidence === "object" &&
    /^hmac-sha256:[0-9a-f]{64}$/.test(value.prepared_seal) &&
    Number.isSafeInteger(value.quoted_aev_atoms) && value.quoted_aev_atoms >= 0;
}

function validInvocationId(value, idempotencyKey) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    value === value.trim() && value !== idempotencyKey;
}

function loadRequest() {
  try {
    const value = JSON.parse(sessionStorage.getItem(REQUEST_STORAGE_KEY) || "null");
    if (value && REQUEST_KEY.test(value.idempotencyKey) && typeof value.prompt === "string" &&
        value.prompt.length <= 2000 && (!value.prepared || validPrepared(value.prepared, value.idempotencyKey)) &&
        (!value.invocationId || validInvocationId(value.invocationId, value.idempotencyKey))) return value;
    sessionStorage.removeItem(REQUEST_STORAGE_KEY);
  } catch { /* Stale or unavailable storage leaves no executable request. */ }
  return null;
}

function storeRequest(value) {
  try {
    if (value) {
      const encoded = JSON.stringify(value);
      sessionStorage.setItem(REQUEST_STORAGE_KEY, encoded);
      return sessionStorage.getItem(REQUEST_STORAGE_KEY) === encoded;
    }
    sessionStorage.removeItem(REQUEST_STORAGE_KEY);
    return sessionStorage.getItem(REQUEST_STORAGE_KEY) === null;
  } catch { return false; }
}

function persistKnownInvocation(request) {
  if (storeRequest(request)) return "persisted";
  // Never leave the older executable no-ID record behind after this tab has learned an ID.
  // The in-memory request keeps the ID, so a same-tab retry can only take the observe path.
  return storeRequest(null) ? "invalidated" : "unavailable";
}

const state = { loggedIn: false, estimate: 2, request: loadRequest(), inFlight: false };
const fmt = (number) => (Math.round(number * 1000000) / 1000000).toString();

function fmtAtoms(value) {
  if (!Number.isSafeInteger(value) || value < 0) return "unknown";
  const whole = Math.floor(value / 100000000);
  const fraction = (value % 100000000).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function newRequestKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return "web-" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function updateRunEnabled() {
  const prompt = $("#prompt");
  prompt.disabled = !!state.request;
  $(".btn-label").textContent = state.request
    ? (state.request.invocationId ? "Observe same invocation" : "Retry same request")
    : "Run AI call";
  runBtn.disabled = state.inFlight || !(state.loggedIn && (state.request || prompt.value.trim().length > 0));
}

function setStatus(message, kind) {
  statusEl.textContent = message || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

async function responseJSON(response) {
  try { return await response.json(); } catch { return { error: "malformed_app_response", message: "The app returned malformed JSON." }; }
}

async function loadMe() {
  try {
    const data = await responseJSON(await fetch("/api/me"));
    state.loggedIn = !!data.logged_in;
    if (typeof data.estimate_aev === "number") {
      state.estimate = data.estimate_aev;
      $("#estVal").textContent = fmt(data.estimate_aev);
    }
    const chip = $("#authChip");
    if (state.loggedIn) {
      chip.textContent = "✓ Signed in";
      chip.className = "chip ok";
      $("#loginBanner").hidden = true;
    } else {
      chip.textContent = "Not signed in";
      chip.className = "chip chip-muted";
      $("#loginBanner").hidden = false;
    }
  } catch { /* Keep the page safely disabled. */ }
  updateRunEnabled();
}

async function run() {
  if (runBtn.disabled) return;
  const prompt = $("#prompt").value.trim();
  if (!state.request && !prompt) return;
  if (!state.request) {
    state.request = { idempotencyKey: newRequestKey(), prompt, prepared: null, invocationId: null };
    if (!storeRequest(state.request)) {
      state.request = null;
      setStatus("Private request storage is unavailable. No quote or invoke was sent.", "err");
      updateRunEnabled();
      return;
    }
  }
  const request = state.request;
  state.inFlight = true;
  runBtn.classList.add("busy");
  updateRunEnabled();

  try {
    if (!request.prepared) {
      setStatus("Discovering the Model Unit and requesting an effect-zero quote…", "");
      const quoteResponse = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": request.idempotencyKey },
        body: JSON.stringify({ prompt: request.prompt }),
      });
      const quote = await responseJSON(quoteResponse);
      if (quoteResponse.status === 401) {
        state.loggedIn = false;
        $("#loginBanner").hidden = false;
        setStatus("Please sign in with Semesh to quote this call.", "err");
        return;
      }
      if (!quoteResponse.ok || !quote.ok || !validPrepared(quote.prepared, request.idempotencyKey)) {
        setStatus(`${quote.message || quote.error || "Quote unavailable."} No invoke was sent; retry this request after the canonical contract is available.`, "err");
        return;
      }
      request.prepared = quote.prepared;
      $("#estVal").textContent = fmtAtoms(quote.quoted_aev_atoms);
      if (!storeRequest(request)) {
        request.prepared = null;
        setStatus("The exact quote bundle could not be persisted. No invoke was sent.", "err");
        return;
      }
    }

    if (!storeRequest(request)) {
      setStatus("The exact saved request failed readback. No invoke was sent.", "err");
      return;
    }

    const observing = validInvocationId(request.invocationId, request.idempotencyKey);
    setStatus(observing
      ? `Observing Invocation ${request.invocationId} with canonical GETs…`
      : `Invoking the saved request (quoted ${fmtAtoms(request.prepared.quoted_aev_atoms)} Aev)…`, "");
    const response = await fetch(observing ? "/api/observe" : "/api/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": request.idempotencyKey },
      body: JSON.stringify({
        prepared: request.prepared,
        ...(observing ? { invocation_id: request.invocationId } : {}),
      }),
    });
    const data = await responseJSON(response);
    if (typeof data.invocation_id === "string") {
      if (!validInvocationId(data.invocation_id, request.idempotencyKey) ||
          (request.invocationId && request.invocationId !== data.invocation_id)) {
        setStatus("The app returned a conflicting Invocation identity. Keep the saved operation for reconciliation.", "err");
        return;
      }
      request.invocationId = data.invocation_id;
      const persistence = persistKnownInvocation(request);
      if (persistence !== "persisted") {
        const storageWarning = persistence === "invalidated"
          ? "The stale no-ID browser record was invalidated."
          : "Browser storage could not be cleared; do not reload or retry from this browser state.";
        setStatus(`Invocation ${data.invocation_id} could not be persisted. ${storageWarning} Keep this tab open and record the ID.`, "err");
        return;
      }
    }
    if (!response.ok || !data.ok) {
      const observed = request.invocationId ? ` Invocation: ${request.invocationId}.` : "";
      setStatus(`${data.message || data.error || "The call did not complete."} Settlement: ${data.settlement_status || "unknown"}.${observed} Replay key: ${request.idempotencyKey}.`, "err");
      return;
    }

    resultPanel.hidden = false;
    resultEl.textContent = data.text || "(empty response)";
    const terminal = data.settlement_status === "captured" || data.settlement_status === "released";
    if (!terminal || !Number.isSafeInteger(data.captured_aev_atoms) || data.captured_aev_atoms < 0) {
      setStatus(`Receipt is not terminal. Reconcile Invocation ${data.invocation_id} with replay key ${request.idempotencyKey}.`, "err");
      return;
    }
    costTag.textContent = `${fmtAtoms(data.captured_aev_atoms)} Aev captured`;
    setStatus(`Done · receipt captured ${fmtAtoms(data.captured_aev_atoms)} Aev · Invocation ${data.invocation_id}.`, "ok");
    state.request = null;
    storeRequest(null);
  } catch (error) {
    const observed = request.invocationId ? ` Invocation: ${request.invocationId}.` : "";
    const recovery = request.invocationId
      ? "Retry observes that same Invocation through canonical GETs."
      : "Retry reuses the saved invoke bytes and replay key.";
    setStatus(`Network outcome unknown.${observed} ${recovery} Key: ${request.idempotencyKey}. ${error && error.message || ""}`, "err");
  } finally {
    state.inFlight = false;
    runBtn.classList.remove("busy");
    updateRunEnabled();
  }
}

runBtn.addEventListener("click", run);
if (state.request) $("#prompt").value = state.request.prompt;
$("#prompt").addEventListener("input", updateRunEnabled);
$("#prompt").addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") run();
});
loadMe();
