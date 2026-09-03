const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

process.env.SEMESH_APP_API_KEY = "test-runtime-key";
process.env.SEMESH_MODEL_CHOICE_ID = "deepseek-v3";
const {
  ProtocolError,
  invokePreparedModelAction,
  observePreparedModelAction,
  prepareCanonicalModelAction,
  server,
} = require("./server.js");

const sha = (digit) => `sha256:${digit.repeat(64)}`;
const ref = {
  unit_id: "model.service",
  unit_revision: sha("1"),
  action_id: "chat",
  action_revision: sha("2"),
};
const catalog = { view_generation: 7, view_digest: sha("3") };
const catalogIdentity = {
  tenant_id: "public",
  publication_id: "publication-model-v7",
  view_generation: catalog.view_generation,
  view_digest: catalog.view_digest,
};
const digests = {
  input_digest: sha("4"),
  price_digest: sha("5"),
  policy_digest: sha("6"),
  effect_digest: sha("7"),
};
const invocationId = "invocation-3f9f89f1";
const settlementReference = "settlement-c8c2f47a";
const quoteReference = "quote-1c915d5e";
const quoteReceipt = "quote-receipt-1c915d5e";
const modelChoicePin = {
  model_id: "deepseek-v3",
  model_revision: "deepseek-v3-2026-09-02",
};
const chatInputSchema = {
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

function chatInput(content = "hello") {
  return { messages: [{ role: "user", content }] };
}

function modelChoice(overrides = {}) {
  return {
    ref: modelChoicePin,
    name: "DeepSeek V3",
    description: "Versioned DeepSeek chat choice.",
    groups: [],
    selectable: true,
    callable: false,
    targets: [{ unit_action_ref: ref, model_ref: modelChoicePin }],
    ...overrides,
  };
}

function canonicalAction(overrides = {}) {
  return {
    id: "chat",
    callable: true,
    availability: "available",
    effect: { requires_confirmation: false },
    input_schema: chatInputSchema,
    model_choices: [modelChoice()],
    output_schema: {
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
    },
    unit_action_ref: ref,
    ...overrides,
  };
}

function detailEnvelope(action = canonicalAction(), overrides = {}) {
  return {
    success: true,
    data: { id: "model.service", kind: "unit", catalog, actions: [action], ...overrides },
    meta: { catalog_token: "catalog-token-v7", catalog_identity: catalogIdentity },
  };
}

function actionWithConstRoleSchema() {
  const action = canonicalAction();
  action.output_schema = JSON.parse(JSON.stringify(action.output_schema));
  action.output_schema.properties.message.properties.role = { type: "string", const: "assistant" };
  return action;
}

function quoteEnvelope(call, overrides = {}) {
  return {
    success: true,
    data: {
      quote_contract_version: "v1",
      quote_kind: "exact",
      currency: "aev",
      exists: true,
      callable: true,
      confirmation_required: false,
      unit_action_ref: ref,
      catalog,
      model_choice_pin: modelChoicePin,
      quote_reference: quoteReference,
      quote_receipt: quoteReceipt,
      input: call.body.input,
      amount_aev_atoms: 200000000,
      budget: call.body.budget,
      deadline: call.body.deadline,
      ...digests,
      ...overrides,
    },
  };
}

function receiptEnvelope(key, overrides = {}) {
  return {
    success: true,
    data: {
      unit_action_ref: ref,
      catalog,
      model_choice_pin: modelChoicePin,
      invocation_id: invocationId,
      idempotency_key: key,
      terminal_state: "succeeded",
      quote_reference: quoteReference,
      quote_receipt: quoteReceipt,
      settlement_reference: settlementReference,
      held_aev_atoms: 200000000,
      captured_aev_atoms: 200000000,
      released_aev_atoms: 0,
      ...digests,
      ...overrides,
    },
  };
}

function protocolMock(overrides = {}) {
  const records = [];
  const state = { currentKey: null };
  const reply = (name, fallback, call) => {
    const selected = Object.hasOwn(overrides, name) ? overrides[name] : fallback;
    const value = typeof selected === "function" ? selected(call, state) : selected;
    return value instanceof Response ? value : Response.json(value);
  };
  const mock = async (url, init = {}) => {
    const record = {
      url: String(url),
      method: init.method,
      headers: new Headers(init.headers),
      rawBody: init.body,
      body: init.body ? JSON.parse(init.body) : null,
      redirect: init.redirect,
      credentials: init.credentials,
      cache: init.cache,
    };
    records.push(record);
    if (/\/v1\/service-units\/search\?/.test(record.url)) return reply("search", {
      success: true,
      data: [{ id: "model.service", kind: "unit", matched_choice: "deepseek" }],
      meta: { catalog_token: "catalog-token-v7", catalog_identity: catalogIdentity },
    }, record);
    if (/\/v1\/service-units\/model\.service\?scope=public$/.test(record.url)) {
      return reply("detail", detailEnvelope(), record);
    }
    if (/\/quote$/.test(record.url)) return reply("quote", quoteEnvelope(record), record);
    if (/\/invoke$/.test(record.url)) {
      state.currentKey = record.headers.get("idempotency-key");
      return reply("invoke", {
        success: true,
        data: {
          unit_action_ref: ref,
          catalog,
          model_choice_pin: modelChoicePin,
          invocation_id: invocationId,
          input_digest: digests.input_digest,
          state: "succeeded",
          result: { message: { role: "assistant", content: "invoke output" }, usage: { total_tokens: 40 } },
          settlement_reference: settlementReference,
        },
      }, record);
    }
    if (/\/actions\/chat\/invocations\//.test(record.url)) return reply("observe", {
      success: true,
      data: {
        unit_action_ref: ref,
        catalog,
        model_choice_pin: modelChoicePin,
        invocation_id: invocationId,
        input_digest: digests.input_digest,
        state: "succeeded",
        result: { message: { role: "assistant", content: "trusted model output" }, usage: { total_tokens: 41 } },
        settlement_reference: settlementReference,
      },
    }, record);
    if (/\/v1\/invocations\/[^/]+\/receipt$/.test(record.url)) {
      return reply("receipt", receiptEnvelope(state.currentKey), record);
    }
    throw new Error(`unexpected request ${record.method} ${record.url}`);
  };
  return { records, mock };
}

test("persists quote-bound input and recovers a known Invocation with upstream GETs only", async (t) => {
  const nativeFetch = globalThis.fetch;
  const { records, mock } = protocolMock();
  globalThis.fetch = mock;
  t.after(() => { globalThis.fetch = nativeFetch; });

  const replayKey = "web-stable-request-0001";
  const prepared = await prepareCanonicalModelAction(
    { messages: [{ role: "user", content: "hello" }] }, "payer-session", replayKey
  );
  assert.equal(records.length, 3);
  assert.equal(new URL(records[0].url).pathname, "/v1/service-units/search");
  assert.equal(records[0].headers.has("authorization"), false);
  assert.equal(records[0].headers.has("x-semesh-payer"), false);
  assert.equal(records[1].headers.get("x-semesh-catalog-token"), "catalog-token-v7");
  assert.equal(records[1].headers.has("authorization"), false);
  assert.equal(records[2].headers.get("authorization"), "Bearer test-runtime-key");
  assert.equal(records[2].headers.get("x-semesh-payer"), "payer-session");
  for (const record of records) {
    assert.equal(record.redirect, "error");
    assert.equal(record.credentials, "omit");
    assert.equal(record.cache, "no-store");
  }
  assert.deepEqual(records[2].body.unit_action_ref, ref);
  assert.deepEqual(records[2].body.catalog, catalog);
  assert.deepEqual(records[2].body.model_choice_pin, modelChoicePin);
  assert.deepEqual(records[2].body.input, chatInput("hello"));
  assert.equal(Object.hasOwn(records[2].body.input, "model_choice"), false);
  assert.deepEqual(records[2].body.budget, { ceiling_aev_atoms: 5000000000 });
  assert.equal(records[2].body.deadline, prepared.deadline);
  assert.equal(prepared.idempotency_key, replayKey);
  assert.deepEqual(prepared.quote_evidence.unit_action_ref, ref);
  assert.deepEqual(prepared.quote_evidence.catalog, catalog);
  assert.deepEqual(prepared.quote_evidence.model_choice_pin, modelChoicePin);
  assert.deepEqual(prepared.quote_evidence.input, chatInput("hello"));
  assert.equal(prepared.quote_evidence.authorized_aev_atoms, 200000000);
  assert.deepEqual(
    Object.fromEntries(Object.keys(digests).map((field) => [field, prepared.quote_evidence[field]])),
    digests
  );

  const persisted = JSON.parse(JSON.stringify(prepared));
  const first = await invokePreparedModelAction(persisted, "payer-session", replayKey);
  const recoveryStart = records.length;
  const second = await observePreparedModelAction(persisted, "payer-session", replayKey, invocationId);
  const recovery = records.slice(recoveryStart);
  const invokes = records.filter((record) => /\/invoke$/.test(record.url));
  assert.equal(invokes.length, 1);
  assert.equal(invokes[0].rawBody, persisted.invoke_body);
  assert.equal(invokes[0].headers.get("idempotency-key"), replayKey);
  assert.deepEqual(recovery.map((record) => record.method), ["GET", "GET"]);
  assert.equal(recovery.some((record) => /\/invoke$|\/quote$|\/v1\/service-units\/search\?/.test(record.url)), false);
  assert.equal(records.filter((record) => /\/v1\/service-units\/search\?/.test(record.url)).length, 1);
  assert.equal(records.filter((record) => /\/quote$/.test(record.url)).length, 1);
  const invokeBody = JSON.parse(persisted.invoke_body);
  assert.deepEqual(Object.keys(invokeBody).sort(), [
    "catalog", "confirmed_effect_digest", "deadline", "input", "model_choice_pin", "quote_reference", "unit_action_ref",
  ].sort());
  assert.deepEqual(invokeBody.model_choice_pin, modelChoicePin);
  assert.deepEqual(invokeBody.input, chatInput("hello"));
  assert.equal(invokeBody.deadline, persisted.deadline);
  assert.equal(invokeBody.confirmed_effect_digest, null);
  assert.equal(first.invocation_id, invocationId);
  assert.notEqual(first.invocation_id, first.idempotency_key);
  assert.deepEqual(first, second);
  assert.equal(first.text, "trusted model output");
  assert.deepEqual(first.usage, { total_tokens: 41 });
  assert.deepEqual(first.model_choice_pin, modelChoicePin);
  assert.equal(first.terminal_state, "succeeded");
  assert.equal(first.captured_aev_atoms, 200000000);
  const invalidRecoveryStart = records.length;
  await assert.rejects(
    observePreparedModelAction(persisted, "payer-session", replayKey, replayKey),
    (error) => error instanceof ProtocolError && error.code === "invalid_invocation_identity"
  );
  assert.equal(records.length, invalidRecoveryStart);
});

test("the local observe handler performs exactly the canonical observation and receipt GETs", async () => {
  const nativeFetch = globalThis.fetch;
  const replayKey = "web-local-observe-0001";
  const fixture = protocolMock({ receipt: () => receiptEnvelope(replayKey) });
  globalThis.fetch = fixture.mock;
  let origin;
  try {
    const prepared = await prepareCanonicalModelAction(chatInput(), "payer-session", replayKey);
    fixture.records.length = 0;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    origin = `http://127.0.0.1:${address.port}`;
    const response = await nativeFetch(`${origin}/api/observe`, {
      method: "POST",
      headers: {
        Authorization: "Bearer payer-session",
        "Content-Type": "application/json",
        "Idempotency-Key": replayKey,
      },
      body: JSON.stringify({ prepared, invocation_id: invocationId }),
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.invocation_id, invocationId);
    assert.deepEqual(fixture.records.map((record) => [record.method, new URL(record.url).pathname]), [
      ["GET", `/v1/service-units/${ref.unit_id}/actions/${ref.action_id}/invocations/${invocationId}`],
      ["GET", `/v1/invocations/${invocationId}/receipt`],
    ]);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = nativeFetch;
  }
});

test("before an Invocation ID is known, same-key replay reuses byte-identical invoke bytes", async (t) => {
  const nativeFetch = globalThis.fetch;
  const fixture = protocolMock();
  globalThis.fetch = fixture.mock;
  t.after(() => { globalThis.fetch = nativeFetch; });

  const replayKey = "web-pre-id-replay-0001";
  const prepared = await prepareCanonicalModelAction(chatInput(), "payer-session", replayKey);
  const persisted = JSON.parse(JSON.stringify(prepared));
  await invokePreparedModelAction(persisted, "payer-session", replayKey);
  await invokePreparedModelAction(persisted, "payer-session", replayKey);

  const invokes = fixture.records.filter((record) => /\/invoke$/.test(record.url));
  assert.equal(invokes.length, 2);
  assert.equal(invokes[0].rawBody, persisted.invoke_body);
  assert.equal(invokes[1].rawBody, persisted.invoke_body);
  assert.equal(invokes[0].rawBody, invokes[1].rawBody);
  assert.equal(invokes[0].headers.get("idempotency-key"), replayKey);
  assert.equal(invokes[1].headers.get("idempotency-key"), replayKey);
  assert.equal(fixture.records.filter((record) => /\/v1\/service-units\/search\?/.test(record.url)).length, 1);
  assert.equal(fixture.records.filter((record) => /\/quote$/.test(record.url)).length, 1);
});

test("the real client persistence helper removes a stale no-ID record when storing the known ID fails", () => {
  const source = fs.readFileSync(require.resolve("./public/app.js"), "utf8");
  const prefixEnd = source.indexOf("const state =");
  assert.ok(prefixEnd > 0, "client helper prefix must remain extractable");

  const stale = { idempotencyKey: "web-storage-failure-0001", prompt: "hello", prepared: {}, invocationId: null };
  const request = { ...stale, invocationId };
  let stored = JSON.stringify(stale);
  const sessionStorage = {
    getItem: () => stored,
    setItem: (_key, value) => {
      if (JSON.parse(value).invocationId) return;
      stored = value;
    },
    removeItem: () => { stored = null; },
  };
  const document = { querySelector: () => ({}) };
  const loadHelper = new Function("sessionStorage", "document", `${source.slice(0, prefixEnd)}\nreturn persistKnownInvocation;`);
  const persistKnownInvocation = loadHelper(sessionStorage, document);

  assert.equal(persistKnownInvocation(request), "invalidated");
  assert.equal(stored, null, "the older executable no-ID record is removed");
  assert.equal(request.invocationId, invocationId, "the in-memory recovery identity is retained");
});

test("404, malformed, and oversized canonical reads fail before invoke without fallback", async (t) => {
  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  for (const [index, override] of [
    { search: new Response("not rolled out", { status: 404 }) },
    { detail: new Response("<html>bad detail</html>", { status: 200 }) },
    { quote: new Response("bad quote", { status: 200 }) },
    { quote: { quote_reference: quoteReference, amount_aev_atoms: 200000000 } },
    { search: new Response("{}", { status: 200, headers: { "content-length": "1048577" } }) },
  ].entries()) {
    const { records, mock } = protocolMock(override);
    globalThis.fetch = mock;
    await assert.rejects(
      prepareCanonicalModelAction(chatInput(), "payer-session", `web-stable-failure-000${index}`),
      (error) => error instanceof ProtocolError && error.beforeInvoke === true
    );
    assert.equal(records.some((record) => /\/invoke$/.test(record.url)), false);
  }
});

test("alternate projection names, Catalog drift, and unavailable Actions cannot reach quote", async (t) => {
  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  const driftCatalog = { view_generation: 7, view_digest: sha("8") };
  const fixtures = [
    { search: { success: true, data: [{ unit_id: "model.service", kind: "unit" }], meta: { catalog_token: "catalog-token-v7", catalog_identity: catalogIdentity } } },
    { detail: { ...detailEnvelope(), data: { unit_id: "model.service", type: "model", catalog, actions: [canonicalAction()] } } },
    { detail: detailEnvelope(canonicalAction(), { catalog: driftCatalog }) },
    { detail: detailEnvelope(canonicalAction({ callable: false })) },
    { detail: detailEnvelope(canonicalAction({ availability: "unavailable" })) },
    { detail: detailEnvelope(canonicalAction({ effect: { requires_confirmation: true } })) },
    { detail: detailEnvelope(canonicalAction({ effect: { confirmation_required: false } })) },
    { detail: detailEnvelope(canonicalAction({ unit_action_ref: { ...ref, action_revision: "sha256:not-a-digest" } })) },
    { detail: detailEnvelope(canonicalAction({ unit_action_ref: { ...ref, provider: "forbidden" } })) },
    { detail: detailEnvelope(canonicalAction({ input_schema: { ...chatInputSchema, required: ["messages", "model_choice"] } })) },
    { detail: detailEnvelope(canonicalAction({ input_schema: { ...chatInputSchema, properties: { messages: { type: "string" } } } })) },
    { detail: detailEnvelope(canonicalAction({ model_choices: [] })) },
    { detail: detailEnvelope(canonicalAction({ model_choices: [modelChoice(), modelChoice()] })) },
    { detail: detailEnvelope(canonicalAction({ model_choices: [modelChoice({ ref: { ...modelChoicePin, provider: "forbidden" } })] })) },
    { detail: detailEnvelope(canonicalAction({ model_choices: [modelChoice({ ref: { model_id: "other-model", model_revision: modelChoicePin.model_revision } })] })) },
    { detail: detailEnvelope(canonicalAction({ model_choices: [modelChoice({ targets: [{ unit_action_ref: { ...ref, action_id: "other" }, model_ref: modelChoicePin }] })] })) },
    { detail: detailEnvelope(canonicalAction({ model_choices: [modelChoice({ targets: [{ unit_action_ref: ref, model_ref: { ...modelChoicePin, model_revision: "other-revision" } }] })] })) },
    { detail: detailEnvelope(canonicalAction({ model_choices: [modelChoice({ targets: [
      { unit_action_ref: ref, model_ref: modelChoicePin },
      { unit_action_ref: { ...ref, action_id: "other" }, model_ref: { ...modelChoicePin, model_revision: "other-revision" } },
    ] })] })) },
    { detail: detailEnvelope(canonicalAction({ output_schema: { type: "object", required: ["content"], properties: { content: { type: "string" } } } })) },
    { detail: detailEnvelope(actionWithConstRoleSchema()) },
  ];
  for (const [index, overrides] of fixtures.entries()) {
    const fixture = protocolMock(overrides);
    globalThis.fetch = fixture.mock;
    await assert.rejects(
      prepareCanonicalModelAction(chatInput(), "payer-session", `web-hostile-shape-00${index}`),
      (error) => error instanceof ProtocolError && error.beforeInvoke
    );
    assert.equal(fixture.records.some((record) => /\/quote$/.test(record.url)), false);
  }
});

test("model choice fields inside canonical input fail closed before Search or quote", async (t) => {
  const nativeFetch = globalThis.fetch;
  const fixture = protocolMock();
  globalThis.fetch = fixture.mock;
  t.after(() => { globalThis.fetch = nativeFetch; });
  for (const [index, input] of [
    { ...chatInput(), model_choice: "deepseek-v3" },
    { ...chatInput(), model_choice_pin: modelChoicePin },
  ].entries()) {
    await assert.rejects(
      prepareCanonicalModelAction(input, "payer-session", `web-pin-in-input-000${index}`),
      (error) => error instanceof ProtocolError && error.code === "invalid_input" && error.beforeInvoke
    );
  }
  assert.equal(fixture.records.length, 0);
});

test("a malformed quote digest and a changed replay key are rejected before invoke", async (t) => {
  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  let fixture = protocolMock({ quote: (call) => quoteEnvelope(call, { input_digest: "sha256:1234" }) });
  globalThis.fetch = fixture.mock;
  await assert.rejects(
    prepareCanonicalModelAction(chatInput(), "payer-session", "web-bad-digest-0001"),
    (error) => error instanceof ProtocolError && error.code === "invalid_quote" && error.beforeInvoke
  );
  assert.equal(fixture.records.some((record) => /\/invoke$/.test(record.url)), false);

  for (const [index, input] of [
    undefined,
    chatInput("drifted"),
    { ...chatInput(), model_choice_pin: modelChoicePin },
  ].entries()) {
    fixture = protocolMock({ quote: (call) => quoteEnvelope(call, { input }) });
    globalThis.fetch = fixture.mock;
    await assert.rejects(
      prepareCanonicalModelAction(chatInput(), "payer-session", `web-bad-quote-input-00${index}`),
      (error) => error instanceof ProtocolError && error.code === "invalid_quote" && error.beforeInvoke
    );
    assert.equal(fixture.records.some((record) => /\/invoke$/.test(record.url)), false);
  }

  fixture = protocolMock({ quote: (call) => quoteEnvelope(call, {
    model_choice_pin: { ...modelChoicePin, model_revision: "drifted-revision" },
  }) });
  globalThis.fetch = fixture.mock;
  await assert.rejects(
    prepareCanonicalModelAction(chatInput(), "payer-session", "web-bad-choice-pin-0001"),
    (error) => error instanceof ProtocolError && error.code === "identity_drift" && error.beforeInvoke
  );
  assert.equal(fixture.records.some((record) => /\/invoke$/.test(record.url)), false);

  fixture = protocolMock();
  globalThis.fetch = fixture.mock;
  const prepared = await prepareCanonicalModelAction(chatInput(), "payer-session", "web-bound-key-0001");
  const count = fixture.records.length;
  await assert.rejects(
    invokePreparedModelAction(prepared, "payer-session", "web-changed-key-0001"),
    (error) => error instanceof ProtocolError && error.code === "invalid_prepared_request" && error.beforeInvoke
  );
  assert.equal(fixture.records.length, count);
  const tampered = JSON.parse(JSON.stringify(prepared));
  tampered.quote_evidence.quote_kind = "hold_ceiling";
  await assert.rejects(
    invokePreparedModelAction(tampered, "payer-session", "web-bound-key-0001"),
    (error) => error instanceof ProtocolError && error.code === "invalid_prepared_request" && error.beforeInvoke
  );
  assert.equal(fixture.records.length, count);
  const inputTampered = JSON.parse(JSON.stringify(prepared));
  inputTampered.quote_evidence.input.messages[0].content = "drifted";
  await assert.rejects(
    invokePreparedModelAction(inputTampered, "payer-session", "web-bound-key-0001"),
    (error) => error instanceof ProtocolError && error.code === "invalid_prepared_request" && error.beforeInvoke
  );
  assert.equal(fixture.records.length, count);
  await assert.rejects(
    invokePreparedModelAction(prepared, "different-payer", "web-bound-key-0001"),
    (error) => error instanceof ProtocolError && error.code === "invalid_prepared_request" && error.beforeInvoke
  );
  assert.equal(fixture.records.length, count);
});

test("invoke and observation must preserve the authenticated quote input digest", async (t) => {
  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  const key = "web-input-digest-chain-0001";
  let fixture = protocolMock();
  globalThis.fetch = fixture.mock;
  const prepared = await prepareCanonicalModelAction(chatInput(), "payer-session", key);
  const invokeWithDigest = (inputDigest) => ({ invoke: {
    success: true,
    data: {
      unit_action_ref: ref, catalog, model_choice_pin: modelChoicePin,
      invocation_id: invocationId, input_digest: inputDigest, settlement_reference: settlementReference,
    },
  } });
  const observationWithDigest = (inputDigest) => ({ observe: {
    success: true,
    data: {
      unit_action_ref: ref, catalog, model_choice_pin: modelChoicePin,
      invocation_id: invocationId, input_digest: inputDigest, state: "succeeded",
      result: { message: { role: "assistant", content: "wrong digest" }, usage: { total_tokens: 1 } },
      settlement_reference: settlementReference,
    },
  } });
  for (const [phase, overrides] of [
    ["invoke missing", invokeWithDigest(undefined)],
    ["invoke malformed", invokeWithDigest("sha256:short")],
    ["invoke drift", invokeWithDigest(sha("8"))],
    ["observation missing", observationWithDigest(undefined)],
    ["observation malformed", observationWithDigest("sha256:short")],
    ["observation drift", observationWithDigest(sha("8"))],
  ]) {
    fixture = protocolMock(overrides);
    globalThis.fetch = fixture.mock;
    await assert.rejects(
      invokePreparedModelAction(prepared, "payer-session", key),
      (error) => error instanceof ProtocolError && error.code === "input_digest_drift" && error.invocationId === invocationId
    );
    assert.equal(fixture.records.some((record) => /\/receipt$/.test(record.url)), false, phase);
    if (phase.startsWith("invoke")) assert.equal(fixture.records.some((record) => /\/actions\/chat\/invocations\//.test(record.url)), false);
  }
});

test("model revision limit is measured in UTF-8 bytes", async (t) => {
  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  for (const [index, [revision, accepted]] of [
    ["é".repeat(256), true],
    ["é".repeat(257), false],
  ].entries()) {
    const pin = { ...modelChoicePin, model_revision: revision };
    const choice = modelChoice({
      ref: pin,
      targets: [{ unit_action_ref: ref, model_ref: pin }],
    });
    const fixture = protocolMock({
      detail: detailEnvelope(canonicalAction({ model_choices: [choice] })),
      quote: (call) => quoteEnvelope(call, { model_choice_pin: pin }),
    });
    globalThis.fetch = fixture.mock;
    const key = `web-utf8-revision-000${index}`;
    if (accepted) {
      const prepared = await prepareCanonicalModelAction(chatInput(), "payer-session", key);
      assert.equal(prepared.quote_evidence.model_choice_pin.model_revision, revision);
    } else {
      await assert.rejects(
        prepareCanonicalModelAction(chatInput(), "payer-session", key),
        (error) => error instanceof ProtocolError && error.code === "model_choice_unavailable" && error.beforeInvoke
      );
      assert.equal(fixture.records.some((record) => /\/quote$/.test(record.url)), false);
    }
  }
});

test("invoke, observation, and receipt each reject model choice pin drift", async (t) => {
  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  const key = "web-choice-chain-0001";
  let fixture = protocolMock();
  globalThis.fetch = fixture.mock;
  const prepared = await prepareCanonicalModelAction(chatInput(), "payer-session", key);
  const driftedPin = { ...modelChoicePin, model_revision: "drifted-revision" };
  const hostilePhases = [
    { invoke: {
      success: true,
      data: {
        unit_action_ref: ref,
        catalog,
        model_choice_pin: driftedPin,
        invocation_id: invocationId,
        settlement_reference: settlementReference,
      },
    } },
    { observe: {
      success: true,
      data: {
        unit_action_ref: ref,
        catalog,
        model_choice_pin: driftedPin,
        invocation_id: invocationId,
        state: "succeeded",
        result: { message: { role: "assistant", content: "wrong pin" }, usage: { total_tokens: 1 } },
        settlement_reference: settlementReference,
      },
    } },
    { receipt: (_call, state) => receiptEnvelope(state.currentKey, { model_choice_pin: driftedPin }) },
  ];
  for (const [index, overrides] of hostilePhases.entries()) {
    fixture = protocolMock(overrides);
    globalThis.fetch = fixture.mock;
    await assert.rejects(
      invokePreparedModelAction(prepared, "payer-session", key),
      (error) => error instanceof ProtocolError && error.code === "identity_drift"
    );
    const callsAfterInvoke = fixture.records.slice(1);
    if (index === 0) assert.equal(callsAfterInvoke.length, 0);
  }
});

test("nested-only invocation identity is rejected immediately after invoke", async (t) => {
  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  const key = "web-nested-identity-0001";
  let fixture = protocolMock();
  globalThis.fetch = fixture.mock;
  const prepared = await prepareCanonicalModelAction(chatInput(), "payer-session", key);
  fixture = protocolMock({
    invoke: {
      success: true,
      data: {
        unit_action_ref: ref,
        catalog,
        model_choice_pin: modelChoicePin,
        invocation: { id: invocationId },
        settlement_reference: settlementReference,
      },
    },
  });
  globalThis.fetch = fixture.mock;
  await assert.rejects(
    invokePreparedModelAction(prepared, "payer-session", key),
    (error) => error instanceof ProtocolError && error.code === "invalid_invocation_identity" && error.invocationId === null
  );
  assert.equal(fixture.records.length, 1);
});

test("provider-shaped output cannot substitute for canonical result.message.content", async (t) => {
  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  const hostileResults = [
    { choices: [{ message: { content: "provider-shaped" } }] },
    { content: "provider-shaped" },
    { completion: "provider-shaped" },
    { output: { text: "provider-shaped" } },
  ];
  for (const [index, result] of hostileResults.entries()) {
    const key = `web-provider-result-000${index}`;
    let fixture = protocolMock();
    globalThis.fetch = fixture.mock;
    const prepared = await prepareCanonicalModelAction(chatInput(), "payer-session", key);
    fixture = protocolMock({ observe: {
      success: true,
      data: {
        unit_action_ref: ref,
        catalog,
        model_choice_pin: modelChoicePin,
        invocation_id: invocationId,
        input_digest: digests.input_digest,
        state: "succeeded",
        result,
        settlement_reference: settlementReference,
      },
    } });
    globalThis.fetch = fixture.mock;
    await assert.rejects(
      invokePreparedModelAction(prepared, "payer-session", key),
      (error) => error instanceof ProtocolError && error.code === "invalid_result_projection" && error.invocationId === invocationId
    );
    assert.equal(fixture.records.some((record) => /\/receipt$/.test(record.url)), false);
  }
});

test("receipt key/digest/authorization drift and unsafe or string atoms remain non-authoritative", async (t) => {
  const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; });
  const hostileReceipts = [
    () => receiptEnvelope("different-stable-key-0001"),
    (key) => receiptEnvelope(key, { policy_digest: sha("8") }),
    (key) => receiptEnvelope(key, { held_aev_atoms: 300000000, captured_aev_atoms: 300000000, released_aev_atoms: 0 }),
    (key) => receiptEnvelope(key, { held_aev_atoms: "200000000", captured_aev_atoms: "200000000", released_aev_atoms: "0" }),
    (key) => receiptEnvelope(key, { held_aev_atoms: Number.MAX_SAFE_INTEGER + 1, captured_aev_atoms: Number.MAX_SAFE_INTEGER + 1, released_aev_atoms: 0 }),
  ];
  for (const [index, receipt] of hostileReceipts.entries()) {
    const key = `web-hostile-receipt-00${index}`;
    const fixture = protocolMock({ receipt: (_call, state) => receipt(state.currentKey) });
    globalThis.fetch = fixture.mock;
    const prepared = await prepareCanonicalModelAction(chatInput(), "payer-session", key);
    await assert.rejects(
      invokePreparedModelAction(prepared, "payer-session", key),
      (error) => error instanceof ProtocolError && error.invocationId === invocationId
    );
  }
});

test("runtime source contains only the canonical Service Unit route family", () => {
  const source = fs.readFileSync(require.resolve("./server.js"), "utf8");
  const client = fs.readFileSync(require.resolve("./public/app.js"), "utf8");
  for (const fragment of ["/v1/" + "capabilities", "/v1/" + "billing/quote", "/v1/" + "services/"]) {
    assert.equal(source.includes(fragment), false, fragment);
  }
  assert.equal(source.includes("x-semesh-" + "charged-aev"), false);
  assert.match(source, /\/api\/observe/);
  assert.match(client, /observing \? "\/api\/observe" : "\/api\/invoke"/);
  assert.match(client, /Observe same invocation/);
});
