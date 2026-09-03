// auth-payments-minimal — one public Catalog Unit Action billed to the signed-in user.
//
// Public discovery is deliberately anonymous:
//   Search -> catalog-token-pinned Unit detail.
// The paid rail is deliberately authenticated and exact:
//   nested Action quote -> same UnitActionRef/Catalog/input invoke -> Invocation -> receipt.
//
// X-Semesh-Payer chooses the logged-in user's wallet. The runtime key and the Search-issued
// catalog token remain server-side. Idempotency-Key identifies a replayable request; the server's
// returned invocation_id is a different identity used only for observation and receipt reads.

const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.PORT || 8080;
const BASE = (process.env.SEMESH_BASE_URL || "https://api.semesh.net").replace(/\/+$/, "");
const RUNTIME_KEY = process.env.SEMESH_APP_API_KEY || process.env.SEMESH_API_KEY || "";
const UNIT_QUERY = String(process.env.SEMESH_UNIT_QUERY || "DeepSeek chat").trim();
const ACTION_ID = String(process.env.SEMESH_ACTION_ID || "chat").trim();
const MODEL_ID = "deepseek-v3";
const BUDGET_CEILING_AEV_ATOMS = Number(process.env.SEMESH_BUDGET_CEILING_AEV_ATOMS);
const configuredDeadlineSeconds = Number(process.env.SEMESH_ACTION_DEADLINE_SECONDS);
const ACTION_DEADLINE_SECONDS =
  Number.isSafeInteger(configuredDeadlineSeconds) && configuredDeadlineSeconds >= 30 && configuredDeadlineSeconds <= 3600
    ? configuredDeadlineSeconds
    : 300;

const QUOTE_KINDS = new Set(["exact", "representative_floor", "hold_ceiling"]);
const TERMINAL_STATES = new Set(["succeeded", "failed", "canceled"]);
const OBSERVABLE_STATES = new Set([...TERMINAL_STATES, "pending", "running", "reconciling"]);
const SAFE_TRACE_ID = /^[A-Za-z0-9_-]{8,128}$/;
const SAFE_MACHINE_CODE = /^[a-z][a-z0-9_]{0,127}$/;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const PRINCIPAL_ID = /^[\x21-\x7E]{1,200}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;
const OPAQUE_TEXT = /^[\x21-\x7E]{1,8192}$/;
const CATALOG_TOKEN = /^[\x21-\x7E]{8,4096}$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_RESPONSE_BYTES = 1024 * 1024;
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
const configuredQuoteTimeout = Number(process.env.SEMESH_QUOTE_TIMEOUT_MS);
const DEFAULT_QUOTE_TIMEOUT_MS =
  Number.isFinite(configuredQuoteTimeout) && configuredQuoteTimeout >= 100 && configuredQuoteTimeout <= 60000
    ? configuredQuoteTimeout
    : 15000;

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ }
    }
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
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clonePublicJSON(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function projectJSONFields(value, fields) {
  const clone = clonePublicJSON(value);
  if (!isObject(clone)) return null;
  const projected = {};
  for (const field of fields) {
    if (Object.hasOwn(clone, field)) projected[field] = clone[field];
  }
  return projected;
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

// The wire contract uses JSON integers. JavaScript cannot represent the full int64 range exactly,
// so this template fails closed outside the non-negative safe-integer subset instead of rounding.
function atomValue(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeMachineCode(raw) {
  const value = String(raw || "").trim();
  return SAFE_MACHINE_CODE.test(value) ? value : "";
}

function safeTraceId(raw) {
  const value = String(raw || "").trim();
  return SAFE_TRACE_ID.test(value) ? value : "";
}

function validPrincipal(value) {
  return typeof value === "string" && PRINCIPAL_ID.test(value);
}

function operationPrincipal(req) {
  const trusted = String(req.headers["x-semesh-user-id"] || "");
  const bound = String(req.headers["x-semesh-operation-principal"] || "");
  if (!validPrincipal(trusted)) {
    return {
      ok: false,
      status: 503,
      error: {
        code: "operation_principal_unavailable",
        message: "The trusted Semesh user identity is unavailable.",
        fix: "Use the Semesh auth edge and retry after it injects x-semesh-user-id.",
        retryable: true,
      },
    };
  }
  if (!validPrincipal(bound)) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "operation_principal_binding_required",
        message: "The operation is missing a valid stable principal binding.",
        fix: "Resolve /__semesh/me and bind user.sub, or user.id only when sub is absent.",
        retryable: false,
      },
    };
  }
  if (trusted !== bound) {
    return {
      ok: false,
      status: 409,
      error: {
        code: "operation_principal_mismatch",
        message: "The paid operation belongs to a different signed-in principal.",
        fix: "Do not replay it. Restore the original account for reconciliation or start a new quoted operation.",
        retryable: false,
      },
    };
  }
  return { ok: true, principal: trusted };
}

function unwrap(json) {
  return isObject(json) && Object.hasOwn(json, "data") ? json.data : json;
}

function canonicalObjectData(json) {
  return isObject(json) && json.success === true && isObject(json.data) ? json.data : null;
}

async function semeshFetch(method, route, options = {}) {
  const headers = {};
  if (options.authenticated) {
    headers.Authorization = `Bearer ${RUNTIME_KEY}`;
    if (options.payer) headers["X-Semesh-Payer"] = options.payer;
  }
  if (options.catalogToken) headers["X-Semesh-Catalog-Token"] = options.catalogToken;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(BASE + route, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
  });
  const advertisedLength = response.headers.get("content-length");
  if (advertisedLength !== null && (!/^(0|[1-9][0-9]*)$/.test(advertisedLength) ||
      BigInt(advertisedLength) > BigInt(MAX_RESPONSE_BYTES))) {
    throw Object.assign(new Error("Semesh response exceeded 1 MiB"), { code: "response_too_large" });
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
        throw Object.assign(new Error("Semesh response exceeded 1 MiB"), { code: "response_too_large" });
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let raw;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw Object.assign(new Error("Semesh response was not valid UTF-8 JSON"), { code: "malformed_response" });
  }
  let json = null;
  let malformed = false;
  try { json = JSON.parse(raw); } catch { malformed = true; }
  return { status: response.status, headers: response.headers, json, malformed };
}

async function boundedSemeshFetch(method, route, options = {}, timeoutMs = DEFAULT_QUOTE_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await semeshFetch(method, route, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut || (error && error.name === "AbortError")) {
      throw Object.assign(new Error("The read-only Semesh request timed out."), { code: "read_timeout" });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function projectedError(phase, { status, json, headers, cause } = {}) {
  const body = isObject(json) ? json : {};
  const unwrapped = unwrap(body);
  const upstream = isObject(body.error) ? body.error : isObject(unwrapped) && isObject(unwrapped.error) ? unwrapped.error : {};
  const retryableStatus = status === 408 || status === 425 || status === 429 || (status != null && status >= 500);
  const fallbackCode = cause
    ? cause.code === "read_timeout" ? `${phase}_timeout` : `${phase}_transport_failed`
    : status === 404 ? `${phase}_not_found`
      : status != null && status >= 500 ? `${phase}_unavailable`
        : `${phase}_failed`;
  const out = {
    code: safeMachineCode(upstream.code) || fallbackCode,
    message:
      typeof upstream.message === "string" && upstream.message.trim()
        ? upstream.message.trim()
        : cause
          ? `The canonical ${phase} request could not be completed.`
          : `The canonical ${phase} request was rejected.`,
    fix:
      typeof upstream.fix === "string" && upstream.fix.trim()
        ? upstream.fix.trim()
        : `Return to public Search and retry the exact Unit Action ${phase}; do not use an alternate route or identity.`,
    retryable: typeof upstream.retryable === "boolean" ? upstream.retryable : !!(cause || retryableStatus),
  };
  const trace = safeTraceId(headers && headers.get("x-semesh-trace-id")) || safeTraceId(upstream.trace_id);
  if (trace) out.trace_id = trace;
  if (isObject(upstream.availability)) out.availability = clonePublicJSON(upstream.availability);
  return out;
}

function contractFailure(code, message, fix, status = 503) {
  return { ok: false, status, error: { code, message, fix, retryable: false } };
}

function validRef(ref, unitId, actionId) {
  return isObject(ref) &&
    Object.keys(ref).length === 4 &&
    ["unit_id", "unit_revision", "action_id", "action_revision"].every((field) => Object.hasOwn(ref, field)) &&
    typeof ref.unit_id === "string" && RESOURCE_ID.test(ref.unit_id) &&
    typeof ref.action_id === "string" && RESOURCE_ID.test(ref.action_id) &&
    typeof ref.unit_revision === "string" && SHA256_DIGEST.test(ref.unit_revision) &&
    typeof ref.action_revision === "string" && SHA256_DIGEST.test(ref.action_revision) &&
    (!unitId || ref.unit_id === unitId) &&
    (!actionId || ref.action_id === actionId);
}

function validCatalogPin(value) {
  return isObject(value) &&
    Object.keys(value).length === 2 &&
    Number.isSafeInteger(value.view_generation) && value.view_generation > 0 &&
    typeof value.view_digest === "string" && SHA256_DIGEST.test(value.view_digest);
}

function validModelId(value) {
  return typeof value === "string" && value.length <= 128 &&
    /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value);
}

function validRuntimeIdentity(value) {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 512 &&
    value.trim() === value && !/[ \t\r\n]/.test(value) && !/\p{Cc}/u.test(value);
}

function validModelChoicePin(value, modelId = null) {
  return isObject(value) &&
    Object.keys(value).length === 2 &&
    Object.hasOwn(value, "model_id") &&
    Object.hasOwn(value, "model_revision") &&
    validModelId(value.model_id) &&
    validRuntimeIdentity(value.model_revision) &&
    (!modelId || value.model_id === modelId);
}

function validCanonicalChatInput(input) {
  return isObject(input) &&
    Object.keys(input).length === 1 &&
    Object.hasOwn(input, "messages") &&
    Array.isArray(input.messages) &&
    input.messages.length > 0 &&
    input.messages.every((message) =>
      isObject(message) &&
      Object.keys(message).length === 2 &&
      Object.hasOwn(message, "role") &&
      Object.hasOwn(message, "content") &&
      ["system", "user", "assistant"].includes(message.role) &&
      typeof message.content === "string" &&
      message.content.length > 0
    );
}

function selectModelChoice(action, input) {
  if (!validCanonicalChatInput(input)) {
    return contractFailure(
      "chat_input_invalid",
      "This template accepts only the closed canonical messages input; model choice is not an input property.",
      "Send one or more exact role/content messages and remove model_choice or any other input field.",
      400
    );
  }
  if (!sameJSON(action.input_schema, STRICT_CHAT_INPUT_SCHEMA)) {
    return contractFailure(
      "action_input_schema_invalid",
      "The selected Action does not advertise the exact closed canonical chat input schema.",
      "Refresh Detail and require the messages-only draft-2020-12 schema before quoting."
    );
  }
  if (!Array.isArray(action.model_choices) || action.model_choices.length === 0 || action.model_choices.length > 128) {
    return contractFailure(
      "model_choice_not_advertised",
      "The selected Action does not expose bounded model_choices.",
      "Refresh Unit Detail and select a choice only from the chosen Action's model_choices array."
    );
  }
  const selected = action.model_choices.filter((choice) =>
    isObject(choice) && isObject(choice.ref) && choice.ref.model_id === MODEL_ID
  );
  if (selected.length !== 1 || !validModelChoicePin(selected[0].ref, MODEL_ID)) {
    return contractFailure(
      "model_choice_not_advertised",
      `The selected Action does not advertise exactly one immutable ${MODEL_ID} ref.`,
      "Refresh Unit Detail; never derive a model revision from Search recall, an alternate name, or provider data."
    );
  }
  const choice = selected[0];
  const pin = choice.ref;
  const targetsValid = Array.isArray(choice.targets) && choice.targets.length > 0 && choice.targets.length <= 128 &&
    choice.targets.every((target) =>
      isObject(target) &&
      Object.keys(target).length === 2 &&
      validRef(target.unit_action_ref) &&
      validModelChoicePin(target.model_ref) &&
      sameJSON(target.model_ref, pin)
    );
  const matchingTargets = targetsValid
    ? choice.targets.filter((target) => sameJSON(target.unit_action_ref, action.unit_action_ref))
    : [];
  if (choice.selectable !== true || choice.callable !== false || !Array.isArray(choice.groups) || choice.groups.length !== 0 || matchingTargets.length !== 1) {
    return contractFailure(
      "model_choice_placement_invalid",
      "The DeepSeek choice is not one selectable, non-callable, Group-free ref targeting this exact Action.",
      "Refresh Unit Detail and preserve the exact nested Action/choice placement."
    );
  }
  return { ok: true, modelChoicePin: clonePublicJSON(pin) };
}

function validateOutputSchema(action) {
  if (sameJSON(action.output_schema, STRICT_CHAT_OUTPUT_SCHEMA)) return { ok: true };
  return contractFailure(
    "action_output_schema_invalid",
    "The selected Action does not advertise the exact strict canonical chat result schema.",
    "Refresh Detail and require strict message(role=assistant, content) plus usage.total_tokens before quoting."
  );
}

function canonicalChatResult(value) {
  if (!isObject(value) || Object.keys(value).length !== 2 || !isObject(value.message) || !isObject(value.usage)) return null;
  if (Object.keys(value.message).length !== 2 || value.message.role !== "assistant" || typeof value.message.content !== "string" || value.message.content.length < 1 || value.message.content.length > (1 << 20)) return null;
  if (Object.keys(value.usage).length !== 1 || typeof value.usage.total_tokens !== "number" || !Number.isSafeInteger(value.usage.total_tokens) || value.usage.total_tokens < 0) return null;
  return {
    message: { role: "assistant", content: value.message.content },
    usage: { total_tokens: value.usage.total_tokens },
  };
}

async function discoverAction(input, options = {}) {
  if (!UNIT_QUERY || !RESOURCE_ID.test(ACTION_ID)) {
    return contractFailure(
      "catalog_selector_not_configured",
      "SEMESH_UNIT_QUERY and SEMESH_ACTION_ID must identify the intended public Action.",
      "Configure a goal query and an Action ID; never configure a catalog token.",
      500
    );
  }
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(requestedTimeout, 60000)
    : DEFAULT_QUOTE_TIMEOUT_MS;
  const searchPath = `/v1/service-units/search?q=${encodeURIComponent(UNIT_QUERY)}&scope=public`;
  let searchResponse;
  try {
    searchResponse = await boundedSemeshFetch("GET", searchPath, { authenticated: false }, timeoutMs);
  } catch (cause) {
    return { ok: false, status: cause.code === "read_timeout" ? 504 : 502, error: projectedError("catalog_search", { cause }) };
  }
  if (searchResponse.status >= 400) {
    return { ok: false, status: searchResponse.status, error: projectedError("catalog_search", searchResponse) };
  }
  if (searchResponse.malformed || !isObject(searchResponse.json) || searchResponse.json.success !== true || !Array.isArray(searchResponse.json.data) || !isObject(searchResponse.json.meta)) {
    return contractFailure(
      "catalog_search_malformed",
      "Public Search returned a malformed Catalog envelope.",
      "Retry public Search; do not fall back to another collection or cached identity."
    );
  }
  const searchMeta = searchResponse.json.meta;
  const catalogToken = searchMeta.catalog_token;
  const catalogIdentity = searchMeta.catalog_identity;
  if (
    typeof catalogToken !== "string" ||
    !CATALOG_TOKEN.test(catalogToken) ||
    !isObject(catalogIdentity) ||
    !Number.isSafeInteger(catalogIdentity.view_generation) ||
    catalogIdentity.view_generation <= 0 ||
    typeof catalogIdentity.view_digest !== "string" ||
    !SHA256_DIGEST.test(catalogIdentity.view_digest)
  ) {
    return contractFailure(
      "catalog_search_pin_missing",
      "Public Search did not return a bounded catalog_token and catalog_identity.",
      "Restart public Search; never source the catalog token from configuration or environment."
    );
  }
  const units = searchResponse.json.data.filter((item) => isObject(item) && item.kind === "unit");
  if (units.length !== 1 || typeof units[0].id !== "string" || !RESOURCE_ID.test(units[0].id)) {
    return contractFailure(
      "model_unit_selection_ambiguous",
      "The configured query did not resolve exactly one callable Service Unit result.",
      "Refine SEMESH_UNIT_QUERY. Groups and Guides are navigation only and are never invocation targets."
    );
  }
  const unitId = units[0].id;
  const detailPath = `/v1/service-units/${encodeURIComponent(unitId)}?scope=public`;
  let detailResponse;
  try {
    detailResponse = await boundedSemeshFetch("GET", detailPath, { authenticated: false, catalogToken }, timeoutMs);
  } catch (cause) {
    return { ok: false, status: cause.code === "read_timeout" ? 504 : 502, error: projectedError("unit_detail", { cause }) };
  }
  if (detailResponse.status >= 400) {
    return { ok: false, status: detailResponse.status, error: projectedError("unit_detail", detailResponse) };
  }
  const detailEnvelope = detailResponse.json;
  if (detailResponse.malformed || !isObject(detailEnvelope) || detailEnvelope.success !== true || !isObject(detailEnvelope.data) || !isObject(detailEnvelope.meta)) {
    return contractFailure(
      "unit_detail_malformed",
      "The token-pinned Unit detail returned a malformed envelope.",
      "Restart public Search; do not quote from a partial or cached detail."
    );
  }
  if (detailEnvelope.meta.catalog_token !== catalogToken || !sameJSON(detailEnvelope.meta.catalog_identity, catalogIdentity)) {
    return contractFailure(
      "catalog_view_refresh_required",
      "The Unit detail did not echo the exact Search catalog token and identity.",
      "Restart public Search and keep its token only across the advertised anonymous GET chain."
    );
  }
  const detail = detailEnvelope.data;
  if (detail.id !== unitId || detail.kind !== "unit" || !Array.isArray(detail.actions) || !isObject(detail.catalog)) {
    return contractFailure(
      "unit_detail_contract_invalid",
      "The pinned detail does not describe the selected Unit, its Actions, and its Catalog pin.",
      "Restart public Search and require one complete current Unit detail."
    );
  }
  const expectedCatalog = {
    view_generation: catalogIdentity.view_generation,
    view_digest: catalogIdentity.view_digest,
  };
  if (!validCatalogPin(detail.catalog) || !sameJSON(detail.catalog, expectedCatalog)) {
    return contractFailure(
      "catalog_view_refresh_required",
      "The Unit detail Catalog pin is not the exact view_generation/view_digest projection of the echoed Search identity.",
      "Restart public Search; never quote from a mismatched or reconstructed Catalog pin."
    );
  }
  const actions = detail.actions.filter((action) => isObject(action) && action.id === ACTION_ID);
  if (actions.length !== 1 || !validRef(actions[0].unit_action_ref, unitId, ACTION_ID)) {
    return contractFailure(
      "unit_action_ref_invalid",
      "The selected Action is missing one exact UnitActionRef matching its Unit and Action path.",
      "Refresh detail and copy the server-authored UnitActionRef unchanged."
    );
  }
  const selectedAction = actions[0];
  if (selectedAction.callable !== true || selectedAction.availability !== "available") {
    return contractFailure(
      "action_unavailable",
      "The selected Action is not explicitly callable and available in the pinned Unit detail.",
      "Resolve the advertised Action availability, then restart public Search and select a fresh pinned detail."
    );
  }
  const modelChoice = selectModelChoice(selectedAction, input);
  if (!modelChoice.ok) return modelChoice;
  const outputSchema = validateOutputSchema(selectedAction);
  if (!outputSchema.ok) return outputSchema;
  if (!isObject(selectedAction.effect) || typeof selectedAction.effect.requires_confirmation !== "boolean") {
    return contractFailure(
      "unit_action_effect_invalid",
      "The selected Action does not declare an exact confirmation requirement.",
      "Refresh detail; never guess whether an effect requires confirmation."
    );
  }
  if (selectedAction.effect.requires_confirmation) {
    return contractFailure(
      "confirmation_required",
      "This minimal app has no separate confirmation ceremony for the selected Action.",
      "Add the Action-advertised confirmation flow before quoting or invoking it."
    );
  }
  const catalog = clonePublicJSON(detail.catalog);
  const unitActionRef = clonePublicJSON(selectedAction.unit_action_ref);
  if (!catalog || !Object.keys(catalog).length || !unitActionRef) {
    return contractFailure(
      "unit_action_pin_invalid",
      "The UnitActionRef or Catalog pin cannot be represented as bounded JSON.",
      "Restart Search; do not reconstruct either pin."
    );
  }
  return {
    ok: true,
    contract: {
      unitActionRef,
      catalog,
      modelChoicePin: modelChoice.modelChoicePin,
      eventsAdvertised: !!(isObject(selectedAction.execution) && selectedAction.execution.events === true),
      requiresConfirmation: false,
    },
  };
}

function quoteContractFailure(message, fix, { code = "quote_contract_unavailable", status = 503, quote } = {}) {
  const result = { ok: false, status, error: { code, message, fix, retryable: status >= 500 } };
  if (quote) result.quote = quote;
  return result;
}

function projectCanonicalQuote(raw, context = {}) {
  if (!isObject(raw)) {
    return quoteContractFailure("The quote payload is missing.", "Retry the canonical nested Action quote; no price is assumed.");
  }
  const quote = projectJSONFields(raw, [
    "quote_contract_version", "quote_kind", "currency", "exists", "callable",
    "amount_aev_atoms", "ceiling_aev_atoms", "capture_basis",
    "quote_reference", "quote_receipt", "input_digest", "price_digest", "policy_digest", "effect_digest",
    "unit_action_ref", "catalog", "model_choice_pin", "input", "budget", "deadline", "confirmation_required",
    "expires_at", "price_label", "note", "required_fields", "availability",
  ]);
  if (!quote) {
    return quoteContractFailure("The quote payload is not bounded JSON.", "Retry the quote; do not reconstruct price or receipt fields.");
  }
  if (raw.quote_contract_version !== "v1" || !QUOTE_KINDS.has(raw.quote_kind) || raw.currency !== "aev" || raw.exists !== true || typeof raw.callable !== "boolean") {
    return quoteContractFailure(
      "The quote version, kind, currency, existence, or callable state is unsupported.",
      "Retry the current Unit Action quote; do not infer an omitted price contract."
    );
  }
  if (raw.callable === false) {
    const availability = isObject(raw.availability) ? clonePublicJSON(raw.availability) : undefined;
    const result = quoteContractFailure(
      (availability && (availability.reason || availability.message)) || "The selected Action is not currently callable.",
      (availability && availability.fix) || "Resolve the advertised availability requirement, refresh detail, and quote again.",
      { code: safeMachineCode(availability && availability.code) || "quote_target_unavailable", quote }
    );
    if (availability) result.error.availability = availability;
    return result;
  }
  for (const field of ["amount_aev_atoms", "ceiling_aev_atoms"]) {
    if (Object.hasOwn(raw, field) && atomValue(raw[field]) === null) {
      return quoteContractFailure(`Quote ${field} is not a non-negative safe JSON integer.`, "Retry the quote; unsafe or string atom amounts are never rounded or guessed.");
    }
  }
  if ((raw.quote_kind === "exact" || raw.quote_kind === "representative_floor") && atomValue(raw.amount_aev_atoms) === null) {
    return quoteContractFailure("The quote has no exact atom amount for its declared kind.", "Retry the canonical quote; do not convert a credit estimate into atoms.");
  }
  if (raw.quote_kind === "hold_ceiling" && (atomValue(raw.ceiling_aev_atoms) === null || raw.ceiling_aev_atoms <= 0 || raw.capture_basis !== "actual_usage")) {
    return quoteContractFailure(
      "The metered quote has no enforceable actual-usage atom ceiling.",
      "Do not invoke until the canonical quote provides ceiling_aev_atoms and capture_basis=actual_usage.",
      { code: "quote_hold_ceiling_unavailable" }
    );
  }
  if (raw.quote_kind === "representative_floor") {
    return quoteContractFailure(
      "A representative floor is discovery guidance, not an invocable final quote.",
      "Provide the required exact input and obtain an exact amount or enforceable hold ceiling.",
      { code: "quote_not_final", quote }
    );
  }
  for (const field of ["quote_reference", "quote_receipt"]) {
    if (typeof raw[field] !== "string" || !OPAQUE_TEXT.test(raw[field])) {
      return quoteContractFailure(`The quote is missing ${field}.`, "Retry the exact quote; never synthesize a reference or receipt.");
    }
  }
  for (const field of ["input_digest", "price_digest", "policy_digest", "effect_digest"]) {
    if (typeof raw[field] !== "string" || !SHA256_DIGEST.test(raw[field])) {
      return quoteContractFailure(`The quote ${field} is not an exact lowercase sha256 digest.`, "Retry the exact quote; never synthesize or weaken a digest pin.");
    }
  }
  if (!validModelChoicePin(raw.model_choice_pin, MODEL_ID)) {
    return quoteContractFailure("The quote is missing one exact DeepSeek model_choice_pin.", "Restart Unit Detail and quote its advertised immutable model ref.", { code: "quote_choice_drift" });
  }
  if (context.contract) {
    if (!sameJSON(raw.unit_action_ref, context.contract.unitActionRef) || !sameJSON(raw.catalog, context.contract.catalog) || !sameJSON(raw.model_choice_pin, context.contract.modelChoicePin)) {
      return quoteContractFailure("The quote drifted from the pinned UnitActionRef, Catalog, or model choice.", "Restart public Search and quote the selected pinned Action/choice again.", { code: "quote_pin_drift" });
    }
  }
  if (context.input) {
    if (!sameJSON(raw.input, context.input)) {
      return quoteContractFailure("The quote did not echo the exact messages input.", "Quote the unchanged canonical input; never move model choice into input.", { code: "quote_input_drift" });
    }
  }
  if (context.budget && (!sameJSON(raw.budget, context.budget) || raw.deadline !== context.deadline || raw.confirmation_required !== false)) {
    return quoteContractFailure(
      "The quote did not echo the exact budget, deadline, and confirmation policy.",
      "Request a new quote; never change these fields between quote and invoke.",
      { code: "quote_control_drift" }
    );
  }
  if (context.budget) {
    const authorized = raw.quote_kind === "exact" ? raw.amount_aev_atoms : raw.ceiling_aev_atoms;
    if (atomValue(authorized) === null || atomValue(context.budget.ceiling_aev_atoms) === null || authorized > context.budget.ceiling_aev_atoms) {
      return quoteContractFailure(
        "The authoritative quote exceeds the configured atom budget.",
        "Raise the budget only with explicit app-owner intent, or choose a lower-cost advertised Action.",
        { code: "quote_budget_exceeded" }
      );
    }
  }
  return { ok: true, quote };
}

function projectQuoteError(args) {
  return projectedError("quote", args);
}

async function quoteAction(payer, input, contract, options = {}) {
  if (!validCanonicalChatInput(input) || !contract || !validRef(contract.unitActionRef) || !validCatalogPin(contract.catalog) || !validModelChoicePin(contract.modelChoicePin, MODEL_ID)) {
    return quoteContractFailure("Quote input or pinned Action contract is invalid.", "Repeat public Search and Unit detail before quoting.", { status: 400 });
  }
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(requestedTimeout, 60000)
    : DEFAULT_QUOTE_TIMEOUT_MS;
  const ref = contract.unitActionRef;
  const budget = clonePublicJSON(options.budget);
  const deadline = String(options.deadline || "");
  if (!isObject(budget) || atomValue(budget.ceiling_aev_atoms) === null || budget.ceiling_aev_atoms <= 0 || !Number.isFinite(Date.parse(deadline))) {
    return quoteContractFailure(
      "Quote budget or deadline is invalid.",
      "Configure a positive integer atom ceiling and generate one bounded ISO deadline before quoting.",
      { status: 500 }
    );
  }
  const route = `/v1/service-units/${encodeURIComponent(ref.unit_id)}/actions/${encodeURIComponent(ref.action_id)}/quote`;
  const body = {
    unit_action_ref: clonePublicJSON(ref),
    catalog: clonePublicJSON(contract.catalog),
    model_choice_pin: clonePublicJSON(contract.modelChoicePin),
    input: clonePublicJSON(input),
    budget,
    deadline,
  };
  let response;
  try {
    response = await boundedSemeshFetch("POST", route, { authenticated: true, payer, body }, timeoutMs);
  } catch (cause) {
    return { ok: false, status: cause.code === "read_timeout" ? 504 : 502, error: projectQuoteError({ cause }) };
  }
  if (response.status >= 400) {
    return { ok: false, status: response.status, error: projectQuoteError(response) };
  }
  const quoteData = canonicalObjectData(response.json);
  if (response.malformed || !quoteData) {
    return quoteContractFailure("The nested Action quote returned a malformed canonical envelope.", "Retry the exact quote; no invoke was sent.");
  }
  return projectCanonicalQuote(quoteData, { contract, input, budget, deadline });
}

function planSigningKey() {
  return crypto.createHash("sha256").update("auth-payments-minimal.quote-plan.v2\0").update(RUNTIME_KEY).digest();
}

function sealQuotePlan(principal, contract, input, quote, budget, deadline) {
  const invokeRequest = {
    unit_action_ref: clonePublicJSON(contract.unitActionRef),
    catalog: clonePublicJSON(contract.catalog),
    model_choice_pin: clonePublicJSON(contract.modelChoicePin),
    quote_reference: quote.quote_reference,
    input: clonePublicJSON(input),
    confirmed_effect_digest: null,
    deadline,
  };
  const payload = Buffer.from(JSON.stringify({
    version: 2,
    principal,
    contract: clonePublicJSON(contract),
    input: clonePublicJSON(input),
    quote: clonePublicJSON(quote),
    budget: clonePublicJSON(budget),
    deadline,
    invokeRequest,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", planSigningKey()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function openQuotePlan(token, principal) {
  if (typeof token !== "string" || token.length < 32 || token.length > 131072) {
    return contractFailure("quote_plan_invalid", "The signed quote plan is missing or invalid.", "Request a new live quote before invoking.", 400);
  }
  const parts = token.split(".");
  if (parts.length !== 2) return contractFailure("quote_plan_invalid", "The signed quote plan is malformed.", "Request a new live quote before invoking.", 400);
  const expected = crypto.createHmac("sha256", planSigningKey()).update(parts[0]).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], "base64url"); } catch { supplied = Buffer.alloc(0); }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return contractFailure("quote_plan_invalid", "The signed quote plan failed integrity validation.", "Discard it and request a new live quote.", 400);
  }
  let plan;
  try { plan = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { plan = null; }
  if (!isObject(plan) || plan.version !== 2 || plan.principal !== principal || !isObject(plan.contract) || !isObject(plan.input) || !isObject(plan.quote) || !isObject(plan.budget) || !isObject(plan.invokeRequest)) {
    return contractFailure("quote_plan_invalid", "The signed quote plan is incomplete or belongs to another principal.", "Use the original signed-in account or request a new quote.", 409);
  }
  if (!validRef(plan.contract.unitActionRef, null, ACTION_ID) || !validCatalogPin(plan.contract.catalog) || !validModelChoicePin(plan.contract.modelChoicePin, MODEL_ID) || !validCanonicalChatInput(plan.input) || typeof plan.contract.eventsAdvertised !== "boolean" || plan.contract.requiresConfirmation !== false) {
    return contractFailure("quote_plan_invalid", "The signed quote plan contains an invalid Action contract.", "Request a new live quote.", 400);
  }
  const quote = projectCanonicalQuote(plan.quote, {
    contract: plan.contract,
    input: plan.input,
    budget: plan.budget,
    deadline: plan.deadline,
  });
  if (!quote.ok) return quote;
  const expectedInvokeRequest = {
    unit_action_ref: plan.contract.unitActionRef,
    catalog: plan.contract.catalog,
    model_choice_pin: plan.contract.modelChoicePin,
    quote_reference: quote.quote.quote_reference,
    input: plan.input,
    confirmed_effect_digest: null,
    deadline: plan.deadline,
  };
  if (!sameJSON(plan.invokeRequest, expectedInvokeRequest)) {
    return contractFailure("quote_plan_invalid", "The signed plan does not contain one exact canonical invoke request.", "Request a new live quote.", 400);
  }
  return {
    ok: true,
    plan: {
      contract: plan.contract,
      input: plan.input,
      quote: quote.quote,
      budget: plan.budget,
      deadline: plan.deadline,
      invokeRequest: plan.invokeRequest,
    },
  };
}

function validateInvocationProjection(raw, plan, invocationId, expectedSettlementReference = null) {
  if (!isObject(raw) || !RESOURCE_ID.test(String(raw.invocation_id || "")) || (invocationId && raw.invocation_id !== invocationId)) return false;
  if (!OBSERVABLE_STATES.has(raw.state)) return false;
  if (!sameJSON(raw.unit_action_ref, plan.contract.unitActionRef) || !sameJSON(raw.catalog, plan.contract.catalog) || !sameJSON(raw.model_choice_pin, plan.contract.modelChoicePin)) return false;
  if (raw.input_digest !== plan.quote.input_digest) return false;
  if (typeof raw.settlement_reference !== "string" || !OPAQUE_TEXT.test(raw.settlement_reference) ||
      (expectedSettlementReference !== null && raw.settlement_reference !== expectedSettlementReference)) return false;
  if (raw.state === "succeeded" && !canonicalChatResult(raw.result)) return false;
  return true;
}

function settlementFromReceipt(raw, expected) {
  if (!isObject(raw) || raw.invocation_id !== expected.invocationId || raw.idempotency_key !== expected.idempotencyKey) {
    return contractFailure("receipt_identity_mismatch", "The settlement receipt does not bind the expected Invocation and idempotency identity.", "Keep the operation for reconciliation; do not start a new key.");
  }
  if (raw.invocation_id === raw.idempotency_key || raw.terminal_state !== expected.state || !TERMINAL_STATES.has(raw.terminal_state)) {
    return contractFailure("receipt_identity_mismatch", "The receipt conflates identities or disagrees with the terminal Invocation state.", "Observe the same Invocation until one consistent receipt is available.");
  }
  if (!sameJSON(raw.unit_action_ref, expected.plan.contract.unitActionRef) || !sameJSON(raw.catalog, expected.plan.contract.catalog) || !sameJSON(raw.model_choice_pin, expected.plan.contract.modelChoicePin)) {
    return contractFailure("receipt_pin_drift", "The receipt drifted from the quoted UnitActionRef, Catalog, or model_choice_pin.", "Keep the operation for reconciliation and do not trust settlement fields.");
  }
  for (const field of ["input_digest", "price_digest", "policy_digest", "effect_digest"]) {
    if (typeof raw[field] !== "string" || !SHA256_DIGEST.test(raw[field]) || raw[field] !== expected.plan.quote[field]) {
      return contractFailure("receipt_digest_drift", `The receipt ${field} differs from the quote.`, "Keep the same Invocation for reconciliation.");
    }
  }
  if (raw.quote_reference !== expected.plan.quote.quote_reference || raw.quote_receipt !== expected.plan.quote.quote_receipt ||
      typeof raw.settlement_reference !== "string" || !OPAQUE_TEXT.test(raw.settlement_reference) ||
      raw.settlement_reference !== expected.settlementReference) {
    return contractFailure("receipt_reference_invalid", "The receipt does not bind the quote reference, quote receipt, and Invocation settlement reference.", "Keep the same Invocation for reconciliation.");
  }
  for (const field of ["held_aev_atoms", "captured_aev_atoms", "released_aev_atoms"]) {
    if (atomValue(raw[field]) === null) {
      return contractFailure("receipt_atoms_invalid", `Receipt ${field} is not a non-negative safe JSON integer.`, "Do not infer or round settlement; reconcile the same Invocation.");
    }
  }
  const held = raw.held_aev_atoms;
  const captured = raw.captured_aev_atoms;
  const released = raw.released_aev_atoms;
  if (captured > held || released !== held - captured) {
    return contractFailure("receipt_atoms_invalid", "Receipt capture plus release does not equal the held atom amount.", "Do not treat headers or provider output as settlement authority.");
  }
  const quote = expected.plan.quote;
  const authorized = quote.quote_kind === "exact" ? quote.amount_aev_atoms : quote.ceiling_aev_atoms;
  if (held !== authorized || captured > authorized) {
    return contractFailure("receipt_atoms_invalid", "Receipt atoms exceed or differ from the quote authorization.", "Reconcile the same Invocation; do not accept a larger charge.");
  }
  if (raw.terminal_state === "succeeded" && quote.quote_kind === "exact" && (captured !== authorized || released !== 0)) {
    return contractFailure("receipt_atoms_invalid", "A successful fixed-price receipt does not capture exactly the quoted atom amount.", "Reconcile the same Invocation.");
  }
  if (raw.terminal_state !== "succeeded" && (captured !== 0 || released !== held)) {
    return contractFailure("receipt_atoms_invalid", "A definite non-delivery receipt is not zero-net-charge.", "Reconcile the same Invocation; do not retry under a new key.");
  }
  return {
    ok: true,
    receipt: projectJSONFields(raw, [
      "invocation_id", "idempotency_key", "terminal_state", "unit_action_ref", "catalog", "model_choice_pin",
      "input_digest", "price_digest", "policy_digest", "effect_digest", "quote_reference", "quote_receipt",
      "held_aev_atoms", "captured_aev_atoms", "released_aev_atoms", "settlement_reference",
    ]),
    settlement: {
      terminal_state: raw.terminal_state,
      held_aev_atoms: held,
      captured_aev_atoms: captured,
      released_aev_atoms: released,
      settlement_reference: raw.settlement_reference,
    },
  };
}

function invocationPaths(plan, invocationId) {
  const ref = plan.contract.unitActionRef;
  return {
    observe: `/v1/service-units/${encodeURIComponent(ref.unit_id)}/actions/${encodeURIComponent(ref.action_id)}/invocations/${encodeURIComponent(invocationId)}`,
    receipt: `/v1/invocations/${encodeURIComponent(invocationId)}/receipt`,
    events: `/v1/invocations/${encodeURIComponent(invocationId)}/events`,
  };
}

async function readInvocation(payer, plan, invocationId, idempotencyKey, expectedSettlementReference = null) {
  const paths = invocationPaths(plan, invocationId);
  let observed;
  try { observed = await semeshFetch("GET", paths.observe, { authenticated: true, payer }); }
  catch (cause) {
    return { ok: false, status: 502, phase: "observe", effectStarted: true, invocationId, error: projectedError("invocation_observe", { cause }), paths };
  }
  const observation = canonicalObjectData(observed.json);
  if (observed.status >= 400 || observed.malformed || !observation ||
      !validateInvocationProjection(observation, plan, invocationId, expectedSettlementReference)) {
    return {
      ok: false,
      status: observed.status >= 400 ? observed.status : 502,
      phase: "observe",
      effectStarted: true,
      invocationId,
      error: observed.status >= 400 ? projectedError("invocation_observe", observed) : {
        code: "invocation_observation_malformed",
        message: "The canonical Invocation observation is malformed or drifted.",
        fix: "Observe this same invocation_id again; never substitute the Idempotency-Key as its identity.",
        retryable: true,
      },
      paths,
    };
  }
  if (!TERMINAL_STATES.has(observation.state)) {
    return {
      ok: false,
      status: 202,
      phase: "observe",
      effectStarted: true,
      invocationId,
      error: {
        code: "invocation_not_terminal",
        message: `Invocation ${invocationId} is ${observation.state}.`,
        fix: "Observe the same invocation_id; do not create a new key or switch model_choice_pin.",
        retryable: true,
      },
      paths,
    };
  }
  let receiptResponse;
  try { receiptResponse = await semeshFetch("GET", paths.receipt, { authenticated: true, payer }); }
  catch (cause) {
    return { ok: false, status: 502, phase: "receipt", effectStarted: true, invocationId, error: projectedError("invocation_receipt", { cause }), paths };
  }
  const receiptData = canonicalObjectData(receiptResponse.json);
  if (receiptResponse.status >= 400 || receiptResponse.malformed || !receiptData) {
    return {
      ok: false,
      status: receiptResponse.status >= 400 ? receiptResponse.status : 502,
      phase: "receipt",
      effectStarted: true,
      invocationId,
      error: receiptResponse.status >= 400 ? projectedError("invocation_receipt", receiptResponse) : {
        code: "receipt_malformed",
        message: "The canonical settlement receipt returned malformed JSON.",
        fix: "Read the same Invocation receipt again; do not infer settlement from a response header.",
        retryable: true,
      },
      paths,
    };
  }
  const settled = settlementFromReceipt(receiptData, {
    invocationId,
    idempotencyKey,
    state: observation.state,
    plan,
    settlementReference: observation.settlement_reference,
  });
  if (!settled.ok) {
    return { ...settled, phase: "receipt", effectStarted: true, invocationId, paths };
  }
  let events;
  let eventsError;
  if (plan.contract.eventsAdvertised) {
    try {
      const eventsResponse = await semeshFetch("GET", paths.events, { authenticated: true, payer });
      const eventData = canonicalObjectData(eventsResponse.json);
      if (eventsResponse.status >= 400 || eventsResponse.malformed || !isObject(eventData) || eventData.invocation_id !== invocationId || !Array.isArray(eventData.events)) {
        eventsError = eventsResponse.status >= 400 ? projectedError("invocation_events", eventsResponse) : {
          code: "invocation_events_malformed",
          message: "The advertised Invocation event stream is malformed.",
          fix: "Retry the same read-only events URL; the verified receipt remains settlement authority.",
          retryable: true,
        };
      } else {
        events = clonePublicJSON(eventData.events);
      }
    } catch (cause) {
      eventsError = projectedError("invocation_events", { cause });
    }
  }
  return {
    ok: observation.state === "succeeded",
    terminal: true,
    status: observation.state === "succeeded" ? 200 : 502,
    phase: "terminal",
    effectStarted: true,
    invocationId,
    result: observation.state === "succeeded" ? canonicalChatResult(observation.result) : undefined,
    receipt: settled.receipt,
    settlement: settled.settlement,
    events,
    eventsError,
    paths,
    error: observation.state === "succeeded" ? undefined : {
      code: "action_terminal_failure",
      message: `The Invocation ended in terminal state ${observation.state}.`,
      fix: "The receipt proves zero-net-charge for definite non-delivery; start a new operation only if the Action contract permits it.",
      retryable: false,
    },
  };
}

async function invokeAction(payer, plan, idempotencyKey) {
  const ref = plan.contract.unitActionRef;
  // The saved quote_reference is reused by this exact /invoke request; no re-quote occurs here.
  const route = `/v1/service-units/${encodeURIComponent(ref.unit_id)}/actions/${encodeURIComponent(ref.action_id)}/invoke`;
  const body = clonePublicJSON(plan.invokeRequest);
  let response;
  try {
    response = await semeshFetch("POST", route, { authenticated: true, payer, idempotencyKey, body });
  } catch (cause) {
    return { ok: false, status: 502, phase: "invoke", effectStarted: true, error: projectedError("invoke", { cause }) };
  }
  if (response.status >= 400) {
    const projected = projectedError("invoke", response);
    const bodyError = isObject(response.json) && isObject(response.json.error) ? response.json.error : null;
    const effectZero = isObject(bodyError) && bodyError.effect_state === "none" && bodyError.money_state === "none";
    return { ok: false, status: response.status, phase: "invoke", effectStarted: !effectZero, error: projected };
  }
  if (response.malformed) {
    return {
      ok: false,
      status: 502,
      phase: "invoke",
      effectStarted: true,
      error: {
        code: "invoke_response_malformed",
        message: "The invoke response is malformed, so its outcome is unknown.",
        fix: "Replay the identical signed quote plan with the same Idempotency-Key; never create a new key.",
        retryable: true,
      },
    };
  }
  const invoked = canonicalObjectData(response.json);
  const invocationId = isObject(invoked) ? String(invoked.invocation_id || "") : "";
  if (!RESOURCE_ID.test(invocationId) || invocationId === idempotencyKey || !validateInvocationProjection(invoked, plan, invocationId)) {
    return {
      ok: false,
      status: 502,
      phase: "invoke",
      effectStarted: true,
      error: {
        code: "invoke_identity_invalid",
        message: "The invoke response did not return one distinct, pinned invocation_id.",
        fix: "Replay the exact request with the same Idempotency-Key; do not invent an observation identity.",
        retryable: true,
      },
    };
  }
  return readInvocation(payer, plan, invocationId, idempotencyKey, invoked.settlement_reference);
}

function sendJSON(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

async function readJSONObject(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) {
      return contractFailure("request_body_too_large", "The request body must be at most 1 MiB.", "Reduce it and request a new quote.", 413);
    }
  }
  let value;
  try { value = JSON.parse(raw || "{}"); }
  catch { return contractFailure("invalid_json_body", "The request body must be valid JSON.", "Correct it before any paid action.", 400); }
  if (!isObject(value)) return contractFailure("invalid_action_input", "The request body must be a JSON object.", "Send one JSON object.", 400);
  return { ok: true, value };
}

function sendPreEffectProblem(res, status, error, phase, extra = {}) {
  return sendJSON(res, status, { error, phase, effect_started: false, ...extra });
}

function publicOperationResult(invoked, idempotencyKey, quote) {
  const common = {
    idempotency_key: idempotencyKey,
    invocation_id: invoked.invocationId,
    quote,
    phase: invoked.phase,
    effect_started: invoked.effectStarted,
    ...(invoked.paths ? { observe_url: invoked.paths.observe, receipt_url: invoked.paths.receipt, events_url: invoked.paths.events } : {}),
  };
  if (!invoked.terminal) return { status: invoked.status || 502, body: { ...common, error: invoked.error } };
  const terminal = {
    ...common,
    terminal: true,
    receipt_verified: true,
    receipt: invoked.receipt,
    result: invoked.result,
    ...(invoked.events ? { events: invoked.events } : {}),
    ...(invoked.eventsError ? { events_error: invoked.eventsError } : {}),
  };
  return invoked.ok
    ? { status: 200, body: { ...terminal, ok: true } }
    : { status: invoked.status || 502, body: { ...terminal, error: invoked.error } };
}

const CTYPE = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, "http://localhost"); }
  catch { return sendJSON(res, 400, { error: "bad_request" }); }

  if (url.pathname === "/healthz") return sendJSON(res, 200, { ok: true });

  if (url.pathname === "/api/me" && req.method === "GET") {
    return sendJSON(res, 200, { logged_in: !!payerToken(req), currency: "aev_atoms" });
  }

  if ((url.pathname === "/api/quote" || url.pathname === "/api/action" || url.pathname === "/api/observe") && req.method === "POST") {
    const payer = payerToken(req);
    if (!payer) {
      return sendPreEffectProblem(res, 401, {
        code: "login_required",
        message: "Sign in before using this paid Action.",
        fix: "Open /__semesh/login, then retry.",
        retryable: false,
      }, "auth", { login: "/__semesh/login" });
    }
    const principal = operationPrincipal(req);
    if (!principal.ok) return sendPreEffectProblem(res, principal.status, principal.error, "identity");
    if (!RUNTIME_KEY) {
      return sendPreEffectProblem(res, 500, {
        code: "app_not_configured",
        message: "SEMESH_APP_API_KEY is missing.",
        fix: "Configure the server-side runtime key; never send it to the browser.",
        retryable: false,
      }, "configuration");
    }
    const parsed = await readJSONObject(req);
    if (!parsed.ok) return sendPreEffectProblem(res, parsed.status, parsed.error, "input");

    if (url.pathname === "/api/quote") {
      if (atomValue(BUDGET_CEILING_AEV_ATOMS) === null || BUDGET_CEILING_AEV_ATOMS <= 0) {
        return sendPreEffectProblem(res, 500, {
          code: "action_budget_not_configured",
          message: "SEMESH_BUDGET_CEILING_AEV_ATOMS must parse as a positive JavaScript-safe JSON integer.",
          fix: "Set an explicit per-operation atom ceiling; the template never invents a spending limit.",
          retryable: false,
        }, "configuration");
      }
      const discovered = await discoverAction(parsed.value);
      if (!discovered.ok) return sendPreEffectProblem(res, discovered.status, discovered.error, "discovery");
      const budget = { ceiling_aev_atoms: BUDGET_CEILING_AEV_ATOMS };
      const deadline = new Date(Date.now() + ACTION_DEADLINE_SECONDS * 1000).toISOString();
      const quoted = await quoteAction(payer, parsed.value, discovered.contract, { budget, deadline });
      if (!quoted.ok) return sendPreEffectProblem(res, quoted.status, quoted.error, "quote", quoted.quote ? { quote: quoted.quote } : {});
      const quoteToken = sealQuotePlan(principal.principal, discovered.contract, parsed.value, quoted.quote, budget, deadline);
      const opened = openQuotePlan(quoteToken, principal.principal);
      if (!opened.ok) return sendPreEffectProblem(res, 500, opened.error, "quote_plan");
      return sendJSON(res, 200, {
        ok: true,
        quote: quoted.quote,
        quote_token: quoteToken,
        invoke_request: opened.plan.invokeRequest,
        selection: {
          unit_action_ref: discovered.contract.unitActionRef,
          catalog: discovered.contract.catalog,
          model_choice_pin: discovered.contract.modelChoicePin,
        },
      });
    }

    const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return sendPreEffectProblem(res, 400, {
        code: "idempotency_key_required",
        message: "Send one stable Idempotency-Key for this logical operation.",
        fix: "Persist one valid key with the signed quote plan before invoking.",
        retryable: false,
      }, "input");
    }
    const opened = openQuotePlan(parsed.value.quote_token, principal.principal);
    if (!opened.ok) return sendPreEffectProblem(res, opened.status, opened.error, "quote_plan", { idempotency_key: idempotencyKey });
    if (!sameJSON(parsed.value.invoke_request, opened.plan.invokeRequest)) {
      return sendPreEffectProblem(res, 409, {
        code: "invoke_request_drift",
        message: "The persisted invoke request differs from the signed quoted request.",
        fix: "Restore the exact saved request and Idempotency-Key; never rediscover or requote a pending operation.",
        retryable: false,
      }, "quote_plan", { idempotency_key: idempotencyKey });
    }

    if (url.pathname === "/api/observe") {
      const invocationId = String(parsed.value.invocation_id || "").trim();
      if (!RESOURCE_ID.test(invocationId) || invocationId === idempotencyKey) {
        return sendPreEffectProblem(res, 400, {
          code: "invocation_id_invalid",
          message: "Observation requires the distinct invocation_id returned by Semesh.",
          fix: "Never place the Idempotency-Key in the Invocation URL.",
          retryable: false,
        }, "input", { idempotency_key: idempotencyKey });
      }
      const observed = await readInvocation(payer, opened.plan, invocationId, idempotencyKey);
      const projected = publicOperationResult(observed, idempotencyKey, opened.plan.quote);
      return sendJSON(res, projected.status, projected.body);
    }

    const invoked = await invokeAction(payer, opened.plan, idempotencyKey);
    const projected = publicOperationResult(invoked, idempotencyKey, opened.plan.quote);
    return sendJSON(res, projected.status, projected.body);
  }

  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const filename = path.join(__dirname, "public", path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, ""));
  fs.readFile(filename, (error, data) => {
    if (error) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": CTYPE[path.extname(filename)] || "application/octet-stream" });
    res.end(data);
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`auth-payments-minimal listening on :${PORT} (base ${BASE})`));
}

module.exports = {
  server,
  discoverAction,
  quoteAction,
  projectCanonicalQuote,
  projectQuoteError,
  settlementFromReceipt,
  sealQuotePlan,
  openQuotePlan,
  safeTraceId,
};
