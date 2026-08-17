const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;

export function isValidIdempotencyKey(value) {
  return typeof value === "string" && IDEMPOTENCY_KEY.test(value);
}

// Provider output is never settlement authority. Only the platform's explicit post-capture header
// can move this template from unknown to captured, independently of HTTP/provider success.
/**
 * @param {Headers | null | undefined} headers
 * @returns {{ settlement_status: "captured" | "unknown", captured_aev: number | null }}
 */
export function captureEvidence(headers) {
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
