// Tiny client. Talks ONLY to this app's /api/* — never to Semesh directly, never sees a key.
const $ = (id) => document.getElementById(id);
let spent = 0;
const LEGACY_OPERATION_STORAGE_KEY = "semesh.auth-payments-minimal.pending-operation.v1";
const OPERATION_STORAGE_PREFIX = "semesh.auth-payments-minimal.pending-operation.v2.";
const OPERATION_ID = /^[A-Za-z0-9._:-]{8,200}$/;
// Opaque OIDC subjects are provider-defined. Accept bounded visible ASCII that is safe in an HTTP
// header; do not encode assumptions about UUIDs, emails, or one identity provider.
const PRINCIPAL_ID = /^[\x21-\x7E]{1,200}$/;
// Slightly longer than the server's quote budget so the browser normally receives the canonical
// server machine error instead of winning the timeout race with a local transport error.
const QUOTE_UI_TIMEOUT_MS = 20000;

function validPrincipal(value) {
  return typeof value === "string" && PRINCIPAL_ID.test(value);
}

// /__semesh/me is the browser identity authority. Prefer OIDC `sub`; use `id` only when
// `sub` is absent. A present malformed sub fails closed instead of silently changing identity.
function principalFromMe(payload) {
  if (!payload || payload.authenticated !== true || !payload.user || typeof payload.user !== "object") return null;
  const user = payload.user;
  if (Object.hasOwn(user, "sub") && user.sub !== "") return validPrincipal(user.sub) ? user.sub : null;
  return validPrincipal(user.id) ? user.id : null;
}

function operationStorageKey(principal) {
  return validPrincipal(principal) ? OPERATION_STORAGE_PREFIX + encodeURIComponent(principal) : null;
}

function parseOperation(raw, expectedPrincipal) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (
      value &&
      value.version === 2 &&
      value.principal === expectedPrincipal &&
      validPrincipal(value.principal) &&
      OPERATION_ID.test(value.id) &&
      value.input &&
      typeof value.input === "object" &&
      !Array.isArray(value.input)
    ) {
      return {
        version: 2,
        principal: value.principal,
        id: value.id,
        input: value.input,
        effect_may_have_started: value.effect_may_have_started !== false,
      };
    }
  } catch { /* invalid storage is not executable */ }
  return null;
}

function readPrincipalOperation(storage, principal) {
  const key = operationStorageKey(principal);
  if (!key || !storage) return null;
  try { return parseOperation(storage.getItem(key), principal); } catch { return null; }
}

// v1 records predate principal binding. Keep the record untouched as recovery evidence, but never
// adopt it into a principal slot or make it executable.
function readLegacyOperation(storage) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(LEGACY_OPERATION_STORAGE_KEY) || "null");
    if (value && OPERATION_ID.test(value.id) && value.input && typeof value.input === "object" && !Array.isArray(value.input)) {
      return {
        id: value.id,
        input: value.input,
        effect_may_have_started: value.effect_may_have_started !== false,
      };
    }
  } catch { /* malformed legacy storage is not executable */ }
  return null;
}

function storeOperation(value) {
  const key = operationStorageKey(currentPrincipal);
  if (!key) return;
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* storage unavailable: the current page still preserves the operation */ }
}

let currentPrincipal = null;
let operation = null;
let legacyOperation = null;
let quotedInput = null;

// One edit point for the example action body. The displayed quote and a new operation both snapshot
// this object; every /api/action request is quoted again server-side with that same stored snapshot.
function defaultActionInput() {
  // TODO(you): return whatever your chosen capability needs in the body.
  return {};
}

function copyInput(value) {
  return JSON.parse(JSON.stringify(value));
}

function operationAfterKnownPreEffect(currentOperation, hadPriorPossibleEffect) {
  return hadPriorPossibleEffect ? currentOperation : null;
}

function newOperationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return "web-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function updateOperationUI() {
  // Preserve the original input snapshot and key until capture; the button can only replay that pair.
  if (legacyOperation) {
    $("runlabel").textContent = "Reconcile legacy operation";
    $("run").title = "This unbound legacy operation cannot be invoked; reconcile its idempotency key first";
    return;
  }
  $("runlabel").textContent = operation ? "Retry same operation" : "Run paid action";
  $("run").title = operation ? "Retries the same account, request body, and Idempotency-Key" : "";
}

function fmtAev(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return String(n);
}

// Render live quote truth: exact price vs representative floor vs usage hold ceiling.
// Never labels a floor/ceiling as a final capture charge.
function formatQuote(quote) {
  if (!quote || typeof quote !== "object") return "";
  const kind = quote.quote_kind;
  const total = quote.total_credits;
  const ceiling =
    (typeof quote.hold_ceiling_credits === "number" && quote.hold_ceiling_credits) ||
    (typeof quote.ceiling_credits === "number" && quote.ceiling_credits) ||
    (typeof quote.preauthorization_credits === "number" && quote.preauthorization_credits) ||
    (typeof quote.capture_ceiling_credits === "number" && quote.capture_ceiling_credits) ||
    total;
  const label = typeof quote.price_label === "string" && quote.price_label.trim() ? quote.price_label.trim() : "";

  if (kind === "exact" && typeof total === "number") {
    return label ? `${fmtAev(total)} Aev exact · ${label}` : `${fmtAev(total)} Aev exact`;
  }
  if (kind === "representative_floor" && typeof total === "number") {
    return label
      ? `from ${fmtAev(total)} Aev floor · ${label} (not final charge)`
      : `from ${fmtAev(total)} Aev representative floor (not final charge)`;
  }
  if (kind === "hold_ceiling" && typeof ceiling === "number") {
    return label
      ? `up to ${fmtAev(ceiling)} Aev hold ceiling · actual usage · ${label}`
      : `up to ${fmtAev(ceiling)} Aev hold ceiling (actual usage, not a final charge)`;
  }
  if (label) return label;
  if (typeof total === "number") return `${fmtAev(total)} Aev (live quote)`;
  return "";
}

function formatQuoteError(err) {
  if (!err || typeof err !== "object") return "Live quote failed; no price is assumed and the action will not run.";
  const parts = [];
  if (err.code) parts.push(`code ${err.code}`);
  if (err.message) parts.push(err.message);
  if (err.fix) parts.push(`fix: ${err.fix}`);
  if (err.trace_id) parts.push(`trace ${err.trace_id}`);
  if (typeof err.retryable === "boolean") parts.push(err.retryable ? "retryable" : "not retryable");
  if (err.availability && typeof err.availability === "object") {
    if (err.availability.status) parts.push(`availability: ${err.availability.status}`);
    const explanation = err.availability.message || err.availability.reason;
    if (explanation && explanation !== err.message) parts.push(String(explanation));
  }
  parts.push("Quote failure prevents invoke; no price is assumed.");
  return parts.join(" · ");
}

function formatMachineError(err, fallback) {
  if (!err || typeof err !== "object") return fallback;
  const parts = [];
  if (err.code) parts.push(`code ${err.code}`);
  if (err.message) parts.push(err.message);
  if (err.fix) parts.push(`fix: ${err.fix}`);
  if (err.trace_id) parts.push(`trace ${err.trace_id}`);
  return parts.length ? parts.join(" · ") : fallback;
}

function formatQuoteDetails(quote) {
  if (!quote || typeof quote !== "object") return "";
  const parts = [];
  if (typeof quote.note === "string" && quote.note.trim()) parts.push(quote.note.trim());
  if (Array.isArray(quote.required_fields) && quote.required_fields.length) {
    parts.push(`required input: ${quote.required_fields.join(", ")}`);
  }
  const availability = quote.availability;
  if (availability && typeof availability === "object") {
    if (availability.status) parts.push(`availability: ${availability.status}`);
    const explanation = availability.message || availability.reason;
    if (explanation) parts.push(String(explanation));
    if (availability.fix) parts.push(`fix: ${availability.fix}`);
  }
  return parts.join(" · ");
}

function showQuoteFailure(error, quote) {
  $("price").textContent = "";
  $("price").title = "";
  $("quotedetail").textContent = formatQuoteDetails(quote);
  $("quotedetail").hidden = !$("quotedetail").textContent;
  $("quoteerr").textContent = formatQuoteError(error);
  $("quoteerr").hidden = false;
  $("retryquote").hidden = false;
  $("retryquote").disabled = false;
  $("run").disabled = true;
  quotedInput = null;
}

function browserStorage() {
  try { return sessionStorage; } catch { return null; }
}

function activatePrincipal(principal) {
  currentPrincipal = principal;
  operation = readPrincipalOperation(browserStorage(), principal);
  quotedInput = null;
  updateOperationUI();
}

async function resolveBrowserIdentity() {
  let response;
  let payload;
  try {
    response = await fetch("/__semesh/me", { cache: "no-store" });
    payload = await response.json();
  } catch {
    return {
      ok: false,
      error: {
        code: "identity_unavailable",
        message: "This app could not resolve the current Semesh identity.",
        fix: "Check the Semesh auth edge, then retry. The paid action has not run.",
        retryable: true,
      },
    };
  }
  if (response.status === 401 || (payload && payload.authenticated === false)) {
    return { ok: true, logged_in: false };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: {
        code: "identity_unavailable",
        message: "The Semesh identity endpoint is unavailable.",
        fix: "Retry identity resolution before quoting or running a paid action.",
        retryable: response.status >= 500,
      },
    };
  }
  const principal = principalFromMe(payload);
  if (!principal) {
    return {
      ok: false,
      error: {
        code: "identity_principal_invalid",
        message: "The signed-in identity has no valid stable sub or id.",
        fix: "Sign out and sign in again. Do not run the paid action until identity is stable.",
        retryable: false,
      },
    };
  }
  return { ok: true, logged_in: true, principal };
}

function showLegacyRecovery(record) {
  showQuoteFailure({
    code: "legacy_operation_principal_unbound",
    message: `Stored operation ${record.id} predates account binding and cannot be replayed safely.`,
    fix: `Reconcile idempotency key ${record.id} in Semesh activity. Keep this record until its settlement is confirmed terminal; it will not be invoked by this app.`,
    retryable: false,
  });
  updateOperationUI();
}

async function fetchReadOnlyQuote(input, principal, options = {}) {
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(requestedTimeout, 60000)
    : QUOTE_UI_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch("/api/quote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Semesh-Operation-Principal": principal,
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    return { response, result: await response.json() };
  } catch (error) {
    if (timedOut || (error && error.name === "AbortError")) {
      return {
        error: {
          code: "quote_ui_timeout",
          message: "The read-only quote timed out.",
          fix: "Retry the quote. The paid action has not run.",
          retryable: true,
        },
      };
    }
    return {
      error: {
        code: "quote_ui_backend_unavailable",
        message: "This app could not reach its read-only quote endpoint.",
        fix: "Check the app/backend connection, then retry the quote. The paid action has not run.",
        retryable: true,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function refresh() {
  $("run").disabled = true;
  $("retryquote").disabled = true;
  const identity = await resolveBrowserIdentity();
  if (!identity.ok) {
    $("signin").hidden = true;
    $("app").hidden = false;
    showQuoteFailure(identity.error);
    return;
  }
  $("signin").hidden = identity.logged_in;
  $("app").hidden = !identity.logged_in;
  if (!identity.logged_in) {
    currentPrincipal = null;
    operation = null;
    quotedInput = null;
    updateOperationUI();
    return;
  }

  if (identity.principal !== currentPrincipal) activatePrincipal(identity.principal);
  legacyOperation = readLegacyOperation(browserStorage());
  if (legacyOperation) {
    showLegacyRecovery(legacyOperation);
    return;
  }

  const input = copyInput(operation ? operation.input : defaultActionInput());
  const quoted = await fetchReadOnlyQuote(input, currentPrincipal);
  if (quoted.error) {
    showQuoteFailure(quoted.error);
    return;
  }
  const { response, result } = quoted;
  if (response.status === 401 && result.login) {
    location.href = result.login;
    return;
  }

  if (!result.ok || !result.quote) {
    showQuoteFailure(result.error, result.quote);
    return;
  }

  $("quoteerr").hidden = true;
  $("retryquote").hidden = true;
  $("err").hidden = true;
  $("price").textContent = formatQuote(result.quote);
  $("quotedetail").textContent = formatQuoteDetails(result.quote);
  $("quotedetail").hidden = !$("quotedetail").textContent;
  quotedInput = input;
  $("run").disabled = false;
  if (result.quote.note) {
    $("price").title = result.quote.note;
  } else {
    $("price").title = "";
  }
}

async function run() {
  $("run").disabled = true;
  $("err").hidden = true;
  $("out").hidden = true;
  const identity = await resolveBrowserIdentity();
  if (!identity.ok) {
    $("err").textContent = formatMachineError(identity.error, "Identity is unavailable; the paid action has not run.");
    $("err").hidden = false;
    $("retryquote").hidden = false;
    $("retryquote").disabled = false;
    updateOperationUI();
    return;
  }
  if (!identity.logged_in) {
    location.href = "/__semesh/login";
    return;
  }
  if (identity.principal !== currentPrincipal) {
    activatePrincipal(identity.principal);
    showQuoteFailure({
      code: "operation_principal_changed",
      message: "The signed-in account changed before the paid action could start.",
      fix: "Review a new quote for the current account. The previous account's recovery record remains preserved.",
      retryable: true,
    });
    return;
  }
  legacyOperation = readLegacyOperation(browserStorage());
  if (legacyOperation) {
    showLegacyRecovery(legacyOperation);
    return;
  }
  if (!quotedInput) {
    showQuoteFailure({
      code: "quote_required",
      message: "A current live quote is required before this action can run.",
      fix: "Retry the read-only quote for this account and input.",
      retryable: true,
    });
    return;
  }
  operation = operation || {
    version: 2,
    principal: currentPrincipal,
    id: newOperationId(),
    input: copyInput(quotedInput),
    effect_may_have_started: false,
  };
  const currentOperation = operation;
  const hadPriorPossibleEffect = currentOperation.effect_may_have_started === true;
  // Once the app request leaves the browser, a transport failure cannot prove where it stopped.
  currentOperation.effect_may_have_started = true;
  storeOperation(currentOperation);
  let quoteBlocked = false;
  updateOperationUI();
  try {
    const r = await fetch("/api/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": currentOperation.id,
        "X-Semesh-Operation-Principal": currentPrincipal,
      },
      // TODO(you): send whatever your chosen capability needs in the body.
      body: JSON.stringify(currentOperation.input),
    });
    const data = await r.json();

    // Quote failure is pre-invoke: surface machine code / fix / trace; do not treat as settlement.
    if (data.phase === "quote" && data.effect_started === false && data.error && typeof data.error === "object") {
      showQuoteFailure(data.error, data.quote);
      operation = operationAfterKnownPreEffect(currentOperation, hadPriorPossibleEffect);
      storeOperation(operation);
      quoteBlocked = true;
      return;
    }

    if (r.status === 401) {
      // Session expired or never signed in — show the sign-in branch again.
      if (!hadPriorPossibleEffect && data.effect_started === false) {
        operation = null;
        storeOperation(null);
      }
      location.href = data.login || "/__semesh/login";
      return;
    }

    if (data.error && typeof data.error === "object") {
      $("err").textContent = formatMachineError(data.error, "The action request was rejected.");
      $("err").hidden = false;
      if (data.effect_started === false) {
        operation = operationAfterKnownPreEffect(currentOperation, hadPriorPossibleEffect);
        storeOperation(operation);
        $("retryquote").hidden = false;
        $("retryquote").disabled = false;
      }
      quoteBlocked = data.effect_started === false;
      return;
    }

    if (!r.ok || !data.ok) {
      const id = data.idempotency_key || currentOperation.id;
      if (data.quote) {
        $("price").textContent = formatQuote(data.quote);
        $("quotedetail").textContent = formatQuoteDetails(data.quote);
        $("quotedetail").hidden = !$("quotedetail").textContent;
        $("price").title = data.quote.note || "";
      }
      const captured = data.settlement_status === "captured" &&
        typeof data.captured_aev === "number" && Number.isFinite(data.captured_aev) && data.captured_aev >= 0;
      $("err").textContent = captured
        ? `${data.message || data.error || "Action did not complete."} Trusted evidence reports ${data.captured_aev} Aev captured for operation ${id}; inspect it before retrying.`
        : `${data.message || data.error || "Action did not complete."} Settlement is unknown; reconcile operation ${id} before retrying.`;
      $("err").hidden = false;
      return;
    }

    $("out").textContent = JSON.stringify(data.result, null, 2);
    $("out").hidden = false;
    if (data.quote) {
      $("price").textContent = formatQuote(data.quote);
      $("quotedetail").textContent = formatQuoteDetails(data.quote);
      $("quotedetail").hidden = !$("quotedetail").textContent;
      if (data.quote.note) $("price").title = data.quote.note;
    }
    const captured = data.settlement_status === "captured" &&
      typeof data.captured_aev === "number" && Number.isFinite(data.captured_aev) && data.captured_aev >= 0;
    if (captured) {
      spent += data.captured_aev;
      $("spentval").textContent = String(spent);
      $("spent").hidden = false;
      operation = null;
      storeOperation(null);
    } else {
      const id = data.idempotency_key || currentOperation.id;
      $("err").textContent = `Result received, but settlement is unknown. Reconcile operation ${id} before starting another.`;
      $("err").hidden = false;
    }
  } catch (e) {
    $("err").textContent = `Network outcome is unknown. Reconcile operation ${currentOperation.id} before starting another. ${e && e.message ? e.message : ""}`;
    $("err").hidden = false;
  } finally {
    $("run").disabled = quoteBlocked;
    updateOperationUI();
  }
}

if (typeof document !== "undefined") {
  $("run").addEventListener("click", run);
  $("retryquote").addEventListener("click", refresh);
  updateOperationUI();
  refresh();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    formatQuote,
    formatQuoteDetails,
    operationAfterKnownPreEffect,
    principalFromMe,
    operationStorageKey,
    readPrincipalOperation,
    readLegacyOperation,
    fetchReadOnlyQuote,
  };
}
