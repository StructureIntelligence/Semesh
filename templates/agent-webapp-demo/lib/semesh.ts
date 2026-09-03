// Semesh integration helpers.
//
// These wrap the three things Semesh injects into a deployed app:
//   1. Auth        — the /__semesh/* edge routes (login / logout / me).
//   2. Database    — a managed SQLite project, queried server-side with a server key.
//   3. Unit Action — one quoted, catalog-pinned, end-user-billed invocation.
//
// Nothing here is secret. Real values arrive as environment variables that
// `semesh deploy` injects at deploy time. See .env.example for the names.

import {
  isValidIdempotencyKey,
  isValidInvocationId,
  projectInvocationReceipt,
} from "./settlement.mjs";
import {
  explicitEffectZero,
  isCanonicalModelOutputSchema,
  readBoundedJSONResponse,
  selectCanonicalDeepSeekChoice,
} from "./polish-operation.mjs";

export { isValidIdempotencyKey, isValidInvocationId };

const SEMESH_BASE_URL = (
  process.env.SEMESH_BASE_URL || "https://api.semesh.net"
).replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// 1. Auth — client-visible edge routes. No SDK needed; just links + a fetch.
// ---------------------------------------------------------------------------

export function settleLoginPath(returnTo = "/") {
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return "/__semesh/login?return_to=" + encodeURIComponent(safe);
}

export function settleLogoutPath() {
  return "/__semesh/logout";
}

export type SettleUser = { id?: string; sub?: string; email?: string; name?: string };

// Call from the browser. Returns the signed-in user, or null when anonymous.
export async function currentSettleUser(): Promise<SettleUser | null> {
  const res = await fetch("/__semesh/me", { cache: "no-store" });
  if (!res.ok) return null;
  const payload = await res.json();
  return payload.authenticated ? (payload.user as SettleUser) : null;
}

export type PrincipalResolution =
  | { ok: true; principalId: string }
  | {
      ok: false;
      status: 401 | 503;
      code: "authentication_required" | "identity_authority_unavailable";
      message: string;
    };

function settleAuthorityCookie(req: Request): string {
  const accepted: string[] = [];
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    if (
      (name === "__semesh_session" || name === "__semesh_access") &&
      value.length > 0 &&
      value.length <= 8192 &&
      !/[\u0000-\u001f\u007f]/.test(value)
    ) {
      accepted.push(name + "=" + value);
    }
  }
  return accepted.join("; ");
}

// Resolve the browser session through the platform's same-origin auth authority. A payer/session
// token is an authorization secret, not a database identity: never decode it, hash it into an owner,
// or persist it. Only the authority's stable user id/sub is safe to use for row ownership.
export async function resolveSettlePrincipal(req: Request): Promise<PrincipalResolution> {
  const cookie = settleAuthorityCookie(req);
  if (!cookie) {
    return {
      ok: false,
      status: 401,
      code: "authentication_required",
      message: "Sign in with Semesh before accessing snippets.",
    };
  }

  let authorityURL: URL;
  try {
    authorityURL = new URL("/__semesh/me", req.url);
    if (authorityURL.protocol !== "https:" && authorityURL.protocol !== "http:") {
      throw new Error("unsupported request origin");
    }
  } catch {
    return {
      ok: false,
      status: 503,
      code: "identity_authority_unavailable",
      message: "Semesh identity could not be verified; no database operation was attempted.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(authorityURL, {
      method: "GET",
      headers: { cookie },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        status: 401,
        code: "authentication_required",
        message: "Your Semesh session is invalid or expired. Sign in again.",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: 503,
        code: "identity_authority_unavailable",
        message: "Semesh identity could not be verified; no database operation was attempted.",
      };
    }

    const payload = (await response.json()) as {
      authenticated?: boolean;
      user?: SettleUser;
    };
    const rawPrincipal = payload.user?.id || payload.user?.sub || "";
    if (
      payload.authenticated !== true ||
      typeof rawPrincipal !== "string" ||
      rawPrincipal.length === 0 ||
      rawPrincipal.length > 512 ||
      rawPrincipal !== rawPrincipal.trim() ||
      /[\u0000-\u001f\u007f]/.test(rawPrincipal)
    ) {
      return {
        ok: false,
        status: 503,
        code: "identity_authority_unavailable",
        message: "Semesh identity returned no valid stable principal; no database operation was attempted.",
      };
    }
    return { ok: true, principalId: "settle:" + rawPrincipal };
  } catch {
    return {
      ok: false,
      status: 503,
      code: "identity_authority_unavailable",
      message: "Semesh identity could not be verified; no database operation was attempted.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// 2. Database — managed SQLite. Server-side only (uses the server key).
// ---------------------------------------------------------------------------

export type DbResult = {
  status: number;
  payload: unknown;
  error?: string;
};

export async function dbQuery(sql: string, params: unknown[] = []): Promise<DbResult> {
  const projectId = process.env.SEMESH_PROJECT_ID;
  const serverKey = process.env.SEMESH_PROJECT_SERVER_KEY;
  if (!projectId || !serverKey) {
    return {
      status: 0,
      payload: null,
      error:
        "database env not injected (SEMESH_PROJECT_ID / SEMESH_PROJECT_SERVER_KEY missing). Deploy with `semesh deploy`.",
    };
  }
  const res = await fetch(
    `${SEMESH_BASE_URL}/v1/projects/${projectId}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${serverKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    }
  );
  const text = await res.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    return {
      status: res.status,
      payload,
      error: `managed database query failed with HTTP ${res.status}`,
    };
  }
  return { status: res.status, payload };
}

// ---------------------------------------------------------------------------
// 3. Canonical Unit Action — Search → token-pinned Detail → quote → invoke.
// ---------------------------------------------------------------------------
// Public discovery is GET /v1/service-units/search?q={query}&scope=public.
// Settlement authority is GET /v1/invocations/{invocation_id}/receipt.

type JsonObject = Record<string, unknown>;

export type UnitActionRef = {
  unit_id: string;
  unit_revision: string;
  action_id: string;
  action_revision: string;
};

export type CatalogPin = {
  view_generation: number;
  view_digest: string;
};

export type ModelChoicePin = {
  model_id: "deepseek-v3";
  model_revision: string;
};

export type CanonicalPolishInput = {
  messages: [
    { role: "system"; content: string },
    { role: "user"; content: string },
  ];
};

export type CanonicalQuoteEvidence = {
  quote_contract_version: "v1";
  quote_kind: "exact" | "hold_ceiling";
  currency: "aev";
  amount_aev_atoms?: number;
  ceiling_aev_atoms?: number;
  capture_basis?: "actual_usage";
  quote_reference: string;
  quote_receipt: string;
  input_digest: string;
  price_digest: string;
  policy_digest: string;
  effect_digest: string;
  model_choice_pin: ModelChoicePin;
};

export type PreparedPolishAction = {
  version: 1;
  unit_action_ref: UnitActionRef;
  catalog: CatalogPin;
  model_choice_pin: ModelChoicePin;
  input: CanonicalPolishInput;
  quote_reference: string;
  quote: CanonicalQuoteEvidence;
  confirmed_effect_digest: null;
  deadline: string;
};

type CanonicalFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  effect_started: boolean;
  invocation_id?: string;
};

export type PreparePolishResult =
  | {
      ok: true;
      status: 200;
      effect_started: false;
      prepared: PreparedPolishAction;
      quote: unknown;
    }
  | CanonicalFailure;

export type InvokePolishResult =
  | {
      ok: true;
      status: number;
      effect_started: true;
      invocation_id: string;
      state: string;
      result: unknown;
      receipt: unknown;
      settlement_status: "captured" | "released" | "unknown";
      captured_aev_atoms: number | null;
      released_aev_atoms: number | null;
    }
  | CanonicalFailure;

type SettlementProjection = {
  authoritative: boolean;
  settlement_status: "captured" | "released" | "unknown";
  captured_aev_atoms: number | null;
  released_aev_atoms: number | null;
  receipt: unknown;
};

const MAX_API_RESPONSE_BYTES = 2 * 1024 * 1024;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const TARGET_MODEL_ID = "deepseek-v3" as const;
const CATALOG_TOKEN = /^[\x21-\x7e]{8,4096}$/;
const DECIMAL_ATOMS = /^(0|[1-9][0-9]*)$/;
const TERMINAL_STATES = new Set(["succeeded", "failed", "canceled"]);
const OBSERVABLE_STATES = new Set([
  ...TERMINAL_STATES,
  "pending",
  "running",
  "reconciling",
]);

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: JsonObject, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameJSON(left: unknown, right: unknown): boolean {
  try {
    return canonicalJSON(left) === canonicalJSON(right);
  } catch {
    return false;
  }
}

function boundedIdentity(value: unknown, max = 512): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function runtimeIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= 512 &&
    value === value.trim() &&
    !/[ \t\r\n]/.test(value) &&
    !/\p{Cc}/u.test(value)
  );
}

function atomInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveAtomInteger(value: unknown): value is number {
  return atomInteger(value) && value > 0;
}

function validPayerToken(value: unknown): value is string {
  return boundedIdentity(value, 8192);
}

function envelopeData(payload: unknown): unknown {
  return isObject(payload) &&
    payload.success === true &&
    Object.prototype.hasOwnProperty.call(payload, "data")
    ? payload.data
    : undefined;
}

function envelopeMeta(payload: unknown): JsonObject | null {
  return isObject(payload) && payload.success === true && isObject(payload.meta)
    ? payload.meta
    : null;
}

function readCatalogPin(value: unknown): CatalogPin | null {
  if (
    !isObject(value) ||
    Object.keys(value).length !== 2 ||
    !Number.isSafeInteger(value.view_generation) ||
    (value.view_generation as number) <= 0 ||
    typeof value.view_digest !== "string" ||
    !DIGEST.test(value.view_digest)
  ) {
    return null;
  }
  return {
    view_generation: value.view_generation as number,
    view_digest: value.view_digest,
  };
}

function readCatalogIdentityPin(value: unknown): CatalogPin | null {
  if (
    !isObject(value) ||
    !Number.isSafeInteger(value.view_generation) ||
    (value.view_generation as number) <= 0 ||
    typeof value.view_digest !== "string" ||
    !DIGEST.test(value.view_digest)
  ) {
    return null;
  }
  return {
    view_generation: value.view_generation as number,
    view_digest: value.view_digest,
  };
}

function readUnitActionRef(value: unknown): UnitActionRef | null {
  if (
    !isObject(value) ||
    Object.keys(value).length !== 4 ||
    !boundedIdentity(value.unit_id, 200) ||
    !RESOURCE_ID.test(value.unit_id) ||
    !boundedIdentity(value.unit_revision, 256) ||
    !DIGEST.test(value.unit_revision) ||
    !boundedIdentity(value.action_id, 200) ||
    !RESOURCE_ID.test(value.action_id) ||
    !boundedIdentity(value.action_revision, 256) ||
    !DIGEST.test(value.action_revision)
  ) {
    return null;
  }
  return {
    unit_id: value.unit_id,
    unit_revision: value.unit_revision,
    action_id: value.action_id,
    action_revision: value.action_revision,
  };
}

function sameRef(left: unknown, right: UnitActionRef): boolean {
  const value = readUnitActionRef(left);
  return Boolean(
    value &&
      value.unit_id === right.unit_id &&
      value.unit_revision === right.unit_revision &&
      value.action_id === right.action_id &&
      value.action_revision === right.action_revision
  );
}

function sameCatalog(left: unknown, right: CatalogPin): boolean {
  const value = readCatalogPin(left);
  return Boolean(
    value &&
      value.view_generation === right.view_generation &&
      value.view_digest === right.view_digest
  );
}

function readModelChoicePin(value: unknown): ModelChoicePin | null {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ["model_id", "model_revision"]) ||
    value.model_id !== TARGET_MODEL_ID ||
    !runtimeIdentity(value.model_revision)
  ) {
    return null;
  }
  return { model_id: TARGET_MODEL_ID, model_revision: value.model_revision };
}

function sameModelChoicePin(left: unknown, right: ModelChoicePin): boolean {
  const value = readModelChoicePin(left);
  return Boolean(
    value &&
      value.model_id === right.model_id &&
      value.model_revision === right.model_revision
  );
}

function canonicalFailure(
  status: number,
  code: string,
  message: string,
  effectStarted = false,
  invocationId?: string
): CanonicalFailure {
  return {
    ok: false,
    status,
    code,
    message,
    effect_started: effectStarted,
    ...(invocationId ? { invocation_id: invocationId } : {}),
  };
}

async function readBoundedJSON(response: Response): Promise<unknown> {
  return readBoundedJSONResponse(response, MAX_API_RESPONSE_BYTES);
}

async function effectZeroFetch(
  url: string,
  init: RequestInit,
  timeoutMs = 10000
): Promise<{ response: Response; payload: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    return { response, payload: await readBoundedJSON(response) };
  } finally {
    clearTimeout(timeout);
  }
}

function apiConfiguration():
  | {
      ok: true;
      apiKey: string;
      query: string;
      unitId: string;
      actionId: string;
      ceilingAevAtoms: number;
    }
  | { ok: false; message: string } {
  const apiKey = String(process.env.SEMESH_APP_API_KEY || "").trim();
  const query = String(process.env.SEMESH_POLISH_QUERY || "").trim();
  const unitId = String(process.env.SEMESH_POLISH_UNIT_ID || "").trim();
  const actionId = String(process.env.SEMESH_POLISH_ACTION_ID || "").trim();
  const ceilingText = String(process.env.SEMESH_POLISH_CEILING_AEV_ATOMS || "").trim();
  const ceilingAevAtoms = Number(ceilingText);
  if (
    !boundedIdentity(apiKey, 8192) ||
    !boundedIdentity(query, 512) ||
    !boundedIdentity(unitId, 256) ||
    !boundedIdentity(actionId, 256) ||
    !DECIMAL_ATOMS.test(ceilingText) ||
    !positiveAtomInteger(ceilingAevAtoms)
  ) {
    return {
      ok: false,
      message:
        "Canonical polish configuration is incomplete. Set the query, exact Unit/Action selectors, API key, and positive Aev-atom ceiling after live discovery.",
    };
  }
  return {
    ok: true,
    apiKey,
    query,
    unitId,
    actionId,
    ceilingAevAtoms,
  };
}

function authenticatedHeaders(apiKey: string, payerToken: string): Record<string, string> {
  return {
    accept: "application/json",
    authorization: "Bearer " + apiKey,
    "content-type": "application/json",
    "X-Semesh-Payer": payerToken,
  };
}

function selectedModelChoicePin(
  action: JsonObject,
  enclosingRef: UnitActionRef
): ModelChoicePin | null {
  return readModelChoicePin(selectCanonicalDeepSeekChoice(action, enclosingRef));
}

function validatesPolishContract(action: JsonObject): boolean {
  return isCanonicalModelOutputSchema(action.output_schema);
}

function responsePreservesChoice(value: unknown, expected: ModelChoicePin): boolean {
  if (!isObject(value)) return false;
  return (
    !Object.prototype.hasOwnProperty.call(value, "model_choice") &&
    sameModelChoicePin(value.model_choice_pin, expected)
  );
}

function nonNegativeAtoms(value: unknown): value is number {
  return atomInteger(value);
}

function readCanonicalQuote(
  value: unknown,
  expected: {
    ref: UnitActionRef;
    catalog: CatalogPin;
    modelChoicePin: ModelChoicePin;
    input: CanonicalPolishInput;
    budget: { ceiling_aev_atoms: number };
    deadline: string;
  }
): CanonicalQuoteEvidence | null {
  if (
    !isObject(value) ||
    value.quote_contract_version !== "v1" ||
    (value.quote_kind !== "exact" && value.quote_kind !== "hold_ceiling") ||
    value.currency !== "aev" ||
    value.exists !== true ||
    value.callable !== true ||
    value.confirmation_required !== false ||
    !sameRef(value.unit_action_ref, expected.ref) ||
    !sameCatalog(value.catalog, expected.catalog) ||
    !sameModelChoicePin(value.model_choice_pin, expected.modelChoicePin) ||
    Object.prototype.hasOwnProperty.call(value, "model_choice") ||
    !sameJSON(value.input, expected.input) ||
    !sameJSON(value.budget, expected.budget) ||
    value.deadline !== expected.deadline ||
    !boundedIdentity(value.quote_reference, 1024) ||
    !boundedIdentity(value.quote_receipt, 65536) ||
    !boundedIdentity(value.input_digest, 320) ||
    !boundedIdentity(value.price_digest, 320) ||
    !boundedIdentity(value.policy_digest, 320) ||
    !boundedIdentity(value.effect_digest, 320) ||
    !DIGEST.test(value.input_digest) ||
    !DIGEST.test(value.price_digest) ||
    !DIGEST.test(value.policy_digest) ||
    !DIGEST.test(value.effect_digest)
  ) {
    return null;
  }
  if (
    (Object.prototype.hasOwnProperty.call(value, "amount_aev_atoms") &&
      !nonNegativeAtoms(value.amount_aev_atoms)) ||
    (Object.prototype.hasOwnProperty.call(value, "ceiling_aev_atoms") &&
      !nonNegativeAtoms(value.ceiling_aev_atoms))
  ) {
    return null;
  }

  if (value.quote_kind === "exact") {
    if (
      !nonNegativeAtoms(value.amount_aev_atoms) ||
      value.amount_aev_atoms > expected.budget.ceiling_aev_atoms
    ) {
      return null;
    }
    return {
      quote_contract_version: "v1",
      quote_kind: "exact",
      currency: "aev",
      amount_aev_atoms: value.amount_aev_atoms,
      quote_reference: value.quote_reference,
      quote_receipt: value.quote_receipt,
      input_digest: value.input_digest,
      price_digest: value.price_digest,
      policy_digest: value.policy_digest,
      effect_digest: value.effect_digest,
      model_choice_pin: expected.modelChoicePin,
    };
  }

  if (
    !nonNegativeAtoms(value.ceiling_aev_atoms) ||
    value.ceiling_aev_atoms === 0 ||
    value.ceiling_aev_atoms > expected.budget.ceiling_aev_atoms ||
    value.capture_basis !== "actual_usage"
  ) {
    return null;
  }
  return {
    quote_contract_version: "v1",
    quote_kind: "hold_ceiling",
    currency: "aev",
    ceiling_aev_atoms: value.ceiling_aev_atoms,
    capture_basis: "actual_usage",
    quote_reference: value.quote_reference,
    quote_receipt: value.quote_receipt,
    input_digest: value.input_digest,
    price_digest: value.price_digest,
    policy_digest: value.policy_digest,
    effect_digest: value.effect_digest,
    model_choice_pin: expected.modelChoicePin,
  };
}

function storedQuoteEvidence(
  value: unknown,
  modelChoicePin: ModelChoicePin,
  quoteReference: unknown
): CanonicalQuoteEvidence | null {
  if (!isObject(value)) return null;
  const quoteKeys = [
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
    !hasExactKeys(value, quoteKeys) ||
    value.quote_contract_version !== "v1" ||
    (value.quote_kind !== "exact" && value.quote_kind !== "hold_ceiling") ||
    value.currency !== "aev" ||
    value.quote_reference !== quoteReference ||
    !boundedIdentity(value.quote_reference, 1024) ||
    !boundedIdentity(value.quote_receipt, 65536) ||
    !boundedIdentity(value.input_digest, 320) ||
    !boundedIdentity(value.price_digest, 320) ||
    !boundedIdentity(value.policy_digest, 320) ||
    !boundedIdentity(value.effect_digest, 320) ||
    !DIGEST.test(value.input_digest) ||
    !DIGEST.test(value.price_digest) ||
    !DIGEST.test(value.policy_digest) ||
    !DIGEST.test(value.effect_digest) ||
    !sameModelChoicePin(value.model_choice_pin, modelChoicePin) ||
    Object.prototype.hasOwnProperty.call(value, "model_choice")
  ) {
    return null;
  }
  const common = {
    quote_contract_version: "v1" as const,
    currency: "aev" as const,
    quote_reference: value.quote_reference,
    quote_receipt: value.quote_receipt,
    input_digest: value.input_digest,
    price_digest: value.price_digest,
    policy_digest: value.policy_digest,
    effect_digest: value.effect_digest,
    model_choice_pin: modelChoicePin,
  };
  if (value.quote_kind === "exact") {
    if (!nonNegativeAtoms(value.amount_aev_atoms)) return null;
    return { ...common, quote_kind: "exact", amount_aev_atoms: value.amount_aev_atoms };
  }
  if (
    !nonNegativeAtoms(value.ceiling_aev_atoms) ||
      value.ceiling_aev_atoms === 0 ||
      value.capture_basis !== "actual_usage"
  ) {
    return null;
  }
  return {
    ...common,
    quote_kind: "hold_ceiling",
    ceiling_aev_atoms: value.ceiling_aev_atoms,
    capture_basis: "actual_usage",
  };
}

function readPreparedPolishInput(value: unknown): CanonicalPolishInput | null {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ["messages"]) ||
    !Array.isArray(value.messages) ||
    value.messages.length !== 2
  ) {
    return null;
  }
  const system = value.messages[0];
  const user = value.messages[1];
  if (
    !isObject(system) ||
    !hasExactKeys(system, ["role", "content"]) ||
    system.role !== "system" ||
    typeof system.content !== "string" ||
    system.content.length === 0 ||
    system.content.length > 1000 ||
    !isObject(user) ||
    !hasExactKeys(user, ["role", "content"]) ||
    user.role !== "user" ||
    typeof user.content !== "string" ||
    user.content.length === 0 ||
    user.content.length > 10000
  ) {
    return null;
  }
  return {
    messages: [
      { role: "system", content: system.content },
      { role: "user", content: user.content },
    ],
  };
}

function preparedAction(value: unknown): PreparedPolishAction | null {
  if (!isObject(value) || value.version !== 1) return null;
  const ref = readUnitActionRef(value.unit_action_ref);
  const catalog = readCatalogPin(value.catalog);
  const modelChoicePin = readModelChoicePin(value.model_choice_pin);
  const input = readPreparedPolishInput(value.input);
  const quote = input && modelChoicePin
    ? storedQuoteEvidence(value.quote, modelChoicePin, value.quote_reference)
    : null;
  if (
    !ref ||
    !catalog ||
    !modelChoicePin ||
    !quote ||
    !input ||
    !hasExactKeys(value, [
      "version",
      "unit_action_ref",
      "catalog",
      "model_choice_pin",
      "input",
      "quote_reference",
      "quote",
      "confirmed_effect_digest",
      "deadline",
    ]) ||
    !boundedIdentity(value.quote_reference, 1024) ||
    value.confirmed_effect_digest !== null ||
    typeof value.deadline !== "string" ||
    !Number.isFinite(Date.parse(value.deadline)) ||
    Object.prototype.hasOwnProperty.call(value, "catalog_token")
  ) {
    return null;
  }
  return {
    version: 1,
    unit_action_ref: ref,
    catalog,
    model_choice_pin: modelChoicePin,
    input,
    quote_reference: value.quote_reference,
    quote,
    confirmed_effect_digest: null,
    deadline: value.deadline,
  };
}

export async function prepareCanonicalPolishAction(
  text: string,
  options: { payerToken: string }
): Promise<PreparePolishResult> {
  const config = apiConfiguration();
  if (config.ok === false) {
    return canonicalFailure(503, "canonical_polish_unavailable", config.message);
  }
  if (!validPayerToken(options.payerToken)) {
    return canonicalFailure(
      401,
      "delegated_payer_required",
      "A valid delegated payer session is required; app-owner fallback is disabled."
    );
  }
  if (typeof text !== "string" || text.length === 0 || text.length > 10000) {
    return canonicalFailure(400, "invalid_polish_input", "Polish text must contain 1–10000 characters.");
  }

  let searchResponse: Response;
  let searchPayload: unknown;
  try {
    const searchURL = new URL(SEMESH_BASE_URL + "/v1/service-units/search");
    searchURL.searchParams.set("q", config.query);
    searchURL.searchParams.set("scope", "public");
    ({ response: searchResponse, payload: searchPayload } = await effectZeroFetch(searchURL.href, {
      method: "GET",
      headers: { accept: "application/json" },
    }));
  } catch {
    return canonicalFailure(
      503,
      "canonical_search_unavailable",
      "Live canonical public Search is unavailable; no quote or invoke was attempted."
    );
  }
  if (
    !searchResponse.ok ||
    !isObject(searchPayload) ||
    searchPayload.success !== true ||
    !Array.isArray(searchPayload.data)
  ) {
    return canonicalFailure(
      503,
      "canonical_search_unavailable",
      "Live canonical public Search did not return a usable Unit catalog; no quote or invoke was attempted."
    );
  }
  const units = searchPayload.data.filter(
    (item) => isObject(item) && item.kind === "unit"
  );
  const searchMeta = envelopeMeta(searchPayload);
  const catalogIdentity = searchMeta?.catalog_identity;
  const catalogIdentityPin = readCatalogIdentityPin(catalogIdentity);
  const catalogToken = searchMeta?.catalog_token;
  if (
    units.length !== 1 ||
    !isObject(units[0]) ||
    units[0].id !== config.unitId ||
    !catalogIdentityPin ||
    typeof catalogToken !== "string" ||
    !CATALOG_TOKEN.test(catalogToken)
  ) {
    return canonicalFailure(
      503,
      "canonical_unit_not_discovered",
      "The configured Unit was not uniquely advertised with a valid Catalog token and identity; no quote or invoke was attempted."
    );
  }

  let detailResponse: Response;
  let detailPayload: unknown;
  try {
    const detailURL = new URL(
      SEMESH_BASE_URL + "/v1/service-units/" + encodeURIComponent(config.unitId)
    );
    detailURL.searchParams.set("scope", "public");
    ({ response: detailResponse, payload: detailPayload } = await effectZeroFetch(detailURL.href, {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-Semesh-Catalog-Token": catalogToken,
      },
    }));
  } catch {
    return canonicalFailure(
      503,
      "canonical_detail_unavailable",
      "Token-pinned canonical Unit Detail is unavailable; no quote or invoke was attempted."
    );
  }
  const detail = envelopeData(detailPayload);
  const detailMeta = envelopeMeta(detailPayload);
  const catalog = isObject(detail) ? readCatalogPin(detail.catalog) : null;
  if (
    !detailResponse.ok ||
    !isObject(detail) ||
    detail.kind !== "unit" ||
    detail.id !== config.unitId ||
    detailMeta?.catalog_token !== catalogToken ||
    !sameJSON(detailMeta?.catalog_identity, catalogIdentity) ||
    !catalog ||
    !sameCatalog(catalog, catalogIdentityPin) ||
    !Array.isArray(detail.actions)
  ) {
    return canonicalFailure(
      503,
      "canonical_detail_invalid",
      "Canonical Unit Detail did not preserve the Search identity; no quote or invoke was attempted."
    );
  }
  const actionMatches = detail.actions.filter((item) => {
    if (!isObject(item)) return false;
    const ref = readUnitActionRef(item.unit_action_ref);
    return (
      item.id === config.actionId &&
      ref?.unit_id === config.unitId &&
      ref.action_id === config.actionId
    );
  });
  if (actionMatches.length !== 1) {
    return canonicalFailure(
      503,
      "canonical_action_not_discovered",
      "The configured polish Action was not uniquely advertised by the selected Unit; no quote or invoke was attempted."
    );
  }
  const action = actionMatches[0] as JsonObject;
  const ref = readUnitActionRef(action.unit_action_ref);
  const modelChoicePin = ref ? selectedModelChoicePin(action, ref) : null;
  const effect = isObject(action.effect) ? action.effect : null;
  if (
    !ref ||
    action.callable !== true ||
    action.availability !== "available" ||
    effect?.requires_confirmation !== false ||
    effect.destructive === true ||
    !validatesPolishContract(action) ||
    !modelChoicePin
  ) {
    return canonicalFailure(
      503,
      "canonical_action_unavailable",
      "The selected Action is unavailable, schema-incompatible, or does not advertise one exact deepseek-v3 model choice ref; no quote or invoke was attempted."
    );
  }

  const input: CanonicalPolishInput = {
    messages: [
      {
        role: "system",
        content: "Tidy and clarify the user's snippet while preserving its meaning.",
      },
      { role: "user", content: text },
    ],
  };
  const deadline = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const quoteBody = {
    unit_action_ref: ref,
    catalog,
    model_choice_pin: modelChoicePin,
    input,
    budget: { ceiling_aev_atoms: config.ceilingAevAtoms },
    deadline,
  };
  let quoteResponse: Response;
  let quotePayload: unknown;
  try {
    ({ response: quoteResponse, payload: quotePayload } = await effectZeroFetch(
      SEMESH_BASE_URL +
        "/v1/service-units/" +
        encodeURIComponent(ref.unit_id) +
        "/actions/" +
        encodeURIComponent(ref.action_id) +
        "/quote",
      {
        method: "POST",
        headers: authenticatedHeaders(config.apiKey, options.payerToken),
        body: JSON.stringify(quoteBody),
      }
    ));
  } catch {
    return canonicalFailure(
      503,
      "canonical_quote_unavailable",
      "The authenticated effect-zero Action quote is unavailable; no invoke was attempted."
    );
  }
  const quote = readCanonicalQuote(envelopeData(quotePayload), {
    ref,
    catalog,
    modelChoicePin,
    input,
    budget: quoteBody.budget,
    deadline,
  });
  if (
    !quoteResponse.ok ||
    !quote
  ) {
    return canonicalFailure(
      quoteResponse.ok ? 502 : quoteResponse.status,
      "canonical_quote_rejected",
      "The effect-zero Action quote was rejected or did not preserve the exact Unit, Action, Catalog, and model choice; no invoke was attempted."
    );
  }

  return {
    ok: true,
    status: 200,
    effect_started: false,
    prepared: {
      version: 1,
      unit_action_ref: ref,
      catalog,
      model_choice_pin: modelChoicePin,
      input,
      quote_reference: quote.quote_reference,
      quote,
      confirmed_effect_digest: null,
      deadline,
    },
    quote,
  };
}

export async function invokePreparedPolishAction(
  candidate: unknown,
  options: { payerToken: string; idempotencyKey: string }
): Promise<InvokePolishResult> {
  const config = apiConfiguration();
  const prepared = preparedAction(candidate);
  if (config.ok === false) {
    return canonicalFailure(503, "canonical_polish_unavailable", config.message);
  }
  if (!validPayerToken(options.payerToken)) {
    return canonicalFailure(401, "delegated_payer_required", "A valid delegated payer session is required.");
  }
  if (!isValidIdempotencyKey(options.idempotencyKey)) {
    return canonicalFailure(400, "idempotency_key_required", "A stable Idempotency-Key is required.");
  }
  if (
    !prepared ||
    prepared.unit_action_ref.unit_id !== config.unitId ||
    prepared.unit_action_ref.action_id !== config.actionId
  ) {
    return canonicalFailure(
      400,
      "prepared_action_invalid",
      "The frozen quote/invoke request is missing or does not match the configured canonical Unit Action."
    );
  }

  const invokeBody = {
    unit_action_ref: prepared.unit_action_ref,
    catalog: prepared.catalog,
    model_choice_pin: prepared.model_choice_pin,
    quote_reference: prepared.quote_reference,
    input: prepared.input,
    confirmed_effect_digest: prepared.confirmed_effect_digest,
    deadline: prepared.deadline,
  };
  let invokeResponse: Response;
  let invokePayload: unknown;
  try {
    invokeResponse = await fetch(
      SEMESH_BASE_URL +
        "/v1/service-units/" +
        encodeURIComponent(prepared.unit_action_ref.unit_id) +
        "/actions/" +
        encodeURIComponent(prepared.unit_action_ref.action_id) +
        "/invoke",
      {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        headers: {
          ...authenticatedHeaders(config.apiKey, options.payerToken),
          "Idempotency-Key": options.idempotencyKey,
        },
        body: JSON.stringify(invokeBody),
      }
    );
    invokePayload = await readBoundedJSON(invokeResponse);
  } catch {
    return canonicalFailure(
      502,
      "invoke_outcome_unknown",
      "The invoke response was lost. Retry only the exact frozen request with the same Idempotency-Key.",
      true
    );
  }
  if (!invokeResponse.ok) {
    const absent = explicitEffectZero(invokePayload);
    return canonicalFailure(
      invokeResponse.status,
      absent ? "invoke_rejected_effect_zero" : "invoke_outcome_unknown",
      absent
        ? "Canonical invoke was explicitly rejected before any effect. Request a new live quote."
        : "Canonical invoke failed without authoritative effect-zero evidence. Retry only the exact frozen request and Idempotency-Key.",
      !absent
    );
  }

  const invocation = envelopeData(invokePayload);
  if (
    !isObject(invocation) ||
    !isValidInvocationId(invocation.invocation_id) ||
    invocation.invocation_id === options.idempotencyKey ||
    !sameRef(invocation.unit_action_ref, prepared.unit_action_ref) ||
    !sameCatalog(invocation.catalog, prepared.catalog) ||
    typeof invocation.state !== "string" ||
    !OBSERVABLE_STATES.has(invocation.state) ||
    !boundedIdentity(invocation.settlement_reference, 1024) ||
    invocation.input_digest !== prepared.quote.input_digest ||
    !responsePreservesChoice(invocation, prepared.model_choice_pin)
  ) {
    return canonicalFailure(
      502,
      "invoke_response_invalid",
      "Invoke succeeded at the transport boundary but returned no trustworthy canonical Invocation identity. Retry only the exact frozen request and Idempotency-Key.",
      true
    );
  }
  const invocationId = invocation.invocation_id as string;
  const settlementReference = invocation.settlement_reference as string;
  let observed: unknown = invocation;
  try {
    const observation = await effectZeroFetch(
      SEMESH_BASE_URL +
        "/v1/service-units/" +
        encodeURIComponent(prepared.unit_action_ref.unit_id) +
        "/actions/" +
        encodeURIComponent(prepared.unit_action_ref.action_id) +
        "/invocations/" +
        encodeURIComponent(invocationId),
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: "Bearer " + config.apiKey,
          "X-Semesh-Payer": options.payerToken,
        },
      }
    );
    const candidateObservation = envelopeData(observation.payload);
    if (
      observation.response.ok &&
      isObject(candidateObservation) &&
      candidateObservation.invocation_id === invocationId &&
      sameRef(candidateObservation.unit_action_ref, prepared.unit_action_ref) &&
      sameCatalog(candidateObservation.catalog, prepared.catalog) &&
      typeof candidateObservation.state === "string" &&
      OBSERVABLE_STATES.has(candidateObservation.state) &&
      candidateObservation.settlement_reference === settlementReference &&
      candidateObservation.input_digest === prepared.quote.input_digest &&
      responsePreservesChoice(candidateObservation, prepared.model_choice_pin)
    ) {
      observed = candidateObservation;
    }
  } catch {
    // The returned invocation_id remains the only observation identity. Never substitute the key.
  }

  const observedObject = observed as JsonObject;
  let receiptProjection: SettlementProjection = {
    authoritative: false,
    settlement_status: "unknown" as const,
    captured_aev_atoms: null as number | null,
    released_aev_atoms: null as number | null,
    receipt: null as unknown,
  };
  try {
    const receiptResponse = await effectZeroFetch(
      SEMESH_BASE_URL +
        "/v1/invocations/" +
        encodeURIComponent(invocationId) +
        "/receipt",
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: "Bearer " + config.apiKey,
          "X-Semesh-Payer": options.payerToken,
        },
      }
    );
    if (receiptResponse.response.ok) {
      receiptProjection = projectInvocationReceipt(receiptResponse.payload, {
        invocation_id: invocationId,
        idempotency_key: options.idempotencyKey,
        settlement_reference: settlementReference,
        state: String(observedObject.state),
        unit_action_ref: prepared.unit_action_ref,
        catalog: prepared.catalog,
        model_choice_pin: prepared.model_choice_pin,
        quote: prepared.quote,
      }) as SettlementProjection;
    }
  } catch {
    // Missing receipt means settlement remains unknown; response headers never upgrade it.
  }

  const state = String(observedObject.state);
  return {
    ok: true,
    status: TERMINAL_STATES.has(state) ? 200 : 202,
    effect_started: true,
    invocation_id: invocationId,
    state,
    result: Object.prototype.hasOwnProperty.call(observedObject, "result")
      ? observedObject.result
      : invocation.result,
    receipt: receiptProjection.receipt,
    settlement_status: receiptProjection.settlement_status,
    captured_aev_atoms: receiptProjection.captured_aev_atoms,
    released_aev_atoms: receiptProjection.released_aev_atoms,
  };
}

export async function observePreparedPolishAction(
  candidate: unknown,
  options: { payerToken: string; invocationId: string; idempotencyKey: string }
): Promise<InvokePolishResult> {
  const config = apiConfiguration();
  const prepared = preparedAction(candidate);
  if (config.ok === false) {
    return canonicalFailure(
      503,
      "canonical_polish_unavailable",
      config.message,
      true,
      options.invocationId
    );
  }
  if (!validPayerToken(options.payerToken)) {
    return canonicalFailure(
      401,
      "delegated_payer_required",
      "A valid delegated payer session is required to observe this Invocation.",
      true,
      options.invocationId
    );
  }
  if (
    !isValidInvocationId(options.invocationId) ||
    !isValidIdempotencyKey(options.idempotencyKey) ||
    options.invocationId === options.idempotencyKey ||
    !prepared ||
    prepared.unit_action_ref.unit_id !== config.unitId ||
    prepared.unit_action_ref.action_id !== config.actionId
  ) {
    return canonicalFailure(
      400,
      "invocation_observation_invalid",
      "The stored Invocation id or its frozen Unit Action request is invalid.",
      true,
      options.invocationId
    );
  }

  let observationPayload: unknown;
  try {
    const observation = await effectZeroFetch(
      SEMESH_BASE_URL +
        "/v1/service-units/" +
        encodeURIComponent(prepared.unit_action_ref.unit_id) +
        "/actions/" +
        encodeURIComponent(prepared.unit_action_ref.action_id) +
        "/invocations/" +
        encodeURIComponent(options.invocationId),
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: "Bearer " + config.apiKey,
          "X-Semesh-Payer": options.payerToken,
        },
      }
    );
    if (!observation.response.ok) {
      return canonicalFailure(
        observation.response.status,
        "invocation_observation_unavailable",
        "The stored Invocation could not be observed. Retry observation with this invocation_id.",
        true,
        options.invocationId
      );
    }
    observationPayload = envelopeData(observation.payload);
  } catch {
    return canonicalFailure(
      502,
      "invocation_observation_unavailable",
      "The stored Invocation could not be observed. Retry observation with this invocation_id.",
      true,
      options.invocationId
    );
  }
  if (
    !isObject(observationPayload) ||
    observationPayload.invocation_id !== options.invocationId ||
    !sameRef(observationPayload.unit_action_ref, prepared.unit_action_ref) ||
    !sameCatalog(observationPayload.catalog, prepared.catalog) ||
    typeof observationPayload.state !== "string" ||
    !OBSERVABLE_STATES.has(observationPayload.state) ||
    !boundedIdentity(observationPayload.settlement_reference, 1024) ||
    observationPayload.input_digest !== prepared.quote.input_digest ||
    !responsePreservesChoice(observationPayload, prepared.model_choice_pin)
  ) {
    return canonicalFailure(
      502,
      "invocation_observation_invalid",
      "The observation did not match the stored Invocation, Unit Action, and Catalog pin.",
      true,
      options.invocationId
    );
  }

  let receiptProjection: SettlementProjection = {
    authoritative: false,
    settlement_status: "unknown" as const,
    captured_aev_atoms: null as number | null,
    released_aev_atoms: null as number | null,
    receipt: null as unknown,
  };
  try {
    const receiptResponse = await effectZeroFetch(
      SEMESH_BASE_URL +
        "/v1/invocations/" +
        encodeURIComponent(options.invocationId) +
        "/receipt",
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: "Bearer " + config.apiKey,
          "X-Semesh-Payer": options.payerToken,
        },
      }
    );
    if (receiptResponse.response.ok) {
      receiptProjection = projectInvocationReceipt(receiptResponse.payload, {
        invocation_id: options.invocationId,
        idempotency_key: options.idempotencyKey,
        settlement_reference: observationPayload.settlement_reference,
        state: observationPayload.state,
        unit_action_ref: prepared.unit_action_ref,
        catalog: prepared.catalog,
        model_choice_pin: prepared.model_choice_pin,
        quote: prepared.quote,
      }) as SettlementProjection;
    }
  } catch {
    // No receipt authority: settlement remains unknown.
  }

  const state = observationPayload.state;
  return {
    ok: true,
    status: TERMINAL_STATES.has(state) ? 200 : 202,
    effect_started: true,
    invocation_id: options.invocationId,
    state,
    result: observationPayload.result,
    receipt: receiptProjection.receipt,
    settlement_status: receiptProjection.settlement_status,
    captured_aev_atoms: receiptProjection.captured_aev_atoms,
    released_aev_atoms: receiptProjection.released_aev_atoms,
  };
}

// Pull the end user's Semesh session token out of an incoming request so a
// downstream Unit Action can bill them. Semesh sets the __semesh_session
// cookie on authenticated requests; we also accept an explicit header.
export function extractPayerToken(req: Request): string | null {
  const header = (req.headers.get("x-semesh-payer") || "").trim();
  if (header && header.length <= 8192 && !/[\u0000-\u001f\u007f]/.test(header)) return header;
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)__semesh_(?:session|access)=([^;]+)/);
  if (!match) return null;
  try {
    const token = decodeURIComponent(match[1]).trim();
    return token && token.length <= 8192 && !/[\u0000-\u001f\u007f]/.test(token) ? token : null;
  } catch {
    return null;
  }
}
