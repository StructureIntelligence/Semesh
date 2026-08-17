// The one METERED capability call in this demo.
//
// POST /api/polish { body } -> { polished }
//
// This forwards the snippet text to a Semesh capability with an authenticated
// delegated payer and one stable logical operation identity. Provider output and
// HTTP success are useful execution evidence, but never settlement authority.

import {
  callCapability,
  extractPayerToken,
  isValidIdempotencyKey,
} from "@/lib/semesh";

export const dynamic = "force-dynamic";

// TODO: set this to the capability/tool ID you want to meter. Semesh exposes
// a catalog of capabilities; pick the one that matches (e.g. a text-rewrite /
// LLM helper) and put its ID here or in the SEMESH_POLISH_CAPABILITY env var.
// The agent guide at https://semesh.io/agent.md lists available capability
// IDs and their exact input contracts — confirm the input shape there before
// going live. Until you set this, the route returns a local fallback so the demo
// still runs end-to-end without charging anyone.
const POLISH_CAPABILITY = process.env.SEMESH_POLISH_CAPABILITY || "";

export async function POST(req: Request) {
  // Never omit X-Semesh-Payer: doing so would silently charge the app owner. Authenticate before
  // parsing operation input so every request without a delegated session has the same 401 contract.
  const payerToken = extractPayerToken(req);
  if (!payerToken) {
    return Response.json(
      {
        error: {
          code: "login_required",
          message: "Sign in with Semesh before starting a paid polish operation.",
        },
      },
      { status: 401 }
    );
  }

  const idempotencyKey = (req.headers.get("Idempotency-Key") || "").trim();
  if (!isValidIdempotencyKey(idempotencyKey)) {
    return Response.json(
      {
        error: {
          code: "idempotency_key_required",
          message: "Send one stable Idempotency-Key per logical polish operation.",
        },
      },
      { status: 400 }
    );
  }

  let parsed: { body?: string };
  try {
    parsed = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const text = (parsed.body || "").trim();
  if (!text) {
    return Response.json({ error: "body is required" }, { status: 400 });
  }
  if (text.length > 10000) {
    return Response.json({ error: "body exceeds 10000 characters" }, { status: 413 });
  }

  // No capability configured yet -> safe local fallback (no charge).
  if (!POLISH_CAPABILITY) {
    return Response.json({
      polished: localTidy(text),
      settlement_status: "not_applicable",
      captured_aev: null,
      idempotency_key: idempotencyKey,
      note: "Local fallback completed without a paid capability operation.",
    });
  }

  try {
    // NOTE: confirm the exact `input` field names for your chosen capability in
    // https://semesh.io/agent.md — they vary per tool.
    const result = await callCapability<{
      output?: string;
      text?: string;
      data?: { output?: string; text?: string };
    }>(
      POLISH_CAPABILITY,
      { text, instruction: "Tidy and clarify this snippet; keep its meaning." },
      { payerToken, idempotencyKey }
    );
    if (!result.ok) {
      const message = result.settlement_status === "captured"
        ? "The provider result was unavailable, but trusted platform evidence reports capture. Inspect this operation before retrying; never start a fresh key."
        : "The provider result was unavailable and settlement is unknown. Retry only the exact same input and Idempotency-Key, or inspect this operation's platform record.";
      return Response.json(
        {
          error: { code: "capability_failed", message },
          settlement_status: result.settlement_status,
          captured_aev: result.captured_aev,
          idempotency_key: idempotencyKey,
          recovery: {
            action: "retry_same_operation",
            message: "Resend the exact same input and Idempotency-Key; never create a fresh key for an uncertain outcome.",
          },
        },
        { status: result.status >= 400 && result.status <= 599 ? result.status : 502 }
      );
    }

    const payload = result.payload || {};
    const data = payload.data || payload;
    const polished =
      (typeof data.output === "string" && data.output) ||
      (typeof data.text === "string" && data.text) ||
      JSON.stringify(data);
    return Response.json({
      polished,
      settlement_status: result.settlement_status,
      captured_aev: result.captured_aev,
      idempotency_key: idempotencyKey,
      recovery: result.settlement_status === "unknown"
        ? {
            action: "retry_same_operation",
            message: "Output is preserved. Resend the exact same input and Idempotency-Key, or inspect this operation's platform record.",
          }
        : null,
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "capability_outcome_unknown",
          message: "Network/provider outcome is unknown. Retry only the exact same input and Idempotency-Key, or inspect this operation's platform record.",
        },
        settlement_status: "unknown",
        captured_aev: null,
        idempotency_key: idempotencyKey,
        recovery: {
          action: "retry_same_operation",
          message: "Resend the exact same input and Idempotency-Key; never create a fresh key for an uncertain outcome.",
        },
      },
      { status: 502 }
    );
  }
}

// Trivial offline cleanup so the template is runnable before a capability is wired.
function localTidy(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
