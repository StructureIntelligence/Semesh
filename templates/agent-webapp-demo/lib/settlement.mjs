const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;
const INVOCATION_ID = /^inv_[A-Za-z0-9._:-]{4,196}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const OPAQUE = /^[\x21-\x7e]{1,1024}$/;
const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

export function isValidIdempotencyKey(value) {
  return typeof value === "string" && IDEMPOTENCY_KEY.test(value);
}

export function isValidInvocationId(value) {
  return typeof value === "string" && INVOCATION_ID.test(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRef(value, expected) {
  return (
    isObject(value) &&
    Object.keys(value).length === 4 &&
    value.unit_id === expected.unit_id &&
    typeof value.unit_revision === "string" &&
    SHA256.test(value.unit_revision) &&
    value.unit_revision === expected.unit_revision &&
    value.action_id === expected.action_id &&
    typeof value.action_revision === "string" &&
    SHA256.test(value.action_revision) &&
    value.action_revision === expected.action_revision
  );
}

function exactCatalog(value, expected) {
  return (
    isObject(value) &&
    Object.keys(value).length === 2 &&
    Number.isSafeInteger(value.view_generation) &&
    value.view_generation > 0 &&
    value.view_generation === expected.view_generation &&
    typeof value.view_digest === "string" &&
    SHA256.test(value.view_digest) &&
    value.view_digest === expected.view_digest
  );
}

function exactModelChoicePin(value, expected) {
  return (
    isObject(value) &&
    isObject(expected) &&
    Object.keys(value).length === 2 &&
    Object.keys(expected).length === 2 &&
    value.model_id === "deepseek-v3" &&
    value.model_id === expected.model_id &&
    isRuntimeIdentity(value.model_revision) &&
    value.model_revision === expected.model_revision
  );
}

function isRuntimeIdentity(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= 512 &&
    value === value.trim() &&
    !/[ \t\r\n]/.test(value) &&
    !/\p{Cc}/u.test(value)
  );
}

function atomInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function boundedOpaque(value, max) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    /^[\x21-\x7e]+$/.test(value)
  );
}

// Only the canonical terminal receipt is settlement authority. Response headers, provider output,
// and HTTP success may be retained as hints by callers, but they can never upgrade this projection.
export function projectInvocationReceipt(raw, expected) {
  const receipt = isObject(raw) && raw.success === true && isObject(raw.data)
    ? raw.data
    : null;
  if (
    !isObject(receipt) ||
    !isValidInvocationId(expected.invocation_id) ||
    receipt.invocation_id !== expected.invocation_id ||
    !isValidIdempotencyKey(expected.idempotency_key) ||
    receipt.idempotency_key !== expected.idempotency_key ||
    receipt.invocation_id === receipt.idempotency_key ||
    !boundedOpaque(expected.settlement_reference, 1024) ||
    receipt.settlement_reference !== expected.settlement_reference ||
    !TERMINAL.has(expected.state) ||
    receipt.terminal_state !== expected.state ||
    !exactRef(receipt.unit_action_ref, expected.unit_action_ref) ||
    !exactCatalog(receipt.catalog, expected.catalog) ||
    !exactModelChoicePin(receipt.model_choice_pin, expected.model_choice_pin) ||
    Object.hasOwn(receipt, "model_choice")
  ) {
    return {
      authoritative: false,
      settlement_status: "unknown",
      captured_aev_atoms: null,
      released_aev_atoms: null,
      receipt: null,
    };
  }

  const quote = expected.quote;
  const held = atomInteger(receipt.held_aev_atoms);
  const captured = atomInteger(receipt.captured_aev_atoms);
  const released = atomInteger(receipt.released_aev_atoms);
  if (
    !isObject(quote) ||
    (quote.quote_kind !== "exact" && quote.quote_kind !== "hold_ceiling") ||
    !exactModelChoicePin(quote.model_choice_pin, expected.model_choice_pin) ||
    Object.hasOwn(quote, "model_choice") ||
    !boundedOpaque(quote.quote_reference, 1024) ||
    !boundedOpaque(quote.quote_receipt, 65536) ||
    (Object.hasOwn(quote, "amount_aev_atoms") && atomInteger(quote.amount_aev_atoms) === null) ||
    (Object.hasOwn(quote, "ceiling_aev_atoms") && atomInteger(quote.ceiling_aev_atoms) === null) ||
    ![quote.input_digest, quote.price_digest, quote.policy_digest, quote.effect_digest].every(
      (digest) => typeof digest === "string" && SHA256.test(digest)
    ) ||
    ![
      receipt.input_digest,
      receipt.price_digest,
      receipt.policy_digest,
      receipt.effect_digest,
    ].every((digest) => typeof digest === "string" && SHA256.test(digest)) ||
    receipt.quote_reference !== quote.quote_reference ||
    receipt.quote_receipt !== quote.quote_receipt ||
    receipt.input_digest !== quote.input_digest ||
    receipt.price_digest !== quote.price_digest ||
    receipt.policy_digest !== quote.policy_digest ||
    receipt.effect_digest !== quote.effect_digest ||
    held === null ||
    captured === null ||
    released === null ||
    captured > held ||
    released !== held - captured ||
    !OPAQUE.test(receipt.settlement_reference)
  ) {
    return {
      authoritative: false,
      settlement_status: "unknown",
      captured_aev_atoms: null,
      released_aev_atoms: null,
      receipt: null,
    };
  }

  const authorized = quote.quote_kind === "exact"
    ? atomInteger(quote.amount_aev_atoms)
    : atomInteger(quote.ceiling_aev_atoms);
  if (
    authorized === null ||
    held !== authorized ||
    captured > authorized ||
    (expected.state === "succeeded" &&
      quote.quote_kind === "exact" &&
      (captured !== authorized || released !== 0)) ||
    (expected.state !== "succeeded" && (captured !== 0 || released !== held))
  ) {
    return {
      authoritative: false,
      settlement_status: "unknown",
      captured_aev_atoms: null,
      released_aev_atoms: null,
      receipt: null,
    };
  }

  return {
    authoritative: true,
    settlement_status: captured > 0 ? "captured" : "released",
    captured_aev_atoms: captured,
    released_aev_atoms: released,
    receipt,
  };
}
