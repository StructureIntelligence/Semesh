// Front-end SPA. Talks ONLY to this app's own /api/* routes — never to Semesh directly, and never
// sees the runtime key. The server forwards the signed-in user's session as X-Semesh-Payer so the
// logged-in user's Aev wallet is charged (end-user-pays).

const $ = (s) => document.querySelector(s);
const runBtn = $("#runBtn");
const statusEl = $("#status");
const resultPanel = $("#resultPanel");
const resultEl = $("#result");
const costTag = $("#costTag");

const OPERATION_STORAGE_KEY = "semesh.ai-saas-paid-api.pending-operation.v1";
const OPERATION_ID = /^[A-Za-z0-9._:-]{8,200}$/;

function loadOperation() {
  try {
    const value = JSON.parse(sessionStorage.getItem(OPERATION_STORAGE_KEY) || "null");
    if (value && OPERATION_ID.test(value.id) && typeof value.prompt === "string" && value.prompt.length <= 2000) return value;
    sessionStorage.removeItem(OPERATION_STORAGE_KEY);
  } catch { /* storage unavailable or stale: keep the in-memory safety path */ }
  return null;
}

function storeOperation(value) {
  try {
    if (value) sessionStorage.setItem(OPERATION_STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(OPERATION_STORAGE_KEY);
  } catch { /* storage unavailable: the current page still preserves the operation */ }
}

const state = { loggedIn: false, estimate: 2, operation: loadOperation(), inFlight: false };

const fmt = (n) => (Math.round(n * 100) / 100).toString();

function newOperationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return "web-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function updateRunEnabled() {
  const prompt = $("#prompt");
  prompt.disabled = !!state.operation;
  $(".btn-label").textContent = state.operation ? "Retry same operation" : "Run AI call";
  runBtn.disabled = state.inFlight || !(state.loggedIn && (state.operation || prompt.value.trim().length > 0));
}

function setStatus(msg, kind) {
  statusEl.textContent = msg || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

async function loadMe() {
  try {
    const j = await (await fetch("/api/me")).json();
    state.loggedIn = !!j.logged_in;
    if (typeof j.estimate_aev === "number") { state.estimate = j.estimate_aev; $("#estVal").textContent = fmt(j.estimate_aev); }
    const chip = $("#authChip");
    if (state.loggedIn) { chip.textContent = "✓ Signed in"; chip.className = "chip ok"; $("#loginBanner").hidden = true; }
    else { chip.textContent = "Not signed in"; chip.className = "chip chip-muted"; $("#loginBanner").hidden = false; }
  } catch { /* ignore */ }
  updateRunEnabled();
}

async function run() {
  if (runBtn.disabled) return;
  const requestedPrompt = $("#prompt").value.trim();
  if (!state.operation && !requestedPrompt) return;

  runBtn.classList.add("busy");
  if (!state.operation) {
    state.operation = { id: newOperationId(), prompt: requestedPrompt };
    storeOperation(state.operation);
  }
  // Unknown settlement can only replay this immutable body/key pair; new input stays locked.
  const operation = state.operation;
  state.inFlight = true;
  updateRunEnabled();
  setStatus(`Running… (≈ ${fmt(state.estimate)} Aev, billed to your wallet)`, "");

  try {
    const r = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": operation.id },
      body: JSON.stringify({ prompt: operation.prompt }),
    });
    const j = await r.json();

    if (r.status === 401) {
      state.loggedIn = false;
      $("#loginBanner").hidden = false;
      setStatus("Please sign in with Semesh to run.", "err");
      return;
    }
    if (r.status === 402) {
      // Funding is offered only when this live response includes a gated path. Preserve this exact
      // operation either way; a later retry must use the same body and key.
      const id = j.idempotency_key || operation.id;
      setStatus(`${j.message || "Not enough Aev."} Settlement is ${j.settlement_status || "unknown"}; reconcile operation ${id}.`, "err");
      if (j.topup) {
        const a = document.createElement("a");
        a.href = j.topup; a.className = "btn btn-primary topup-link"; a.textContent = "Add Aev";
        statusEl.appendChild(document.createTextNode(" "));
        statusEl.appendChild(a);
      }
      return;
    }
    if (!r.ok || !j.ok) {
      const id = j.idempotency_key || operation.id;
      setStatus(`${j.message || j.error || "The call did not complete."} Settlement is ${j.settlement_status || "unknown"}; reconcile operation ${id} before starting a new call.`, "err");
      return;
    }

    // A provider result is useful output, but only explicit platform capture evidence proves billing.
    resultPanel.hidden = false;
    resultEl.textContent = j.text || "(empty response)";
    const captured = j.settlement_status === "captured" &&
      typeof j.captured_aev === "number" && Number.isFinite(j.captured_aev) && j.captured_aev >= 0;
    if (captured) {
      costTag.textContent = `${fmt(j.captured_aev)} Aev captured`;
      setStatus(`Done · ${fmt(j.captured_aev)} Aev captured from your wallet.`, "ok");
      state.operation = null;
      storeOperation(null);
    } else {
      const id = j.idempotency_key || operation.id;
      costTag.textContent = `Settlement unknown · operation ${id}`;
      setStatus(`Result received, but settlement is unknown. Reconcile operation ${id} before starting a new call.`, "err");
    }
  } catch (e) {
    setStatus(`Network outcome is unknown. Reconcile operation ${operation.id} before starting a new call. ${e && e.message ? e.message : ""}`, "err");
  } finally {
    state.inFlight = false;
    runBtn.classList.remove("busy");
    updateRunEnabled();
  }
}

runBtn.addEventListener("click", run);
if (state.operation) $("#prompt").value = state.operation.prompt;
$("#prompt").addEventListener("input", updateRunEnabled);
$("#prompt").addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
});

loadMe();
