// ai-saas-paid-api — a pay-per-use AI app on Semesh (end-user-pays / "G2").
//
// THE WHOLE POINT (read this first):
//   A signed-in end user triggers an AI call, and *that user* — not you, the developer — is billed for
//   it against their own Aev balance. We never write any billing code. The platform does the charge.
//   The only two things this server does to make that happen:
//     1. Authenticate to Semesh with the app's injected runtime key (SEMESH_APP_API_KEY).
//     2. Forward the logged-in user's session as the `X-Semesh-Payer` header on each billable call.
//   That header is what charges the END USER's Aev wallet instead of yours. We ALWAYS forward it on
//   user-triggered billable calls. If it's missing, we return 401 and the UI shows a Sign-in button —
//   we never silently bill the developer for a user action.
//
//   No secret ever reaches the browser. The runtime key stays server-side; the browser talks only to
//   this server's /api/* routes.
//
//   Aev is Semesh prepaid credit: 1 USD = 100 Aev. Card funding is offered only when the live
//   server response says its Legal/provider gates are available; this template never assumes that.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const BASE = (process.env.SEMESH_BASE_URL || "https://api.semesh.net").replace(/\/+$/, "");
// Injected automatically by `semesh deploy`. Authenticates this app to Semesh.
const RUNTIME_KEY = process.env.SEMESH_APP_API_KEY || process.env.SEMESH_API_KEY || "";

// ---------------------------------------------------------------------------------------------------
// The AI capability this app charges for.
//
// TODO(confirm against https://semesh.io/agent.md): verify the capability id and the exact `input`
// body before going live. The INVOKE MECHANICS below are correct (POST /v1/capabilities/{id}/invoke
// with a JSON `{ input: {...} }` body, Bearer runtime key, X-Semesh-Payer = end-user session). What you
// must confirm is (a) the capability id string and (b) the field names inside `input` for that model.
// `llm.chat` and a `{ messages: [...] }` input are the common shape, but DO NOT guess — check agent.md.
const CAPABILITY_ID = process.env.SEMESH_CAPABILITY_ID || "llm.chat";
const MAX_PROMPT_CHARS = 2000;

// A display-only price floor (Aev) so the UI can show "you pay per use" before the call returns.
// This is only a pre-call estimate. Final capture is displayed only from the platform's explicit
// x-semesh-charged-aev post-capture response header, never from the provider response body.
const PRICE_ESTIMATE_AEV = Number(process.env.PRICE_ESTIMATE_AEV || 2);

// ---------------------------------------------------------------------------------------------------
// Payer extraction: the logged-in user's delegated-payer token. Bearer header, else the durable
// __semesh_session cookie (7-day, set by the platform auth gate at login), else the short-lived
// __semesh_access cookie. "" when nobody is signed in.
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
  if (payer) headers["X-Semesh-Payer"] = payer; // <- this is what makes the END USER pay.
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json, headers: res.headers };
}

// Invoke a capability for the paying user.
function invokeCapability(capabilityId, input, payer, idempotencyKey) {
  return semeshFetch("POST", `/v1/capabilities/${encodeURIComponent(capabilityId)}/invoke`, payer, { input: input || {} }, idempotencyKey);
}

// Defensively unwrap a possibly-{success,data,meta}-wrapped response down to its payload.
function unwrap(json) {
  if (json && typeof json === "object" && json.data && typeof json.data === "object") return json.data;
  return json || {};
}

// Pull the model's text answer out of the response, trying the common shapes. Adjust to the capability
// you wired (see the TODO above) — different models name the output field differently.
function extractText(json) {
  const d = unwrap(json);
  const probe = (o) => {
    if (!o || typeof o !== "object") return "";
    if (typeof o.text === "string") return o.text;
    if (typeof o.output === "string") return o.output;
    if (typeof o.content === "string") return o.content;
    if (typeof o.completion === "string") return o.completion;
    if (typeof o.message === "string") return o.message;
    if (o.message && typeof o.message.content === "string") return o.message.content;
    if (Array.isArray(o.choices) && o.choices[0]) {
      const c = o.choices[0];
      if (typeof c.text === "string") return c.text;
      if (c.message && typeof c.message.content === "string") return c.message.content;
    }
    return "";
  };
  return probe(d) || probe(json) || "";
}

// Only the platform's explicit post-capture response header is settlement authority here. Capability
// output is untrusted provider data and must never be searched for cost-like fields.
function captureEvidence(headers) {
  const raw = headers && headers.get("x-semesh-charged-aev");
  if (raw == null || String(raw).trim() === "") return { settlement_status: "unknown", captured_aev: null };
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return { settlement_status: "unknown", captured_aev: null };
  return { settlement_status: "captured", captured_aev: amount };
}

// A funding link crosses from a platform response into browser navigation. Accept only an absolute
// HTTPS URL without credentials, or a same-origin path beginning with exactly one slash.
function safeFundingURL(value) {
  if (typeof value !== "string" || value === "" || value !== value.trim()) return null;
  if (/[\u0000-\u0020\u007f\\]/.test(value)) return null;
  if (value.startsWith("/")) return value.startsWith("//") ? null : value;
  if (!/^https:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;

function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

const CTYPE = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

const server = http.createServer(async (req, res) => {
  let u;
  try { u = new URL(req.url, "http://localhost"); } catch { return sendJSON(res, 400, { error: "bad_request" }); }

  if (u.pathname === "/healthz") return sendJSON(res, 200, { ok: true });

  // Is the current browser signed in? Drives the UI's sign-in branch and shows the per-use price.
  if (u.pathname === "/api/me" && req.method === "GET") {
    return sendJSON(res, 200, {
      logged_in: !!payerToken(req),
      estimate_aev: PRICE_ESTIMATE_AEV,
      currency: "aev",
    });
  }

  // Run the AI call. BILLABLE -> charges the logged-in user (X-Semesh-Payer = their session).
  if (u.pathname === "/api/run" && req.method === "POST") {
    const payer = payerToken(req);
    // Never bill the developer for a user action: no signed-in user => 401, UI shows "Sign in".
    if (!payer) return sendJSON(res, 401, { error: "login_required", login: "/__semesh/login" });
    if (!RUNTIME_KEY) return sendJSON(res, 500, { error: "app_not_configured", message: "SEMESH_APP_API_KEY is missing" });

    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch {}
    const prompt = String(body.prompt || "").trim().slice(0, MAX_PROMPT_CHARS);
    if (!prompt) return sendJSON(res, 400, { error: "prompt_required" });
    const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return sendJSON(res, 400, { error: "idempotency_key_required", message: "Send one stable Idempotency-Key per logical operation." });
    }

    try {
      // TODO(confirm against agent.md): the shape of `input` for your chosen capability. The line below
      // uses a generic chat shape — replace with the exact fields the capability documents.
      const input = { messages: [{ role: "user", content: prompt }] };
      const r = await invokeCapability(CAPABILITY_ID, input, payer, idempotencyKey);

      // Surface the platform's billing errors plainly (e.g. insufficient balance -> prompt a top-up).
      if (r.status === 402) {
        const detail = unwrap(r.json);
        const topup = safeFundingURL(detail.topup_url);
        return sendJSON(res, 402, {
          error: "insufficient_balance",
          message: topup ? "Not enough Aev. Follow the available funding path, then retry this same operation." : "Not enough Aev, and no available funding path was returned.",
          topup,
          settlement_status: "unknown",
          idempotency_key: idempotencyKey,
        });
      }
      if (r.status >= 400) {
        return sendJSON(res, r.status, {
          error: "capability_failed",
          message: "The call did not complete here. Settlement is unknown; reconcile this operation before starting another.",
          detail: r.json,
          settlement_status: "unknown",
          idempotency_key: idempotencyKey,
        });
      }

      const text = extractText(r.json);
      const capture = captureEvidence(r.headers);
      return sendJSON(res, 200, {
        ok: true,
        text,
        // This is captured money only when the platform emitted its explicit post-capture header.
        captured_aev: capture.captured_aev,
        settlement_status: capture.settlement_status,
        idempotency_key: idempotencyKey,
        estimate_aev: PRICE_ESTIMATE_AEV,
        currency: "aev",
      });
    } catch (e) {
      return sendJSON(res, 502, {
        error: "run_failed",
        message: "Network/provider outcome is unknown. Reconcile this operation before starting another. " + String((e && e.message) || e),
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
  server.listen(PORT, () => console.log("ai-saas-paid-api listening on :" + PORT + " (base " + BASE + ")"));
}

module.exports = { safeFundingURL };
