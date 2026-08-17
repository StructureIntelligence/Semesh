import test from "node:test";
import assert from "node:assert/strict";

import { captureEvidence, isValidIdempotencyKey } from "./settlement.mjs";

test("provider body and HTTP success cannot prove capture", () => {
  const providerOutput = {
    output: "valid polished text",
    cost: 99,
    amount: 98,
    charged: 97,
  };

  assert.equal(providerOutput.output, "valid polished text");
  assert.deepEqual(captureEvidence(new Headers()), {
    settlement_status: "unknown",
    captured_aev: null,
  });
});

test("only a valid explicit platform header proves capture", () => {
  assert.deepEqual(
    captureEvidence(new Headers({ "x-semesh-charged-aev": "3" })),
    { settlement_status: "captured", captured_aev: 3 }
  );
  for (const value of ["", "NaN", "-1", "Infinity"]) {
    assert.deepEqual(
      captureEvidence(new Headers({ "x-semesh-charged-aev": value })),
      { settlement_status: "unknown", captured_aev: null }
    );
  }
});

test("logical operation keys are stable, bounded header values", () => {
  assert.equal(isValidIdempotencyKey("polish:operation-123"), true);
  assert.equal(isValidIdempotencyKey("short"), false);
  assert.equal(isValidIdempotencyKey("polish key with spaces"), false);
  assert.equal(isValidIdempotencyKey("x".repeat(201)), false);
});
