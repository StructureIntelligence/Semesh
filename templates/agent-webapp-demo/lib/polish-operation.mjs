import { isValidIdempotencyKey } from "./settlement.mjs";

export const POLISH_OPERATION_STORAGE_KEY = "semesh.snippet-vault.polish-operation.v1";

export function createPolishOperation(input, principalId) {
  const id = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
    ? "polish:" + globalThis.crypto.randomUUID()
    : "polish:" + Date.now() + ":" + Math.random().toString(36).slice(2);
  return { id, input, principalId };
}

// A pending paid operation is reusable only by the same stable principal. Its original input and
// key remain immutable; a useful provider result may be attached without replacing either.
export function parsePolishOperation(raw, principalId) {
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (
    !value ||
    !isValidIdempotencyKey(value.id) ||
    typeof value.input !== "string" ||
    value.input.length === 0 ||
    value.input.length > 10000 ||
    typeof value.principalId !== "string" ||
    value.principalId !== principalId ||
    (value.result !== undefined && typeof value.result !== "string")
  ) {
    return null;
  }
  return {
    id: value.id,
    input: value.input,
    principalId: value.principalId,
    ...(value.result === undefined ? {} : { result: value.result }),
  };
}

export function resolveStoredPolishOperation(raw, principalId) {
  if (raw == null) return { operation: null, shouldClear: false };
  const operation = parsePolishOperation(raw, principalId);
  return { operation, shouldClear: operation === null };
}
