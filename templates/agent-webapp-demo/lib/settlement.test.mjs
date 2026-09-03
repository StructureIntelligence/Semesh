import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isValidIdempotencyKey,
  isValidInvocationId,
  projectInvocationReceipt,
} from "./settlement.mjs";
import { readBoundedJSONResponse } from "./polish-operation.mjs";

const ref = {
  unit_id: "unit_deepseek_text",
  unit_revision: "sha256:" + "1".repeat(64),
  action_id: "polish",
  action_revision: "sha256:" + "2".repeat(64),
};
const catalog = {
  view_generation: 41,
  view_digest: "sha256:" + "a".repeat(64),
};
const modelChoicePin = {
  model_id: "deepseek-v3",
  model_revision: "model.release.2026-09-02",
};
const quote = {
  quote_kind: "exact",
  amount_aev_atoms: 3,
  quote_reference: "quote_123",
  quote_receipt: "quote_receipt_123",
  input_digest: "sha256:" + "3".repeat(64),
  price_digest: "sha256:" + "4".repeat(64),
  policy_digest: "sha256:" + "5".repeat(64),
  effect_digest: "sha256:" + "6".repeat(64),
  model_choice_pin: modelChoicePin,
};
const expected = {
  invocation_id: "inv_abc12345",
  idempotency_key: "polish-request:operation-123",
  settlement_reference: "set_123",
  state: "succeeded",
  unit_action_ref: ref,
  catalog,
  model_choice_pin: modelChoicePin,
  quote,
};

test("request replay key and observation identity are distinct domains", () => {
  assert.equal(isValidIdempotencyKey("polish-request:operation-123"), true);
  assert.equal(isValidInvocationId("inv_abc12345"), true);
  assert.equal(isValidInvocationId("polish-request:operation-123"), false);
  assert.equal(isValidIdempotencyKey("key with spaces"), false);
  assert.equal(
    projectInvocationReceipt(
      {
        success: true,
        data: {
          invocation_id: "inv_abc12345",
          idempotency_key: "inv_abc12345",
          terminal_state: "succeeded",
          unit_action_ref: ref,
          catalog,
          model_choice_pin: modelChoicePin,
        },
      },
      { ...expected, idempotency_key: "inv_abc12345" }
    ).authoritative,
    false
  );
});

test("an exact terminal canonical receipt is settlement authority", () => {
  const receipt = {
    invocation_id: expected.invocation_id,
    idempotency_key: expected.idempotency_key,
    terminal_state: expected.state,
    unit_action_ref: ref,
    catalog,
    model_choice_pin: expected.model_choice_pin,
    quote_reference: quote.quote_reference,
    quote_receipt: quote.quote_receipt,
    input_digest: quote.input_digest,
    price_digest: quote.price_digest,
    policy_digest: quote.policy_digest,
    effect_digest: quote.effect_digest,
    held_aev_atoms: 3,
    captured_aev_atoms: 3,
    released_aev_atoms: 0,
    settlement_reference: "set_123",
  };
  const projected = projectInvocationReceipt({ success: true, data: receipt }, expected);
  assert.equal(projected.authoritative, true);
  assert.equal(projected.settlement_status, "captured");
  assert.equal(projected.captured_aev_atoms, 3);
  assert.equal(projected.receipt, receipt);

  const unicodePin = {
    model_id: "deepseek-v3",
    model_revision: "model.\u00a0release.2026-09-02",
  };
  assert.equal(
    projectInvocationReceipt(
      { success: true, data: { ...receipt, model_choice_pin: unicodePin } },
      {
        ...expected,
        model_choice_pin: unicodePin,
        quote: { ...quote, model_choice_pin: unicodePin },
      }
    ).authoritative,
    true
  );
});

test("incomplete, mismatched, or hostile receipt amounts never prove settlement", () => {
  const base = {
    invocation_id: expected.invocation_id,
    idempotency_key: expected.idempotency_key,
    terminal_state: expected.state,
    unit_action_ref: ref,
    catalog,
    model_choice_pin: expected.model_choice_pin,
    quote_reference: quote.quote_reference,
    quote_receipt: quote.quote_receipt,
    input_digest: quote.input_digest,
    price_digest: quote.price_digest,
    policy_digest: quote.policy_digest,
    effect_digest: quote.effect_digest,
    held_aev_atoms: 3,
    captured_aev_atoms: 9,
    released_aev_atoms: 0,
    settlement_reference: "set_123",
  };
  for (const receipt of [
    base,
    { ...base, captured_aev_atoms: 3, invocation_id: "inv_other123" },
    { ...base, captured_aev_atoms: 3, idempotency_key: "polish-request:different-123" },
    { ...base, captured_aev_atoms: 3, catalog: { ...catalog, view_generation: 42 } },
    { ...base, captured_aev_atoms: 3, catalog: { ...catalog, scope: "public" } },
    { ...base, captured_aev_atoms: 3, catalog: { ...catalog, view_digest: "sha256:short" } },
    { ...base, captured_aev_atoms: 3, model_choice_pin: { ...modelChoicePin, model_revision: "model release with spaces" } },
    { ...base, captured_aev_atoms: 3, model_choice_pin: { ...modelChoicePin, model_revision: "\u00e9".repeat(257) } },
    { ...base, captured_aev_atoms: 3, model_choice_pin: { ...modelChoicePin, model_revision: "model.release.2026-09-03" } },
    { ...base, captured_aev_atoms: 3, model_choice: "deepseek-v3" },
    { ...base, captured_aev_atoms: 3, unit_action_ref: { ...ref, extra: "not-canonical" } },
    { ...base, captured_aev_atoms: 3, unit_action_ref: { ...ref, unit_revision: "sha256:short" } },
    { ...base, captured_aev_atoms: 3, unit_action_ref: { ...ref, action_revision: "sha256:" + "G".repeat(64) } },
    { ...base, captured_aev_atoms: 3, price_digest: "sha256:" + "7".repeat(64) },
    { ...base, captured_aev_atoms: 3, input_digest: "sha256:short" },
    { ...base, captured_aev_atoms: 3, effect_digest: "sha256:" + "g".repeat(64) },
    { ...base, captured_aev_atoms: 3, quote_receipt: "quote_receipt_drift" },
    { ...base, captured_aev_atoms: 3, settlement_reference: "set_drift" },
    { ...base, captured_aev_atoms: 3, settlement_reference: "" },
  ]) {
    assert.deepEqual(projectInvocationReceipt({ success: true, data: receipt }, expected), {
      authoritative: false,
      settlement_status: "unknown",
      captured_aev_atoms: null,
      released_aev_atoms: null,
      receipt: null,
    });
  }
});

test("unsafe numeric and string atom forms fail closed", () => {
  const receipt = {
    invocation_id: expected.invocation_id,
    idempotency_key: expected.idempotency_key,
    terminal_state: expected.state,
    unit_action_ref: ref,
    catalog,
    model_choice_pin: expected.model_choice_pin,
    quote_reference: quote.quote_reference,
    quote_receipt: quote.quote_receipt,
    input_digest: quote.input_digest,
    price_digest: quote.price_digest,
    policy_digest: quote.policy_digest,
    effect_digest: quote.effect_digest,
    held_aev_atoms: 3,
    captured_aev_atoms: 3,
    released_aev_atoms: 0,
    settlement_reference: expected.settlement_reference,
  };
  for (const mutation of [
    { receipt: { ...receipt, held_aev_atoms: Number.MAX_SAFE_INTEGER + 1 }, expected },
    { receipt: { ...receipt, captured_aev_atoms: "3" }, expected },
    { receipt, expected: { ...expected, quote: { ...quote, amount_aev_atoms: "3" } } },
    { receipt, expected: { ...expected, quote: { ...quote, ceiling_aev_atoms: "3" } } },
    {
      receipt: { ...receipt, held_aev_atoms: Number.MAX_SAFE_INTEGER + 1 },
      expected: {
        ...expected,
        quote: { ...quote, amount_aev_atoms: Number.MAX_SAFE_INTEGER + 1 },
      },
    },
  ]) {
    assert.equal(
      projectInvocationReceipt(
        { success: true, data: mutation.receipt },
        mutation.expected
      ).authoritative,
      false
    );
  }
});

test("receipt authority requires an explicit success:true envelope", () => {
  const receipt = {
    invocation_id: expected.invocation_id,
    idempotency_key: expected.idempotency_key,
    terminal_state: expected.state,
    unit_action_ref: ref,
    catalog,
    model_choice_pin: expected.model_choice_pin,
    quote_reference: quote.quote_reference,
    quote_receipt: quote.quote_receipt,
    input_digest: quote.input_digest,
    price_digest: quote.price_digest,
    policy_digest: quote.policy_digest,
    effect_digest: quote.effect_digest,
    held_aev_atoms: 3,
    captured_aev_atoms: 3,
    released_aev_atoms: 0,
    settlement_reference: "set_123",
  };
  for (const payload of [receipt, { data: receipt }, { success: false, data: receipt }]) {
    assert.equal(projectInvocationReceipt(payload, expected).authoritative, false);
  }
});

test("bounded JSON reader cancels oversized streams and rejects hostile metadata or UTF-8", async () => {
  const encoded = new TextEncoder().encode('{"message":"caf\u00e9"}');
  const validStream = new ReadableStream({
    start(controller) {
      const split = encoded.indexOf(0xc3) + 1;
      controller.enqueue(encoded.slice(0, split));
      controller.enqueue(encoded.slice(split));
      controller.close();
    },
  });
  assert.deepEqual(
    await readBoundedJSONResponse(
      new Response(validStream, { headers: { "content-length": String(encoded.byteLength) } }),
      2 * 1024 * 1024
    ),
    { message: "caf\u00e9" }
  );

  await assert.rejects(
    readBoundedJSONResponse(
      new Response("{}", { headers: { "content-length": "not-an-integer" } }),
      2 * 1024 * 1024
    ),
    /invalid Content-Length/
  );
  await assert.rejects(
    readBoundedJSONResponse(
      new Response("{}", { headers: { "content-length": "2097153" } }),
      2 * 1024 * 1024
    ),
    /response too large/
  );

  let oversizedCanceled = false;
  const oversized = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
    },
    cancel() {
      oversizedCanceled = true;
    },
  });
  await assert.rejects(
    readBoundedJSONResponse(new Response(oversized), 2 * 1024 * 1024),
    /response too large/
  );
  assert.equal(oversizedCanceled, true);

  let invalidUtf8Canceled = false;
  const invalidUtf8 = new ReadableStream({
    pull(controller) {
      controller.enqueue(Uint8Array.of(0xc3, 0x28));
    },
    cancel() {
      invalidUtf8Canceled = true;
    },
  });
  await assert.rejects(
    readBoundedJSONResponse(new Response(invalidUtf8), 2 * 1024 * 1024),
    /encoded data was not valid/
  );
  assert.equal(invalidUtf8Canceled, true);
});

test("runtime source uses only canonical Unit routes and receipt evidence", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(here, "semesh.ts"), "utf8");
  const operationSource = fs.readFileSync(path.join(here, "polish-operation.mjs"), "utf8");
  assert.doesNotMatch(source, /\/v1\/(?:capabilities|tools|models|services\/search|billing\/quote)(?:\/|\b)/);
  assert.match(source, /\/v1\/service-units/);
  assert.match(source, /X-Semesh-Catalog-Token/);
  assert.match(source, /credentials:\s*"omit"/);
  assert.match(source, /cache:\s*"no-store"/);
  assert.match(source, /payload\.success\s*===\s*true/);
  assert.match(source, /searchPayload\.success\s*!==\s*true/);
  assert.match(source, /effect\?\.requires_confirmation\s*!==\s*false/);
  assert.doesNotMatch(source, /effect\?\.confirmation_required/);
  assert.match(source, /value\.confirmation_required\s*!==\s*false/);
  assert.match(operationSource, /action\.model_choices/);
  assert.match(operationSource, /choice\.ref/);
  assert.match(operationSource, /choice\.selectable\s*!==\s*true/);
  assert.match(operationSource, /choice\.callable\s*!==\s*false/);
  assert.match(operationSource, /choice\.targets/);
  assert.match(source, /model_choice_pin/);
  assert.doesNotMatch(source, /SEMESH_POLISH_MODEL_CHOICE/);
  assert.match(source, /"\/v1\/invocations\/"/);
  assert.match(source, /"\/receipt"/);
});
