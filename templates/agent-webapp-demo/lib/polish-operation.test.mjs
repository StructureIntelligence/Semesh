import test from "node:test";
import assert from "node:assert/strict";

import {
  challengePreparedPolishRequestPersistence,
  createPolishRequest,
  explicitEffectZero,
  isCanonicalModelInputSchema,
  isCanonicalModelOutputSchema,
  mayClearPolishRecoveryAfterEffectZero,
  parsePolishRequest,
  POLISH_REQUEST_STORAGE_KEY,
  polishRequestStorageKey,
  projectCanonicalModelResult,
  readPolishRequestStorage,
  recoverPolishRequestStorage,
  removePolishRequestStorage,
  resolveStoredPolishRequest,
  selectCanonicalDeepSeekChoice,
  writePolishRequestStorage,
} from "./polish-operation.mjs";

const prepared = {
  version: 1,
  unit_action_ref: {
    unit_id: "unit_deepseek_text",
    unit_revision: "sha256:" + "1".repeat(64),
    action_id: "polish",
    action_revision: "sha256:" + "2".repeat(64),
  },
  catalog: {
    view_generation: 41,
    view_digest: "sha256:" + "a".repeat(64),
  },
  model_choice_pin: {
    model_id: "deepseek-v3",
    model_revision: "model.release.2026-09-02",
  },
  input: {
    messages: [
      {
        role: "system",
        content: "Tidy and clarify the user's snippet while preserving its meaning.",
      },
      { role: "user", content: "original input" },
    ],
  },
  quote_reference: "quote_123",
  quote: {
    quote_contract_version: "v1",
    quote_kind: "exact",
    currency: "aev",
    amount_aev_atoms: Number.MAX_SAFE_INTEGER,
    quote_reference: "quote_123",
    quote_receipt: "quote_receipt_123",
    input_digest: "sha256:" + "3".repeat(64),
    price_digest: "sha256:" + "4".repeat(64),
    policy_digest: "sha256:" + "5".repeat(64),
    effect_digest: "sha256:" + "6".repeat(64),
    model_choice_pin: {
      model_id: "deepseek-v3",
      model_revision: "model.release.2026-09-02",
    },
  },
  confirmed_effect_digest: null,
  deadline: "2030-01-01T00:00:00.000Z",
};

function controlledStorage(initialEntries = {}, behavior = {}) {
  const values = new Map(Object.entries(initialEntries));
  let setCalls = 0;
  return {
    getItem(key) {
      if (behavior.throwGet) throw new Error("get blocked");
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, nextValue) {
      setCalls += 1;
      if (behavior.throwSet) throw new Error("set blocked");
      if (!behavior.ignoreSet) values.set(key, nextValue);
    },
    removeItem(key) {
      if (behavior.throwRemove) throw new Error("remove blocked");
      if (!behavior.ignoreRemove) values.delete(key);
    },
    inspect(key) {
      return { value: values.has(key) ? values.get(key) : null, setCalls };
    },
  };
}

function preparedRequest(overrides = {}) {
  return {
    version: 2,
    persistenceEpoch: 0,
    effectMayHaveStarted: false,
    idempotencyKey: "polish-request:operation-123",
    input: "original input",
    principalId: "principal-a",
    prepared,
    ...overrides,
  };
}

const principalAStorageKey = polishRequestStorageKey("principal-a");
const principalBStorageKey = polishRequestStorageKey("principal-b");
assert.equal(typeof principalAStorageKey, "string");
assert.equal(typeof principalBStorageKey, "string");
assert.notEqual(principalAStorageKey, principalBStorageKey);
assert.notEqual(principalAStorageKey, POLISH_REQUEST_STORAGE_KEY);

test("effect-zero classification requires both effect and money state to be none", () => {
  assert.equal(explicitEffectZero({ effect_state: "none", money_state: "none" }), true);
  assert.equal(explicitEffectZero({ error: { effect_state: "none", money_state: "none" } }), true);
  for (const hostile of [
    { effect_started: false },
    { effect_state: "none" },
    { money_state: "none" },
    { effect_started: false, effect_state: "none", money_state: "held" },
    { error: { effect_started: false, effect_state: "none", money_state: "captured" } },
  ]) {
    assert.equal(explicitEffectZero(hostile), false);
  }
});

test("pending request keeps immutable input and a distinct replay key", () => {
  const request = createPolishRequest("original input", "principal-a");
  const parsed = parsePolishRequest(JSON.stringify(request), "principal-a");

  assert.equal(parsed.input, "original input");
  assert.match(parsed.idempotencyKey, /^polish-request:[A-Za-z0-9._:-]+$/);
  assert.equal(parsed.principalId, "principal-a");
});

test("prepared request, invocation observation id, and useful output survive reload", () => {
  const parsed = parsePolishRequest(
    JSON.stringify({
      version: 2,
      persistenceEpoch: 1,
      effectMayHaveStarted: true,
      idempotencyKey: "polish-request:operation-123",
      input: "original input",
      principalId: "principal-a",
      prepared,
      invocationId: "inv_abc12345",
      result: "valid provider output",
    }),
    "principal-a"
  );

  assert.equal(parsed.input, "original input");
  assert.equal(parsed.prepared.quote_reference, "quote_123");
  assert.deepEqual(parsed.prepared.model_choice_pin, prepared.model_choice_pin);
  assert.equal(parsed.prepared.quote.amount_aev_atoms, Number.MAX_SAFE_INTEGER);
  assert.equal(parsed.invocationId, "inv_abc12345");
  assert.equal(parsed.result, "valid provider output");
});

test("a valid stored invocation identity normalizes prior-effect recovery to true", () => {
  const parsed = parsePolishRequest(
    JSON.stringify(preparedRequest({
      effectMayHaveStarted: false,
      invocationId: "inv_abc12345",
    })),
    "principal-a"
  );

  assert.equal(parsed.invocationId, "inv_abc12345");
  assert.equal(parsed.effectMayHaveStarted, true);
});

test("request cannot cross principals, conflate ids, or drift from quoted input", () => {
  const serialized = JSON.stringify({
    version: 2,
    persistenceEpoch: 0,
    effectMayHaveStarted: false,
    idempotencyKey: "polish-request:operation-123",
    input: "original input",
    principalId: "principal-a",
  });
  assert.equal(parsePolishRequest(serialized, "principal-b"), null);
  assert.equal(
    parsePolishRequest(
      JSON.stringify({
        version: 2,
        persistenceEpoch: 1,
        effectMayHaveStarted: true,
        idempotencyKey: "polish-request:operation-123",
        input: "original input",
        principalId: "principal-a",
        prepared,
        invocationId: "polish-request:operation-123",
      }),
      "principal-a"
    ),
    null
  );
  assert.equal(
    parsePolishRequest(
      JSON.stringify({
        version: 2,
        persistenceEpoch: 1,
        effectMayHaveStarted: true,
        idempotencyKey: "inv_abc12345",
        input: "original input",
        principalId: "principal-a",
        prepared,
        invocationId: "inv_abc12345",
      }),
      "principal-a"
    ),
    null
  );
  assert.equal(
    parsePolishRequest(
      JSON.stringify({
        version: 2,
        persistenceEpoch: 0,
        effectMayHaveStarted: false,
        idempotencyKey: "polish-request:operation-123",
        input: "different input",
        principalId: "principal-a",
        prepared,
      }),
      "principal-a"
    ),
    null
  );
  for (const invalidAtoms of [Number.MAX_SAFE_INTEGER + 1, "3"]) {
    const malformed = JSON.parse(JSON.stringify(prepared));
    malformed.quote.amount_aev_atoms = invalidAtoms;
    assert.equal(
      parsePolishRequest(
        JSON.stringify({
          version: 2,
          persistenceEpoch: 0,
          effectMayHaveStarted: false,
          idempotencyKey: "polish-request:operation-123",
          input: "original input",
          principalId: "principal-a",
          prepared: malformed,
        }),
        "principal-a"
      ),
      null
    );
  }
});

test("stored request cleanup distinguishes absence from legacy or stale state", () => {
  assert.deepEqual(resolveStoredPolishRequest(null, "principal-b"), {
    request: null,
    shouldClear: false,
  });
  const stale = resolveStoredPolishRequest(
    JSON.stringify({
      id: "polish:operation-123",
      input: "original input",
      principalId: "principal-a",
    }),
    "principal-b"
  );
  assert.equal(stale.request, null);
  assert.equal(stale.shouldClear, true);
});

test("malformed scoped evidence plus failed removal hard-stops paid continuation", () => {
  const malformedBytes = JSON.stringify({ version: 2, malformed: true });
  const storage = controlledStorage(
    { [principalAStorageKey]: malformedBytes },
    { ignoreRemove: true }
  );

  assert.deepEqual(recoverPolishRequestStorage(storage, "principal-a"), {
    ok: true,
    request: null,
    shouldClear: true,
    hardStop: true,
    paidContinuationAllowed: false,
  });
  assert.deepEqual(storage.inspect(principalAStorageKey), {
    value: malformedBytes,
    setCalls: 0,
  });
});

test("browser storage helpers prove an exact scoped write, read, and removal", () => {
  const storage = controlledStorage();
  const request = preparedRequest();

  assert.equal(writePolishRequestStorage(storage, request), true);
  assert.deepEqual(readPolishRequestStorage(storage, "principal-a"), {
    ok: true,
    request,
    shouldClear: false,
  });
  assert.equal(removePolishRequestStorage(storage, "principal-a"), true);
  assert.deepEqual(storage.inspect(principalAStorageKey), { value: null, setCalls: 1 });
});

test("invoke persistence changes exact bytes and records that an effect may start", () => {
  const request = preparedRequest();
  const storage = controlledStorage({
    [principalAStorageKey]: JSON.stringify(request),
  });

  const proof = challengePreparedPolishRequestPersistence(storage, request);
  assert.equal(proof.ok, true);
  assert.equal(proof.restored, true);
  assert.equal(proof.request.persistenceEpoch, 1);
  assert.equal(proof.request.effectMayHaveStarted, true);
  assert.deepEqual(readPolishRequestStorage(storage, "principal-a").request, proof.request);
});

test("an identical stale prepared record cannot pass a silent no-op invoke challenge", () => {
  const request = preparedRequest();
  const staleBytes = JSON.stringify(request);
  const storage = controlledStorage(
    { [principalAStorageKey]: staleBytes },
    { ignoreSet: true }
  );

  const proof = challengePreparedPolishRequestPersistence(storage, request);
  assert.deepEqual(proof, { ok: false, request, restored: true });
  assert.deepEqual(storage.inspect(principalAStorageKey), {
    value: staleBytes,
    setCalls: 2,
  });
});

test("storage access that throws fails closed instead of escaping", () => {
  const writeBlocked = controlledStorage({}, { throwSet: true });
  assert.equal(writePolishRequestStorage(writeBlocked, preparedRequest()), false);

  const readBlocked = controlledStorage({}, { throwGet: true });
  assert.deepEqual(readPolishRequestStorage(readBlocked, "principal-a"), {
    ok: false,
    request: null,
    shouldClear: false,
  });
  assert.equal(removePolishRequestStorage(readBlocked, "principal-a"), false);
});

test("a failed learned-ID write can verified-invalidate the older no-ID record", () => {
  const noIdRecord = JSON.stringify(preparedRequest({
    persistenceEpoch: 1,
    effectMayHaveStarted: true,
  }));
  const storage = controlledStorage(
    { [principalAStorageKey]: noIdRecord },
    { ignoreSet: true }
  );
  const withId = preparedRequest({
    persistenceEpoch: 1,
    effectMayHaveStarted: true,
    invocationId: "inv_abc12345",
  });

  assert.equal(writePolishRequestStorage(storage, withId), false);
  assert.equal(removePolishRequestStorage(storage, "principal-a"), true);
  assert.deepEqual(storage.inspect(principalAStorageKey), { value: null, setCalls: 1 });
});

test("failed invalidation is detected while the unsafe older no-ID record remains", () => {
  const noIdRecord = JSON.stringify(preparedRequest({
    persistenceEpoch: 1,
    effectMayHaveStarted: true,
  }));
  const silentRemoval = controlledStorage(
    { [principalAStorageKey]: noIdRecord },
    { ignoreSet: true, ignoreRemove: true }
  );
  const withId = preparedRequest({
    persistenceEpoch: 1,
    effectMayHaveStarted: true,
    invocationId: "inv_abc12345",
  });

  assert.equal(writePolishRequestStorage(silentRemoval, withId), false);
  assert.equal(removePolishRequestStorage(silentRemoval, "principal-a"), false);
  assert.deepEqual(silentRemoval.inspect(principalAStorageKey), {
    value: noIdRecord,
    setCalls: 1,
  });

  const thrownRemoval = controlledStorage(
    { [principalAStorageKey]: noIdRecord },
    { throwRemove: true }
  );
  assert.equal(removePolishRequestStorage(thrownRemoval, "principal-a"), false);
});

test("an unprepared record cannot satisfy the paid invoke persistence proof", () => {
  const storage = controlledStorage();
  const request = createPolishRequest("original input", "principal-a");

  assert.deepEqual(challengePreparedPolishRequestPersistence(storage, request), {
    ok: false,
    request,
    restored: false,
  });
  assert.deepEqual(storage.inspect(principalAStorageKey), { value: null, setCalls: 0 });
});

test("principal-scoped records cannot be adopted or erased by an account switch", () => {
  const requestA = preparedRequest({
    persistenceEpoch: 1,
    effectMayHaveStarted: true,
    invocationId: "inv_abc12345",
  });
  const requestABytes = JSON.stringify(requestA);
  const storage = controlledStorage({ [principalAStorageKey]: requestABytes });

  assert.deepEqual(readPolishRequestStorage(storage, "principal-b"), {
    ok: true,
    request: null,
    shouldClear: false,
  });
  assert.equal(removePolishRequestStorage(storage, "principal-b"), true);
  assert.deepEqual(storage.inspect(principalAStorageKey), {
    value: requestABytes,
    setCalls: 0,
  });
  assert.deepEqual(readPolishRequestStorage(storage, "principal-a").request, requestA);
});

test("the former global v2 record is quarantined without deletion or execution", () => {
  const legacyBytes = JSON.stringify({
    version: 2,
    idempotencyKey: "polish-request:legacy-operation",
    input: "legacy evidence",
    principalId: "principal-a",
    prepared,
  });
  const storage = controlledStorage({ [POLISH_REQUEST_STORAGE_KEY]: legacyBytes });

  assert.deepEqual(readPolishRequestStorage(storage, "principal-a"), {
    ok: true,
    request: null,
    shouldClear: false,
  });
  assert.deepEqual(storage.inspect(POLISH_REQUEST_STORAGE_KEY), {
    value: legacyBytes,
    setCalls: 0,
  });
});

test("later pre-effect claims cannot clear prior possible-effect recovery", () => {
  const preEffectResponse = {
    effect_started: false,
    effect_state: "none",
    money_state: "none",
  };
  const knownIdObserve = preparedRequest({
    persistenceEpoch: 1,
    effectMayHaveStarted: true,
    invocationId: "inv_abc12345",
  });
  const priorUnknownRetry = preparedRequest({
    persistenceEpoch: 1,
    effectMayHaveStarted: true,
  });

  assert.equal(
    mayClearPolishRecoveryAfterEffectZero(knownIdObserve, preEffectResponse),
    false
  );
  assert.equal(
    mayClearPolishRecoveryAfterEffectZero(priorUnknownRetry, preEffectResponse),
    false
  );
  assert.equal(
    mayClearPolishRecoveryAfterEffectZero(preparedRequest(), preEffectResponse),
    true
  );
});

test("prepared request rejects extra fields, malformed pins, and malformed SHA-256 identities", () => {
  const mutations = [
    (value) => { value.extra = "not-canonical"; },
    (value) => { value.input.extra = "not-canonical"; },
    (value) => { value.quote.extra = "not-canonical"; },
    (value) => { value.unit_action_ref.extra = "not-canonical"; },
    (value) => { value.catalog.scope = "public"; },
    (value) => { value.model_choice_pin.model_id = "mistral"; },
    (value) => { value.model_choice_pin.model_revision = "model revision with spaces"; },
    (value) => { value.model_choice_pin.model_revision = "model.\u0085revision"; },
    (value) => { value.model_choice_pin.model_revision = "\u00a0model.release"; },
    (value) => { value.model_choice_pin.model_revision = "\u00e9".repeat(257); },
    (value) => { value.quote.model_choice_pin.model_revision = "model.release.2026-09-03"; },
    (value) => { value.model_choice = "deepseek-v3"; },
    (value) => { value.quote.model_choice = "deepseek-v3"; },
    (value) => { value.unit_action_ref.unit_revision = "sha256:short"; },
    (value) => { value.unit_action_ref.action_revision = "sha256:" + "G".repeat(64); },
    (value) => { value.catalog.view_digest = "sha256:not-hex"; },
    (value) => { value.quote.policy_digest = "sha256:short"; },
  ];
  for (const mutate of mutations) {
    const value = JSON.parse(JSON.stringify(prepared));
    mutate(value);
    assert.equal(
      parsePolishRequest(
        JSON.stringify({
          version: 2,
          persistenceEpoch: 0,
          effectMayHaveStarted: false,
          idempotencyKey: "polish-request:operation-123",
          input: "original input",
          principalId: "principal-a",
          prepared: value,
        }),
        "principal-a"
      ),
      null
    );
  }

  const unicodeWhitespace = JSON.parse(JSON.stringify(prepared));
  unicodeWhitespace.model_choice_pin.model_revision = "model.\u00a0release.2026-09-02";
  unicodeWhitespace.quote.model_choice_pin.model_revision = "model.\u00a0release.2026-09-02";
  assert.notEqual(
    parsePolishRequest(
      JSON.stringify({
        version: 2,
        persistenceEpoch: 0,
        effectMayHaveStarted: false,
        idempotencyKey: "polish-request:operation-123",
        input: "original input",
        principalId: "principal-a",
        prepared: unicodeWhitespace,
      }),
      "principal-a"
    ),
    null
  );
});

test("browser recovery record has one exact versioned schema", () => {
  const record = {
    version: 2,
    persistenceEpoch: 0,
    effectMayHaveStarted: false,
    idempotencyKey: "polish-request:operation-123",
    input: "original input",
    principalId: "principal-a",
    prepared,
    extra: "not-canonical",
  };
  assert.equal(parsePolishRequest(JSON.stringify(record), "principal-a"), null);
});

test("legacy text input and malformed chat messages cannot become an invoke request", () => {
  const mutations = [
    { text: "original input" },
    { messages: [{ role: "user", content: "original input" }] },
    {
      messages: [
        { role: "system", content: "Polish it." },
        { role: "user", content: "original input" },
      ],
      model_choice: "deepseek-v3",
    },
    {
      messages: [
        { role: "system", content: "Polish it." },
        { role: "assistant", content: "original input" },
      ],
    },
  ];
  for (const input of mutations) {
    const malformed = JSON.parse(JSON.stringify(prepared));
    malformed.input = input;
    assert.equal(
      parsePolishRequest(
        JSON.stringify({
          version: 2,
          persistenceEpoch: 0,
          effectMayHaveStarted: false,
          idempotencyKey: "polish-request:operation-123",
          input: "original input",
          principalId: "principal-a",
          prepared: malformed,
        }),
        "principal-a"
      ),
      null
    );
  }
});

test("only strict canonical assistant message and usage output is projected", () => {
  assert.deepEqual(
    projectCanonicalModelResult({
      message: { role: "assistant", content: "Polished output." },
      usage: { total_tokens: 17 },
    }),
    {
      message: { role: "assistant", content: "Polished output." },
      usage: { total_tokens: 17 },
    }
  );
  for (const hostile of [
    { text: "provider fallback" },
    { choices: [{ message: { role: "assistant", content: "provider fallback" } }] },
    { output: "provider fallback" },
    {
      message: { role: "user", content: "wrong role" },
      usage: { total_tokens: 1 },
    },
    {
      message: { role: "assistant", content: "extra" },
      usage: { total_tokens: 1 },
      choices: [],
    },
    {
      message: { role: "assistant", content: "unsafe usage" },
      usage: { total_tokens: Number.MAX_SAFE_INTEGER + 1 },
    },
    {
      message: { role: "assistant", content: "string usage" },
      usage: { total_tokens: "17" },
    },
    {
      message: { role: "assistant", content: "" },
      usage: { total_tokens: 0 },
    },
  ]) {
    assert.equal(projectCanonicalModelResult(hostile), null);
  }
});

test("Detail must advertise the one exact strict Model chat output schema", () => {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      message: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["assistant"] },
          content: { type: "string", minLength: 1 },
        },
        required: ["role", "content"],
        additionalProperties: false,
      },
      usage: {
        type: "object",
        properties: {
          total_tokens: { type: "integer", minimum: 0 },
        },
        required: ["total_tokens"],
        additionalProperties: false,
      },
    },
    required: ["message", "usage"],
    additionalProperties: false,
  };
  assert.equal(isCanonicalModelOutputSchema(schema), true);

  const constRole = JSON.parse(JSON.stringify(schema));
  constRole.properties.message.properties.role = { type: "string", const: "assistant" };
  const missingUsage = JSON.parse(JSON.stringify(schema));
  delete missingUsage.properties.usage;
  const openMessage = JSON.parse(JSON.stringify(schema));
  openMessage.properties.message.additionalProperties = true;
  const missingDialect = JSON.parse(JSON.stringify(schema));
  delete missingDialect.$schema;
  const looseContent = JSON.parse(JSON.stringify(schema));
  delete looseContent.properties.message.properties.content.minLength;
  const providerRole = JSON.parse(JSON.stringify(schema));
  providerRole.properties.message.properties.role.enum.push("tool");
  const extraTopLevelProperty = JSON.parse(JSON.stringify(schema));
  extraTopLevelProperty.properties.text = { type: "string" };
  for (const hostile of [
    constRole,
    missingUsage,
    openMessage,
    missingDialect,
    looseContent,
    providerRole,
    extraTopLevelProperty,
  ]) {
    assert.equal(isCanonicalModelOutputSchema(hostile), false);
  }
});

test("Detail input schema is messages-only and rejects in-input model selection", () => {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      messages: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            role: { type: "string", enum: ["system", "user", "assistant"] },
            content: { type: "string", minLength: 1 },
          },
          required: ["role", "content"],
          additionalProperties: false,
        },
      },
    },
    required: ["messages"],
    additionalProperties: false,
  };
  assert.equal(isCanonicalModelInputSchema(schema), true);

  const legacyChoice = JSON.parse(JSON.stringify(schema));
  legacyChoice.properties.model_choice = { type: "string", enum: ["deepseek-v3"] };
  legacyChoice.required.push("model_choice");
  const openInput = JSON.parse(JSON.stringify(schema));
  openInput.additionalProperties = true;
  const rawProviderRole = JSON.parse(JSON.stringify(schema));
  rawProviderRole.properties.messages.items.properties.role.enum.push("tool");
  const openMessage = JSON.parse(JSON.stringify(schema));
  openMessage.properties.messages.items.additionalProperties = true;
  const missingMinimum = JSON.parse(JSON.stringify(schema));
  delete missingMinimum.properties.messages.items.properties.content.minLength;
  const textInput = {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  };
  for (const hostile of [
    legacyChoice,
    openInput,
    rawProviderRole,
    openMessage,
    missingMinimum,
    textInput,
  ]) {
    assert.equal(isCanonicalModelInputSchema(hostile), false);
  }
});

test("Detail model choice must be an exact selectable target of this Action", () => {
  const inputSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      messages: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            role: { type: "string", enum: ["system", "user", "assistant"] },
            content: { type: "string", minLength: 1 },
          },
          required: ["role", "content"],
          additionalProperties: false,
        },
      },
    },
    required: ["messages"],
    additionalProperties: false,
  };
  const choice = {
    ref: prepared.model_choice_pin,
    name: "DeepSeek V3",
    description: "The advertised versioned Model choice.",
    selectable: true,
    callable: false,
    groups: [],
    targets: [
      {
        unit_action_ref: prepared.unit_action_ref,
        model_ref: prepared.model_choice_pin,
      },
    ],
  };
  const action = { input_schema: inputSchema, model_choices: [choice] };
  assert.deepEqual(
    selectCanonicalDeepSeekChoice(action, prepared.unit_action_ref),
    prepared.model_choice_pin
  );
  const unicodeChoice = JSON.parse(JSON.stringify(action));
  unicodeChoice.model_choices[0].ref.model_revision = "model.\u00a0release.2026-09-02";
  unicodeChoice.model_choices[0].targets[0].model_ref.model_revision =
    "model.\u00a0release.2026-09-02";
  assert.deepEqual(
    selectCanonicalDeepSeekChoice(unicodeChoice, prepared.unit_action_ref),
    { model_id: "deepseek-v3", model_revision: "model.\u00a0release.2026-09-02" }
  );

  const hostileMutations = [
    (value) => { value.model_choices = [{ provider: "deepseek", choices: ["deepseek-v3"] }]; },
    (value) => { value.model_choices[0].ref.provider = "deepseek"; },
    (value) => { value.model_choices.push(JSON.parse(JSON.stringify(value.model_choices[0]))); },
    (value) => { value.model_choices[0].selectable = false; },
    (value) => { value.model_choices[0].callable = true; },
    (value) => { value.model_choices[0].groups = ["provider-group"]; },
    (value) => { value.model_choices[0].targets = []; },
    (value) => { value.model_choices[0].targets[0].unit_action_ref.action_id = "other-action"; },
    (value) => { value.model_choices[0].targets[0].model_ref.model_revision = "model.release.2026-09-03"; },
    (value) => { value.model_choices[0].targets[0].provider = "deepseek"; },
    (value) => { value.model_choices[0].ref.model_revision = "provider revision"; },
    (value) => { value.model_choices[0].ref.model_revision = "\u00e9".repeat(257); },
    (value) => { value.input_schema.properties.model_choice = { type: "string" }; },
  ];
  for (const mutate of hostileMutations) {
    const hostile = JSON.parse(JSON.stringify(action));
    mutate(hostile);
    assert.equal(selectCanonicalDeepSeekChoice(hostile, prepared.unit_action_ref), null);
  }
});
