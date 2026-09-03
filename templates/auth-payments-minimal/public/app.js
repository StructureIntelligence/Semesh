// Tiny browser client. It sees no runtime key and never calls Semesh directly.
const $ = (id) => document.getElementById(id);
let spentAtoms = 0;

const UNBOUND_OPERATION_STORAGE_KEY = "semesh.auth-payments-minimal.pending-operation.v1";
const LEGACY_OPERATION_STORAGE_PREFIXES = [
  { version: 2, prefix: "semesh.auth-payments-minimal.pending-operation.v2." },
  { version: 3, prefix: "semesh.auth-payments-minimal.pending-operation.v3." },
];
const OPERATION_STORAGE_PREFIX = "semesh.auth-payments-minimal.pending-operation.v4.";
const OPERATION_ID = /^[A-Za-z0-9._:-]{8,200}$/;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const PRINCIPAL_ID = /^[\x21-\x7E]{1,200}$/;
const QUOTE_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MODEL_ID = "deepseek-v3";
const QUOTE_UI_TIMEOUT_MS = 20000;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function copyJSON(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameJSON(left, right) {
  try { return canonicalJSON(left) === canonicalJSON(right); } catch { return false; }
}

function atomValue(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function canonicalChatResult(value) {
  if (!isObject(value) || Object.keys(value).length !== 2 || !isObject(value.message) || !isObject(value.usage)) return null;
  if (
    Object.keys(value.message).length !== 2 ||
    value.message.role !== "assistant" ||
    typeof value.message.content !== "string" ||
    value.message.content.length < 1 ||
    value.message.content.length > (1 << 20)
  ) return null;
  if (
    Object.keys(value.usage).length !== 1 ||
    typeof value.usage.total_tokens !== "number" ||
    !Number.isSafeInteger(value.usage.total_tokens) ||
    value.usage.total_tokens < 0
  ) return null;
  return {
    message: { role: "assistant", content: value.message.content },
    usage: { total_tokens: value.usage.total_tokens },
  };
}

function validPrincipal(value) {
  return typeof value === "string" && PRINCIPAL_ID.test(value);
}

function validModelChoicePin(value) {
  return isObject(value) &&
    Object.keys(value).length === 2 &&
    value.model_id === MODEL_ID &&
    typeof value.model_revision === "string" &&
    RESOURCE_ID.test(value.model_revision);
}

function validCanonicalChatInput(value) {
  return isObject(value) &&
    Object.keys(value).length === 1 &&
    Array.isArray(value.messages) &&
    value.messages.length > 0 &&
    value.messages.every((message) =>
      isObject(message) &&
      Object.keys(message).length === 2 &&
      ["system", "user", "assistant"].includes(message.role) &&
      typeof message.content === "string" &&
      message.content.length > 0
    );
}

function principalFromMe(payload) {
  if (!isObject(payload) || payload.authenticated !== true || !isObject(payload.user)) return null;
  if (Object.hasOwn(payload.user, "sub") && payload.user.sub !== "") {
    return validPrincipal(payload.user.sub) ? payload.user.sub : null;
  }
  return validPrincipal(payload.user.id) ? payload.user.id : null;
}

function operationStorageKey(principal) {
  return validPrincipal(principal) ? OPERATION_STORAGE_PREFIX + encodeURIComponent(principal) : null;
}

function legacyOperationStorageKeys(principal) {
  return validPrincipal(principal)
    ? LEGACY_OPERATION_STORAGE_PREFIXES.map(({ version, prefix }) => ({ version, key: prefix + encodeURIComponent(principal) }))
    : [];
}

function validInvokeRequest(value) {
  return isObject(value) &&
    Object.keys(value).length === 7 &&
    isObject(value.unit_action_ref) &&
    isObject(value.catalog) &&
    validModelChoicePin(value.model_choice_pin) &&
    validCanonicalChatInput(value.input) &&
    typeof value.quote_reference === "string" && value.quote_reference.length > 0 &&
    value.confirmed_effect_digest === null &&
    typeof value.deadline === "string" && Number.isFinite(Date.parse(value.deadline));
}

function parseOperation(raw, expectedPrincipal) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (
      isObject(value) &&
      value.version === 4 &&
      value.principal === expectedPrincipal &&
      validPrincipal(value.principal) &&
      typeof value.idempotency_key === "string" &&
      OPERATION_ID.test(value.idempotency_key) &&
      (value.invocation_id === null || (typeof value.invocation_id === "string" && OPERATION_ID.test(value.invocation_id))) &&
      value.invocation_id !== value.idempotency_key &&
      (value.persistence_epoch === undefined || value.persistence_epoch === 0 || value.persistence_epoch === 1) &&
      typeof value.quote_token === "string" &&
      QUOTE_TOKEN.test(value.quote_token) &&
      value.quote_token.length <= 131072 &&
      isObject(value.input) &&
      isObject(value.quote) &&
      validInvokeRequest(value.invoke_request) &&
      sameJSON(value.input, value.invoke_request.input) &&
      sameJSON(value.quote.model_choice_pin, value.invoke_request.model_choice_pin)
    ) {
      return {
        version: 4,
        principal: value.principal,
        idempotency_key: value.idempotency_key,
        invocation_id: value.invocation_id,
        input: copyJSON(value.input),
        quote: copyJSON(value.quote),
        quote_token: value.quote_token,
        invoke_request: copyJSON(value.invoke_request),
        // Any v4 record reached durable storage only at the invoke boundary. Treat even a
        // hostile/stale false bit as prior-possible effect so later local pre-effect errors
        // cannot erase recovery evidence and enable a fresh operation.
        effect_may_have_started: true,
        ...(value.persistence_epoch === undefined ? {} : { persistence_epoch: value.persistence_epoch }),
      };
    }
  } catch { /* malformed storage is never executable */ }
  return null;
}

function readPrincipalOperation(storage, principal) {
  const key = operationStorageKey(principal);
  if (!key || !storage) return null;
  try { return parseOperation(storage.getItem(key), principal); } catch { return null; }
}

// Older records did not persist the new exact quoted request. Preserve them unchanged as recovery
// evidence, but never adopt them into the executable v4 principal slot.
function readLegacyOperation(storage, principal) {
  if (!storage) return null;
  const candidates = [{ key: UNBOUND_OPERATION_STORAGE_KEY, version: 1 }];
  candidates.push(...legacyOperationStorageKeys(principal));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(storage.getItem(candidate.key) || "null");
      const oldKey = value && (value.idempotency_key || value.id);
      if (isObject(value) && OPERATION_ID.test(oldKey) && isObject(value.input)) {
        return {
          storage_key: candidate.key,
          storage_version: candidate.version,
          idempotency_key: oldKey,
          invocation_id: OPERATION_ID.test(value.invocation_id) && value.invocation_id !== oldKey ? value.invocation_id : null,
          input: copyJSON(value.input),
          effect_may_have_started: value.effect_may_have_started !== false,
        };
      }
    } catch { /* malformed historical evidence is not executable */ }
  }
  return null;
}

function writePrincipalOperation(storage, principal, value) {
  const key = operationStorageKey(principal);
  if (!key || !storage) return false;
  try {
    const expected = value ? JSON.stringify(value) : null;
    if (value && typeof expected !== "string") return false;
    if (value) storage.setItem(key, expected);
    else storage.removeItem(key);
    return storage.getItem(key) === expected;
  } catch { return false; }
}

function storeOperation(value) {
  return writePrincipalOperation(browserStorage(), currentPrincipal, value);
}

function persistOperationForInvoke(storage, principal, currentOperation) {
  if (!isObject(currentOperation)) return false;
  const hadEpoch = Object.hasOwn(currentOperation, "persistence_epoch");
  const priorEpoch = currentOperation.persistence_epoch;
  if (hadEpoch && priorEpoch !== 0 && priorEpoch !== 1) return false;

  // Every effect-capable POST must change durable bytes. Otherwise a silent setItem no-op
  // could make an older identical no-ID record look freshly persisted after a reload.
  currentOperation.persistence_epoch = priorEpoch === 0 ? 1 : 0;
  if (writePrincipalOperation(storage, principal, currentOperation)) return true;

  if (hadEpoch) currentOperation.persistence_epoch = priorEpoch;
  else delete currentOperation.persistence_epoch;
  return false;
}

function persistKnownInvocation(storage, principal, currentOperation, invocationId) {
  if (
    !isObject(currentOperation) ||
    typeof invocationId !== "string" ||
    !OPERATION_ID.test(invocationId) ||
    invocationId === currentOperation.idempotency_key ||
    (currentOperation.invocation_id && currentOperation.invocation_id !== invocationId)
  ) {
    return { ok: false, code: "invocation_identity_drift", invalidated: false };
  }
  if (currentOperation.invocation_id === invocationId) {
    // A matching ID is already observation-only recovery. Never rewrite or remove its
    // durable record merely because a read-only observation echoed the same identity.
    return { ok: true, persisted: false, invalidated: false, alreadyKnown: true };
  }
  // Keep the returned identity in memory even if durable storage fails. If the exact
  // ID-bearing record cannot be read back, the old executable no-ID record must be
  // proven absent before this tab may continue with observation-only recovery.
  currentOperation.invocation_id = invocationId;
  if (writePrincipalOperation(storage, principal, currentOperation)) {
    return { ok: true, persisted: true, invalidated: false };
  }
  return {
    ok: false,
    code: "invocation_persistence_failed",
    persisted: false,
    invalidated: writePrincipalOperation(storage, principal, null),
  };
}

let currentPrincipal = null;
let operation = null;
let legacyOperation = null;
let quotedPlan = null;

function defaultActionInput() {
  // This is one Model Action input. Change it only to a value advertised by the pinned detail.
  return {
    messages: [{ role: "user", content: "Say hello from Semesh." }],
  };
}

function operationAfterKnownPreEffect(currentOperation, hadPriorPossibleEffect) {
  return hadPriorPossibleEffect ? currentOperation : null;
}

function newIdempotencyKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return "web-" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatAevAtoms(atoms) {
  const normalized = atomValue(atoms);
  if (normalized === null) return "";
  const whole = Math.floor(normalized / 100000000);
  const remainder = String(normalized % 100000000).padStart(8, "0").replace(/0+$/, "");
  return remainder ? `${whole}.${remainder}` : String(whole);
}

function formatQuote(quote) {
  if (!isObject(quote)) return "";
  const label = typeof quote.price_label === "string" && quote.price_label.trim() ? quote.price_label.trim() : "";
  if (quote.quote_kind === "exact" && atomValue(quote.amount_aev_atoms) !== null) {
    const amount = formatAevAtoms(quote.amount_aev_atoms);
    return label ? `${amount} Aev exact · ${label}` : `${amount} Aev exact`;
  }
  if (quote.quote_kind === "representative_floor" && atomValue(quote.amount_aev_atoms) !== null) {
    const amount = formatAevAtoms(quote.amount_aev_atoms);
    return label ? `from ${amount} Aev floor · ${label} (not final)` : `from ${amount} Aev representative floor (not final)`;
  }
  if (quote.quote_kind === "hold_ceiling" && atomValue(quote.ceiling_aev_atoms) !== null) {
    const amount = formatAevAtoms(quote.ceiling_aev_atoms);
    return label ? `up to ${amount} Aev hold ceiling · actual usage · ${label}` : `up to ${amount} Aev hold ceiling (actual usage)`;
  }
  return "";
}

function formatQuoteDetails(quote) {
  if (!isObject(quote)) return "";
  const parts = [];
  if (typeof quote.note === "string" && quote.note.trim()) parts.push(quote.note.trim());
  if (Array.isArray(quote.required_fields) && quote.required_fields.length) {
    parts.push(`required input: ${quote.required_fields.join(", ")}`);
  }
  if (isObject(quote.availability)) {
    if (quote.availability.status) parts.push(`availability: ${quote.availability.status}`);
    const explanation = quote.availability.message || quote.availability.reason;
    if (explanation) parts.push(String(explanation));
    if (quote.availability.fix) parts.push(`fix: ${quote.availability.fix}`);
  }
  return parts.join(" · ");
}

function formatQuoteError(error) {
  if (!isObject(error)) return "Live quote failed; no price is assumed and no invoke was sent.";
  const err = error;
  const parts = [];
  if (err.code) parts.push(`code ${err.code}`);
  if (err.message) parts.push(err.message);
  if (err.fix) parts.push(`fix: ${err.fix}`);
  if (err.trace_id) parts.push(`trace ${err.trace_id}`);
  if (typeof err.retryable === "boolean") parts.push(err.retryable ? "retryable" : "not retryable");
  parts.push("No paid invoke was sent for this quote failure.");
  return parts.join(" · ");
}

function formatMachineError(error, fallback) {
  if (!isObject(error)) return fallback;
  const parts = [];
  if (error.code) parts.push(`code ${error.code}`);
  if (error.message) parts.push(error.message);
  if (error.fix) parts.push(`fix: ${error.fix}`);
  if (error.trace_id) parts.push(`trace ${error.trace_id}`);
  return parts.length ? parts.join(" · ") : fallback;
}

function receiptSettlement(receipt, invocationId, idempotencyKey) {
  if (!isObject(receipt) || !OPERATION_ID.test(invocationId) || !OPERATION_ID.test(idempotencyKey)) return null;
  if (invocationId === idempotencyKey || receipt.invocation_id !== invocationId || receipt.idempotency_key !== idempotencyKey) return null;
  if (!["succeeded", "failed", "canceled"].includes(receipt.terminal_state)) return null;
  const atoms = [receipt.held_aev_atoms, receipt.captured_aev_atoms, receipt.released_aev_atoms];
  if (!atoms.every((value) => atomValue(value) !== null)) return null;
  if (receipt.captured_aev_atoms > receipt.held_aev_atoms || receipt.released_aev_atoms !== receipt.held_aev_atoms - receipt.captured_aev_atoms) return null;
  if (typeof receipt.settlement_reference !== "string" || !receipt.settlement_reference) return null;
  return {
    terminal_state: receipt.terminal_state,
    held_aev_atoms: receipt.held_aev_atoms,
    captured_aev_atoms: receipt.captured_aev_atoms,
    released_aev_atoms: receipt.released_aev_atoms,
    settlement_reference: receipt.settlement_reference,
  };
}

function showQuote(quote) {
  $("price").textContent = formatQuote(quote);
  $("price").title = quote && quote.note ? quote.note : "";
  $("quotedetail").textContent = formatQuoteDetails(quote);
  $("quotedetail").hidden = !$("quotedetail").textContent;
  $("quoteerr").hidden = true;
  $("retryquote").hidden = true;
  $("err").hidden = true;
}

function showQuoteFailure(error, quote) {
  $("price").textContent = quote ? formatQuote(quote) : "";
  $("price").title = "";
  $("quotedetail").textContent = formatQuoteDetails(quote);
  $("quotedetail").hidden = !$("quotedetail").textContent;
  $("quoteerr").textContent = formatQuoteError(error);
  $("quoteerr").hidden = false;
  $("retryquote").hidden = false;
  $("retryquote").disabled = false;
  $("run").disabled = true;
  quotedPlan = null;
}

function browserStorage() {
  try { return sessionStorage; } catch { return null; }
}

function updateOperationUI() {
  if (legacyOperation) {
    $("runlabel").textContent = "Reconcile stored operation";
    $("run").title = "This older record is preserved but cannot be replayed through the new contract";
    return;
  }
  if (operation && operation.invocation_id) {
    $("runlabel").textContent = "Observe same invocation";
    $("run").title = `Reads invocation ${operation.invocation_id}; the Idempotency-Key is never used as its URL identity`;
    return;
  }
  $("runlabel").textContent = operation ? "Retry same request" : "Run paid action";
  $("run").title = operation ? "Reuses the persisted request bytes and Idempotency-Key without rediscovery or requote" : "";
}

function activatePrincipal(principal) {
  currentPrincipal = principal;
  operation = readPrincipalOperation(browserStorage(), principal);
  quotedPlan = operation ? {
    input: copyJSON(operation.input),
    quote: copyJSON(operation.quote),
    quote_token: operation.quote_token,
    invoke_request: copyJSON(operation.invoke_request),
  } : null;
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
        fix: "Check the Semesh auth edge, then retry. The paid Action has not run.",
        retryable: true,
      },
    };
  }
  if (response.status === 401 || (payload && payload.authenticated === false)) return { ok: true, logged_in: false };
  if (!response.ok) {
    return {
      ok: false,
      error: {
        code: "identity_unavailable",
        message: "The Semesh identity endpoint is unavailable.",
        fix: "Retry identity resolution before quoting or invoking.",
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
        fix: "Sign out and sign in again before using the paid Action.",
        retryable: false,
      },
    };
  }
  return { ok: true, logged_in: true, principal };
}

function showLegacyRecovery(record) {
  showQuoteFailure({
    code: "stored_operation_contract_retired",
    message: `Stored idempotency key ${record.idempotency_key} predates the exact signed request bundle and cannot be replayed safely.`,
    fix: record.invocation_id
      ? `Reconcile returned invocation_id ${record.invocation_id}; keep it distinct from key ${record.idempotency_key}.`
      : `Reconcile key ${record.idempotency_key} in Semesh activity. Keep this record until settlement is terminal.`,
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
    let result;
    try { result = await response.json(); }
    catch {
      return {
        error: {
          code: "quote_ui_response_malformed",
          message: "The local quote adapter returned malformed JSON.",
          fix: "Retry the quote; no paid invoke was sent.",
          retryable: true,
        },
      };
    }
    return { response, result };
  } catch (error) {
    return {
      error: {
        code: timedOut || (error && error.name === "AbortError") ? "quote_ui_timeout" : "quote_ui_backend_unavailable",
        message: timedOut || (error && error.name === "AbortError")
          ? "The read-only quote timed out."
          : "This app could not reach its read-only quote endpoint.",
        fix: "Retry the quote. The paid Action has not run.",
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
    legacyOperation = null;
    quotedPlan = null;
    updateOperationUI();
    return;
  }
  if (identity.principal !== currentPrincipal) activatePrincipal(identity.principal);
  legacyOperation = readLegacyOperation(browserStorage(), currentPrincipal);
  if (legacyOperation) {
    showLegacyRecovery(legacyOperation);
    return;
  }
  if (operation) {
    showQuote(operation.quote);
    quotedPlan = {
      input: copyJSON(operation.input),
      quote: copyJSON(operation.quote),
      quote_token: operation.quote_token,
      invoke_request: copyJSON(operation.invoke_request),
    };
    $("run").disabled = false;
    updateOperationUI();
    return;
  }

  const input = defaultActionInput();
  const quoted = await fetchReadOnlyQuote(input, currentPrincipal);
  if (quoted.error) return showQuoteFailure(quoted.error);
  if (quoted.response.status === 401 && quoted.result.login) {
    location.href = quoted.result.login;
    return;
  }
  const result = quoted.result;
  if (
    !result.ok ||
    !isObject(result.quote) ||
    !isObject(result.selection) ||
    typeof result.quote_token !== "string" ||
    !QUOTE_TOKEN.test(result.quote_token) ||
    !validInvokeRequest(result.invoke_request) ||
    !sameJSON(input, result.invoke_request.input) ||
    !sameJSON(result.quote.model_choice_pin, result.invoke_request.model_choice_pin) ||
    !sameJSON(result.selection.model_choice_pin, result.invoke_request.model_choice_pin)
  ) {
    return showQuoteFailure(result.error || {
      code: "quote_plan_malformed",
      message: "The quote adapter did not return one exact signed invoke request.",
      fix: "Retry public discovery and quote; do not build a request from partial fields.",
      retryable: true,
    }, result.quote);
  }
  quotedPlan = {
    input: copyJSON(input),
    quote: copyJSON(result.quote),
    quote_token: result.quote_token,
    invoke_request: copyJSON(result.invoke_request),
  };
  showQuote(result.quote);
  $("run").disabled = false;
  updateOperationUI();
}

function displayUnknown(data, currentOperation) {
  const invocation = currentOperation.invocation_id
    ? `invocation_id ${currentOperation.invocation_id}`
    : "the not-yet-returned invocation_id";
  $("err").textContent = `${formatMachineError(data && data.error, "The operation outcome is unknown.")} Reconcile ${invocation} with Idempotency-Key ${currentOperation.idempotency_key}; never substitute one identity for the other.`;
  $("err").hidden = false;
}

async function run() {
  $("run").disabled = true;
  $("err").hidden = true;
  $("out").hidden = true;
  const identity = await resolveBrowserIdentity();
  if (!identity.ok) {
    $("err").textContent = formatMachineError(identity.error, "Identity is unavailable; no paid Action ran.");
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
      message: "The signed-in account changed before the operation could continue.",
      fix: "Review a new quote for this account. The prior account recovery record remains isolated.",
      retryable: true,
    });
    return;
  }
  legacyOperation = readLegacyOperation(browserStorage(), currentPrincipal);
  if (legacyOperation) return showLegacyRecovery(legacyOperation);
  if (!quotedPlan) {
    return showQuoteFailure({
      code: "quote_required",
      message: "A complete signed live quote plan is required.",
      fix: "Retry the read-only Search, detail, and quote chain.",
      retryable: true,
    });
  }

  operation = operation || {
    version: 4,
    principal: currentPrincipal,
    idempotency_key: newIdempotencyKey(),
    invocation_id: null,
    input: copyJSON(quotedPlan.input),
    quote: copyJSON(quotedPlan.quote),
    quote_token: quotedPlan.quote_token,
    invoke_request: copyJSON(quotedPlan.invoke_request),
    effect_may_have_started: false,
  };
  const currentOperation = operation;
  // currentRequest.input remains the exact quoted body for every Retry same request attempt.
  const currentRequest = currentOperation;
  if (!sameJSON(currentRequest.input, currentRequest.invoke_request.input) || !sameJSON(currentRequest.quote.model_choice_pin, currentRequest.invoke_request.model_choice_pin)) {
    displayUnknown({ error: { code: "stored_request_drift", message: "The persisted request input or model choice pin drifted." } }, currentRequest);
    return;
  }
  const observing = !!currentOperation.invocation_id;
  const hadPriorPossibleEffect = currentOperation.effect_may_have_started === true;
  if (!observing) {
    // Persist exact canonical request + quote plan + key before the only effect-capable
    // POST, with changed epoch bytes so stale identical storage cannot prove this write.
    currentOperation.effect_may_have_started = true;
    if (!persistOperationForInvoke(browserStorage(), currentPrincipal, currentOperation)) {
      currentOperation.effect_may_have_started = hadPriorPossibleEffect;
      $("err").textContent = "code recovery_persistence_required · Fresh changed bytes for the exact invoke request and Idempotency-Key could not be persisted. No paid invoke was sent.";
      $("err").hidden = false;
      updateOperationUI();
      return;
    }
    updateOperationUI();
  }

  let blockForNewQuote = false;
  try {
    const response = await fetch(observing ? "/api/observe" : "/api/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": currentOperation.idempotency_key,
        "X-Semesh-Operation-Principal": currentPrincipal,
      },
      body: JSON.stringify({
        quote_token: currentOperation.quote_token,
        invoke_request: currentOperation.invoke_request,
        ...(currentOperation.invocation_id ? { invocation_id: currentOperation.invocation_id } : {}),
      }),
    });
    let data;
    try { data = await response.json(); }
    catch { return displayUnknown({ error: { code: "app_response_malformed", message: "The local action adapter returned malformed JSON." } }, currentOperation); }

    if (data.idempotency_key && data.idempotency_key !== currentOperation.idempotency_key) {
      return displayUnknown({ error: { code: "idempotency_identity_drift", message: "The response returned a different Idempotency-Key." } }, currentOperation);
    }
    if (data.invocation_id !== undefined && data.invocation_id !== null) {
      if (typeof data.invocation_id !== "string" || !OPERATION_ID.test(data.invocation_id) || data.invocation_id === currentOperation.idempotency_key || (currentOperation.invocation_id && data.invocation_id !== currentOperation.invocation_id)) {
        return displayUnknown({ error: { code: "invocation_identity_drift", message: "The response returned an invalid or conflated invocation_id." } }, currentOperation);
      }
      const persistedInvocation = persistKnownInvocation(browserStorage(), currentPrincipal, currentOperation, data.invocation_id);
      if (!persistedInvocation.ok) {
        updateOperationUI();
        $("err").hidden = false;
        if (persistedInvocation.invalidated) {
          $("err").textContent = `code invocation_persistence_failed · The returned invocation_id ${currentOperation.invocation_id} could not be persisted, but the prior executable no-ID record was verified absent. The ID remains only in this tab: do not reload or retry the invoke; select Observe same invocation.`;
        } else {
          blockForNewQuote = true;
          $("err").textContent = `code recovery_storage_hard_stop · The returned invocation_id ${currentOperation.invocation_id} could not be persisted and the prior executable no-ID record could not be verified absent. Hard stop: do not reload, retry, or invoke again. Reconcile this invocation_id and Idempotency-Key outside this app.`;
        }
        return;
      }
      updateOperationUI();
    }

    // Keep the replay key and observation identity in separate domains.
    const idempotencyKey = currentOperation.idempotency_key;
    const invocationId = currentOperation.invocation_id;
    if (invocationId && invocationId === idempotencyKey) {
      return displayUnknown({ error: { code: "identity_conflation", message: "Invocation and replay identities were conflated." } }, currentOperation);
    }

    if (response.status === 401 && data.effect_started === false) {
      if (!hadPriorPossibleEffect) {
        if (!storeOperation(null)) {
          blockForNewQuote = true;
          $("err").textContent = "code recovery_clear_unverified · The pre-effect record could not be verified removed. Hard stop: do not reload or retry until storage is reconciled.";
          $("err").hidden = false;
          return;
        }
        operation = null;
      }
      location.href = data.login || "/__semesh/login";
      return;
    }
    if (data.effect_started === false) {
      const nextOperation = operationAfterKnownPreEffect(currentOperation, hadPriorPossibleEffect);
      if (!storeOperation(nextOperation)) {
        blockForNewQuote = true;
        $("err").textContent = "code recovery_update_unverified · The pre-effect storage transition could not be read back exactly. Hard stop: do not reload or retry until storage is reconciled.";
        $("err").hidden = false;
        return;
      }
      operation = nextOperation;
      blockForNewQuote = !operation;
      if (data.phase === "quote" || data.phase === "discovery") showQuoteFailure(data.error, data.quote);
      else {
        $("err").textContent = formatMachineError(data.error, "The operation was rejected before effect.");
        $("err").hidden = false;
        $("retryquote").hidden = false;
        $("retryquote").disabled = false;
        quotedPlan = operation ? quotedPlan : null;
      }
      return;
    }

    const settlement = data.receipt_verified === true
      ? receiptSettlement(data.receipt, currentOperation.invocation_id, currentOperation.idempotency_key)
      : null;
    const canonicalResult = canonicalChatResult(data.result);
    if (data.terminal === true && settlement && (data.ok !== true || canonicalResult)) {
      if (data.quote) showQuote(data.quote);
      if (data.ok === true) {
        $("out").textContent = canonicalResult.message.content;
        $("out").hidden = false;
      } else {
        $("out").textContent = "";
        $("out").hidden = true;
      }
      if (settlement.captured_aev_atoms > 0) {
        if (settlement.captured_aev_atoms <= Number.MAX_SAFE_INTEGER - spentAtoms) {
          spentAtoms += settlement.captured_aev_atoms;
          $("spentval").textContent = formatAevAtoms(spentAtoms);
        } else {
          $("spentval").textContent = "unavailable";
        }
        $("spent").hidden = false;
      }
      if (storeOperation(null)) {
        operation = null;
        quotedPlan = null;
        blockForNewQuote = true;
      } else {
        operation = currentOperation;
        $("err").textContent = "code terminal_storage_clear_unverified · Settlement is terminal, but its recovery record could not be verified removed. Keep the stored invocation_id and do not issue a new invoke.";
        $("err").hidden = false;
      }
      $("retryquote").hidden = false;
      $("retryquote").disabled = false;
      if (!response.ok || !data.ok) {
        $("err").textContent = `${formatMachineError(data.error, "The Action ended in a definite terminal failure.")} Receipt ${settlement.settlement_reference}: ${formatAevAtoms(settlement.captured_aev_atoms)} Aev captured, ${formatAevAtoms(settlement.released_aev_atoms)} Aev released.`;
        $("err").hidden = false;
      }
      return;
    }
    displayUnknown(data, currentOperation);
  } catch (error) {
    displayUnknown({ error: { code: "operation_transport_unknown", message: error && error.message ? error.message : "Network response was lost." } }, currentOperation);
  } finally {
    $("run").disabled = blockForNewQuote;
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
    formatAevAtoms,
    formatQuote,
    formatQuoteDetails,
    canonicalChatResult,
    receiptSettlement,
    operationAfterKnownPreEffect,
    principalFromMe,
    operationStorageKey,
    readPrincipalOperation,
    writePrincipalOperation,
    persistOperationForInvoke,
    persistKnownInvocation,
    readLegacyOperation,
    fetchReadOnlyQuote,
  };
}
