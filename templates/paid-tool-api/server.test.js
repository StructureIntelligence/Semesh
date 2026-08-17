const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SEMESH_APP_API_KEY = "test-runtime-key";
const { captureEvidence, extractText } = require("./server.js");

test("provider payload cost-like fields are output only, never settlement evidence", () => {
  const providerPayload = {
    data: {
      text: "useful result",
      cost: 9001,
      nested: { amount: 8002, charged: 7003 },
    },
  };

  assert.equal(extractText(providerPayload), "useful result");
  assert.deepEqual(captureEvidence(new Headers()), {
    settlement_status: "unknown",
    captured_aev: null,
  });
});

test("only a valid explicit platform capture header proves captured money", () => {
  assert.deepEqual(
    captureEvidence(new Headers({ "x-semesh-charged-aev": "6" })),
    { settlement_status: "captured", captured_aev: 6 }
  );
  for (const value of ["", "not-a-number", "-1", "Infinity"]) {
    assert.deepEqual(
      captureEvidence(new Headers({ "x-semesh-charged-aev": value })),
      { settlement_status: "unknown", captured_aev: null }
    );
  }
});

test("HTTP response keeps provider cost-like fields out of settlement state", async (t) => {
  const { server } = require("./server.js");
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      data: {
        text: "provider output",
        cost: 999,
        amount: 998,
        charged: 997,
      },
    });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    globalThis.fetch = nativeFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  const address = server.address();
  assert.equal(typeof address, "object");
  const response = await nativeFetch(`http://127.0.0.1:${address.port}/api/tool`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-payer-session",
      "content-type": "application/json",
      "idempotency-key": "tool:test-operation-1",
    },
    body: JSON.stringify({ text: "hello", style: "tldr" }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.summary, "provider output");
  assert.equal(payload.settlement_status, "unknown");
  assert.equal(payload.captured_aev, null);
  assert.equal(Object.hasOwn(payload, "cost_aev"), false);
});

test("non-2xx response preserves explicit trusted capture evidence", async (t) => {
  const { server } = require("./server.js");
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      { error: { code: "provider_result_unavailable" } },
      { status: 502, headers: { "x-semesh-charged-aev": "4" } }
    );

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    globalThis.fetch = nativeFetch;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  const address = server.address();
  assert.equal(typeof address, "object");
  const response = await nativeFetch(`http://127.0.0.1:${address.port}/api/tool`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-payer-session",
      "content-type": "application/json",
      "idempotency-key": "tool:test-operation-2",
    },
    body: JSON.stringify({ text: "hello", style: "tldr" }),
  });
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.settlement_status, "captured");
  assert.equal(payload.captured_aev, 4);
  assert.equal(payload.idempotency_key, "tool:test-operation-2");
});
