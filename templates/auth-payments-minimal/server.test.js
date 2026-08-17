const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.SEMESH_APP_API_KEY = "test-runtime-key";
process.env.SEMESH_BASE_URL = "https://quote-authority.test";

const serverPath = path.join(__dirname, "server.js");
const source = fs.readFileSync(serverPath, "utf8");
const TEST_PRINCIPAL_HEADERS = {
  "x-semesh-user-id": "user-test",
  "x-semesh-operation-principal": "user-test",
};

test("source removes every static/assumed price fallback", () => {
  assert.equal(source.includes("PRICE_AEV"), false, "PRICE_AEV must be removed");
  assert.equal(source.includes("estimate_aev"), false, "estimate_aev must not be projected");
  assert.match(source, /\/v1\/billing\/quote/);
  assert.match(source, /require\.main\s*===\s*module/);
});

test("module exports quote helpers and does not listen on import", () => {
  const mod = require("./server.js");
  assert.equal(typeof mod.quoteAction, "function");
  assert.equal(typeof mod.projectCanonicalQuote, "function");
  assert.equal(typeof mod.projectQuoteError, "function");
  assert.equal(typeof mod.captureEvidence, "function");
  assert.ok(mod.server);
  assert.equal(mod.server.listening, false);
});

test("projectCanonicalQuote preserves exact / floor / hold-ceiling truth fields", () => {
  const { projectCanonicalQuote } = require("./server.js");

  const exact = projectCanonicalQuote({
    quote_contract_version: "v1",
    quote_kind: "exact",
    total_credits: 1.5,
    base_cost_credits: 1.25,
    markup_credits: 0.25,
    currency: "aev",
    callable: true,
    exists: true,
    note: "fixed service-unit price",
    price_label: "1.5 aev",
    required_fields: ["prompt"],
    availability: { status: "available" },
    requires_input_for_exact_quote: true,
    future_contract_field: { preserved: true },
  });
  assert.equal(exact.ok, true);
  assert.equal(exact.quote.quote_kind, "exact");
  assert.equal(exact.quote.total_credits, 1.5);
  assert.equal(exact.quote.price_label, "1.5 aev");
  assert.deepEqual(exact.quote.required_fields, ["prompt"]);
  assert.equal(exact.quote.note, "fixed service-unit price");
  assert.equal(exact.quote.requires_input_for_exact_quote, true);
  assert.deepEqual(exact.quote.future_contract_field, { preserved: true });

  const floor = projectCanonicalQuote({
    quote_contract_version: "v1",
    quote_kind: "representative_floor",
    total_credits: 2,
    base_cost_credits: 2,
    currency: "aev",
    callable: true,
    exists: true,
    note: "representative floor, not the final charge",
    price_label: "2 aev/s",
  });
  assert.equal(floor.ok, true);
  assert.equal(floor.quote.quote_kind, "representative_floor");
  assert.match(String(floor.quote.note), /not the final charge/i);

  const ceiling = projectCanonicalQuote({
    quote_contract_version: "v1",
    quote_kind: "hold_ceiling",
    capture_basis: "actual_usage",
    total_credits: 11,
    ceiling_credits: 11,
    hold_ceiling_credits: 11,
    preauthorization_credits: 11,
    capture_ceiling_credits: 11,
    currency: "aev",
    callable: true,
    exists: true,
    metered: true,
    note: "usage-metered hold ceiling",
  });
  assert.equal(ceiling.ok, true);
  assert.equal(ceiling.quote.quote_kind, "hold_ceiling");
  assert.equal(ceiling.quote.capture_basis, "actual_usage");
  assert.equal(ceiling.quote.hold_ceiling_credits, 11);
  assert.equal(ceiling.quote.capture_ceiling_credits, 11);

  const inconsistentCeiling = projectCanonicalQuote({
    quote_contract_version: "v1",
    quote_kind: "hold_ceiling",
    capture_basis: "actual_usage",
    total_credits: 5,
    hold_ceiling_credits: 5,
    capture_ceiling_credits: 20,
    currency: "aev",
    callable: true,
    exists: true,
  });
  assert.equal(inconsistentCeiling.ok, false);
  assert.equal(inconsistentCeiling.error.code, "quote_hold_ceiling_unavailable");
});

test("projectCanonicalQuote fails closed on availability/contract defects", () => {
  const { projectCanonicalQuote } = require("./server.js");

  assert.equal(projectCanonicalQuote(null).ok, false);
  assert.equal(projectCanonicalQuote({ quote_kind: "exact", total_credits: 1 }).ok, false);
  assert.equal(
    projectCanonicalQuote({
      quote_kind: "exact",
      quote_contract_version: "v1",
      total_credits: 1,
      currency: "aev",
      exists: true,
      callable: false,
      availability: {
        status: "unavailable",
        code: "provider_configuration_missing",
        reason: "missing platform provider configuration",
        fix: "configure the provider binding",
      },
    }).ok,
    false
  );
  assert.equal(
    projectCanonicalQuote({
      quote_kind: "hold_ceiling",
      quote_contract_version: "v1",
      total_credits: 0,
      currency: "aev",
      exists: true,
      callable: true,
      capture_basis: "actual_usage",
    }).ok,
    false
  );
});

test("projectQuoteError projects code/message/fix/retryable and safe trace_id", () => {
  const { projectQuoteError } = require("./server.js");
  const err = projectQuoteError({
    status: 503,
    json: {
      success: false,
      error: {
        code: "quote_hold_ceiling_unavailable",
        message: "an enforceable hold ceiling is unavailable for this usage-metered target",
        fix: "retry after the platform publishes a hold ceiling",
        retryable: true,
        trace_id: "trace_abc12345",
      },
    },
    headers: new Headers({ "x-semesh-trace-id": "header-trace-999" }),
  });
  assert.equal(err.code, "quote_hold_ceiling_unavailable");
  assert.match(err.message, /hold ceiling/i);
  assert.match(err.fix, /hold ceiling/i);
  assert.equal(err.retryable, true);
  assert.equal(err.trace_id, "header-trace-999");

  const unsafe = projectQuoteError({
    status: 502,
    json: { error: { code: "BAD CODE", message: "m", fix: "f", retryable: false, trace_id: "bad trace" } },
  });
  assert.equal(unsafe.code, "quote_backend_unavailable");
  assert.equal(Object.hasOwn(unsafe, "trace_id"), false);
});

test("unavailable quote preserves canonical availability and blocks invocation", () => {
  const { projectCanonicalQuote } = require("./server.js");
  const result = projectCanonicalQuote({
    quote_contract_version: "v1",
    quote_kind: "exact",
    currency: "aev",
    exists: true,
    callable: false,
    total_credits: 3,
    availability: {
      status: "unavailable",
      code: "provider_configuration_missing",
      reason: "provider is not configured",
      fix: "configure the provider binding",
      requirements: ["provider binding"],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "provider_configuration_missing");
  assert.deepEqual(result.error.availability.requirements, ["provider binding"]);
  assert.deepEqual(result.quote.availability.requirements, ["provider binding"]);
});

test("quoteAction is the only price authority and never invents a static amount", async () => {
  const { quoteAction } = require("./server.js");
  const nativeFetch = globalThis.fetch;
  let sawQuote = false;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/v1\/billing\/quote$/);
    sawQuote = true;
    assert.equal(init.method, "POST");
    const body = JSON.parse(init.body);
    assert.equal(body.capability_id, "REPLACE_WITH_A_REAL_CAPABILITY_ID");
    assert.deepEqual(body.input, { prompt: "hello" });
    return new Response("upstream down", { status: 502 });
  };
  try {
    const result = await quoteAction("payer-session", { prompt: "hello" });
    assert.equal(sawQuote, true);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error.code, "string");
    assert.equal(typeof result.error.message, "string");
    assert.equal(typeof result.error.fix, "string");
    assert.equal(typeof result.error.retryable, "boolean");
    assert.equal(Object.hasOwn(result, "quote"), false);
    assert.equal(Object.hasOwn(result.error, "total_credits"), false);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("quoteAction aborts only the read-only quote and returns a retryable timeout contract", async () => {
  const { quoteAction } = require("./server.js");
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  });
  try {
    const result = await quoteAction("payer-session", { prompt: "hello" }, { timeoutMs: 5 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 504);
    assert.equal(result.error.code, "quote_timeout");
    assert.equal(result.error.retryable, true);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test("paid action fails closed before quote when trusted and bound principals are missing or differ", async (t) => {
  const { server } = require("./server.js");
  const nativeFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls += 1;
    return new Response("unexpected", { status: 500 });
  };

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    globalThis.fetch = nativeFetch;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const address = server.address();
  const baseHeaders = {
    authorization: "Bearer test-payer-session",
    "content-type": "application/json",
    "idempotency-key": "action:principal-contract",
  };

  for (const [headers, expectedCode] of [
    [{ ...baseHeaders, "x-semesh-operation-principal": "user-alice" }, "operation_principal_unavailable"],
    [{ ...baseHeaders, "x-semesh-user-id": "user-alice" }, "operation_principal_binding_required"],
    [{ ...baseHeaders, "x-semesh-user-id": "user-bob", "x-semesh-operation-principal": "user-alice" }, "operation_principal_mismatch"],
  ]) {
    const response = await nativeFetch(`http://127.0.0.1:${address.port}/api/action`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: "must not run" }),
    });
    const payload = await response.json();
    assert.ok(response.status >= 400);
    assert.equal(payload.error.code, expectedCode);
    assert.equal(payload.effect_started, false);
    assert.equal(payload.phase, "identity");
  }
  assert.equal(externalCalls, 0, "identity failures must stop before quote and invoke");
});

test("quote adapter requires the same trusted principal binding before upstream quote", async (t) => {
  const { server } = require("./server.js");
  const nativeFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls += 1;
    return new Response("unexpected", { status: 500 });
  };
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    globalThis.fetch = nativeFetch;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  const address = server.address();
  const response = await nativeFetch(`http://127.0.0.1:${address.port}/api/quote`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-payer-session",
      "content-type": "application/json",
      "x-semesh-user-id": "user-bob",
      "x-semesh-operation-principal": "user-alice",
    },
    body: JSON.stringify({ prompt: "must not quote" }),
  });
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "operation_principal_mismatch");
  assert.equal(payload.effect_started, false);
  assert.equal(externalCalls, 0);
});

describe("HTTP quote authority routes", { concurrency: 1 }, () => {
  test("POST /api/action quotes the exact input and does not invoke when quote fails", async (t) => {
    const { server } = require("./server.js");
    const nativeFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (String(url).includes("/v1/billing/quote")) {
        return Response.json(
          {
            success: false,
            error: {
              code: "anonymous_quote_target_restricted",
              message: "this quote target requires authentication",
              fix: "authenticate before quoting this target",
              retryable: false,
              trace_id: "trace_quote_fail_1",
            },
          },
          { status: 401, headers: { "x-semesh-trace-id": "trace_quote_fail_1" } }
        );
      }
      return Response.json({ data: { ok: true } }, { status: 200 });
    };

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      globalThis.fetch = nativeFetch;
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    });

    const address = server.address();
    const response = await nativeFetch(`http://127.0.0.1:${address.port}/api/action`, {
      method: "POST",
      headers: {
        ...TEST_PRINCIPAL_HEADERS,
        authorization: "Bearer test-payer-session",
        "content-type": "application/json",
        "idempotency-key": "action:test-operation-1",
      },
      body: JSON.stringify({ prompt: "bill me" }),
    });
    const payload = await response.json();

    assert.ok(response.status >= 400);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/v1\/billing\/quote$/);
    assert.deepEqual(calls[0].body.input, { prompt: "bill me" });
    assert.equal(payload.error.code, "anonymous_quote_target_restricted");
    assert.equal(payload.error.trace_id, "trace_quote_fail_1");
    assert.match(payload.error.fix, /authenticate/i);
    assert.equal(payload.phase, "quote");
    assert.equal(payload.effect_started, false);
    assert.equal(Object.hasOwn(payload, "estimate_aev"), false);
    assert.equal(Object.hasOwn(payload, "result"), false);
  });

  test("POST /api/action invokes only after a successful live quote of the same input", async (t) => {
    const { server } = require("./server.js");
    const nativeFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
      const parsed = init.body ? JSON.parse(init.body) : null;
      calls.push({ url: String(url), method: init.method, body: parsed, signal: init.signal });
      if (String(url).includes("/v1/billing/quote")) {
        return Response.json({
          data: {
            quote_contract_version: "v1",
            quote_kind: "exact",
            total_credits: 3,
            base_cost_credits: 2.5,
            markup_credits: 0.5,
            currency: "aev",
            callable: true,
            exists: true,
            note: "exact service-unit price for this input",
          },
        });
      }
      if (String(url).includes("/invoke")) {
        return new Response(JSON.stringify({ data: { text: "done" } }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-semesh-charged-aev": "3",
          },
        });
      }
      return new Response("unexpected", { status: 500 });
    };

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      globalThis.fetch = nativeFetch;
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    });

    const address = server.address();
    const response = await nativeFetch(`http://127.0.0.1:${address.port}/api/action`, {
      method: "POST",
      headers: {
        ...TEST_PRINCIPAL_HEADERS,
        authorization: "Bearer test-payer-session",
        "content-type": "application/json",
        "idempotency-key": "action:test-operation-2",
      },
      body: JSON.stringify({ prompt: "same-input" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/v1\/billing\/quote$/);
    assert.match(calls[1].url, /\/invoke$/);
    assert.deepEqual(calls[0].body.input, { prompt: "same-input" });
    assert.deepEqual(calls[1].body.input, { prompt: "same-input" });
    assert.ok(calls[0].signal instanceof AbortSignal, "read-only quote must have a bounded timeout");
    assert.equal(calls[1].signal, undefined, "invoke outcome must not be made ambiguous by the quote timeout");
    assert.equal(payload.quote.quote_kind, "exact");
    assert.equal(payload.quote.total_credits, 3);
    assert.equal(payload.settlement_status, "captured");
    assert.equal(payload.captured_aev, 3);
    assert.equal(Object.hasOwn(payload, "estimate_aev"), false);
  });

  test("POST /api/action preserves trusted capture evidence on a non-2xx invoke", async (t) => {
    const { server } = require("./server.js");
    const nativeFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      if (String(url).includes("/v1/billing/quote")) {
        return Response.json({
          data: {
            quote_contract_version: "v1",
            quote_kind: "exact",
            total_credits: 4,
            base_cost_credits: 4,
            currency: "aev",
            callable: true,
            exists: true,
          },
        });
      }
      return Response.json(
        { success: false, error: { code: "provider_result_failed", message: "provider result failed" } },
        { status: 502, headers: { "x-semesh-charged-aev": "4" } }
      );
    };

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      globalThis.fetch = nativeFetch;
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    });

    const address = server.address();
    const response = await nativeFetch(`http://127.0.0.1:${address.port}/api/action`, {
      method: "POST",
      headers: {
        ...TEST_PRINCIPAL_HEADERS,
        authorization: "Bearer test-payer-session",
        "content-type": "application/json",
        "idempotency-key": "action:test-operation-error-capture",
      },
      body: JSON.stringify({ prompt: "same input" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 502);
    assert.equal(calls.length, 2);
    assert.equal(payload.settlement_status, "captured");
    assert.equal(payload.captured_aev, 4);
    assert.match(payload.message, /trusted platform evidence reports capture/i);
    assert.equal(payload.quote.total_credits, 4);
  });

  test("POST /api/action blocks a metered quote without an explicit consistent hold ceiling", async (t) => {
    const { server } = require("./server.js");
    const nativeFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return Response.json({
        data: {
          quote_contract_version: "v1",
          quote_kind: "hold_ceiling",
          capture_basis: "actual_usage",
          total_credits: 5,
          currency: "aev",
          callable: true,
          exists: true,
          metered: true,
        },
      });
    };

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      globalThis.fetch = nativeFetch;
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    });

    const address = server.address();
    const response = await nativeFetch(`http://127.0.0.1:${address.port}/api/action`, {
      method: "POST",
      headers: {
        ...TEST_PRINCIPAL_HEADERS,
        authorization: "Bearer test-payer-session",
        "content-type": "application/json",
        "idempotency-key": "action:test-operation-no-ceiling",
      },
      body: JSON.stringify({ model: "metered-model" }),
    });
    const payload = await response.json();

    assert.equal(response.status, 503);
    assert.equal(calls.length, 1, "missing ceiling must stop before capability invoke");
    assert.match(calls[0].url, /\/v1\/billing\/quote$/);
    assert.equal(payload.error.code, "quote_hold_ceiling_unavailable");
    assert.equal(payload.phase, "quote");
    assert.equal(payload.effect_started, false);
  });

  test("GET /api/me returns auth only and POST /api/quote quotes the exact browser input", async (t) => {
    const { server } = require("./server.js");
    const nativeFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /\/v1\/billing\/quote$/);
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return Response.json({
        data: {
          quote_contract_version: "v1",
          quote_kind: "representative_floor",
          total_credits: 2,
          base_cost_credits: 2,
          currency: "aev",
          callable: true,
          exists: true,
          required_fields: ["prompt"],
          availability: { status: "available" },
          note: "Pass input for an exact quote; this is a representative floor.",
          future_contract_field: { preserved: true },
        },
      });
    };

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      globalThis.fetch = nativeFetch;
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    });

    const address = server.address();
    const meResponse = await nativeFetch(`http://127.0.0.1:${address.port}/api/me`, {
      headers: { authorization: "Bearer test-payer-session" },
    });
    const me = await meResponse.json();
    assert.equal(me.logged_in, true);
    assert.equal(Object.hasOwn(me, "quote"), false);
    assert.equal(Object.hasOwn(me, "estimate_aev"), false);
    assert.equal(calls.length, 0, "auth state must not fabricate or preselect quote input");

    const quoteInput = { prompt: "browser input", duration: 4 };
    const quoteResponse = await nativeFetch(`http://127.0.0.1:${address.port}/api/quote`, {
      method: "POST",
      headers: {
        ...TEST_PRINCIPAL_HEADERS,
        authorization: "Bearer test-payer-session",
        "content-type": "application/json",
      },
      body: JSON.stringify(quoteInput),
    });
    const quoted = await quoteResponse.json();
    assert.equal(quoteResponse.status, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body.input, quoteInput);
    assert.equal(quoted.quote.quote_kind, "representative_floor");
    assert.deepEqual(quoted.quote.required_fields, ["prompt"]);
    assert.deepEqual(quoted.quote.future_contract_field, { preserved: true });
  });
});

test("POST /api/action rejects malformed JSON before quote or invoke", async (t) => {
  const { server } = require("./server.js");
  const nativeFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls += 1;
    return new Response("unexpected", { status: 500 });
  };

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    globalThis.fetch = nativeFetch;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  const address = server.address();
  const response = await new Promise((resolve, reject) => {
    const request = require("node:http").request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: "/api/action",
        method: "POST",
        headers: {
          ...TEST_PRINCIPAL_HEADERS,
          authorization: "Bearer test-payer-session",
          "content-type": "application/json",
          "idempotency-key": "action:test-operation-bad-json",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      }
    );
    request.on("error", reject);
    request.end("{");
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "invalid_json_body");
  assert.equal(response.body.effect_started, false);
  assert.equal(externalCalls, 0);
});
