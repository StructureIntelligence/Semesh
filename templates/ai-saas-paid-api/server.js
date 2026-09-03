// ai-saas-paid-api — one versioned DeepSeek model choice inside Semesh's single Model Service Unit.
// Public Search and token-pinned public Unit detail are anonymous. Quote, invoke, Invocation
// observation, and terminal receipt authenticate the app and forward the signed-in payer.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");

const PORT = process.env.PORT || 8080;
const BASE = (process.env.SEMESH_BASE_URL || "https://api.semesh.net").replace(/\/+$/, "");
const RUNTIME_KEY = process.env.SEMESH_APP_API_KEY || process.env.SEMESH_API_KEY || "";
const MODEL_SEARCH_QUERY = process.env.SEMESH_MODEL_SEARCH_QUERY || "DeepSeek text generation";
const MODEL_ACTION_ID = process.env.SEMESH_MODEL_ACTION_ID || "chat";
const MODEL_CHOICE_ID = process.env.SEMESH_MODEL_CHOICE_ID || "deepseek-v3";
const configuredBudget = Number(process.env.SEMESH_BUDGET_CEILING_AEV_ATOMS || "5000000000");
const BUDGET_CEILING_AEV_ATOMS = Number.isSafeInteger(configuredBudget) && configuredBudget > 0
  ? configuredBudget
  : null;
const MAX_PROMPT_CHARS = 2000;
const REQUEST_TIMEOUT_MS = 60 * 1000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const PRICE_ESTIMATE_AEV = Number(process.env.PRICE_ESTIMATE_AEV || 2);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/;
const DIGEST_FIELDS = ["input_digest", "price_digest", "policy_digest", "effect_digest"];
const TERMINAL_STATES = new Set(["succeeded", "failed", "canceled"]);
const PREPARED_SEAL = /^hmac-sha256:[0-9a-f]{64}$/;
const CHAT_INPUT_SCHEMA_V1 = {
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
const CHAT_OUTPUT_SCHEMA_V1 = {
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

class ProtocolError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.status = options.status || 502;
    this.beforeInvoke = !!options.beforeInvoke;
    this.invocationId = options.invocationId || null;
  }
}

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function payerToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const cookies = parseCookies(req.headers.cookie);
  return cookies.__semesh_session || cookies.__semesh_access || "";
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function payload(json) {
  return isObject(json) && isObject(json.data) ? json.data : null;
}

function exactIdentity(value, max = 256) {
  return typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim();
}

function exactRuntimeIdentity(value) {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 512 &&
    value === value.trim() && !/[ \t\r\n]/.test(value) && !/\p{Cc}/u.test(value);
}

function exactModelId(value) {
  return typeof value === "string" && value.length <= 128 &&
    /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value);
}

function exactModelChoicePin(value) {
  return isObject(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), ["model_id", "model_revision"]) &&
    exactModelId(value.model_id) && exactRuntimeIdentity(value.model_revision);
}

function atomNumber(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function exactCatalog(value) {
  return isObject(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), ["view_digest", "view_generation"]) &&
    Number.isSafeInteger(value.view_generation) && value.view_generation > 0 &&
    SHA256_ID.test(value.view_digest);
}

function catalogIdentityPin(value) {
  if (!isObject(value) || !Number.isSafeInteger(value.view_generation) || value.view_generation <= 0 ||
      !SHA256_ID.test(value.view_digest)) return null;
  return { view_generation: value.view_generation, view_digest: value.view_digest };
}

function exactDigests(value) {
  if (!isObject(value) || !isDeepStrictEqual(Object.keys(value).sort(), [...DIGEST_FIELDS].sort())) return false;
  return DIGEST_FIELDS.every((field) => SHA256_ID.test(value[field]));
}

function sealPrepared(prepared, payer) {
  const material = JSON.stringify({
    action_path: prepared.action_path,
    invoke_body: prepared.invoke_body,
    deadline: prepared.deadline,
    idempotency_key: prepared.idempotency_key,
    quote_evidence: prepared.quote_evidence,
    quoted_aev_atoms: prepared.quoted_aev_atoms,
    topup: prepared.topup,
  });
  return `hmac-sha256:${crypto.createHmac("sha256", RUNTIME_KEY).update(payer).update("\0").update(material).digest("hex")}`;
}

function assertObject(value, code, message, options) {
  if (!isObject(value)) throw new ProtocolError(code, message, options);
  return value;
}

async function fetchJSON(method, route, options = {}) {
  const headers = {};
  if (options.authenticated) {
    if (!RUNTIME_KEY || !options.payer) {
      throw new ProtocolError("authentication_unavailable", "The authenticated payer rail is unavailable.", {
        beforeInvoke: !!options.beforeInvoke,
        status: 500,
      });
    }
    headers.Authorization = `Bearer ${RUNTIME_KEY}`;
    headers["X-Semesh-Payer"] = options.payer;
  }
  if (options.catalogToken) headers["X-Semesh-Catalog-Token"] = options.catalogToken;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  if (options.body !== undefined || options.bodyText !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(BASE + route, {
      method,
      headers,
      body: options.bodyText !== undefined
        ? options.bodyText
        : (options.body === undefined ? undefined : JSON.stringify(options.body)),
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
  } catch (error) {
    throw new ProtocolError("platform_unreachable", `Semesh request failed: ${String(error && error.message || error)}`, {
      beforeInvoke: !!options.beforeInvoke,
      invocationId: options.invocationId,
    });
  } finally {
    clearTimeout(timer);
  }

  const advertisedLength = response.headers.get("content-length");
  if (advertisedLength !== null && (!/^(0|[1-9][0-9]*)$/.test(advertisedLength) ||
      BigInt(advertisedLength) > BigInt(MAX_RESPONSE_BYTES))) {
    throw new ProtocolError("response_too_large", "Semesh returned an invalid or oversized protocol response.", {
      beforeInvoke: !!options.beforeInvoke, invocationId: options.invocationId,
    });
  }
  const chunks = [];
  let received = 0;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ProtocolError("response_too_large", "Semesh returned an oversized protocol response.", {
          beforeInvoke: !!options.beforeInvoke, invocationId: options.invocationId,
        });
      }
      chunks.push(value);
    }
  }
  const rawBytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { rawBytes.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
  let json;
  try { json = JSON.parse(raw); } catch {
    throw new ProtocolError("malformed_platform_response", "Semesh returned a non-JSON protocol response; no fallback was attempted.", {
      beforeInvoke: !!options.beforeInvoke,
      invocationId: options.invocationId,
    });
  }
  if (!response.ok || !isObject(json) || json.success !== true) {
    throw new ProtocolError(
      response.status === 404 ? "canonical_contract_unavailable" : "platform_rejected_request",
      response.status === 404
        ? "The canonical Service Unit route is not available; the call stopped without a legacy fallback."
        : `Semesh rejected the ${options.phase || "request"} request.`,
      { status: response.status, beforeInvoke: !!options.beforeInvoke, invocationId: options.invocationId }
    );
  }
  return json;
}

function searchItems(json) {
  return Array.isArray(json.data) ? json.data : null;
}

function validChatInput(value) {
  return isObject(value) && isDeepStrictEqual(Object.keys(value), ["messages"]) &&
    Array.isArray(value.messages) && value.messages.length > 0 &&
    value.messages.every((message) => isObject(message) &&
      isDeepStrictEqual(Object.keys(message).sort(), ["content", "role"]) &&
      ["system", "user", "assistant"].includes(message.role) &&
      typeof message.content === "string" && message.content.length > 0);
}

function validUnitActionRef(value) {
  return isObject(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), ["action_id", "action_revision", "unit_id", "unit_revision"]) &&
    exactIdentity(value.unit_id) && exactIdentity(value.action_id) &&
    SHA256_ID.test(value.unit_revision) && SHA256_ID.test(value.action_revision);
}

function selectedModelChoicePin(action, enclosingRef) {
  if (!isDeepStrictEqual(action.input_schema, CHAT_INPUT_SCHEMA_V1) ||
      !Array.isArray(action.model_choices) || action.model_choices.length === 0 ||
      action.model_choices.length > 128 || !exactModelId(MODEL_CHOICE_ID)) return null;

  const seenRefs = new Set();
  for (const entry of action.model_choices) {
    if (!isObject(entry) || !exactModelChoicePin(entry.ref)) return null;
    const encodedRef = `${entry.ref.model_id}\0${entry.ref.model_revision}`;
    if (seenRefs.has(encodedRef)) return null;
    seenRefs.add(encodedRef);
  }
  const matches = action.model_choices.filter((entry) => entry.ref.model_id === MODEL_CHOICE_ID);
  if (matches.length !== 1) return null;
  const selected = matches[0];
  if (selected.selectable !== true || selected.callable !== false ||
      !Array.isArray(selected.groups) || selected.groups.length !== 0 ||
      !Array.isArray(selected.targets) || selected.targets.length === 0 || selected.targets.length > 32) return null;
  const seenTargets = new Set();
  let enclosingMatches = 0;
  for (const target of selected.targets) {
    if (!isObject(target) ||
        !isDeepStrictEqual(Object.keys(target).sort(), ["model_ref", "unit_action_ref"]) ||
        !validUnitActionRef(target.unit_action_ref) || !exactModelChoicePin(target.model_ref) ||
        !isDeepStrictEqual(target.model_ref, selected.ref)) return null;
    const targetRef = target.unit_action_ref;
    const encodedTarget = `${targetRef.unit_id}\0${targetRef.unit_revision}\0${targetRef.action_id}\0${targetRef.action_revision}`;
    if (seenTargets.has(encodedTarget)) return null;
    seenTargets.add(encodedTarget);
    if (isDeepStrictEqual(target.unit_action_ref, enclosingRef) &&
        isDeepStrictEqual(target.model_ref, selected.ref)) enclosingMatches += 1;
  }
  return enclosingMatches === 1
    ? { model_id: selected.ref.model_id, model_revision: selected.ref.model_revision }
    : null;
}

function validChatOutputSchema(action) {
  return isDeepStrictEqual(action.output_schema, CHAT_OUTPUT_SCHEMA_V1);
}

async function discoverModelAction() {
  const params = new URLSearchParams({ q: MODEL_SEARCH_QUERY, scope: "public" });
  const search = await fetchJSON("GET", `/v1/service-units/search?${params}`, { phase: "public Search", beforeInvoke: true });
  const items = searchItems(search);
  const meta = assertObject(search.meta, "invalid_search_contract", "Search omitted its Catalog metadata.", { beforeInvoke: true });
  const searchCatalog = catalogIdentityPin(meta.catalog_identity);
  if (!Array.isArray(items)) throw new ProtocolError("invalid_search_contract", "Search did not return a bounded result list.", { beforeInvoke: true });
  if (!exactIdentity(meta.catalog_token, 4096) || !searchCatalog) {
    throw new ProtocolError("invalid_search_contract", "Search omitted its bounded Catalog token or identity.", { beforeInvoke: true });
  }
  const modelUnits = items.filter((item) => isObject(item) && item.kind === "unit");
  if (modelUnits.length !== 1 || !exactIdentity(modelUnits[0].id)) {
    throw new ProtocolError("model_unit_ambiguous", "Search must resolve exactly one public Model Service Unit.", { beforeInvoke: true });
  }
  const unitId = modelUnits[0].id;

  const detail = await fetchJSON("GET", `/v1/service-units/${encodeURIComponent(unitId)}?scope=public`, {
    phase: "token-pinned Unit detail", catalogToken: meta.catalog_token, beforeInvoke: true,
  });
  const detailMeta = assertObject(detail.meta, "invalid_detail_contract", "Unit detail omitted Catalog metadata.", { beforeInvoke: true });
  const detailCatalog = catalogIdentityPin(detailMeta.catalog_identity);
  if (detailMeta.catalog_token !== meta.catalog_token || !detailCatalog ||
      !isDeepStrictEqual(detailMeta.catalog_identity, meta.catalog_identity)) {
    throw new ProtocolError("catalog_view_drift", "Search and Unit detail do not identify the same Catalog view.", { beforeInvoke: true });
  }
  const unit = assertObject(payload(detail), "invalid_detail_contract", "Unit detail is malformed.", { beforeInvoke: true });
  if (unit.id !== unitId || unit.kind !== "unit") {
    throw new ProtocolError("invalid_detail_contract", "Detail is not the exact Model Unit returned by Search.", { beforeInvoke: true });
  }
  if (!Array.isArray(unit.actions)) throw new ProtocolError("invalid_detail_contract", "Model Unit detail omitted nested Actions.", { beforeInvoke: true });
  const actions = unit.actions.filter((entry) => isObject(entry) && entry.id === MODEL_ACTION_ID);
  if (actions.length !== 1) {
    throw new ProtocolError("model_action_ambiguous", "The pinned Model Unit must advertise one exact requested Action.", { beforeInvoke: true });
  }
  const action = actions[0];
  if (!isObject(action.unit_action_ref)) {
    throw new ProtocolError("invalid_action_reference", "The nested Action omitted an exact UnitActionRef.", { beforeInvoke: true });
  }
  const ref = action.unit_action_ref;
  if (!validUnitActionRef(ref) || ref.unit_id !== unitId || ref.action_id !== MODEL_ACTION_ID) {
    throw new ProtocolError("invalid_action_reference", "The Action path and UnitActionRef do not match.", { beforeInvoke: true });
  }
  if (action.callable !== true || action.availability !== "available" || !isObject(action.effect) ||
      action.effect.requires_confirmation !== false || !validChatOutputSchema(action)) {
    throw new ProtocolError("model_action_unavailable", "The selected Action is not explicitly callable, available, and confirmation-free.", { beforeInvoke: true });
  }
  const catalog = unit.catalog;
  if (!exactCatalog(catalog) || !isDeepStrictEqual(catalog, searchCatalog) ||
      !isDeepStrictEqual(catalog, detailCatalog)) {
    throw new ProtocolError("invalid_catalog", "Unit detail Catalog pin does not match the pinned Search view.", { beforeInvoke: true });
  }

  const modelChoicePin = selectedModelChoicePin(action, ref);
  if (!modelChoicePin) {
    throw new ProtocolError("model_choice_unavailable", "The requested DeepSeek choice is not one exact advertised model choice placed under this Action.", { beforeInvoke: true });
  }
  return { unitId, actionId: ref.action_id, unitActionRef: ref, catalog, modelChoicePin };
}

function assertPinnedPayload(data, expected, phase, invocationId) {
  if (!isDeepStrictEqual(data.unit_action_ref, expected.unitActionRef) ||
      !isDeepStrictEqual(data.catalog, expected.catalog) ||
      !isDeepStrictEqual(data.model_choice_pin, expected.modelChoicePin)) {
    throw new ProtocolError("identity_drift", `${phase} did not preserve the exact Action, Catalog, and model choice pins.`, {
      beforeInvoke: phase === "quote", invocationId,
    });
  }
}

function assertExecutionEvidence(data, expected, phase, invocationId) {
  assertPinnedPayload(data, expected, phase, invocationId);
  if (!SHA256_ID.test(data.input_digest) || data.input_digest !== expected.quoteEvidence.input_digest) {
    throw new ProtocolError("input_digest_drift", `${phase} did not preserve the authenticated quote input_digest.`, {
      invocationId,
    });
  }
}

function invocationIdentity(data) {
  return data.invocation_id;
}

function receiptEvidence(json, expected) {
  const data = assertObject(payload(json), "invalid_receipt", "The canonical receipt response is malformed.", { invocationId: expected.invocationId });
  assertPinnedPayload(data, expected, "receipt", expected.invocationId);
  const quote = expected.quoteEvidence;
  if (invocationIdentity(data) !== expected.invocationId || data.idempotency_key !== expected.idempotencyKey ||
      data.invocation_id === data.idempotency_key) {
    throw new ProtocolError("receipt_identity_drift", "Receipt invocation and replay identities do not match the request.", { invocationId: expected.invocationId });
  }
  if (!TERMINAL_STATES.has(data.terminal_state) || data.terminal_state !== expected.terminalState ||
      !exactIdentity(data.settlement_reference) || data.settlement_reference !== expected.settlementReference ||
      data.quote_reference !== quote.quote_reference || data.quote_receipt !== quote.quote_receipt) {
    throw new ProtocolError("receipt_reference_drift", "Receipt terminal, quote, or settlement references drifted.", { invocationId: expected.invocationId });
  }
  for (const field of DIGEST_FIELDS) {
    if (!SHA256_ID.test(data[field]) || data[field] !== quote[field]) {
      throw new ProtocolError("receipt_digest_drift", `Receipt ${field} differs from the authenticated quote.`, { invocationId: expected.invocationId });
    }
  }
  const normalized = {};
  for (const key of ["held_aev_atoms", "captured_aev_atoms", "released_aev_atoms"]) {
    normalized[key] = atomNumber(data[key]);
    if (normalized[key] === null) {
      throw new ProtocolError("invalid_receipt_atoms", `Receipt ${key} is not a non-negative integer atom.`, { invocationId: expected.invocationId });
    }
  }
  const held = normalized.held_aev_atoms;
  const captured = normalized.captured_aev_atoms;
  const released = normalized.released_aev_atoms;
  const authorized = quote.authorized_aev_atoms;
  const accounted = captured + released;
  if (!Number.isSafeInteger(accounted) || held !== authorized || captured > authorized || accounted !== held) {
    throw new ProtocolError("invalid_receipt_atoms", "Receipt atoms exceed, drift from, or fail to conserve the authenticated quote authorization.", { invocationId: expected.invocationId });
  }
  if (data.terminal_state === "succeeded" && quote.quote_kind === "exact" &&
      (captured !== authorized || released !== 0)) {
    throw new ProtocolError("invalid_receipt_atoms", "A terminal receipt for a successful Invocation under an exact quote must show exactly its authorized atoms captured.", { invocationId: expected.invocationId });
  }
  if (data.terminal_state !== "succeeded" && (captured !== 0 || released !== authorized)) {
    throw new ProtocolError("invalid_receipt_atoms", "A definite failure must fully release its authorization without capture.", { invocationId: expected.invocationId });
  }
  return {
    terminal_state: data.terminal_state,
    settlement_status: data.terminal_state === "succeeded" ? "captured" : "released",
    held_aev_atoms: normalized.held_aev_atoms,
    captured_aev_atoms: normalized.captured_aev_atoms,
    released_aev_atoms: normalized.released_aev_atoms,
  };
}

function canonicalChatResult(value) {
  if (!isObject(value) || !isDeepStrictEqual(Object.keys(value).sort(), ["message", "usage"]) ||
      !isObject(value.message) || !isDeepStrictEqual(Object.keys(value.message).sort(), ["content", "role"]) ||
      value.message.role !== "assistant" || typeof value.message.content !== "string" || value.message.content.length === 0 ||
      !isObject(value.usage) || !isDeepStrictEqual(Object.keys(value.usage), ["total_tokens"]) ||
      !Number.isSafeInteger(value.usage.total_tokens) || value.usage.total_tokens < 0) return null;
  return value;
}

function extractText(value) {
  const result = canonicalChatResult(value);
  return result ? result.message.content : null;
}

async function prepareCanonicalModelAction(input, payer, idempotencyKey) {
  if (BUDGET_CEILING_AEV_ATOMS === null) {
    throw new ProtocolError("invalid_budget", "SEMESH_BUDGET_CEILING_AEV_ATOMS must be a positive integer.", { beforeInvoke: true });
  }
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new ProtocolError("invalid_idempotency_key", "One stable Idempotency-Key must be fixed before quote.", { beforeInvoke: true });
  }
  if (!validChatInput(input)) {
    throw new ProtocolError("invalid_input", "Input must match the exact messages-only chat schema; model choice is a sibling pin.", { beforeInvoke: true });
  }
  const selected = await discoverModelAction();
  const deadline = new Date(Date.now() + (2 * REQUEST_TIMEOUT_MS)).toISOString();
  const canonicalInput = input;
  const quoteBody = {
    unit_action_ref: selected.unitActionRef,
    catalog: selected.catalog,
    model_choice_pin: selected.modelChoicePin,
    input: canonicalInput,
    budget: { ceiling_aev_atoms: BUDGET_CEILING_AEV_ATOMS },
    deadline,
  };
  const basePath = `/v1/service-units/${encodeURIComponent(selected.unitId)}/actions/${encodeURIComponent(selected.actionId)}`;
  const quoteJSON = await fetchJSON("POST", `${basePath}/quote`, {
    authenticated: true, payer, body: quoteBody, phase: "quote", beforeInvoke: true,
  });
  const quote = assertObject(payload(quoteJSON), "invalid_quote", "The authenticated quote response is malformed.", { beforeInvoke: true });
  const detail = quote;
  const topup = safeFundingURL(detail.topup_url);
  assertPinnedPayload(quote, selected, "quote");
  const amount = quote.quote_kind === "exact" ? atomNumber(quote.amount_aev_atoms) : null;
  const ceiling = quote.quote_kind === "hold_ceiling" ? atomNumber(quote.ceiling_aev_atoms) : null;
  const authorized = amount === null ? ceiling : amount;
  const quoteDigests = Object.fromEntries(DIGEST_FIELDS.map((field) => [field, quote[field]]));
  if (quote.quote_contract_version !== "v1" || quote.currency !== "aev" || quote.exists !== true ||
      quote.callable !== true || quote.confirmation_required !== false ||
      (quote.quote_kind !== "exact" && quote.quote_kind !== "hold_ceiling") ||
      (quote.quote_kind === "hold_ceiling" && quote.capture_basis !== "actual_usage") ||
      !isDeepStrictEqual(quote.input, quoteBody.input) ||
      !isDeepStrictEqual(quote.budget, quoteBody.budget) || quote.deadline !== deadline ||
      !exactIdentity(quote.quote_reference, 4096) || !exactIdentity(quote.quote_receipt, 8192) ||
      !exactDigests(quoteDigests) || authorized === null || authorized === 0 ||
      authorized > BUDGET_CEILING_AEV_ATOMS) {
    throw new ProtocolError("invalid_quote", "Quote omitted or drifted from its exact pins, digest evidence, controls, or Aev authorization.", { beforeInvoke: true });
  }
  const quoteEvidence = {
    unit_action_ref: selected.unitActionRef,
    catalog: selected.catalog,
    model_choice_pin: selected.modelChoicePin,
    quote_kind: quote.quote_kind,
    authorized_aev_atoms: authorized,
    quote_reference: quote.quote_reference,
    quote_receipt: quote.quote_receipt,
    input: quote.input,
    budget: quoteBody.budget,
    deadline,
    ...quoteDigests,
  };
  const invokeBody = {
    unit_action_ref: selected.unitActionRef,
    catalog: selected.catalog,
    model_choice_pin: selected.modelChoicePin,
    quote_reference: quote.quote_reference,
    input: canonicalInput,
    confirmed_effect_digest: null,
    deadline,
  };
  const prepared = {
    action_path: basePath,
    invoke_body: JSON.stringify(invokeBody),
    deadline,
    idempotency_key: idempotencyKey,
    quote_evidence: quoteEvidence,
    quoted_aev_atoms: authorized,
    topup,
  };
  return { ...prepared, prepared_seal: sealPrepared(prepared, payer) };
}

function validatePreparedAction(prepared, idempotencyKey, payer) {
  const preparedKeys = ["action_path", "invoke_body", "deadline", "idempotency_key", "quote_evidence",
    "quoted_aev_atoms", "topup", "prepared_seal"].sort();
  if (!isObject(prepared) || !isDeepStrictEqual(Object.keys(prepared).sort(), preparedKeys) ||
      !exactIdentity(prepared.action_path, 1024) ||
      !exactIdentity(prepared.invoke_body, 1024 * 1024) || !exactIdentity(prepared.deadline, 64) ||
      !IDEMPOTENCY_KEY.test(idempotencyKey) || !exactIdentity(payer, 8192) || prepared.idempotency_key !== idempotencyKey ||
      atomNumber(prepared.quoted_aev_atoms) !== prepared.quoted_aev_atoms || !isObject(prepared.quote_evidence) ||
      !PREPARED_SEAL.test(prepared.prepared_seal)) {
    throw new ProtocolError("invalid_prepared_request", "The persisted canonical invoke request is missing or malformed.", { beforeInvoke: true });
  }
  const expectedSeal = sealPrepared(prepared, payer);
  if (!crypto.timingSafeEqual(Buffer.from(prepared.prepared_seal), Buffer.from(expectedSeal))) {
    throw new ProtocolError("invalid_prepared_request", "The persisted quote and invoke bundle was changed after preparation.", { beforeInvoke: true });
  }
  let body;
  try { body = JSON.parse(prepared.invoke_body); } catch {
    throw new ProtocolError("invalid_prepared_request", "The persisted canonical invoke bytes are not JSON.", { beforeInvoke: true });
  }
  const keys = Object.keys(body).sort();
  const expectedKeys = ["catalog", "confirmed_effect_digest", "deadline", "input", "model_choice_pin", "quote_reference", "unit_action_ref"].sort();
  const quote = prepared.quote_evidence;
  const quoteKeys = ["unit_action_ref", "catalog", "model_choice_pin", "quote_kind", "authorized_aev_atoms",
    "quote_reference", "quote_receipt", "input", "budget", "deadline", ...DIGEST_FIELDS].sort();
  const quoteDigests = Object.fromEntries(DIGEST_FIELDS.map((field) => [field, quote[field]]));
  if (!isDeepStrictEqual(keys, expectedKeys) || !isObject(body.unit_action_ref) || !isObject(body.catalog) ||
      !validChatInput(body.input) || !exactModelChoicePin(body.model_choice_pin) ||
      body.model_choice_pin.model_id !== MODEL_CHOICE_ID || body.confirmed_effect_digest !== null ||
      body.deadline !== prepared.deadline || Number.isNaN(Date.parse(body.deadline)) || !exactIdentity(body.quote_reference, 4096) ||
      !isDeepStrictEqual(Object.keys(quote).sort(), quoteKeys) || !isDeepStrictEqual(quote.unit_action_ref, body.unit_action_ref) ||
      !isDeepStrictEqual(quote.catalog, body.catalog) || !isDeepStrictEqual(quote.model_choice_pin, body.model_choice_pin) ||
      !isDeepStrictEqual(quote.input, body.input) || quote.quote_reference !== body.quote_reference || quote.deadline !== body.deadline ||
      (quote.quote_kind !== "exact" && quote.quote_kind !== "hold_ceiling") ||
      !isDeepStrictEqual(quote.budget, { ceiling_aev_atoms: BUDGET_CEILING_AEV_ATOMS }) ||
      atomNumber(quote.authorized_aev_atoms) !== quote.authorized_aev_atoms || quote.authorized_aev_atoms === 0 ||
      prepared.quoted_aev_atoms !== quote.authorized_aev_atoms || !exactIdentity(quote.quote_receipt, 8192) ||
      !exactDigests(quoteDigests) || !exactCatalog(body.catalog)) {
    throw new ProtocolError("invalid_prepared_request", "The persisted invoke bytes do not contain one exact pinned request.", { beforeInvoke: true });
  }
  if (!validUnitActionRef(body.unit_action_ref)) {
    throw new ProtocolError("invalid_prepared_request", "The persisted UnitActionRef is incomplete or not content-addressed.", { beforeInvoke: true });
  }
  const expectedPath = `/v1/service-units/${encodeURIComponent(body.unit_action_ref.unit_id)}/actions/${encodeURIComponent(body.unit_action_ref.action_id)}`;
  if (prepared.action_path !== expectedPath) {
    throw new ProtocolError("invalid_prepared_request", "The persisted Action path does not match its UnitActionRef.", { beforeInvoke: true });
  }
  return { body, selected: {
    unitId: body.unit_action_ref.unit_id,
    actionId: body.unit_action_ref.action_id,
    unitActionRef: body.unit_action_ref,
    catalog: body.catalog,
    modelChoicePin: body.model_choice_pin,
    quoteEvidence: quote,
  } };
}

async function observePreparedModelAction(prepared, payer, idempotencyKey, invocationId, expectedSettlementReference = null) {
  const { selected } = validatePreparedAction(prepared, idempotencyKey, payer);
  const basePath = prepared.action_path;
  if (!exactIdentity(invocationId, 4096) || invocationId === idempotencyKey) {
    throw new ProtocolError("invalid_invocation_identity", "Invocation observation identity must be present and distinct from the replay key.", {
      invocationId: exactIdentity(invocationId, 4096) ? invocationId : null,
    });
  }
  if (expectedSettlementReference !== null && !exactIdentity(expectedSettlementReference, 4096)) {
    throw new ProtocolError("invalid_invocation", "Invoke omitted its settlement reference.", { invocationId });
  }
  const observeJSON = await fetchJSON("GET", `${basePath}/invocations/${encodeURIComponent(invocationId)}`, {
    authenticated: true, payer, phase: "Invocation observation", invocationId,
  });
  const observation = assertObject(payload(observeJSON), "invalid_observation", "Invocation observation is malformed.", { invocationId });
  assertExecutionEvidence(observation, selected, "observation", invocationId);
  if (invocationIdentity(observation) !== invocationId || !exactIdentity(observation.settlement_reference, 4096) ||
      (expectedSettlementReference !== null && observation.settlement_reference !== expectedSettlementReference)) {
    throw new ProtocolError("observation_identity_drift", "Invocation observation did not preserve invocation and settlement identity.", { invocationId });
  }
  if (!TERMINAL_STATES.has(observation.state)) {
    throw new ProtocolError("invocation_not_terminal", "Invocation is not terminal; reconcile this same Invocation before reading settlement.", { invocationId });
  }
  const result = observation.state === "succeeded" ? canonicalChatResult(observation.result) : null;
  if (observation.state === "succeeded" && !result) {
    throw new ProtocolError("invalid_result_projection", "Invocation result does not match the pinned Action output schema.", { invocationId });
  }

  const receiptJSON = await fetchJSON("GET", `/v1/invocations/${encodeURIComponent(invocationId)}/receipt`, {
    authenticated: true, payer, phase: "terminal receipt", invocationId,
  });
  const settlement = receiptEvidence(receiptJSON, {
    ...selected, invocationId, idempotencyKey, terminalState: observation.state,
    settlementReference: observation.settlement_reference,
  });
  return {
    text: result ? result.message.content : "",
    usage: result ? { total_tokens: result.usage.total_tokens } : null,
    unit_action_ref: selected.unitActionRef,
    model_choice_pin: selected.modelChoicePin,
    invocation_id: invocationId,
    idempotency_key: idempotencyKey,
    settlement_reference: observation.settlement_reference,
    receipt: payload(receiptJSON),
    ...settlement,
  };
}

async function invokePreparedModelAction(prepared, payer, idempotencyKey) {
  const { selected } = validatePreparedAction(prepared, idempotencyKey, payer);
  const invokePath = `/v1/service-units/${encodeURIComponent(selected.unitId)}/actions/${encodeURIComponent(selected.actionId)}/invoke`;
  const invokeJSON = await fetchJSON("POST", invokePath, {
    authenticated: true, payer, bodyText: prepared.invoke_body, idempotencyKey, phase: "invoke",
  });
  const invocation = assertObject(payload(invokeJSON), "invalid_invocation", "The invoke response is malformed.");
  const invocationId = invocationIdentity(invocation);
  if (!exactIdentity(invocationId, 4096) || invocationId === idempotencyKey) {
    throw new ProtocolError("invalid_invocation_identity", "Invocation observation identity must be present and distinct from the replay key.", {
      invocationId: exactIdentity(invocationId, 4096) ? invocationId : null,
    });
  }
  assertExecutionEvidence(invocation, selected, "invoke", invocationId);
  if (!exactIdentity(invocation.settlement_reference, 4096)) {
    throw new ProtocolError("invalid_invocation", "Invoke omitted its settlement reference.", { invocationId });
  }
  return observePreparedModelAction(prepared, payer, idempotencyKey, invocationId, invocation.settlement_reference);
}

function safeFundingURL(value) {
  if (typeof value !== "string" || value === "" || value !== value.trim()) return null;
  if (/[\u0000-\u0020\u007f\\]/.test(value)) return null;
  if (value.startsWith("/")) return value.startsWith("//") ? null : value;
  if (!/^https:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch { return null; }
}

function sendJSON(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const CTYPE = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, "http://localhost"); } catch { return sendJSON(res, 400, { error: "bad_request" }); }
  if (url.pathname === "/healthz") return sendJSON(res, 200, { ok: true });
  if (url.pathname === "/api/me" && req.method === "GET") {
    return sendJSON(res, 200, { logged_in: !!payerToken(req), estimate_aev: PRICE_ESTIMATE_AEV, currency: "AEV" });
  }
  if ((url.pathname === "/api/quote" || url.pathname === "/api/invoke" || url.pathname === "/api/observe") && req.method === "POST") {
    const payer = payerToken(req);
    if (!payer) return sendJSON(res, 401, { error: "login_required", login: "/__semesh/login" });
    if (!RUNTIME_KEY) return sendJSON(res, 500, { error: "app_not_configured", message: "SEMESH_APP_API_KEY is missing." });
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body;
    try { body = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "invalid_json" }); }
    const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return sendJSON(res, 400, { error: "idempotency_key_required", message: "Send one stable Idempotency-Key per logical request." });
    }
    try {
      if (url.pathname === "/api/quote") {
        const prompt = String(body.prompt || "").trim();
        if (!prompt) return sendJSON(res, 400, { error: "prompt_required" });
        if (prompt.length > MAX_PROMPT_CHARS) return sendJSON(res, 413, { error: "prompt_too_long" });
        const prepared = await prepareCanonicalModelAction(
          { messages: [{ role: "user", content: prompt }] }, payer, idempotencyKey
        );
        return sendJSON(res, 200, {
          ok: true,
          effect_zero: true,
          idempotency_key: idempotencyKey,
          prepared,
          quoted_aev_atoms: prepared.quoted_aev_atoms,
        });
      }
      const result = url.pathname === "/api/observe"
        ? await observePreparedModelAction(body.prepared, payer, idempotencyKey, body.invocation_id)
        : await invokePreparedModelAction(body.prepared, payer, idempotencyKey);
      return sendJSON(res, 200, { ok: true, ...result });
    } catch (error) {
      const known = error instanceof ProtocolError;
      const beforeInvoke = url.pathname !== "/api/observe" && (url.pathname === "/api/quote" || (known && error.beforeInvoke));
      const status = known && error.status === 402 ? 402 : (beforeInvoke ? 503 : 502);
      return sendJSON(res, status, {
        error: known ? error.code : "run_failed",
        message: known ? error.message : "The canonical outcome is unknown; replay only the exact request with the same key.",
        effect_zero: beforeInvoke,
        settlement_status: beforeInvoke ? "not_started" : "unknown",
        idempotency_key: idempotencyKey,
        invocation_id: known ? error.invocationId : null,
      });
    }
  }

  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const filename = path.join(__dirname, "public", path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, ""));
  fs.readFile(filename, (error, data) => {
    if (error) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": CTYPE[path.extname(filename)] || "application/octet-stream" });
    res.end(data);
  });
});

if (require.main === module) server.listen(PORT, () => console.log(`ai-saas-paid-api listening on :${PORT} (base ${BASE})`));

module.exports = {
  ProtocolError,
  discoverModelAction,
  extractText,
  invokePreparedModelAction,
  observePreparedModelAction,
  prepareCanonicalModelAction,
  receiptEvidence,
  safeFundingURL,
  server,
  validatePreparedAction,
};
