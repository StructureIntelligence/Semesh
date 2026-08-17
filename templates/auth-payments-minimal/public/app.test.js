const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatQuote,
  formatQuoteDetails,
  operationAfterKnownPreEffect,
  principalFromMe,
  operationStorageKey,
  readPrincipalOperation,
  readLegacyOperation,
  fetchReadOnlyQuote,
} = require("./app.js");

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    snapshot() { return Object.fromEntries(values); },
  };
}

test("quote display distinguishes exact, representative floor, and actual-usage hold ceiling", () => {
  assert.equal(
    formatQuote({ quote_kind: "exact", total_credits: 0.0001 }),
    "0.0001 Aev exact"
  );
  assert.match(
    formatQuote({ quote_kind: "representative_floor", total_credits: 2, price_label: "2 aev/s" }),
    /representative|floor/i
  );
  assert.match(
    formatQuote({
      quote_kind: "hold_ceiling",
      total_credits: 11,
      capture_ceiling_credits: 11,
      capture_basis: "actual_usage",
    }),
    /11 Aev hold ceiling \(actual usage, not a final charge\)/
  );
});

test("quote details preserve note, required fields, and availability recovery", () => {
  const details = formatQuoteDetails({
    note: "input-priced",
    required_fields: ["prompt", "duration"],
    availability: {
      status: "unavailable",
      reason: "provider binding is missing",
      fix: "configure the provider binding",
    },
  });
  assert.match(details, /input-priced/);
  assert.match(details, /prompt, duration/);
  assert.match(details, /availability: unavailable/);
  assert.match(details, /configure the provider binding/);
});

test("known pre-effect failure clears only a fresh operation and preserves prior recovery identity", () => {
  const pending = {
    id: "web-test-operation",
    input: { prompt: "same input" },
    effect_may_have_started: true,
  };
  assert.equal(operationAfterKnownPreEffect(pending, false), null);
  assert.equal(operationAfterKnownPreEffect(pending, true), pending);
});

test("stable principal uses user.sub first and user.id only when sub is absent", () => {
  assert.equal(principalFromMe({ authenticated: true, user: { sub: "subject-1", id: "legacy-id" } }), "subject-1");
  assert.equal(principalFromMe({ authenticated: true, user: { id: "user-2" } }), "user-2");
  assert.equal(principalFromMe({ authenticated: true, user: { sub: "bad principal", id: "fallback-must-not-win" } }), null);
  assert.equal(principalFromMe({ authenticated: false, user: { sub: "subject-1" } }), null);
  assert.equal(principalFromMe({ authenticated: true, user: { sub: "https://issuer.test/users/a=b?c" } }), "https://issuer.test/users/a=b?c");
});

test("browser quote adapter binds the principal and times out only the read-only request", async () => {
  const nativeFetch = globalThis.fetch;
  let signal;
  globalThis.fetch = async (_url, init) => {
    signal = init.signal;
    assert.equal(init.headers["X-Semesh-Operation-Principal"], "user-alice");
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
  };
  try {
    const result = await fetchReadOnlyQuote({ prompt: "same input" }, "user-alice", { timeoutMs: 5 });
    assert.ok(signal instanceof AbortSignal);
    assert.equal(result.error.code, "quote_ui_timeout");
    assert.equal(result.error.retryable, true);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("pending operations are stored and loaded only from the validated principal slot", () => {
  const alice = "user-alice";
  const bob = "user-bob";
  const aliceOperation = {
    version: 2,
    principal: alice,
    id: "web-alice-operation",
    input: { prompt: "alice input" },
    effect_may_have_started: true,
  };
  const storage = memoryStorage({
    [operationStorageKey(alice)]: JSON.stringify(aliceOperation),
  });

  assert.deepEqual(readPrincipalOperation(storage, alice), aliceOperation);
  assert.equal(readPrincipalOperation(storage, bob), null, "Bob must not see or replay Alice's operation");
  assert.equal(storage.snapshot()[operationStorageKey(alice)], JSON.stringify(aliceOperation), "Alice recovery must remain intact");
});

test("legacy unbound operation remains quarantined for reconciliation and is never adopted", () => {
  const legacy = {
    id: "web-legacy-operation",
    input: { prompt: "unknown owner" },
    effect_may_have_started: true,
  };
  const legacyKey = "semesh.auth-payments-minimal.pending-operation.v1";
  const storage = memoryStorage({ [legacyKey]: JSON.stringify(legacy) });

  assert.deepEqual(readLegacyOperation(storage), legacy);
  assert.equal(readPrincipalOperation(storage, "user-alice"), null);
  assert.equal(storage.snapshot()[legacyKey], JSON.stringify(legacy), "unknown recovery evidence must not be deleted or migrated");
});
