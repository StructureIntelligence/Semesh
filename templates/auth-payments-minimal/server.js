// auth-payments-minimal — the "hello world" of paid apps on Semesh.
//
// THE WHOLE POINT (the G2 end-user-pays loop):
//   The user signs in with their Semesh account at the platform auth gate (/__semesh/login).
//   This server then bills THAT logged-in user — not you, the developer — for one paid action, by:
//     1. authenticating to Semesh with the app's injected runtime key (SEMESH_APP_API_KEY), and
//     2. forwarding the user's session token as the `X-Semesh-Payer` header on the billable call.
//   `X-Semesh-Payer` is what charges the LOGGED-IN USER's Aev wallet instead of yours. We ALWAYS send
//   it on user-triggered billable calls. If it's absent, the route returns 401 and the UI shows a
//   "Sign in with Semesh" button — we never silently bill the developer for a user action.
//
//   THE RUNTIME KEY NEVER REACHES THE BROWSER. It stays server-side; the browser only talks to /api/*.
//
//   PRICE AUTHORITY: the only price is a live read-only POST /v1/billing/quote for the exact input.
//   There is no static/assumed price fallback. A quote transport/backend/provider/availability/contract
//   failure is projected as a machine-readable error and prevents invoke.
//
//   PRINCIPAL BINDING: the browser binds each recovery record to /__semesh/me user.sub (or id when
//   sub is absent). Before quote or invoke, this server compares that non-secret binding with the
//   trusted x-semesh-user-id injected by the Semesh edge. Missing/mismatched identity fails
//   pre-effect. Never expose these routes on a path that bypasses that edge.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const BASE = (process.env.SEMESH_BASE_URL || "https://api.semesh.net").replace(/\/+$/, "");
// Injected by the platform at deploy time. Locally, export it yourself (see README).
const RUNTIME_KEY = process.env.SEMESH_APP_API_KEY || process.env.SEMESH_API_KEY || "";

// -------------------------------------------------------------------------------------------------
// CONFIGURE YOUR PAID ACTION HERE.
//
// A "capability" is a metered Semesh action invoked at POST /v1/capabilities/{id}/invoke.
// Pick the capability your app charges for, set its ID below, and shape `input` to match it.
//
// TODO(you): set CAPABILITY_ID to the capability you want to bill for, and confirm the exact
//            `input` body for it. The capability catalogue + per-capability request shapes are in
//            the agent guide at https://semesh.io/agent.md — do NOT guess the ID or body.
//            (Example real capability used by other templates: "image.gpt-image-2".)
const CAPABILITY_ID = "REPLACE_WITH_A_REAL_CAPABILITY_ID"; // e.g. "image.gpt-image-2"

const QUOTE_KINDS = new Set(["exact", "representative_floor", "hold_ceiling"]);
const SAFE_TRACE_ID = /^[A-Za-z0-9_-]{8,128}$/;
const SAFE_MACHINE_CODE = /^[a-z][a-z0-9_]{0,127}$/;
// Treat the principal as an opaque OIDC subject. Visible ASCII is header-safe without baking in a
// UUID/email/provider format; the strict bound prevents unbounded storage/header amplification.
const PRINCIPAL_ID = /^[\x21-\x7E]{1,200}$/;
const configuredQuoteTimeout = Number(process.env.SEMESH_QUOTE_TIMEOUT_MS);
const DEFAULT_QUOTE_TIMEOUT_MS = Number.isFinite(configuredQuoteTimeout) && configuredQuoteTimeout >= 100 && configuredQuoteTimeout <= 60000
  ? configuredQuoteTimeout
  : 15000;
const QUOTE_AMOUNT_FIELDS = [
  "base_cost_credits",
  "markup_credits",
  "total_credits",
  "ceiling_credits",
  "hold_ceiling_credits",
  "preauthorization_credits",
  "capture_ceiling_credits",
];

// -------------------------------------------------------------------------------------------------
// Payer extraction: the logged-in user's token. Bearer header, else the durable __semesh_session
// cookie (7-day), else the short-lived __semesh_access cookie. "" when nobody is logged in.
// -------------------------------------------------------------------------------------------------
function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function payerToken(req) {
  const auth = String(req.headers["authorization"] || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const c = parseCookies(req.headers["cookie"]);
  return c["__semesh_session"] || c["__semesh_access"] || "";
}

// -------------------------------------------------------------------------------------------------
// Semesh call helper. RUNTIME_KEY authenticates the app; X-Semesh-Payer bills the logged-in user.
// -------------------------------------------------------------------------------------------------
async function semeshFetch(method, p, payer, body, idempotencyKey, options = {}) {
  const headers = { Authorization: "Bearer " + RUNTIME_KEY };
  if (payer) headers["X-Semesh-Payer"] = payer; // <-- this header makes the USER pay
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (body) headers["Content-Type"] = "application/json";
  const init = { method, headers, body: body ? JSON.stringify(body) : undefined };
  if (options.signal) init.signal = options.signal;
  const res = await fetch(BASE + p, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json, headers: res.headers };
}

// Invoke a metered capability: POST /v1/capabilities/{id}/invoke with {input}.
function invokeCapability(capabilityId, input, payer, idempotencyKey) {
  return semeshFetch("POST", `/v1/capabilities/${encodeURIComponent(capabilityId)}/invoke`, payer, { input: input || {} }, idempotencyKey);
}

// Unwrap a possibly-{success,data,meta}-wrapped response down to its payload object.
function unwrap(json) {
  if (json && typeof json === "object" && json.data && typeof json.data === "object") return json.data;
  return json || {};
}

// Only the explicit Semesh post-capture header is authoritative here. Provider output may contain
// arbitrary cost/amount-like business fields and is never billing evidence.
function captureEvidence(headers) {
  const raw = headers && headers.get("x-semesh-charged-aev");
  if (raw == null || String(raw).trim() === "") return { settlement_status: "unknown", captured_aev: null };
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return { settlement_status: "unknown", captured_aev: null };
  return { settlement_status: "captured", captured_aev: amount };
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;

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
        fix: "Resolve /__semesh/me and bind its user.sub, or user.id only when sub is absent, before quoting or invoking.",
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
        fix: "Do not replay it. Restore the original account for reconciliation, or start from a new quote for this account.",
        retryable: false,
      },
    };
  }
  return { ok: true, principal: trusted };
}

function safeTraceId(raw) {
  const id = String(raw || "").trim();
  return SAFE_TRACE_ID.test(id) ? id : "";
}

function asFiniteNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function clonePublicJSON(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function safeMachineCode(raw) {
  const code = String(raw || "").trim();
  return SAFE_MACHINE_CODE.test(code) ? code : "";
}

function projectQuoteError({ status, json, headers, cause } = {}) {
  const body = json && typeof json === "object" ? json : {};
  const err =
    body.error && typeof body.error === "object" && !Array.isArray(body.error)
      ? body.error
      : body.data && typeof body.data === "object" && body.data.error && typeof body.data.error === "object"
        ? body.data.error
        : {};

  let code = safeMachineCode(err.code);
  let message = typeof err.message === "string" && err.message.trim() ? err.message.trim() : "";
  let fix = typeof err.fix === "string" && err.fix.trim() ? err.fix.trim() : "";
  let retryable = typeof err.retryable === "boolean" ? err.retryable : null;
  const statusRetryable = status === 408 || status === 425 || status === 429 || (status != null && status >= 500);

  if (!code || !message) {
    if (cause) {
      code = code || "quote_transport_failed";
      message = message || "The read-only price quote could not be reached.";
      fix = fix || "Check network connectivity to Semesh and retry the quote before invoking.";
      retryable = retryable == null ? true : retryable;
    } else if (status != null && status >= 500) {
      code = code || "quote_backend_unavailable";
      message = message || "The read-only price quote backend is unavailable.";
      fix = fix || "Retry the quote later; do not invoke without a successful live quote.";
      retryable = retryable == null ? true : retryable;
    } else if (status != null && status >= 400) {
      code = code || "quote_failed";
      message = message || "The read-only price quote was rejected.";
      fix = fix || "Inspect the quote error, correct the request, and quote again before invoking.";
      retryable = retryable == null ? statusRetryable : retryable;
    } else {
      code = code || "quote_contract_unavailable";
      message = message || "The live quote response could not be projected into the public price contract.";
      fix = fix || "Do not assume a price. Retry the quote or inspect the capability contract.";
      retryable = retryable == null ? false : retryable;
    }
  } else if (retryable == null) {
    retryable = statusRetryable;
  }
  if (!fix) {
    fix = "Do not assume a price. Obtain a successful live POST /v1/billing/quote before invoking.";
  }

  const headerTrace = headers && typeof headers.get === "function" ? headers.get("x-semesh-trace-id") : "";
  const trace_id = safeTraceId(headerTrace) || safeTraceId(err.trace_id);
  const out = { code, message, fix, retryable: !!retryable };
  if (trace_id) out.trace_id = trace_id;
  const availability =
    err.availability && typeof err.availability === "object" && !Array.isArray(err.availability)
      ? clonePublicJSON(err.availability)
      : body.availability && typeof body.availability === "object" && !Array.isArray(body.availability)
        ? clonePublicJSON(body.availability)
        : null;
  if (availability) out.availability = availability;
  return out;
}

function quoteContractFailure(message, fix, { code = "quote_contract_unavailable", retryable = true, quote } = {}) {
  const result = {
    ok: false,
    status: 503,
    error: projectQuoteError({
      status: 503,
      json: { error: { code, message, fix, retryable } },
    }),
  };
  if (quote) result.quote = quote;
  return result;
}

// Project only the public quote contract. Never invent amounts. Do not relabel floors/ceilings as
// a final capture charge — that remains captureEvidence after invoke.
function projectCanonicalQuote(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return quoteContractFailure("quote payload is missing", "Retry the live quote; no price is assumed.");
  }

  const quote = clonePublicJSON(raw);
  if (!quote) {
    return quoteContractFailure(
      "quote payload cannot be represented as JSON",
      "Retry the live quote; do not invent or partially reconstruct a price."
    );
  }
  const kind = typeof raw.quote_kind === "string" ? raw.quote_kind.trim() : "";
  const contractVersion =
    typeof raw.quote_contract_version === "string" ? raw.quote_contract_version.trim() : "";
  if (!QUOTE_KINDS.has(kind) || contractVersion !== "v1") {
    return quoteContractFailure(
      !QUOTE_KINDS.has(kind)
        ? "quote_kind is missing or unsupported"
        : "quote_contract_version is missing or unsupported",
      "Retry the live quote; do not invent a price kind or contract version."
    );
  }
  if (raw.currency !== "aev" || raw.exists !== true || typeof raw.callable !== "boolean") {
    return quoteContractFailure(
      "quote currency, existence, or callable state is missing or unsupported",
      "Retry the canonical v1 quote; do not infer omitted price or availability fields."
    );
  }

  if (raw.callable === false) {
    const availability = raw.availability && typeof raw.availability === "object" ? raw.availability : null;
    const reason =
      (availability && (availability.reason || availability.message)) ||
      raw.availability_reason ||
      "target is not currently callable";
    const error = projectQuoteError({
      status: 503,
      json: {
        error: {
          code: safeMachineCode(availability && availability.code) || "quote_target_unavailable",
          message: String(reason),
          fix:
            (availability && typeof availability.fix === "string" && availability.fix.trim()) ||
            "Resolve the availability requirement reported by the quote, then quote again before invoking.",
          retryable: false,
          availability,
        },
      },
    });
    return { ok: false, status: 503, error, quote };
  }

  for (const field of QUOTE_AMOUNT_FIELDS) {
    if (Object.hasOwn(raw, field) && (asFiniteNumber(raw[field]) == null || raw[field] < 0)) {
      return quoteContractFailure(
        `quote ${field} is invalid`,
        "Retry the canonical v1 quote; do not display or authorize an invalid amount."
      );
    }
  }

  const total = asFiniteNumber(raw.total_credits);
  const holdCeiling =
    asFiniteNumber(raw.hold_ceiling_credits) ??
    asFiniteNumber(raw.ceiling_credits) ??
    asFiniteNumber(raw.preauthorization_credits) ??
    asFiniteNumber(raw.capture_ceiling_credits);

  if (kind === "hold_ceiling") {
    const boundedAmounts = [
      total,
      ...["ceiling_credits", "hold_ceiling_credits", "preauthorization_credits", "capture_ceiling_credits"]
        .filter((field) => Object.hasOwn(raw, field))
        .map((field) => raw[field]),
    ];
    const boundsAgree = holdCeiling != null && boundedAmounts.every((amount) => amount === holdCeiling);
    if (holdCeiling == null || holdCeiling <= 0 || total == null || !boundsAgree || raw.capture_basis !== "actual_usage") {
      return quoteContractFailure(
        "one consistent, enforceable actual-usage hold ceiling is unavailable for this usage-metered target",
        "Pass the supported pricing input, or retry when the platform publishes a hold ceiling. Do not invoke without a ceiling.",
        { code: "quote_hold_ceiling_unavailable" }
      );
    }
  } else if (total == null || total < 0) {
    return quoteContractFailure(
      "quote total_credits is missing or invalid",
      "Retry the live quote with the exact invoke input; no price is assumed."
    );
  }

  return { ok: true, quote };
}

// Read-only live quote for the exact capability + input that will be invoked. No static fallback.
async function quoteAction(payer, input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return quoteContractFailure(
      "action input must be a JSON object",
      "Send the same JSON object to quote and invoke; do not guess or coerce the input."
    );
  }
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(requestedTimeout, 60000)
    : DEFAULT_QUOTE_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const r = await semeshFetch("POST", "/v1/billing/quote", payer, {
      capability_id: CAPABILITY_ID,
      input,
    }, undefined, { signal: controller.signal });
    if (r.status >= 400) {
      return {
        ok: false,
        status: r.status,
        error: projectQuoteError({ status: r.status, json: r.json, headers: r.headers }),
      };
    }
    const projected = projectCanonicalQuote(unwrap(r.json));
    if (!projected.ok) return projected;
    return { ok: true, quote: projected.quote };
  } catch (e) {
    if (timedOut || (e && e.name === "AbortError")) {
      return {
        ok: false,
        status: 504,
        error: projectQuoteError({
          status: 504,
          json: {
            error: {
              code: "quote_timeout",
              message: "The read-only live quote timed out.",
              fix: "Retry the quote before invoking. No paid action was started by this timeout.",
              retryable: true,
            },
          },
        }),
      };
    }
    return {
      ok: false,
      status: 502,
      error: projectQuoteError({ status: 502, cause: e }),
    };
  } finally {
    clearTimeout(timer);
  }
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

async function readJSONObject(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 1024 * 1024) {
      return {
        ok: false,
        status: 413,
        error: {
          code: "request_body_too_large",
          message: "Action input must be at most 1 MiB.",
          fix: "Reduce the JSON input, then quote the exact reduced object before invoking.",
          retryable: false,
        },
      };
    }
  }
  let value;
  try {
    value = JSON.parse(raw || "{}");
  } catch {
    return {
      ok: false,
      status: 400,
      error: {
        code: "invalid_json_body",
        message: "Action input must be valid JSON.",
        fix: "Correct the JSON object, then request a new live quote before invoking.",
        retryable: false,
      },
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "invalid_action_input",
        message: "Action input must be a JSON object.",
        fix: "Send one JSON object matching the capability input schema.",
        retryable: false,
      },
    };
  }
  return { ok: true, value };
}

function sendPreEffectProblem(res, status, error, phase, extra = {}) {
  return sendJSON(res, status, { error, phase, effect_started: false, ...extra });
}

const CTYPE = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

const server = http.createServer(async (req, res) => {
  let u;
  try { u = new URL(req.url, "http://localhost"); } catch { return sendJSON(res, 400, { error: "bad_request" }); }

  if (u.pathname === "/healthz") return sendJSON(res, 200, { ok: true });

  // Authentication state only. The browser quotes its actual pending/default input through /api/quote.
  if (u.pathname === "/api/me" && req.method === "GET") {
    const payer = payerToken(req);
    if (!payer) return sendJSON(res, 200, { logged_in: false, currency: "aev" });
    return sendJSON(res, 200, { logged_in: true, currency: "aev" });
  }

  // Browser-facing read-only quote adapter. Its request body is the exact action input object.
  if (u.pathname === "/api/quote" && req.method === "POST") {
    const payer = payerToken(req);
    if (!payer) {
      return sendPreEffectProblem(
        res,
        401,
        {
          code: "login_required",
          message: "Sign in before quoting this paid action.",
          fix: "Open /__semesh/login, then retry the read-only quote.",
          retryable: false,
        },
        "auth",
        { login: "/__semesh/login" }
      );
    }
    const principal = operationPrincipal(req);
    if (!principal.ok) return sendPreEffectProblem(res, principal.status, principal.error, "identity");
    if (!RUNTIME_KEY) {
      return sendPreEffectProblem(
        res,
        500,
        {
          code: "app_not_configured",
          message: "SEMESH_APP_API_KEY is missing.",
          fix: "Configure the server-side runtime key, then retry the read-only quote.",
          retryable: false,
        },
        "configuration"
      );
    }
    const parsed = await readJSONObject(req);
    if (!parsed.ok) return sendPreEffectProblem(res, parsed.status, parsed.error, "input");
    const quoted = await quoteAction(payer, parsed.value);
    if (!quoted.ok) {
      return sendPreEffectProblem(res, quoted.status || 503, quoted.error, "quote", quoted.quote ? { quote: quoted.quote } : {});
    }
    return sendJSON(res, 200, { ok: true, quote: quoted.quote });
  }

  // THE PAID ACTION. Billable -> bills the logged-in user (X-Semesh-Payer = their session).
  // Quote the exact same input first; never invoke when the live quote fails.
  if (u.pathname === "/api/action" && req.method === "POST") {
    const payer = payerToken(req);
    if (!payer) {
      return sendPreEffectProblem(
        res,
        401,
        {
          code: "login_required",
          message: "Sign in before running this paid action.",
          fix: "Open /__semesh/login, then retry the same action intent.",
          retryable: false,
        },
        "auth",
        { login: "/__semesh/login" }
      );
    }
    const principal = operationPrincipal(req);
    if (!principal.ok) return sendPreEffectProblem(res, principal.status, principal.error, "identity");
    if (!RUNTIME_KEY) {
      return sendPreEffectProblem(
        res,
        500,
        {
          code: "app_not_configured",
          message: "SEMESH_APP_API_KEY is missing.",
          fix: "Configure the server-side runtime key, then request a new live quote.",
          retryable: false,
        },
        "configuration"
      );
    }
    const parsed = await readJSONObject(req);
    if (!parsed.ok) return sendPreEffectProblem(res, parsed.status, parsed.error, "input");
    const input = parsed.value;
    const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return sendPreEffectProblem(
        res,
        400,
        {
          code: "idempotency_key_required",
          message: "Send one stable Idempotency-Key per logical operation.",
          fix: "Create one valid key and preserve it with the exact same input for any safe replay.",
          retryable: false,
        },
        "input"
      );
    }

    // TODO(you): shape `input` to match your chosen CAPABILITY_ID (see https://semesh.io/agent.md).
    const quoted = await quoteAction(payer, input);
    if (!quoted.ok) {
      return sendPreEffectProblem(res, quoted.status || 503, quoted.error, "quote", {
        ...(quoted.quote ? { quote: quoted.quote } : {}),
        idempotency_key: idempotencyKey,
      });
    }

    try {
      const r = await invokeCapability(CAPABILITY_ID, input, payer, idempotencyKey);
      const capture = captureEvidence(r.headers);
      if (r.status >= 400) {
        const message = capture.settlement_status === "captured"
          ? "The action did not complete here, but trusted platform evidence reports capture. Inspect this operation before retrying; never start a fresh operation key."
          : "The action did not complete here and settlement is unknown. Reconcile this operation before retrying; never start a fresh operation key.";
        return sendJSON(res, r.status, {
          error: "action_failed",
          detail: r.json,
          quote: quoted.quote,
          captured_aev: capture.captured_aev,
          settlement_status: capture.settlement_status,
          idempotency_key: idempotencyKey,
          message,
        });
      }
      const data = unwrap(r.json);
      return sendJSON(res, 200, {
        ok: true,
        result: data,
        quote: quoted.quote,
        captured_aev: capture.captured_aev,
        settlement_status: capture.settlement_status,
        idempotency_key: idempotencyKey,
        currency: "aev",
      });
    } catch (e) {
      return sendJSON(res, 502, {
        error: "action_error",
        message: "Network/provider outcome is unknown. Reconcile this operation before starting another. " + String((e && e.message) || e),
        quote: quoted.quote,
        settlement_status: "unknown",
        idempotency_key: idempotencyKey,
      });
    }
  }

  // Static assets.
  const rel = u.pathname === "/" ? "/index.html" : u.pathname;
  const fp = path.join(__dirname, "public", path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, ""));
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": CTYPE[path.extname(fp)] || "application/octet-stream" });
    res.end(data);
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log("auth-payments-minimal listening on :" + PORT + " (base " + BASE + ")"));
}

module.exports = {
  server,
  quoteAction,
  projectCanonicalQuote,
  projectQuoteError,
  captureEvidence,
  safeTraceId,
};
