import { isValidIdempotencyKey, isValidInvocationId } from "./settlement.mjs";

export const POLISH_REQUEST_STORAGE_KEY = "semesh.snippet-vault.polish-request.v2";
const POLISH_REQUEST_STORAGE_SCOPE = `${POLISH_REQUEST_STORAGE_KEY}.principal.`;
const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const MODEL_ID = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export async function readBoundedJSONResponse(response, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("invalid response byte bound");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^[0-9]+$/.test(contentLength)) {
      throw new Error("invalid Content-Length");
    }
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared > maxBytes) {
      throw new Error("response too large");
    }
  }

  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  let completed = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        completed = true;
        break;
      }
      if (!(chunk.value instanceof Uint8Array)) {
        throw new Error("invalid response body chunk");
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error("response too large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the parse/size error; cancel is only best-effort cleanup.
      }
    }
    reader.releaseLock();
  }
  return text ? JSON.parse(text) : null;
}

function isDigest(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isRuntimeIdentity(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= 512 &&
    value === value.trim() &&
    !/[ \t\r\n]/.test(value) &&
    !/\p{Cc}/u.test(value)
  );
}

function isPrincipalId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= 512 &&
    !/\p{Cc}/u.test(value)
  );
}

export function polishRequestStorageKey(principalId) {
  if (!isPrincipalId(principalId)) return null;
  try {
    return POLISH_REQUEST_STORAGE_SCOPE + encodeURIComponent(principalId);
  } catch {
    return null;
  }
}

function isAtoms(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isMessage(value, role, maxLength) {
  return (
    isObject(value) &&
    hasExactKeys(value, ["role", "content"]) &&
    value.role === role &&
    typeof value.content === "string" &&
    value.content.length > 0 &&
    value.content.length <= maxLength
  );
}

function isCanonicalPolishInput(value) {
  return (
    isObject(value) &&
    hasExactKeys(value, ["messages"]) &&
    Array.isArray(value.messages) &&
    value.messages.length === 2 &&
    isMessage(value.messages[0], "system", 1000) &&
    isMessage(value.messages[1], "user", 10000)
  );
}

// Model output is a canonical projection, not an OpenAI/provider compatibility surface.
export function projectCanonicalModelResult(value) {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ["message", "usage"]) ||
    !isObject(value.message) ||
    !hasExactKeys(value.message, ["role", "content"]) ||
    value.message.role !== "assistant" ||
    typeof value.message.content !== "string" ||
    value.message.content.length === 0 ||
    value.message.content.length > 100000 ||
    !isObject(value.usage) ||
    !hasExactKeys(value.usage, ["total_tokens"]) ||
    !Number.isSafeInteger(value.usage.total_tokens) ||
    value.usage.total_tokens < 0
  ) {
    return null;
  }
  return {
    message: { role: "assistant", content: value.message.content },
    usage: { total_tokens: value.usage.total_tokens },
  };
}

export function explicitEffectZero(payload) {
  if (!isObject(payload)) return false;
  const error = isObject(payload.error) ? payload.error : null;
  const noEffectOrMoney = (value) =>
    isObject(value) && value.effect_state === "none" && value.money_state === "none";
  return noEffectOrMoney(payload) || noEffectOrMoney(error);
}

function hasExactRequiredFields(schema, fields) {
  if (!Array.isArray(schema.required)) return false;
  const actual = [...schema.required].sort();
  const expected = [...fields].sort();
  return (
    actual.length === expected.length &&
    actual.every((field, index) => typeof field === "string" && field === expected[index])
  );
}

export function isCanonicalModelInputSchema(schema) {
  if (
    !isObject(schema) ||
    !hasExactKeys(schema, ["$schema", "type", "properties", "required", "additionalProperties"]) ||
    schema.$schema !== JSON_SCHEMA_2020_12 ||
    schema.type !== "object" ||
    schema.additionalProperties !== false ||
    !hasExactRequiredFields(schema, ["messages"]) ||
    !isObject(schema.properties) ||
    !hasExactKeys(schema.properties, ["messages"])
  ) {
    return false;
  }
  const messages = schema.properties.messages;
  if (
    !isObject(messages) ||
    !hasExactKeys(messages, ["type", "minItems", "items"]) ||
    messages.type !== "array" ||
    messages.minItems !== 1 ||
    !isObject(messages.items) ||
    !hasExactKeys(messages.items, ["type", "properties", "required", "additionalProperties"]) ||
    messages.items.type !== "object" ||
    messages.items.additionalProperties !== false ||
    !hasExactRequiredFields(messages.items, ["role", "content"]) ||
    !isObject(messages.items.properties) ||
    !hasExactKeys(messages.items.properties, ["role", "content"])
  ) {
    return false;
  }
  const role = messages.items.properties.role;
  const content = messages.items.properties.content;
  return (
    isObject(role) &&
    hasExactKeys(role, ["type", "enum"]) &&
    role.type === "string" &&
    Array.isArray(role.enum) &&
    role.enum.length === 3 &&
    role.enum[0] === "system" &&
    role.enum[1] === "user" &&
    role.enum[2] === "assistant" &&
    isObject(content) &&
    hasExactKeys(content, ["type", "minLength"]) &&
    content.type === "string" &&
    content.minLength === 1
  );
}

export function isCanonicalModelOutputSchema(schema) {
  if (
    !isObject(schema) ||
    !hasExactKeys(schema, ["$schema", "type", "properties", "required", "additionalProperties"]) ||
    schema.$schema !== JSON_SCHEMA_2020_12 ||
    schema.type !== "object" ||
    schema.additionalProperties !== false ||
    !hasExactRequiredFields(schema, ["message", "usage"]) ||
    !isObject(schema.properties) ||
    !hasExactKeys(schema.properties, ["message", "usage"])
  ) {
    return false;
  }
  const message = schema.properties.message;
  const usage = schema.properties.usage;
  if (
    !isObject(message) ||
    !hasExactKeys(message, ["type", "properties", "required", "additionalProperties"]) ||
    message.type !== "object" ||
    message.additionalProperties !== false ||
    !hasExactRequiredFields(message, ["role", "content"]) ||
    !isObject(message.properties) ||
    !hasExactKeys(message.properties, ["role", "content"]) ||
    !isObject(message.properties.role) ||
    !hasExactKeys(message.properties.role, ["type", "enum"]) ||
    message.properties.role.type !== "string" ||
    !Array.isArray(message.properties.role.enum) ||
    message.properties.role.enum.length !== 1 ||
    message.properties.role.enum[0] !== "assistant" ||
    !isObject(message.properties.content) ||
    !hasExactKeys(message.properties.content, ["type", "minLength"]) ||
    message.properties.content.type !== "string" ||
    message.properties.content.minLength !== 1
  ) {
    return false;
  }
  return (
    isObject(usage) &&
    hasExactKeys(usage, ["type", "properties", "required", "additionalProperties"]) &&
    usage.type === "object" &&
    usage.additionalProperties === false &&
    hasExactRequiredFields(usage, ["total_tokens"]) &&
    isObject(usage.properties) &&
    hasExactKeys(usage.properties, ["total_tokens"]) &&
    isObject(usage.properties.total_tokens) &&
    hasExactKeys(usage.properties.total_tokens, ["type", "minimum"]) &&
    usage.properties.total_tokens.type === "integer" &&
    usage.properties.total_tokens.minimum === 0
  );
}

function advertisedModelChoicePin(value) {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ["model_id", "model_revision"]) ||
    typeof value.model_id !== "string" ||
    value.model_id.length > 128 ||
    !MODEL_ID.test(value.model_id) ||
    !isRuntimeIdentity(value.model_revision)
  ) {
    return null;
  }
  return { model_id: value.model_id, model_revision: value.model_revision };
}

function sameRef(left, right) {
  return (
    isRef(left) &&
    isRef(right) &&
    left.unit_id === right.unit_id &&
    left.unit_revision === right.unit_revision &&
    left.action_id === right.action_id &&
    left.action_revision === right.action_revision
  );
}

// A concrete model remains a nested choice of the selected Model Action. The ref is copied from
// Detail only after its selectable/non-callable placement targets this exact UnitActionRef.
export function selectCanonicalDeepSeekChoice(action, enclosingRef) {
  if (
    !isObject(action) ||
    !isRef(enclosingRef) ||
    !isCanonicalModelInputSchema(action.input_schema) ||
    !Array.isArray(action.model_choices) ||
    action.model_choices.length === 0 ||
    action.model_choices.length > 128
  ) {
    return null;
  }

  const seenRefs = new Set();
  let selected = null;
  for (const choice of action.model_choices) {
    if (!isObject(choice)) return null;
    const pin = advertisedModelChoicePin(choice.ref);
    if (!pin) return null;
    const refKey = `${pin.model_id}\u0000${pin.model_revision}`;
    if (seenRefs.has(refKey)) return null;
    seenRefs.add(refKey);
    if (pin.model_id === "deepseek-v3") {
      if (selected) return null;
      selected = { choice, pin };
    }
  }
  if (!selected) return null;

  const { choice, pin } = selected;
  if (
    choice.selectable !== true ||
    choice.callable !== false ||
    !Array.isArray(choice.groups) ||
    choice.groups.length !== 0 ||
    !Array.isArray(choice.targets) ||
    choice.targets.length === 0 ||
    choice.targets.length > 256
  ) {
    return null;
  }

  const seenTargets = new Set();
  let enclosingMatches = 0;
  for (const target of choice.targets) {
    if (!isObject(target) || !hasExactKeys(target, ["unit_action_ref", "model_ref"])) {
      return null;
    }
    const modelRef = advertisedModelChoicePin(target.model_ref);
    if (
      !isRef(target.unit_action_ref) ||
      !modelRef ||
      modelRef.model_id !== pin.model_id ||
      modelRef.model_revision !== pin.model_revision
    ) {
      return null;
    }
    const targetKey = [
      target.unit_action_ref.unit_id,
      target.unit_action_ref.unit_revision,
      target.unit_action_ref.action_id,
      target.unit_action_ref.action_revision,
      modelRef.model_id,
      modelRef.model_revision,
    ].join("\u0000");
    if (seenTargets.has(targetKey)) return null;
    seenTargets.add(targetKey);
    if (sameRef(target.unit_action_ref, enclosingRef)) enclosingMatches += 1;
  }
  return enclosingMatches === 1
    ? { model_id: "deepseek-v3", model_revision: pin.model_revision }
    : null;
}

function isRef(value) {
  return (
    isObject(value) &&
    Object.keys(value).length === 4 &&
    typeof value.unit_id === "string" &&
    value.unit_id.length > 0 &&
    value.unit_id.length <= 200 &&
    typeof value.action_id === "string" &&
    value.action_id.length > 0 &&
    value.action_id.length <= 200 &&
    isDigest(value.unit_revision) &&
    isDigest(value.action_revision)
  );
}

function isCatalog(value) {
  return (
    isObject(value) &&
    Object.keys(value).length === 2 &&
    Number.isSafeInteger(value.view_generation) &&
    value.view_generation > 0 &&
    isDigest(value.view_digest)
  );
}

function isModelChoicePin(value) {
  const pin = advertisedModelChoicePin(value);
  return pin !== null && pin.model_id === "deepseek-v3";
}

function isQuote(value, modelChoicePin, quoteReference) {
  if (!isObject(value)) return false;
  const expectedKeys = [
    "quote_contract_version",
    "quote_kind",
    "currency",
    "quote_reference",
    "quote_receipt",
    "input_digest",
    "price_digest",
    "policy_digest",
    "effect_digest",
    "model_choice_pin",
    ...(value.quote_kind === "exact"
      ? ["amount_aev_atoms"]
      : value.quote_kind === "hold_ceiling"
        ? ["ceiling_aev_atoms", "capture_basis"]
        : []),
  ];
  if (
    !hasExactKeys(value, expectedKeys) ||
    value.quote_contract_version !== "v1" ||
    (value.quote_kind !== "exact" && value.quote_kind !== "hold_ceiling") ||
    value.currency !== "aev" ||
    value.quote_reference !== quoteReference ||
    typeof value.quote_receipt !== "string" ||
    value.quote_receipt.length === 0 ||
    value.quote_receipt.length > 65536 ||
    !isDigest(value.input_digest) ||
    !isDigest(value.price_digest) ||
    !isDigest(value.policy_digest) ||
    !isDigest(value.effect_digest) ||
    !isModelChoicePin(value.model_choice_pin) ||
    value.model_choice_pin.model_id !== modelChoicePin.model_id ||
    value.model_choice_pin.model_revision !== modelChoicePin.model_revision
  ) {
    return false;
  }
  if (value.quote_kind === "exact") return isAtoms(value.amount_aev_atoms);
  return (
    isAtoms(value.ceiling_aev_atoms) &&
    value.ceiling_aev_atoms !== 0 &&
    value.capture_basis === "actual_usage"
  );
}

function isPreparedAction(value) {
  return (
    isObject(value) &&
    hasExactKeys(value, [
      "version",
      "unit_action_ref",
      "catalog",
      "model_choice_pin",
      "input",
      "quote_reference",
      "quote",
      "confirmed_effect_digest",
      "deadline",
    ]) &&
    value.version === 1 &&
    isRef(value.unit_action_ref) &&
    isCatalog(value.catalog) &&
    isModelChoicePin(value.model_choice_pin) &&
    isCanonicalPolishInput(value.input) &&
    typeof value.quote_reference === "string" &&
    value.quote_reference.length > 0 &&
    value.quote_reference.length <= 1024 &&
    isQuote(value.quote, value.model_choice_pin, value.quote_reference) &&
    value.confirmed_effect_digest === null &&
    typeof value.deadline === "string" &&
    Number.isFinite(Date.parse(value.deadline)) &&
    !("catalog_token" in value)
  );
}

export function createPolishRequest(input, principalId) {
  const idempotencyKey = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
    ? "polish-request:" + globalThis.crypto.randomUUID()
    : "polish-request:" + Date.now() + ":" + Math.random().toString(36).slice(2);
  return {
    version: 2,
    persistenceEpoch: 0,
    effectMayHaveStarted: false,
    idempotencyKey,
    input,
    principalId,
  };
}

// Search tokens stay server-side. The browser persists the quoted action/catalog/model pins and
// exact request so retries reuse the same body/key; invocationId is observation identity only.
export function parsePolishRequest(raw, principalId) {
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "version",
      "persistenceEpoch",
      "effectMayHaveStarted",
      "idempotencyKey",
      "input",
      "principalId",
      ...(value.prepared === undefined ? [] : ["prepared"]),
      ...(value.invocationId === undefined ? [] : ["invocationId"]),
      ...(value.result === undefined ? [] : ["result"]),
    ]) ||
    value.version !== 2 ||
    (value.persistenceEpoch !== 0 && value.persistenceEpoch !== 1) ||
    typeof value.effectMayHaveStarted !== "boolean" ||
    !isValidIdempotencyKey(value.idempotencyKey) ||
    typeof value.input !== "string" ||
    value.input.length === 0 ||
    value.input.length > 10000 ||
    !isPrincipalId(value.principalId) ||
    value.principalId !== principalId ||
    (value.prepared !== undefined && !isPreparedAction(value.prepared)) ||
    (value.prepared !== undefined && value.prepared.input.messages[1].content !== value.input) ||
    (value.invocationId !== undefined && !isValidInvocationId(value.invocationId)) ||
    (value.invocationId !== undefined && value.invocationId === value.idempotencyKey) ||
    (value.invocationId !== undefined && value.prepared === undefined) ||
    (value.effectMayHaveStarted && value.prepared === undefined) ||
    (value.result !== undefined &&
      (typeof value.result !== "string" || value.result.length > 100000))
  ) {
    return null;
  }
  return {
    version: 2,
    persistenceEpoch: value.persistenceEpoch,
    effectMayHaveStarted:
      value.invocationId === undefined ? value.effectMayHaveStarted : true,
    idempotencyKey: value.idempotencyKey,
    input: value.input,
    principalId: value.principalId,
    ...(value.prepared === undefined ? {} : { prepared: value.prepared }),
    ...(value.invocationId === undefined ? {} : { invocationId: value.invocationId }),
    ...(value.result === undefined ? {} : { result: value.result }),
  };
}

export function resolveStoredPolishRequest(raw, principalId) {
  if (raw == null) return { request: null, shouldClear: false };
  const request = parsePolishRequest(raw, principalId);
  return { request, shouldClear: request === null };
}

function exactSerializedPolishRequest(value) {
  try {
    if (!isObject(value) || typeof value.principalId !== "string") return null;
    const serialized = JSON.stringify(value);
    const parsed = parsePolishRequest(serialized, value.principalId);
    if (!parsed || JSON.stringify(parsed) !== serialized) return null;
    return serialized;
  } catch {
    return null;
  }
}

// Browser storage can throw (privacy/security settings) or silently ignore writes. Every helper
// therefore treats the storage object as hostile and verifies the exact post-operation value.
export function readPolishRequestStorage(storage, principalId) {
  try {
    if (!storage || typeof storage.getItem !== "function") {
      return { ok: false, request: null, shouldClear: false };
    }
    const storageKey = polishRequestStorageKey(principalId);
    if (storageKey === null) return { ok: false, request: null, shouldClear: false };
    const raw = storage.getItem(storageKey);
    return { ok: true, ...resolveStoredPolishRequest(raw, principalId) };
  } catch {
    return { ok: false, request: null, shouldClear: false };
  }
}

export function writePolishRequestStorage(storage, value) {
  try {
    if (
      !storage ||
      typeof storage.setItem !== "function" ||
      typeof storage.getItem !== "function"
    ) {
      return false;
    }
    const serialized = exactSerializedPolishRequest(value);
    if (serialized === null) return false;
    const storageKey = polishRequestStorageKey(value.principalId);
    if (storageKey === null) return false;
    storage.setItem(storageKey, serialized);
    return storage.getItem(storageKey) === serialized;
  } catch {
    return false;
  }
}

export function challengePreparedPolishRequestPersistence(storage, value) {
  if (
    !isObject(value) ||
    value.prepared === undefined ||
    (value.persistenceEpoch !== 0 && value.persistenceEpoch !== 1)
  ) {
    return { ok: false, request: value, restored: false };
  }
  const challenged = {
    ...value,
    persistenceEpoch: value.persistenceEpoch === 0 ? 1 : 0,
    effectMayHaveStarted: true,
  };
  if (writePolishRequestStorage(storage, challenged)) {
    return { ok: true, request: challenged, restored: true };
  }
  return {
    ok: false,
    request: value,
    restored: writePolishRequestStorage(storage, value),
  };
}

export function mayClearPolishRecoveryAfterEffectZero(request, payload) {
  return (
    isObject(request) &&
    request.effectMayHaveStarted === false &&
    request.invocationId === undefined &&
    explicitEffectZero(payload)
  );
}

export function removePolishRequestStorage(storage, principalId) {
  try {
    if (
      !storage ||
      typeof storage.removeItem !== "function" ||
      typeof storage.getItem !== "function"
    ) {
      return false;
    }
    const storageKey = polishRequestStorageKey(principalId);
    if (storageKey === null) return false;
    storage.removeItem(storageKey);
    return storage.getItem(storageKey) === null;
  } catch {
    return false;
  }
}

export function recoverPolishRequestStorage(storage, principalId) {
  const stored = readPolishRequestStorage(storage, principalId);
  if (!stored.shouldClear) {
    return {
      ...stored,
      hardStop: false,
      paidContinuationAllowed: true,
    };
  }
  if (removePolishRequestStorage(storage, principalId)) {
    return {
      ok: true,
      request: null,
      shouldClear: false,
      hardStop: false,
      paidContinuationAllowed: true,
    };
  }
  return {
    ...stored,
    hardStop: true,
    paidContinuationAllowed: false,
  };
}
