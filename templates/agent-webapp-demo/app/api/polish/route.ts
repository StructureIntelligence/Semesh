// The demo's single paid flow is deliberately two-phase:
//   prepare — anonymous public Search, token-pinned Detail, authenticated effect-zero quote
//   invoke  — the browser persisted the exact action/catalog/model pins and request + replay key
//   observe — after invoke returns an id, use only invocation_id for observation/receipt
// There is no legacy capability path and no local execution fallback.

import {
  extractPayerToken,
  invokePreparedPolishAction,
  isValidIdempotencyKey,
  observePreparedPolishAction,
  prepareCanonicalPolishAction,
} from "@/lib/semesh";
import { projectCanonicalModelResult } from "@/lib/polish-operation.mjs";

export const dynamic = "force-dynamic";

function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {}
) {
  return Response.json({ error: { code, message }, ...extra }, { status });
}

export async function POST(req: Request) {
  const payerToken = extractPayerToken(req);
  if (!payerToken) {
    return Response.json(
      {
        error: {
          code: "login_required",
          message: "Sign in with Semesh before preparing or invoking a paid polish Action.",
        },
        effect_started: false,
      },
      { status: 401 }
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return errorResponse(400, "invalid_json", "The request body must be JSON.", {
      effect_started: false,
    });
  }

  const idempotencyKey = (req.headers.get("Idempotency-Key") || "").trim();
  if (!isValidIdempotencyKey(idempotencyKey)) {
    return errorResponse(
      400,
      "idempotency_key_required",
      "Send one stable Idempotency-Key for this logical polish request.",
      { effect_started: false }
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return errorResponse(400, "invalid_request", "A canonical polish request object is required.", {
      effect_started: false,
    });
  }
  const request = payload as {
    mode?: unknown;
    body?: unknown;
    prepared?: unknown;
    invocation_id?: unknown;
  };

  if (request.mode === "prepare") {
    const text = typeof request.body === "string" ? request.body : "";
    const result = await prepareCanonicalPolishAction(text, { payerToken });
    if (result.ok === false) {
      return errorResponse(result.status, result.code, result.message, {
        effect_started: false,
        idempotency_key: idempotencyKey,
      });
    }
    return Response.json({
      prepared: result.prepared,
      effect_started: false,
      idempotency_key: idempotencyKey,
    });
  }

  if (request.mode !== "invoke" && request.mode !== "observe") {
    return errorResponse(400, "invalid_mode", "mode must be prepare, invoke, or observe.", {
      effect_started: false,
      idempotency_key: idempotencyKey,
    });
  }

  const result = request.mode === "observe"
      ? await observePreparedPolishAction(request.prepared, {
        payerToken,
        invocationId: typeof request.invocation_id === "string" ? request.invocation_id : "",
        idempotencyKey,
      })
    : await invokePreparedPolishAction(request.prepared, {
        payerToken,
        idempotencyKey,
      });
  if (result.ok === false) {
    return errorResponse(result.status, result.code, result.message, {
      effect_started: result.effect_started,
      idempotency_key: idempotencyKey,
      ...(result.invocation_id ? { invocation_id: result.invocation_id } : {}),
      recovery: result.effect_started
        ? {
            action: "retry_same_request",
            message:
              "Reuse the exact persisted request and Idempotency-Key. Observe only a returned invocation_id; never use the key as an observation id.",
          }
        : null,
    });
  }

  const canonicalResult = result.state === "succeeded"
    ? projectCanonicalModelResult(result.result)
    : null;
  const polished = canonicalResult?.message.content ?? null;
  if (result.state === "succeeded" && polished === null) {
    return errorResponse(
      502,
      "invalid_action_result",
      "The terminal Model result did not match its strict assistant message and usage schema.",
      {
        effect_started: true,
        idempotency_key: idempotencyKey,
        invocation_id: result.invocation_id,
        settlement_status: result.settlement_status,
        captured_aev_atoms: result.captured_aev_atoms,
        released_aev_atoms: result.released_aev_atoms,
        receipt: result.receipt,
        recovery: {
          action: "inspect_invocation",
          message: "Inspect this invocation_id; do not create a replacement request.",
        },
      }
    );
  }

  return Response.json(
    {
      invocation_id: result.invocation_id,
      state: result.state,
      ...(polished === null ? {} : { polished }),
      ...(canonicalResult === null ? {} : { usage: canonicalResult.usage }),
      settlement_status: result.settlement_status,
      captured_aev_atoms: result.captured_aev_atoms,
      released_aev_atoms: result.released_aev_atoms,
      receipt: result.receipt,
      idempotency_key: idempotencyKey,
      effect_started: true,
      recovery:
        result.state === "succeeded" && result.receipt
          ? null
          : {
              action: "retry_same_request",
              message:
                "Reuse this exact persisted request and Idempotency-Key; the returned invocation_id remains the observation identity.",
            },
    },
    { status: result.status }
  );
}
