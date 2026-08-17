// paid-tool-api — sell ONE API endpoint, metered per call, on Semesh.
//
// THE WHOLE POINT (pay-per-call, no billing code of your own):
//   A caller signs in with their Semesh account (the platform auth gate at /__semesh/login sets a
//   durable __semesh_session cookie). This server then bills THAT logged-in user — not you, the app
//   developer — for each admitted call to /api/tool, by:
//     1. authenticating to Semesh with the app's injected runtime key (SEMESH_APP_API_KEY), and
//     2. forwarding the user's session token as the `X-Semesh-Payer` header on the billable invoke.
//   `X-Semesh-Payer` is what charges the LOGGED-IN USER's Aev wallet instead of yours. If it is absent,
//   the route returns 401 — we never silently bill the developer for a user's call. The markup you set in
//   semesh.json ("billing.markup") is your margin on top of the underlying cost; the platform handles
//   the wallet debit, the ledger, and your payout. You write zero billing code.
//
//   Aev = Semesh prepaid credit. 1 USD = 100 Aev. Wallets are topped up via Stripe.
//
//   No secret ever reaches the browser: RUNTIME_KEY stays server-side; callers only touch /api/*.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const BASE = (process.env.SEMESH_BASE_URL || "https://api.semesh.net").replace(/\/+$/, "");
const RUNTIME_KEY = process.env.SEMESH_APP_API_KEY || process.env.SEMESH_API_KEY || "";

// ---------------------------------------------------------------------------------------------------
// The capability this endpoint resells. `llm.chat` is a documented Semesh capability (text in/out).
//
// TODO (make it yours): swap this for whatever you want to sell — another capability id, a cloud-worker
// offer ("wof_..."), or your own logic. If you call a different Semesh capability/offer and are
// unsure of the exact request body, check the agent guide at https://semesh.io/agent.md before
// changing `invokeTool` below — do not guess the shape.
// ---------------------------------------------------------------------------------------------------
const CAPABILITY = process.env.TOOL_CAPABILITY_ID || "llm.chat";

// Per-request ceiling so a slow upstream never hangs the caller.
const REQUEST_TIMEOUT_MS = 60 * 1000;

// ---------------------------------------------------------------------------------------------------
// Payer extraction: the logged-in user's delegated-payer token. Bearer header (for API callers), else
// the durable __semesh_session cookie (set by the auth gate at login), else short-lived __semesh_access.
// "" when none — and "" means "not logged in", which we refuse to bill.
// ---------------------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------------------
// Semesh call helper. RUNTIME_KEY authenticates the app; X-Semesh-Payer bills the logged-in user.
// ---------------------------------------------------------------------------------------------------
async function semeshFetch(method, p, payer, body, idempotencyKey) {
  const headers = { Authorization: "Bearer " + RUNTIME_KEY };
  if (payer) headers["X-Semesh-Payer"] = payer; // <-- charges the USER's wallet, not the developer's
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (body) headers["Content-Type"] = "application/json";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(BASE + p, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, json, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

// Invoke a capability: POST /v1/capabilities/{id}/invoke with {input}. (See agent.md for the contract.)
function invokeTool(input, payer, idempotencyKey) {
  return semeshFetch("POST", `/v1/capabilities/${encodeURIComponent(CAPABILITY)}/invoke`, payer, { input: input || {} }, idempotencyKey);
}

// Defensively unwrap a possibly-{success,data,meta}-wrapped response down to its payload.
function unwrap(json) {
  if (json && typeof json === "object" && json.data && typeof json.data === "object") return json.data;
  return json || {};
}

// Capability output is provider-controlled data, not settlement authority. This template calls money
// captured only when the platform emits its explicit post-capture response header. Missing or invalid
// evidence stays unknown; useful provider output never upgrades billing state by itself.
function captureEvidence(headers) {
  const raw = headers && headers.get("x-semesh-charged-aev");
  if (raw == null || String(raw).trim() === "") {
    return { settlement_status: "unknown", captured_aev: null };
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) {
    return { settlement_status: "unknown", captured_aev: null };
  }
  return { settlement_status: "captured", captured_aev: amount };
}

// Pull plain text out of the capability result, trying the common shapes.
function extractText(json) {
  const d = unwrap(json);
  const probe = (o) => {
    if (!o || typeof o !== "object") return null;
    for (const k of ["text", "output", "result", "content", "message", "completion"]) {
      if (typeof o[k] === "string" && o[k].trim()) return o[k];
    }
    return null;
  };
  return probe(d) || probe(json) || "";
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;

const CTYPE = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  let u;
  try { u = new URL(req.url, "http://localhost"); } catch { return sendJSON(res, 400, { error: "bad_request" }); }

  if (u.pathname === "/healthz") return sendJSON(res, 200, { ok: true });

  // Is the current caller logged in? (drives the docs page's "sign in" branch)
  if (u.pathname === "/api/me" && req.method === "GET") {
    return sendJSON(res, 200, { logged_in: !!payerToken(req) });
  }

  // -------------------------------------------------------------------------------------------------
  // THE PAID ENDPOINT. Calls request delegated billing against the logged-in user's Aev wallet;
  // only explicit platform capture evidence below proves the final settlement state.
  //
  // This example: summarize text. POST { "text": "...", "style": "tldr" | "bullets" } -> { summary }.
  // Replace the prompt/body with your own tool — the billing wiring (payer + runtime key) stays as-is.
  // -------------------------------------------------------------------------------------------------
  if (u.pathname === "/api/tool" && req.method === "POST") {
    const payer = payerToken(req);
    if (!payer) return sendJSON(res, 401, { error: "login_required", login: "/__semesh/login", message: "Sign in with Semesh to call this paid endpoint." });
    if (!RUNTIME_KEY) return sendJSON(res, 500, { error: "app_not_configured", message: "SEMESH_APP_API_KEY is missing." });

    let raw = "";
    for await (const c of req) raw += c;
    let input = {};
    try { input = JSON.parse(raw || "{}"); } catch { return sendJSON(res, 400, { error: "invalid_json" }); }

    const text = String(input.text || "").trim();
    if (!text) return sendJSON(res, 400, { error: "text_required", message: "Provide a non-empty 'text' field." });
    if (text.length > 12000) return sendJSON(res, 413, { error: "text_too_long", message: "Limit input to 12000 characters." });

    const style = String(input.style || "tldr").toLowerCase();
    const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return sendJSON(res, 400, {
        error: "idempotency_key_required",
        message: "Send one stable Idempotency-Key per logical operation.",
      });
    }
    const instruction = style === "bullets"
      ? "Summarize the following text as 3-5 concise bullet points. Output only the bullets."
      : "Summarize the following text in 2-3 sentences. Output only the summary.";

    try {
      // The billable call. X-Semesh-Payer (set inside semeshFetch) bills the logged-in user.
      const r = await invokeTool(
        {
          // TODO: this {messages:[...]} shape matches the llm.chat capability. If you switch CAPABILITY
          // to a different capability/offer, set the input to ITS documented schema (see agent.md).
          messages: [
            { role: "system", content: instruction },
            { role: "user", content: text },
          ],
        },
        payer,
        idempotencyKey
      );
      const capture = captureEvidence(r.headers);

      if (r.status >= 400) {
        // The HTTP status is not settlement authority. Preserve explicit capture evidence even on an
        // error response; otherwise keep the outcome unknown and reuse this exact logical operation.
        const message = capture.settlement_status === "captured"
          ? "The call did not complete here, but trusted platform evidence reports capture. Inspect the platform record before retrying; never start a fresh operation key."
          : "The call did not complete here and settlement is unknown. Safely retry only with the exact same input and Idempotency-Key, or inspect the platform record; never start a fresh operation key.";
        return sendJSON(res, r.status, {
          error: "tool_failed",
          message,
          detail: r.json,
          captured_aev: capture.captured_aev,
          settlement_status: capture.settlement_status,
          idempotency_key: idempotencyKey,
        });
      }

      const summary = extractText(r.json);
      return sendJSON(res, 200, {
        ok: true,
        summary,
        style,
        captured_aev: capture.captured_aev,
        settlement_status: capture.settlement_status,
        idempotency_key: idempotencyKey,
        currency: "aev",
      });
    } catch (e) {
      return sendJSON(res, 502, {
        error: "tool_error",
        message: "Network/provider outcome is unknown. Safely retry only with the exact same input and Idempotency-Key, or inspect the platform record; never start a fresh operation key. " + String((e && e.message) || e),
        settlement_status: "unknown",
        idempotency_key: idempotencyKey,
      });
    }
  }

  // Static assets (the docs/landing page).
  const rel = u.pathname === "/" ? "/index.html" : u.pathname;
  const fp = path.join(__dirname, "public", path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, ""));
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": CTYPE[path.extname(fp)] || "application/octet-stream" });
    res.end(data);
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log("paid-tool-api listening on :" + PORT + " (base " + BASE + ")"));
}

module.exports = { captureEvidence, extractText, server };
