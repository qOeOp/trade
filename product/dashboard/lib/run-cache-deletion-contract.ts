import { createHash } from "node:crypto";

import { isRunIdentityV1 } from "./run-contract.ts";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PRINCIPAL = /^[A-Za-z0-9._:/-]{1,96}$/;

export type OperationalCacheDeletionReceiptV1 = {
  schema_version: 1;
  operation: "dashboard.operational_cache.delete.v1";
  receipt_identity: string;
  run_identity: string;
  prior_state: "succeeded" | "failed" | "cancelled" | "unknown";
  prior_transition_version: number;
  principal_ref: string;
  authorization_digest: string;
  deleted_at: string;
};

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalIdentityInput(value: Omit<OperationalCacheDeletionReceiptV1, "receipt_identity">) {
  return JSON.stringify([
    value.schema_version,
    value.operation,
    value.run_identity,
    value.prior_state,
    value.prior_transition_version,
    value.principal_ref,
    value.authorization_digest,
    value.deleted_at,
  ]);
}

export function operationalCacheDeletionReceiptIdentityV1(
  value: Omit<OperationalCacheDeletionReceiptV1, "receipt_identity">,
) {
  return `dashboard-operational-cache-deletion-v1-${createHash("sha256")
    .update(canonicalIdentityInput(value))
    .digest("hex")}`;
}

export function parseOperationalCacheDeletionReceiptV1(
  value: unknown,
): OperationalCacheDeletionReceiptV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "receipt_identity", "run_identity", "prior_state",
    "prior_transition_version", "principal_ref", "authorization_digest", "deleted_at",
  ]) || value.schema_version !== 1 || value.operation !== "dashboard.operational_cache.delete.v1"
    || !isRunIdentityV1(value.run_identity)
    || !["succeeded", "failed", "cancelled", "unknown"].includes(String(value.prior_state))
    || !Number.isSafeInteger(value.prior_transition_version)
    || Number(value.prior_transition_version) < 1
    || typeof value.principal_ref !== "string" || !PRINCIPAL.test(value.principal_ref)
    || typeof value.authorization_digest !== "string" || !DIGEST.test(value.authorization_digest)
    || typeof value.deleted_at !== "string" || !Number.isFinite(Date.parse(value.deleted_at))
    || new Date(value.deleted_at).toISOString() !== value.deleted_at) return null;
  const { receipt_identity: receiptIdentity, ...unsigned } = value;
  return receiptIdentity === operationalCacheDeletionReceiptIdentityV1(
    unsigned as Omit<OperationalCacheDeletionReceiptV1, "receipt_identity">,
  ) ? value as OperationalCacheDeletionReceiptV1 : null;
}

export type OperationalCacheDeletionEnvelopeV1 = {
  schema_version: 1;
  operation: "dashboard.operational_cache.delete.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  observed_at: string;
  run_identity: string;
  receipt: OperationalCacheDeletionReceiptV1 | null;
};

export function parseOperationalCacheDeletionEnvelopeV1(
  value: unknown,
): OperationalCacheDeletionEnvelopeV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "availability", "unavailable_reason", "observed_at",
    "run_identity", "receipt",
  ]) || value.schema_version !== 1 || value.operation !== "dashboard.operational_cache.delete.v1"
    || !isRunIdentityV1(value.run_identity) || typeof value.observed_at !== "string"
    || !Number.isFinite(Date.parse(value.observed_at))) return null;
  if (value.availability === "unavailable") {
    return typeof value.unavailable_reason === "string" && value.receipt === null
      ? value as OperationalCacheDeletionEnvelopeV1 : null;
  }
  const receipt = parseOperationalCacheDeletionReceiptV1(value.receipt);
  return value.availability === "available" && value.unavailable_reason === null && receipt
    && receipt.run_identity === value.run_identity
    && Date.parse(receipt.deleted_at) <= Date.parse(value.observed_at)
    ? { ...(value as OperationalCacheDeletionEnvelopeV1), receipt }
    : null;
}
