const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
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
} = require("./app.js");

const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const AMOUNT = 500000000;
const UNIT_REVISION = `sha256:${"1".repeat(64)}`;
const ACTION_REVISION = `sha256:${"2".repeat(64)}`;
const CATALOG_DIGEST = `sha256:${"3".repeat(64)}`;
const MODEL_CHOICE_PIN = {
  model_id: "deepseek-v3",
  model_revision: "model.release.2026-09-02",
};

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    snapshot() { return Object.fromEntries(values); },
  };
}

function invokeRequest(input = { messages: [{ role: "user", content: "hello" }] }) {
  return {
    unit_action_ref: {
      unit_id: "unit_models",
      unit_revision: UNIT_REVISION,
      action_id: "chat",
      action_revision: ACTION_REVISION,
    },
    catalog: { view_generation: 42, view_digest: CATALOG_DIGEST },
    model_choice_pin: MODEL_CHOICE_PIN,
    quote_reference: "quote_ref_00000001",
    input,
    confirmed_effect_digest: null,
    deadline: "2030-01-01T00:00:00.000Z",
  };
}

function currentOperation(overrides = {}) {
  const request = invokeRequest();
  return {
    version: 4,
    principal: "user-alice",
    idempotency_key: "web-operation-00000001",
    invocation_id: null,
    input: request.input,
    quote: { quote_kind: "exact", amount_aev_atoms: AMOUNT, model_choice_pin: MODEL_CHOICE_PIN },
    quote_token: "signedpayload.signedsignature",
    invoke_request: request,
    effect_may_have_started: true,
    ...overrides,
  };
}

test("browser source persists exact request and never derives settlement from a response header", () => {
  assert.match(source, /Persist exact canonical request \+ quote plan \+ key before/);
  assert.match(source, /receipt_verified === true/);
  assert.match(source, /captured_aev_atoms/);
  assert.equal(source.includes("x-semesh-charged-aev"), false);
  assert.doesNotMatch(source, /captured_aev(?!_atoms)/);
  assert.equal(source.includes("estimate_aev"), false);
  assert.match(source, /canonicalResult\.message\.content/);
  assert.doesNotMatch(source, /data\.result\.(choices|content|completion|output)/);
});

test("browser accepts only the strict canonical chat result", () => {
  const canonical = {
    message: { role: "assistant", content: "hello" },
    usage: { total_tokens: 7 },
  };
  assert.deepEqual(canonicalChatResult(canonical), canonical);
  assert.equal(canonicalChatResult({ ...canonical, choices: [] }), null, "provider-shaped extras are rejected");
  assert.equal(canonicalChatResult({ message: { role: "assistant", content: "" }, usage: canonical.usage }), null);
  assert.equal(canonicalChatResult({ message: { role: "user", content: "hello" }, usage: canonical.usage }), null);
  assert.equal(canonicalChatResult({ message: canonical.message, usage: { total_tokens: Number.MAX_SAFE_INTEGER + 1 } }), null);
  assert.equal(canonicalChatResult({ message: canonical.message, usage: { total_tokens: "7" } }), null);
});

test("atom formatting and quote labels never round the settlement authority", () => {
  assert.equal(formatAevAtoms("0"), "", "atom strings are not the JSON-integer wire type");
  assert.equal(formatAevAtoms(0), "0");
  assert.equal(formatAevAtoms(1), "0.00000001");
  assert.equal(formatAevAtoms(150000000), "1.5");
  assert.equal(formatAevAtoms(123456789), "1.23456789");
  assert.equal(formatAevAtoms(Number.MAX_SAFE_INTEGER), "90071992.54740991", "the largest safe JSON integer remains exact");
  assert.equal(formatAevAtoms(Number.MAX_SAFE_INTEGER + 1), "", "unsafe integers above 2^53 fail closed");
  assert.equal(formatAevAtoms("150000000"), "", "schema-incompatible atom strings fail closed");
  assert.equal(formatQuote({ quote_kind: "exact", amount_aev_atoms: 150000000 }), "1.5 Aev exact");
  assert.match(formatQuote({ quote_kind: "representative_floor", amount_aev_atoms: 200000000 }), /not final/);
  assert.match(formatQuote({ quote_kind: "hold_ceiling", ceiling_aev_atoms: 500000000 }), /5 Aev hold ceiling/);
});

test("quote detail preserves note, required input, and availability recovery", () => {
  const details = formatQuoteDetails({
    note: "input-priced",
    required_fields: ["messages"],
    availability: { status: "unavailable", reason: "binding missing", fix: "wait for availability" },
  });
  assert.match(details, /input-priced/);
  assert.match(details, /messages/);
  assert.match(details, /availability: unavailable/);
  assert.match(details, /wait for availability/);
});

test("receipt atoms are accepted only with distinct bound identities and conservation", () => {
  const receipt = {
    invocation_id: "inv_server_00000001",
    idempotency_key: "web-operation-00000001",
    terminal_state: "succeeded",
    held_aev_atoms: AMOUNT,
    captured_aev_atoms: AMOUNT,
    released_aev_atoms: 0,
    settlement_reference: "settlement_ref_00000001",
  };
  assert.deepEqual(receiptSettlement(receipt, receipt.invocation_id, receipt.idempotency_key), {
    terminal_state: "succeeded",
    held_aev_atoms: AMOUNT,
    captured_aev_atoms: AMOUNT,
    released_aev_atoms: 0,
    settlement_reference: "settlement_ref_00000001",
  });
  assert.equal(receiptSettlement({ ...receipt, invocation_id: receipt.idempotency_key }, receipt.idempotency_key, receipt.idempotency_key), null);
  assert.equal(receiptSettlement({ ...receipt, released_aev_atoms: 1 }, receipt.invocation_id, receipt.idempotency_key), null);
  assert.equal(receiptSettlement({ ...receipt, captured_aev_atoms: Number.MAX_SAFE_INTEGER + 1 }, receipt.invocation_id, receipt.idempotency_key), null);
  assert.equal(receiptSettlement({ ...receipt, held_aev_atoms: String(AMOUNT), captured_aev_atoms: String(AMOUNT) }, receipt.invocation_id, receipt.idempotency_key), null);
});

test("known pre-effect failure clears only a fresh operation and preserves prior recovery", () => {
  const pending = currentOperation();
  assert.equal(operationAfterKnownPreEffect(pending, false), null);
  assert.equal(operationAfterKnownPreEffect(pending, true), pending);
});

test("stable principal prefers user.sub and rejects malformed present sub", () => {
  assert.equal(principalFromMe({ authenticated: true, user: { sub: "subject-1", id: "legacy-id" } }), "subject-1");
  assert.equal(principalFromMe({ authenticated: true, user: { id: "user-2" } }), "user-2");
  assert.equal(principalFromMe({ authenticated: true, user: { sub: "bad principal", id: "must-not-win" } }), null);
  assert.equal(principalFromMe({ authenticated: false, user: { sub: "subject-1" } }), null);
  assert.equal(principalFromMe({ authenticated: true, user: { sub: "https://issuer.test/users/a=b?c" } }), "https://issuer.test/users/a=b?c");
});

test("v4 operations load only from their validated principal slot with the exact choice-pinned quote bundle", () => {
  const aliceOperation = currentOperation();
  const storage = memoryStorage({
    [operationStorageKey("user-alice")]: JSON.stringify(aliceOperation),
  });
  assert.deepEqual(readPrincipalOperation(storage, "user-alice"), aliceOperation);
  assert.equal(readPrincipalOperation(storage, "user-bob"), null);
  assert.equal(storage.snapshot()[operationStorageKey("user-alice")], JSON.stringify(aliceOperation));

  const conflated = currentOperation({ invocation_id: "web-operation-00000001" });
  const conflatedStorage = memoryStorage({
    [operationStorageKey("user-alice")]: JSON.stringify(conflated),
  });
  assert.equal(readPrincipalOperation(conflatedStorage, "user-alice"), null);

  const drifted = currentOperation();
  drifted.invoke_request.model_choice_pin = { ...MODEL_CHOICE_PIN, model_revision: "model.release.drift" };
  const driftedStorage = memoryStorage({
    [operationStorageKey("user-alice")]: JSON.stringify(drifted),
  });
  assert.equal(readPrincipalOperation(driftedStorage, "user-alice"), null);

  const embeddedChoice = currentOperation();
  embeddedChoice.input = { ...embeddedChoice.input, model_choice: "deepseek-v3" };
  embeddedChoice.invoke_request.input = embeddedChoice.input;
  const embeddedChoiceStorage = memoryStorage({
    [operationStorageKey("user-alice")]: JSON.stringify(embeddedChoice),
  });
  assert.equal(readPrincipalOperation(embeddedChoiceStorage, "user-alice"), null);

  const hostilePreEffect = currentOperation({
    invocation_id: "inv_server_00000001",
    effect_may_have_started: false,
  });
  const hostilePreEffectStorage = memoryStorage({
    [operationStorageKey("user-alice")]: JSON.stringify(hostilePreEffect),
  });
  const recovered = readPrincipalOperation(hostilePreEffectStorage, "user-alice");
  assert.equal(recovered.invocation_id, hostilePreEffect.invocation_id);
  assert.equal(recovered.effect_may_have_started, true, "every durable v4 recovery record remains prior-possible effect");
  assert.equal(operationAfterKnownPreEffect(recovered, recovered.effect_may_have_started), recovered);
});

test("effect-capable work requires durable principal-slot persistence", () => {
  const operation = currentOperation();
  const storage = memoryStorage();
  assert.equal(writePrincipalOperation(storage, "user-alice", operation), true);
  assert.equal(storage.snapshot()[operationStorageKey("user-alice")], JSON.stringify(operation));
  assert.equal(writePrincipalOperation({ setItem() { throw new Error("quota"); } }, "user-alice", operation), false);
  assert.equal(writePrincipalOperation(null, "user-alice", operation), false);

  const silentWrite = memoryStorage();
  silentWrite.setItem = () => {};
  assert.equal(writePrincipalOperation(silentWrite, "user-alice", operation), false, "a silent setItem no-op is not persistence");

  const silentRemove = memoryStorage({
    [operationStorageKey("user-alice")]: JSON.stringify(operation),
  });
  silentRemove.removeItem = () => {};
  assert.equal(writePrincipalOperation(silentRemove, "user-alice", null), false, "a silent removeItem no-op is not invalidation");
});

test("a fresh persistence epoch prevents identical stale bytes from passing after reload", () => {
  const staleOperation = currentOperation({ persistence_epoch: 0 });
  const key = operationStorageKey("user-alice");
  const storage = memoryStorage({ [key]: JSON.stringify(staleOperation) });
  const reloaded = readPrincipalOperation(storage, "user-alice");
  const staleBytes = storage.snapshot()[key];
  storage.setItem = () => {};

  assert.equal(persistOperationForInvoke(storage, "user-alice", reloaded), false);
  assert.equal(storage.snapshot()[key], staleBytes, "the silently retained stale record is not accepted as a fresh proof");
  assert.equal(reloaded.persistence_epoch, 0, "the in-memory challenge is restored after failed persistence");

  const durableStorage = memoryStorage({ [key]: staleBytes });
  const durableReload = readPrincipalOperation(durableStorage, "user-alice");
  assert.equal(persistOperationForInvoke(durableStorage, "user-alice", durableReload), true);
  assert.equal(durableReload.persistence_epoch, 1);
  assert.equal(readPrincipalOperation(durableStorage, "user-alice").persistence_epoch, 1);
});

test("learning an invocation ID either persists it exactly or verified-invalidates the executable no-ID record", () => {
  const invocationId = "inv_server_00000001";

  const durableOperation = currentOperation();
  const durableStorage = memoryStorage();
  assert.deepEqual(persistKnownInvocation(durableStorage, "user-alice", durableOperation, invocationId), {
    ok: true,
    persisted: true,
    invalidated: false,
  });
  assert.equal(durableOperation.invocation_id, invocationId);
  assert.equal(readPrincipalOperation(durableStorage, "user-alice").invocation_id, invocationId);

  let knownSetCalls = 0;
  let knownRemoveCalls = 0;
  const knownOperation = currentOperation({ invocation_id: invocationId, persistence_epoch: 1 });
  const knownStorage = memoryStorage({
    [operationStorageKey("user-alice")]: JSON.stringify(knownOperation),
  });
  knownStorage.setItem = () => { knownSetCalls += 1; throw new Error("write blocked"); };
  knownStorage.removeItem = () => { knownRemoveCalls += 1; };
  assert.deepEqual(persistKnownInvocation(knownStorage, "user-alice", knownOperation, invocationId), {
    ok: true,
    persisted: false,
    invalidated: false,
    alreadyKnown: true,
  });
  assert.equal(knownSetCalls, 0, "an observed known ID is never redundantly rewritten");
  assert.equal(knownRemoveCalls, 0, "an observed known ID can never trigger stale-no-ID removal");
  assert.equal(readPrincipalOperation(knownStorage, "user-alice").invocation_id, invocationId);

  const invalidatedOperation = currentOperation();
  const invalidatedStorage = memoryStorage({
    [operationStorageKey("user-alice")]: JSON.stringify(invalidatedOperation),
  });
  invalidatedStorage.setItem = () => {};
  assert.deepEqual(persistKnownInvocation(invalidatedStorage, "user-alice", invalidatedOperation, invocationId), {
    ok: false,
    code: "invocation_persistence_failed",
    persisted: false,
    invalidated: true,
  });
  assert.equal(invalidatedOperation.invocation_id, invocationId, "same-tab observation retains the learned identity");
  assert.equal(readPrincipalOperation(invalidatedStorage, "user-alice"), null, "the stale replayable record is proven absent");

  const blockedOperation = currentOperation();
  const blockedStorage = memoryStorage({
    [operationStorageKey("user-alice")]: JSON.stringify(blockedOperation),
  });
  blockedStorage.setItem = () => {};
  blockedStorage.removeItem = () => {};
  assert.deepEqual(persistKnownInvocation(blockedStorage, "user-alice", blockedOperation, invocationId), {
    ok: false,
    code: "invocation_persistence_failed",
    persisted: false,
    invalidated: false,
  });
  assert.equal(blockedOperation.invocation_id, invocationId, "the identity remains available for manual reconciliation");
  assert.equal(readPrincipalOperation(blockedStorage, "user-alice").invocation_id, null, "the unsafe stale record is detected, never treated as removed");

  const conflictingOperation = currentOperation({ invocation_id: "inv_server_existing_01" });
  assert.deepEqual(persistKnownInvocation(memoryStorage(), "user-alice", conflictingOperation, invocationId), {
    ok: false,
    code: "invocation_identity_drift",
    invalidated: false,
  });
  assert.equal(conflictingOperation.invocation_id, "inv_server_existing_01");

  const numericOperation = currentOperation();
  assert.deepEqual(persistKnownInvocation(memoryStorage(), "user-alice", numericOperation, 12345678), {
    ok: false,
    code: "invocation_identity_drift",
    invalidated: false,
  });
  assert.equal(numericOperation.invocation_id, null);
});

test("v1 unbound and pre-choice v2/v3 operations stay quarantined and unmodified", () => {
  const v1 = {
    id: "web-legacy-operation",
    input: { messages: [{ role: "user", content: "unknown" }] },
    effect_may_have_started: true,
  };
  const v1Key = "semesh.auth-payments-minimal.pending-operation.v1";
  const v1Storage = memoryStorage({ [v1Key]: JSON.stringify(v1) });
  const quarantinedV1 = readLegacyOperation(v1Storage, "user-alice");
  assert.equal(quarantinedV1.storage_version, 1);
  assert.equal(quarantinedV1.idempotency_key, v1.id);
  assert.equal(readPrincipalOperation(v1Storage, "user-alice"), null);
  assert.equal(v1Storage.snapshot()[v1Key], JSON.stringify(v1));

  const v2 = {
    version: 2,
    principal: "user-alice",
    id: "web-previous-operation",
    input: { messages: [{ role: "user", content: "legacy v2" }] },
    effect_may_have_started: true,
  };
  const v2Key = "semesh.auth-payments-minimal.pending-operation.v2." + encodeURIComponent("user-alice");
  const v2Storage = memoryStorage({ [v2Key]: JSON.stringify(v2) });
  const quarantinedV2 = readLegacyOperation(v2Storage, "user-alice");
  assert.equal(quarantinedV2.storage_version, 2);
  assert.equal(quarantinedV2.idempotency_key, v2.id);
  assert.equal(v2Storage.snapshot()[v2Key], JSON.stringify(v2));

  const v3 = {
    version: 3,
    principal: "user-alice",
    idempotency_key: "web-v3-operation",
    input: { messages: [{ role: "user", content: "legacy v3" }], model_choice: "deepseek-v3" },
    effect_may_have_started: true,
  };
  const v3Key = "semesh.auth-payments-minimal.pending-operation.v3." + encodeURIComponent("user-alice");
  const v3Storage = memoryStorage({ [v3Key]: JSON.stringify(v3) });
  const quarantinedV3 = readLegacyOperation(v3Storage, "user-alice");
  assert.equal(quarantinedV3.storage_version, 3);
  assert.equal(quarantinedV3.idempotency_key, v3.idempotency_key);
  assert.equal(v3Storage.snapshot()[v3Key], JSON.stringify(v3));
});

test("browser quote adapter binds principal and times out only the read-only request", async () => {
  const nativeFetch = globalThis.fetch;
  let signal;
  globalThis.fetch = async (_url, init) => {
    signal = init.signal;
    assert.equal(init.headers["X-Semesh-Operation-Principal"], "user-alice");
    assert.deepEqual(JSON.parse(init.body), { messages: [{ role: "user", content: "hello" }] });
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
  };
  try {
    const result = await fetchReadOnlyQuote({ messages: [{ role: "user", content: "hello" }] }, "user-alice", { timeoutMs: 5 });
    assert.ok(signal instanceof AbortSignal);
    assert.equal(result.error.code, "quote_ui_timeout");
    assert.equal(result.error.retryable, true);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});
