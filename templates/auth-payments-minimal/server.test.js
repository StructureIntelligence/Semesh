const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.SEMESH_APP_API_KEY = "test-runtime-key";
process.env.SEMESH_BASE_URL = "https://catalog-authority.test";
process.env.SEMESH_UNIT_QUERY = "DeepSeek chat";
process.env.SEMESH_ACTION_ID = "chat";
process.env.SEMESH_BUDGET_CEILING_AEV_ATOMS = "900000000";
process.env.SEMESH_ACTION_DEADLINE_SECONDS = "300";
// An ambient attacker-controlled value must never become discovery authority.
process.env.SEMESH_CATALOG_TOKEN = "environment-token-must-never-be-used";

const serverPath = path.join(__dirname, "server.js");
const source = fs.readFileSync(serverPath, "utf8");
const mod = require("./server.js");

const INPUT = {
  messages: [{ role: "user", content: "Say hello." }],
};
const UNIT_REVISION = `sha256:${"1".repeat(64)}`;
const ACTION_REVISION = `sha256:${"2".repeat(64)}`;
const CATALOG_DIGEST = `sha256:${"3".repeat(64)}`;
const INPUT_DIGEST = `sha256:${"4".repeat(64)}`;
const PRICE_DIGEST = `sha256:${"5".repeat(64)}`;
const POLICY_DIGEST = `sha256:${"6".repeat(64)}`;
const EFFECT_DIGEST = `sha256:${"7".repeat(64)}`;
const REF = {
  unit_id: "unit_models",
  unit_revision: UNIT_REVISION,
  action_id: "chat",
  action_revision: ACTION_REVISION,
};
const MODEL_CHOICE_PIN = {
  model_id: "deepseek-v3",
  model_revision: "model.release.2026-09-02",
};
const CATALOG = { view_generation: 42, view_digest: CATALOG_DIGEST };
const CATALOG_IDENTITY = { view_generation: 42, view_digest: CATALOG_DIGEST, scope: "public" };
const CATALOG_TOKEN = "search-issued-catalog-token-0001";
const IDEMPOTENCY_KEY = "web-operation-00000001";
const INVOCATION_ID = "inv_server_00000001";
const SETTLEMENT_REFERENCE = "settlement_ref_00000001";
const AMOUNT = 500000000;
const BUDGET = 900000000;
const STRICT_CHAT_INPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["messages"],
  properties: {
    messages: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["role", "content"],
        properties: {
          role: { type: "string", enum: ["system", "user", "assistant"] },
          content: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};
const STRICT_CHAT_OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["message", "usage"],
  properties: {
    message: {
      type: "object",
      required: ["role", "content"],
      properties: {
        role: { type: "string", enum: ["assistant"] },
        content: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    usage: {
      type: "object",
      required: ["total_tokens"],
      properties: { total_tokens: { type: "integer", minimum: 0 } },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function searchEnvelope(overrides = {}) {
  return {
    success: true,
    data: [{ kind: "unit", id: REF.unit_id, matched_choice: "deepseek" }],
    notices: [{ kind: "guide", message: "read-only navigation" }],
    meta: { catalog_token: CATALOG_TOKEN, catalog_identity: clone(CATALOG_IDENTITY) },
    ...overrides,
  };
}

function detailEnvelope(overrides = {}) {
  return {
    success: true,
    data: {
      id: REF.unit_id,
      kind: "unit",
      catalog: clone(CATALOG),
      actions: [{
        id: REF.action_id,
        unit_action_ref: clone(REF),
        input_schema: clone(STRICT_CHAT_INPUT_SCHEMA),
        output_schema: clone(STRICT_CHAT_OUTPUT_SCHEMA),
        model_choices: [{
          ref: clone(MODEL_CHOICE_PIN),
          selectable: true,
          callable: false,
          groups: [],
          targets: [{ unit_action_ref: clone(REF), model_ref: clone(MODEL_CHOICE_PIN) }],
        }],
        callable: true,
        availability: "available",
        effect: { requires_confirmation: false },
        execution: { mode: "sync", events: true },
      }],
      ...overrides,
    },
    meta: { catalog_token: CATALOG_TOKEN, catalog_identity: clone(CATALOG_IDENTITY) },
  };
}

function quoteProjection(quoteRequest, overrides = {}) {
  return {
    quote_contract_version: "v1",
    quote_kind: "exact",
    currency: "aev",
    exists: true,
    callable: true,
    amount_aev_atoms: AMOUNT,
    quote_reference: "quote_ref_00000001",
    quote_receipt: "quote_receipt_00000001",
    input_digest: INPUT_DIGEST,
    price_digest: PRICE_DIGEST,
    policy_digest: POLICY_DIGEST,
    effect_digest: EFFECT_DIGEST,
    unit_action_ref: clone(quoteRequest.unit_action_ref),
    catalog: clone(quoteRequest.catalog),
    model_choice_pin: clone(quoteRequest.model_choice_pin),
    input: clone(quoteRequest.input),
    budget: clone(quoteRequest.budget),
    deadline: quoteRequest.deadline,
    confirmation_required: false,
    provider_binding: "must-remain-hidden",
    ...overrides,
  };
}

function invocationProjection(state = "succeeded", overrides = {}) {
  return {
    invocation_id: INVOCATION_ID,
    state,
    unit_action_ref: clone(REF),
    catalog: clone(CATALOG),
    model_choice_pin: clone(MODEL_CHOICE_PIN),
    input_digest: INPUT_DIGEST,
    settlement_reference: SETTLEMENT_REFERENCE,
    result: {
      message: { role: "assistant", content: "hello" },
      usage: { total_tokens: 7 },
    },
    ...overrides,
  };
}

function receiptProjection(overrides = {}) {
  return {
    invocation_id: INVOCATION_ID,
    idempotency_key: IDEMPOTENCY_KEY,
    terminal_state: "succeeded",
    unit_action_ref: clone(REF),
    catalog: clone(CATALOG),
    model_choice_pin: clone(MODEL_CHOICE_PIN),
    input_digest: INPUT_DIGEST,
    price_digest: PRICE_DIGEST,
    policy_digest: POLICY_DIGEST,
    effect_digest: EFFECT_DIGEST,
    quote_reference: "quote_ref_00000001",
    quote_receipt: "quote_receipt_00000001",
    held_aev_atoms: AMOUNT,
    captured_aev_atoms: AMOUNT,
    released_aev_atoms: 0,
    settlement_reference: SETTLEMENT_REFERENCE,
    provider_receipt: "must-remain-hidden",
    ...overrides,
  };
}

function json(value, init = {}) {
  return Response.json(value, init);
}

function canonicalRouter(options = {}) {
  const calls = [];
  const router = async (url, init = {}) => {
    const parsed = new URL(String(url));
    const method = String(init.method || "GET");
    const call = {
      method,
      pathname: parsed.pathname,
      search: parsed.search,
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : undefined,
      credentials: init.credentials,
      redirect: init.redirect,
      cache: init.cache,
    };
    calls.push(call);

    if (method === "GET" && parsed.pathname === "/v1/service-units/search" && parsed.searchParams.get("scope") === "public") {
      return options.search || json(searchEnvelope());
    }
    if (method === "GET" && parsed.pathname === `/v1/service-units/${REF.unit_id}`) {
      return options.detail || json(detailEnvelope());
    }
    if (method === "POST" && parsed.pathname.endsWith(`/actions/${REF.action_id}/quote`)) {
      const quoteData = quoteProjection(call.body, options.quoteOverrides);
      return options.quote || (options.bareQuote ? json(quoteData) : json({ success: true, data: quoteData }));
    }
    if (method === "POST" && parsed.pathname.endsWith(`/actions/${REF.action_id}/invoke`)) {
      return options.invoke || json({ success: true, data: invocationProjection() }, {
        headers: { "x-semesh-charged-aev": "9000000000" },
      });
    }
    if (method === "GET" && parsed.pathname.endsWith(`/actions/${REF.action_id}/invocations/${INVOCATION_ID}`)) {
      return options.observe || json({ success: true, data: invocationProjection() });
    }
    if (method === "GET" && parsed.pathname === `/v1/invocations/${INVOCATION_ID}/receipt`) {
      return options.receipt || json({ success: true, data: receiptProjection() });
    }
    if (method === "GET" && parsed.pathname === `/v1/invocations/${INVOCATION_ID}/events`) {
      return options.events || json({ success: true, data: { invocation_id: INVOCATION_ID, events: [{ sequence: 1, state: "succeeded" }] } });
    }
    throw new Error(`unexpected external request ${method} ${parsed.pathname}${parsed.search}`);
  };
  return { calls, router };
}

const PRINCIPAL_HEADERS = {
  authorization: "Bearer test-payer-session",
  "content-type": "application/json",
  "x-semesh-user-id": "user-alice",
  "x-semesh-operation-principal": "user-alice",
};

async function withServer(t, upstream) {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = upstream;
  await new Promise((resolve) => mod.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    globalThis.fetch = nativeFetch;
    await new Promise((resolve, reject) => mod.server.close((error) => error ? reject(error) : resolve()));
  });
  return {
    nativeFetch,
    origin: `http://127.0.0.1:${mod.server.address().port}`,
  };
}

test("source contains only the canonical public Unit Action rail", () => {
  const retiredPricePath = ["", "v1", "billing", "quote"].join("/");
  const retiredInvokeStem = ["", "v1", "capabilities", ""].join("/");
  const retiredIdentityName = ["CAPABILITY", "ID"].join("_");
  assert.equal(source.includes(retiredPricePath), false);
  assert.equal(source.includes(retiredInvokeStem), false);
  assert.equal(source.includes(retiredIdentityName), false);
  assert.equal(source.includes("SEMESH_CATALOG_TOKEN"), false);
  assert.match(source, /\/v1\/service-units\/search\?q=/);
  assert.doesNotMatch(source, /\/v1\/service-units\?q=/);
  assert.match(source, /\/actions\/\$\{encodeURIComponent\(ref\.action_id\)\}\/quote/);
  assert.match(source, /\/actions\/\$\{encodeURIComponent\(ref\.action_id\)\}\/invoke/);
  assert.match(source, /\/v1\/invocations\/\$\{encodeURIComponent\(invocationId\)\}\/receipt/);
  assert.match(source, /\/v1\/invocations\/\$\{encodeURIComponent\(invocationId\)\}\/events/);
});

test("module exports strict helpers without listening on import", () => {
  assert.equal(typeof mod.discoverAction, "function");
  assert.equal(typeof mod.quoteAction, "function");
  assert.equal(typeof mod.projectCanonicalQuote, "function");
  assert.equal(typeof mod.settlementFromReceipt, "function");
  assert.equal(typeof mod.sealQuotePlan, "function");
  assert.equal(typeof mod.openQuotePlan, "function");
  assert.equal(mod.server.listening, false);
});

test("quote projection requires atom truth, exact pins, receipt digests, budget, and deadline", () => {
  const request = {
    unit_action_ref: clone(REF),
    catalog: clone(CATALOG),
    model_choice_pin: clone(MODEL_CHOICE_PIN),
    input: clone(INPUT),
    budget: { ceiling_aev_atoms: BUDGET },
    deadline: "2030-01-01T00:00:00.000Z",
  };
  const context = {
    contract: { unitActionRef: REF, catalog: CATALOG, modelChoicePin: MODEL_CHOICE_PIN },
    input: INPUT,
    budget: request.budget,
    deadline: request.deadline,
  };
  assert.equal(mod.projectCanonicalQuote(quoteProjection(request), context).ok, true);
  assert.equal(mod.projectCanonicalQuote(quoteProjection(request, { amount_aev_atoms: 1.5 }), context).ok, false);
  assert.equal(mod.projectCanonicalQuote(quoteProjection(request, { catalog: { view_generation: 43 } }), context).error.code, "quote_pin_drift");
  assert.equal(mod.projectCanonicalQuote(quoteProjection(request, { model_choice_pin: { ...MODEL_CHOICE_PIN, model_revision: "model.release.drift" } }), context).error.code, "quote_pin_drift");
  assert.equal(mod.projectCanonicalQuote(quoteProjection(request, { input: undefined }), context).error.code, "quote_input_drift");
  assert.equal(mod.projectCanonicalQuote(quoteProjection(request, { amount_aev_atoms: BUDGET + 1 }), context).error.code, "quote_budget_exceeded");
  assert.equal(mod.projectCanonicalQuote(quoteProjection(request, { amount_aev_atoms: Number.MAX_SAFE_INTEGER + 1 }), context).ok, false, "unsafe JSON integers above 2^53 fail closed");
  assert.equal(mod.projectCanonicalQuote(quoteProjection(request, { amount_aev_atoms: String(AMOUNT) }), context).ok, false, "schema-incompatible atom strings are rejected");
  assert.equal(mod.projectCanonicalQuote(quoteProjection(request, { input_digest: "sha256:1234" }), context).ok, false, "short digest pins are rejected");
  assert.equal(mod.projectCanonicalQuote(quoteProjection(request, { effect_digest: `sha256:${"g".repeat(64)}` }), context).ok, false, "nonhex digest pins are rejected");
  assert.equal(mod.projectCanonicalQuote(quoteProjection(request, { confirmation_required: undefined, requires_confirmation: false }), context).error.code, "quote_control_drift", "Detail's requires_confirmation name is not a quote-response substitute");
  assert.equal(mod.projectCanonicalQuote(quoteProjection(request, { quote_kind: "representative_floor" }), context).error.code, "quote_not_final");
  const metered = quoteProjection(request, {
    quote_kind: "hold_ceiling",
    ceiling_aev_atoms: BUDGET,
    capture_basis: "actual_usage",
  });
  delete metered.amount_aev_atoms;
  assert.equal(mod.projectCanonicalQuote(metered, context).ok, true);
});

test("anonymous Search supplies the only token used by anonymous pinned detail", async () => {
  const { calls, router } = canonicalRouter();
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = router;
  try {
    const found = await mod.discoverAction(INPUT);
    assert.equal(found.ok, true);
    assert.deepEqual(found.contract.unitActionRef, REF);
    assert.deepEqual(found.contract.catalog, CATALOG);
    assert.deepEqual(found.contract.modelChoicePin, MODEL_CHOICE_PIN);
    assert.deepEqual(calls.map((call) => [call.method, call.pathname]), [
      ["GET", "/v1/service-units/search"],
      ["GET", `/v1/service-units/${REF.unit_id}`],
    ]);
    assert.equal(new URL(`https://x.test${calls[0].search}`).searchParams.get("q"), "DeepSeek chat");
    assert.equal(calls[0].headers.Authorization, undefined);
    assert.equal(calls[0].headers["X-Semesh-Payer"], undefined);
    assert.equal(calls[0].headers["X-Semesh-Catalog-Token"], undefined);
    assert.equal(calls[1].headers.Authorization, undefined);
    assert.equal(calls[1].headers["X-Semesh-Payer"], undefined);
    assert.equal(calls[1].headers["X-Semesh-Catalog-Token"], CATALOG_TOKEN);
    assert.notEqual(calls[1].headers["X-Semesh-Catalog-Token"], process.env.SEMESH_CATALOG_TOKEN);
    assert.equal(calls[0].credentials, "omit");
    assert.equal(calls[1].redirect, "error");
    assert.equal(calls[0].cache, "no-store");
    assert.equal(calls[1].cache, "no-store");
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("discovery rejects ambiguity, pin drift, invalid chat schema, and hostile nested model choices before any POST", async () => {
  const nativeFetch = globalThis.fetch;
  try {
    const cases = [
      canonicalRouter({
        search: json(searchEnvelope({ data: [
          { kind: "unit", id: REF.unit_id },
          { kind: "unit", id: "unit_models_second" },
        ] })),
      }),
      canonicalRouter({
        search: json(searchEnvelope({ success: undefined })),
      }),
      canonicalRouter({
        detail: json({ ...detailEnvelope(), meta: { catalog_token: "different-search-token", catalog_identity: CATALOG_IDENTITY } }),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ catalog: { view_generation: 42, view_digest: `sha256:${"8".repeat(64)}` } })),
      }),
      canonicalRouter({
        search: json(searchEnvelope({ meta: {
          catalog_token: CATALOG_TOKEN,
          catalog_identity: { ...CATALOG_IDENTITY, view_generation: 0 },
        } })),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ actions: [{
          ...detailEnvelope().data.actions[0],
          unit_action_ref: { ...REF, unit_revision: "sha256:1234" },
        }] })),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ actions: [{
          ...detailEnvelope().data.actions[0],
          unit_action_ref: { ...REF, action_revision: `sha256:${"G".repeat(64)}` },
        }] })),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ actions: [{
          ...detailEnvelope().data.actions[0],
          unit_action_ref: { ...REF, provider: "must-remain-hidden" },
        }] })),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ actions: [{
          ...detailEnvelope().data.actions[0],
          input_schema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            required: ["messages"],
            properties: {
              messages: { type: "string" },
            },
            additionalProperties: false,
          },
        }] })),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ actions: [{
          ...detailEnvelope().data.actions[0],
          input_schema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            required: ["messages", "model_choice"],
            properties: {
              messages: clone(STRICT_CHAT_INPUT_SCHEMA.properties.messages),
              model_choice: { type: "string", enum: ["deepseek-v3"] },
            },
            additionalProperties: false,
          },
        }] })),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ actions: [{
          ...detailEnvelope().data.actions[0],
          model_choices: [{
            ...detailEnvelope().data.actions[0].model_choices[0],
            ref: { model_id: "mistral", model_revision: "model.release.1" },
            targets: [{
              unit_action_ref: clone(REF),
              model_ref: { model_id: "mistral", model_revision: "model.release.1" },
            }],
          }],
        }] })),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ actions: [{
          ...detailEnvelope().data.actions[0],
          model_choices: [
            detailEnvelope().data.actions[0].model_choices[0],
            clone(detailEnvelope().data.actions[0].model_choices[0]),
          ],
        }] })),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ actions: [{
          ...detailEnvelope().data.actions[0],
          model_choices: [{
            ...detailEnvelope().data.actions[0].model_choices[0],
            ref: { ...MODEL_CHOICE_PIN, provider: "must-remain-hidden" },
          }],
        }] })),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ actions: [{
          ...detailEnvelope().data.actions[0],
          model_choices: [{
            ...detailEnvelope().data.actions[0].model_choices[0],
            selectable: false,
          }],
        }] })),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ actions: [{
          ...detailEnvelope().data.actions[0],
          model_choices: [{
            ...detailEnvelope().data.actions[0].model_choices[0],
            targets: [{
              unit_action_ref: { ...REF, action_id: "other" },
              model_ref: clone(MODEL_CHOICE_PIN),
            }],
          }],
        }] })),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ actions: [{
          ...detailEnvelope().data.actions[0],
          output_schema: {
            type: "object",
            required: ["choices"],
            properties: { choices: { type: "array" } },
          },
        }] })),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ actions: [{
          ...detailEnvelope().data.actions[0],
          callable: false,
        }] })),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ actions: [{
          ...detailEnvelope().data.actions[0],
          availability: "unavailable",
        }] })),
      }),
      canonicalRouter({
        detail: json(detailEnvelope({ actions: [{
          ...detailEnvelope().data.actions[0],
          effect: { confirmation_required: false },
        }] })),
      }),
    ];
    for (const entry of cases) {
      globalThis.fetch = entry.router;
      const result = await mod.discoverAction(INPUT);
      assert.equal(result.ok, false);
      assert.equal(entry.calls.some((call) => call.method === "POST"), false);
    }
    const embeddedChoice = canonicalRouter();
    globalThis.fetch = embeddedChoice.router;
    const embeddedChoiceResult = await mod.discoverAction({ ...INPUT, model_choice: "deepseek-v3" });
    assert.equal(embeddedChoiceResult.ok, false);
    assert.equal(embeddedChoice.calls.some((call) => call.method === "POST"), false);
    const providerInput = canonicalRouter();
    globalThis.fetch = providerInput.router;
    const providerInputResult = await mod.discoverAction({ ...INPUT, provider: "must-remain-hidden" });
    assert.equal(providerInputResult.ok, false);
    assert.equal(providerInput.calls.some((call) => call.method === "POST"), false);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("nested quote is authenticated, payer-bound, read-only, and carries exact controls", async () => {
  const { calls, router } = canonicalRouter();
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = router;
  const deadline = "2030-01-01T00:00:00.000Z";
  const budget = { ceiling_aev_atoms: BUDGET };
  try {
    const result = await mod.quoteAction("payer-session", INPUT, {
      unitActionRef: REF,
      catalog: CATALOG,
      modelChoicePin: MODEL_CHOICE_PIN,
    }, { budget, deadline });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].pathname, `/v1/service-units/${REF.unit_id}/actions/${REF.action_id}/quote`);
    assert.equal(calls[0].headers.Authorization, "Bearer test-runtime-key");
    assert.equal(calls[0].headers["X-Semesh-Payer"], "payer-session");
    assert.equal(calls[0].headers["Idempotency-Key"], undefined);
    assert.equal(calls[0].headers["X-Semesh-Catalog-Token"], undefined);
    assert.deepEqual(calls[0].body, {
      unit_action_ref: REF,
      catalog: CATALOG,
      model_choice_pin: MODEL_CHOICE_PIN,
      input: INPUT,
      budget,
      deadline,
    });
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("quote timeout is retryable and never reaches invoke", async () => {
  const nativeFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
  };
  try {
    const result = await mod.quoteAction("payer", INPUT, { unitActionRef: REF, catalog: CATALOG, modelChoicePin: MODEL_CHOICE_PIN }, {
      budget: { ceiling_aev_atoms: BUDGET },
      deadline: "2030-01-01T00:00:00.000Z",
      timeoutMs: 5,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 504);
    assert.equal(result.error.code, "quote_timeout");
    assert.equal(result.error.retryable, true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

describe("HTTP canonical paid journey", { concurrency: 1 }, () => {
  test("persists a signed exact bundle before one invoke and settles only from receipt atoms", async (t) => {
    const upstream = canonicalRouter();
    const { nativeFetch, origin } = await withServer(t, upstream.router);

    const quoteResponse = await nativeFetch(`${origin}/api/quote`, {
      method: "POST",
      headers: PRINCIPAL_HEADERS,
      body: JSON.stringify(INPUT),
    });
    const quoted = await quoteResponse.json();
    assert.equal(quoteResponse.status, 200);
    assert.equal(quoted.ok, true);
    assert.equal(typeof quoted.quote_token, "string");
    assert.deepEqual(quoted.quote.model_choice_pin, MODEL_CHOICE_PIN);
    assert.equal(Object.hasOwn(quoted.quote, "provider_binding"), false);
    assert.deepEqual(quoted.selection, { unit_action_ref: REF, catalog: CATALOG, model_choice_pin: MODEL_CHOICE_PIN });
    assert.deepEqual(quoted.invoke_request, {
      unit_action_ref: REF,
      catalog: CATALOG,
      model_choice_pin: MODEL_CHOICE_PIN,
      quote_reference: "quote_ref_00000001",
      input: INPUT,
      confirmed_effect_digest: null,
      deadline: quoted.quote.deadline,
    });

    // This is the exact bundle a browser persists with the key before the effect-capable request.
    const persisted = JSON.parse(JSON.stringify({
      quote_token: quoted.quote_token,
      invoke_request: quoted.invoke_request,
    }));
    const actionResponse = await nativeFetch(`${origin}/api/action`, {
      method: "POST",
      headers: { ...PRINCIPAL_HEADERS, "idempotency-key": IDEMPOTENCY_KEY },
      body: JSON.stringify(persisted),
    });
    const result = await actionResponse.json();
    assert.equal(actionResponse.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.receipt_verified, true);
    assert.equal(result.idempotency_key, IDEMPOTENCY_KEY);
    assert.equal(result.invocation_id, INVOCATION_ID);
    assert.notEqual(result.invocation_id, result.idempotency_key);
    assert.equal(result.receipt.captured_aev_atoms, AMOUNT);
    assert.equal(result.receipt.quote_receipt, "quote_receipt_00000001");
    assert.equal(result.receipt.settlement_reference, SETTLEMENT_REFERENCE);
    assert.deepEqual(result.receipt.model_choice_pin, MODEL_CHOICE_PIN);
    assert.equal(Object.hasOwn(result.receipt, "provider_receipt"), false);
    assert.deepEqual(result.result, {
      message: { role: "assistant", content: "hello" },
      usage: { total_tokens: 7 },
    }, "only the strict canonical message/usage result is projected");

    assert.deepEqual(upstream.calls.map((call) => [call.method, call.pathname]), [
      ["GET", "/v1/service-units/search"],
      ["GET", `/v1/service-units/${REF.unit_id}`],
      ["POST", `/v1/service-units/${REF.unit_id}/actions/${REF.action_id}/quote`],
      ["POST", `/v1/service-units/${REF.unit_id}/actions/${REF.action_id}/invoke`],
      ["GET", `/v1/service-units/${REF.unit_id}/actions/${REF.action_id}/invocations/${INVOCATION_ID}`],
      ["GET", `/v1/invocations/${INVOCATION_ID}/receipt`],
      ["GET", `/v1/invocations/${INVOCATION_ID}/events`],
    ]);
    const quoteCall = upstream.calls[2];
    const invokeCall = upstream.calls[3];
    assert.deepEqual(invokeCall.body, quoted.invoke_request);
    assert.deepEqual(invokeCall.body.unit_action_ref, quoteCall.body.unit_action_ref);
    assert.deepEqual(invokeCall.body.catalog, quoteCall.body.catalog);
    assert.deepEqual(invokeCall.body.model_choice_pin, quoteCall.body.model_choice_pin);
    assert.deepEqual(invokeCall.body.input, quoteCall.body.input);
    assert.equal(invokeCall.body.deadline, quoteCall.body.deadline);
    assert.equal(invokeCall.headers["Idempotency-Key"], IDEMPOTENCY_KEY);
    assert.equal(invokeCall.headers.Authorization, "Bearer test-runtime-key");
    assert.equal(invokeCall.headers["X-Semesh-Payer"], "test-payer-session");
    assert.equal(Object.hasOwn(invokeCall.body, "budget"), false);
    assert.equal(Object.hasOwn(invokeCall.body, "quote_receipt"), false);
  });

  test("known invocation recovery uses only canonical GETs and never posts again", async (t) => {
    const upstream = canonicalRouter();
    const { nativeFetch, origin } = await withServer(t, upstream.router);
    const quoted = await (await nativeFetch(`${origin}/api/quote`, {
      method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify(INPUT),
    })).json();
    upstream.calls.length = 0;

    const response = await nativeFetch(`${origin}/api/observe`, {
      method: "POST",
      headers: { ...PRINCIPAL_HEADERS, "idempotency-key": IDEMPOTENCY_KEY },
      body: JSON.stringify({
        quote_token: quoted.quote_token,
        invoke_request: quoted.invoke_request,
        invocation_id: INVOCATION_ID,
      }),
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.receipt_verified, true);
    assert.equal(upstream.calls.some((call) => call.method === "POST"), false);
    assert.deepEqual(upstream.calls.map((call) => call.pathname), [
      `/v1/service-units/${REF.unit_id}/actions/${REF.action_id}/invocations/${INVOCATION_ID}`,
      `/v1/invocations/${INVOCATION_ID}/receipt`,
      `/v1/invocations/${INVOCATION_ID}/events`,
    ]);
  });

  for (const [name, upstreamOptions, expectedPhase, expectedMaxCalls] of [
    ["Search 404", { search: new Response("not found", { status: 404 }) }, "discovery", 1],
    ["malformed Search", { search: new Response("<html>bad</html>", { status: 200 }) }, "discovery", 1],
    ["oversized streamed Search", { search: new Response("x".repeat((1024 * 1024) + 1), { status: 200 }) }, "discovery", 1],
    ["Detail 404", { detail: new Response("not found", { status: 404 }) }, "discovery", 2],
    ["malformed quote", { quote: new Response("not-json", { status: 200 }) }, "quote", 3],
    ["quote 404", { quote: new Response("not found", { status: 404 }) }, "quote", 3],
    ["bare quote object", { bareQuote: true }, "quote", 3],
    ["quote missing input echo", { quoteOverrides: { input: undefined } }, "quote", 3],
    ["quote missing model choice pin", { quoteOverrides: { model_choice_pin: undefined } }, "quote", 3],
    ["quote drifted model choice pin", { quoteOverrides: { model_choice_pin: { ...MODEL_CHOICE_PIN, model_revision: "model.release.drift" } } }, "quote", 3],
    ["quote short digest", { quoteOverrides: { input_digest: "sha256:1234" } }, "quote", 3],
    ["quote nonhex digest", { quoteOverrides: { effect_digest: `sha256:${"g".repeat(64)}` } }, "quote", 3],
  ]) {
    test(`${name} fails closed with zero invoke and zero alternate call`, async (t) => {
      const upstream = canonicalRouter(upstreamOptions);
      const { nativeFetch, origin } = await withServer(t, upstream.router);
      const response = await nativeFetch(`${origin}/api/quote`, {
        method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify(INPUT),
      });
      const result = await response.json();
      assert.ok(response.status >= 400);
      assert.equal(result.effect_started, false);
      assert.equal(result.phase, expectedPhase);
      assert.equal(upstream.calls.length, expectedMaxCalls);
      assert.equal(upstream.calls.some((call) => call.pathname.endsWith("/invoke")), false);
      assert.equal(upstream.calls.every((call) => call.pathname.startsWith("/v1/service-units")), true);
    });
  }

  test("tampered persisted invoke bundle fails before every external call", async (t) => {
    const upstream = canonicalRouter();
    const { nativeFetch, origin } = await withServer(t, upstream.router);
    const quoted = await (await nativeFetch(`${origin}/api/quote`, {
      method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify(INPUT),
    })).json();
    upstream.calls.length = 0;
    const tampered = clone(quoted.invoke_request);
    tampered.model_choice_pin.model_revision = "model.release.drift";
    const response = await nativeFetch(`${origin}/api/action`, {
      method: "POST",
      headers: { ...PRINCIPAL_HEADERS, "idempotency-key": IDEMPOTENCY_KEY },
      body: JSON.stringify({ quote_token: quoted.quote_token, invoke_request: tampered }),
    });
    const result = await response.json();
    assert.equal(response.status, 409);
    assert.equal(result.error.code, "invoke_request_drift");
    assert.equal(result.effect_started, false);
    assert.equal(upstream.calls.length, 0);
  });

  test("principal mismatch fails before public discovery or authenticated effect", async (t) => {
    let externalCalls = 0;
    const { nativeFetch, origin } = await withServer(t, async () => {
      externalCalls += 1;
      return new Response("unexpected", { status: 500 });
    });
    const response = await nativeFetch(`${origin}/api/quote`, {
      method: "POST",
      headers: { ...PRINCIPAL_HEADERS, "x-semesh-user-id": "user-bob" },
      body: JSON.stringify(INPUT),
    });
    const result = await response.json();
    assert.equal(response.status, 409);
    assert.equal(result.error.code, "operation_principal_mismatch");
    assert.equal(result.effect_started, false);
    assert.equal(externalCalls, 0);
  });

  test("invoke returning the request key as invocation_id is rejected and never observed", async (t) => {
    const upstream = canonicalRouter({
      invoke: json({ success: true, data: invocationProjection("succeeded", { invocation_id: IDEMPOTENCY_KEY }) }),
    });
    const { nativeFetch, origin } = await withServer(t, upstream.router);
    const quoted = await (await nativeFetch(`${origin}/api/quote`, {
      method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify(INPUT),
    })).json();
    const response = await nativeFetch(`${origin}/api/action`, {
      method: "POST",
      headers: { ...PRINCIPAL_HEADERS, "idempotency-key": IDEMPOTENCY_KEY },
      body: JSON.stringify({ quote_token: quoted.quote_token, invoke_request: quoted.invoke_request }),
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.error.code, "invoke_identity_invalid");
    assert.equal(result.effect_started, true);
    assert.equal(upstream.calls.filter((call) => call.method === "POST" && call.pathname.endsWith("/invoke")).length, 1);
    assert.equal(upstream.calls.some((call) => call.pathname.includes("/invocations/")), false);
  });

  for (const [name, error, effectStarted] of [
    ["without effect or money evidence", { code: "not_found", message: "not found" }, true],
    ["with only effect none", { code: "not_found", effect_state: "none" }, true],
    ["with held money", { code: "not_found", effect_state: "none", money_state: "held" }, true],
    ["with captured money", { code: "not_found", effect_state: "none", money_state: "captured" }, true],
    ["with explicit same-object effect and money none", { code: "not_found", effect_state: "none", money_state: "none" }, false],
  ]) {
    test(`invoke 404 ${name} reports ${effectStarted ? "unknown effect" : "explicit effect-zero"}`, async (t) => {
      const upstream = canonicalRouter({
        invoke: json({ success: false, error }, { status: 404 }),
      });
      const { nativeFetch, origin } = await withServer(t, upstream.router);
      const quoted = await (await nativeFetch(`${origin}/api/quote`, {
        method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify(INPUT),
      })).json();
      const response = await nativeFetch(`${origin}/api/action`, {
        method: "POST",
        headers: { ...PRINCIPAL_HEADERS, "idempotency-key": IDEMPOTENCY_KEY },
        body: JSON.stringify({ quote_token: quoted.quote_token, invoke_request: quoted.invoke_request }),
      });
      const result = await response.json();
      assert.equal(response.status, 404);
      assert.equal(result.effect_started, effectStarted);
      assert.equal(result.terminal, undefined);
      assert.equal(result.receipt_verified, undefined);
      assert.equal(upstream.calls.filter((call) => call.method === "POST" && call.pathname.endsWith("/invoke")).length, 1);
      assert.equal(upstream.calls.some((call) => call.pathname.includes("/invocations/")), false);
    });
  }

  test("invoke 404 cannot combine effect-zero evidence across envelope objects", async (t) => {
    const upstream = canonicalRouter({
      invoke: json({
        success: false,
        money_state: "none",
        error: { code: "not_found", effect_state: "none" },
      }, { status: 404 }),
    });
    const { nativeFetch, origin } = await withServer(t, upstream.router);
    const quoted = await (await nativeFetch(`${origin}/api/quote`, {
      method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify(INPUT),
    })).json();
    const response = await nativeFetch(`${origin}/api/action`, {
      method: "POST",
      headers: { ...PRINCIPAL_HEADERS, "idempotency-key": IDEMPOTENCY_KEY },
      body: JSON.stringify({ quote_token: quoted.quote_token, invoke_request: quoted.invoke_request }),
    });
    const result = await response.json();
    assert.equal(response.status, 404);
    assert.equal(result.effect_started, true);
    assert.equal(result.receipt_verified, undefined);
  });

  test("provider-shaped output outside canonical message/usage fails closed", async (t) => {
    const upstream = canonicalRouter({
      observe: json({ success: true, data: invocationProjection("succeeded", {
        result: {
          message: { role: "assistant", content: "must still fail" },
          usage: { total_tokens: 3 },
          choices: [{ message: { content: "must not be consumed" } }],
          content: "must not be consumed",
          completion: "must not be consumed",
          output: "must not be consumed",
        },
      }) }),
    });
    const { nativeFetch, origin } = await withServer(t, upstream.router);
    const quoted = await (await nativeFetch(`${origin}/api/quote`, {
      method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify(INPUT),
    })).json();
    const response = await nativeFetch(`${origin}/api/action`, {
      method: "POST",
      headers: { ...PRINCIPAL_HEADERS, "idempotency-key": IDEMPOTENCY_KEY },
      body: JSON.stringify({ quote_token: quoted.quote_token, invoke_request: quoted.invoke_request }),
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.error.code, "invocation_observation_malformed");
    assert.equal(result.effect_started, true);
    assert.equal(result.receipt_verified, undefined);
    assert.equal(upstream.calls.some((call) => call.pathname.endsWith("/receipt")), false);
  });

  test("observation model choice drift fails closed before receipt", async (t) => {
    const upstream = canonicalRouter({
      observe: json({ success: true, data: invocationProjection("succeeded", {
        model_choice_pin: { ...MODEL_CHOICE_PIN, model_revision: "model.release.drift" },
      }) }),
    });
    const { nativeFetch, origin } = await withServer(t, upstream.router);
    const quoted = await (await nativeFetch(`${origin}/api/quote`, {
      method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify(INPUT),
    })).json();
    const response = await nativeFetch(`${origin}/api/action`, {
      method: "POST",
      headers: { ...PRINCIPAL_HEADERS, "idempotency-key": IDEMPOTENCY_KEY },
      body: JSON.stringify({ quote_token: quoted.quote_token, invoke_request: quoted.invoke_request }),
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.error.code, "invocation_observation_malformed");
    assert.equal(result.effect_started, true);
    assert.equal(upstream.calls.some((call) => call.pathname.endsWith("/receipt")), false);
  });

  test("receipt model choice drift never becomes settlement authority", async (t) => {
    const upstream = canonicalRouter({
      receipt: json({ success: true, data: receiptProjection({
        model_choice_pin: { ...MODEL_CHOICE_PIN, model_revision: "model.release.drift" },
      }) }),
    });
    const { nativeFetch, origin } = await withServer(t, upstream.router);
    const quoted = await (await nativeFetch(`${origin}/api/quote`, {
      method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify(INPUT),
    })).json();
    const response = await nativeFetch(`${origin}/api/action`, {
      method: "POST",
      headers: { ...PRINCIPAL_HEADERS, "idempotency-key": IDEMPOTENCY_KEY },
      body: JSON.stringify({ quote_token: quoted.quote_token, invoke_request: quoted.invoke_request }),
    });
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.error.code, "receipt_pin_drift");
    assert.equal(result.effect_started, true);
    assert.equal(result.receipt_verified, undefined);
  });

  for (const [name, index, options] of [
    ["invoke missing settlement reference", 0, { invoke: json({ success: true, data: invocationProjection("succeeded", { settlement_reference: undefined }) }) }],
    ["observation settlement reference drift", 1, { observe: json({ success: true, data: invocationProjection("succeeded", { settlement_reference: "settlement_ref_drift" }) }) }],
  ]) {
    test(`${name} fails before receipt`, async (t) => {
      const upstream = canonicalRouter(options);
      const { nativeFetch, origin } = await withServer(t, upstream.router);
      const quoted = await (await nativeFetch(`${origin}/api/quote`, {
        method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify(INPUT),
      })).json();
      const response = await nativeFetch(`${origin}/api/action`, {
        method: "POST",
        headers: { ...PRINCIPAL_HEADERS, "idempotency-key": `${IDEMPOTENCY_KEY}-${index}` },
        body: JSON.stringify({ quote_token: quoted.quote_token, invoke_request: quoted.invoke_request }),
      });
      const result = await response.json();
      assert.equal(response.status, 502);
      assert.equal(result.receipt_verified, undefined);
      assert.equal(upstream.calls.some((call) => call.pathname.endsWith("/receipt")), false);
    });
  }

  for (const [name, index, overrides] of [
    ["quote receipt drift", 0, { quote_receipt: "quote_receipt_drift" }],
    ["settlement reference drift", 1, { settlement_reference: "settlement_ref_drift" }],
  ]) {
    test(`receipt ${name} never proves money state`, async (t) => {
      const upstream = canonicalRouter({
        receipt: json({ success: true, data: receiptProjection(overrides) }),
      });
      const { nativeFetch, origin } = await withServer(t, upstream.router);
      const quoted = await (await nativeFetch(`${origin}/api/quote`, {
        method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify(INPUT),
      })).json();
      const response = await nativeFetch(`${origin}/api/action`, {
        method: "POST",
        headers: { ...PRINCIPAL_HEADERS, "idempotency-key": IDEMPOTENCY_KEY },
        body: JSON.stringify({ quote_token: quoted.quote_token, invoke_request: quoted.invoke_request }),
      });
      const result = await response.json();
      assert.equal(response.status, 503);
      assert.equal(result.error.code, "receipt_reference_invalid");
      assert.equal(result.receipt_verified, undefined);
    });
  }

  test("unsafe canonical usage total_tokens fails closed before receipt", async (t) => {
    const upstream = canonicalRouter({
      observe: json({ success: true, data: invocationProjection("succeeded", {
        result: {
          message: { role: "assistant", content: "must not be consumed" },
          usage: { total_tokens: Number.MAX_SAFE_INTEGER + 1 },
        },
      }) }),
    });
    const { nativeFetch, origin } = await withServer(t, upstream.router);
    const quoted = await (await nativeFetch(`${origin}/api/quote`, {
      method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify(INPUT),
    })).json();
    const response = await nativeFetch(`${origin}/api/action`, {
      method: "POST",
      headers: { ...PRINCIPAL_HEADERS, "idempotency-key": IDEMPOTENCY_KEY },
      body: JSON.stringify({ quote_token: quoted.quote_token, invoke_request: quoted.invoke_request }),
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.error.code, "invocation_observation_malformed");
    assert.equal(result.effect_started, true);
    assert.equal(result.receipt_verified, undefined);
    assert.equal(upstream.calls.some((call) => call.pathname.endsWith("/receipt")), false);
  });

  test("malicious header and provider amounts cannot override an invalid receipt", async (t) => {
    const upstream = canonicalRouter({
      receipt: json({ success: true, data: receiptProjection({
        held_aev_atoms: Number.MAX_SAFE_INTEGER + 1,
        captured_aev_atoms: Number.MAX_SAFE_INTEGER + 1,
        released_aev_atoms: 0,
      }) }),
    });
    const { nativeFetch, origin } = await withServer(t, upstream.router);
    const quoted = await (await nativeFetch(`${origin}/api/quote`, {
      method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify(INPUT),
    })).json();
    const response = await nativeFetch(`${origin}/api/action`, {
      method: "POST",
      headers: { ...PRINCIPAL_HEADERS, "idempotency-key": IDEMPOTENCY_KEY },
      body: JSON.stringify({ quote_token: quoted.quote_token, invoke_request: quoted.invoke_request }),
    });
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.error.code, "receipt_atoms_invalid");
    assert.equal(result.effect_started, true);
    assert.equal(result.receipt_verified, undefined);
    assert.equal(Object.hasOwn(result, "captured_aev_atoms"), false);
  });

  test("a nonhex receipt digest never becomes verified settlement", async (t) => {
    const upstream = canonicalRouter({
      receipt: json({ success: true, data: receiptProjection({ effect_digest: `sha256:${"g".repeat(64)}` }) }),
    });
    const { nativeFetch, origin } = await withServer(t, upstream.router);
    const quoted = await (await nativeFetch(`${origin}/api/quote`, {
      method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify(INPUT),
    })).json();
    const response = await nativeFetch(`${origin}/api/action`, {
      method: "POST",
      headers: { ...PRINCIPAL_HEADERS, "idempotency-key": IDEMPOTENCY_KEY },
      body: JSON.stringify({ quote_token: quoted.quote_token, invoke_request: quoted.invoke_request }),
    });
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.error.code, "receipt_digest_drift");
    assert.equal(result.effect_started, true);
    assert.equal(result.receipt_verified, undefined);
  });

  test("malformed JSON and missing Idempotency-Key stop before external calls", async (t) => {
    let externalCalls = 0;
    const { nativeFetch, origin } = await withServer(t, async () => {
      externalCalls += 1;
      return new Response("unexpected", { status: 500 });
    });
    const bad = await nativeFetch(`${origin}/api/action`, {
      method: "POST", headers: PRINCIPAL_HEADERS, body: "{",
    });
    assert.equal(bad.status, 400);
    const missingKey = await nativeFetch(`${origin}/api/action`, {
      method: "POST", headers: PRINCIPAL_HEADERS, body: JSON.stringify({}),
    });
    assert.equal(missingKey.status, 400);
    assert.equal(externalCalls, 0);
  });
});
