import { createHash } from "node:crypto";

import { isRunIdentityV1 } from "./run-contract.ts";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ACTION_IDENTITY = /^dashboard-operational-action-v1-[0-9a-f]{64}$/;
const RECEIPT_IDENTITY = /^dashboard-operational-cancellation-v1-[0-9a-f]{64}$/;
const PRINCIPAL = /^[A-Za-z0-9._:/-]{1,96}$/;

export const EMPTY_DOMAIN_EFFECT_DIGEST_V1 = `sha256:${createHash("sha256")
  .update(JSON.stringify([]))
  .digest("hex")}`;

export type OperationalActionEnvelopeV1 = {
  schema_version: 1;
  operation: "dashboard.operational_action.v1";
  action_identity: string;
  capability: "dependency.cancel.queued";
  run_identity: string;
  principal_ref: string;
  authorization_digest: string;
  transition_version: number;
  kind: "dependency";
  state: "queued";
  domain_effect_digest: string;
  claim_absence_observed_at: string;
  expires_at: string;
};

export type OperationalCancellationReceiptV1 = {
  schema_version: 1;
  operation: "dashboard.dependency.cancel.queued.v1";
  receipt_identity: string;
  action_identity: string;
  run_identity: string;
  prior_state: "queued";
  prior_transition_version: number;
  state: "cancelled";
  transition_version: number;
  principal_ref: string;
  authorization_digest: string;
  cancelled_at: string;
};

export type OperationalCancellationReadbackV1 = {
  state: "none" | "pending" | "receipt" | "unavailable";
  unavailable_reason: string | null;
  action_envelope: OperationalActionEnvelopeV1 | null;
  receipt: OperationalCancellationReceiptV1 | null;
};

export type OperationalCancellationEnvelopeV1 = {
  schema_version: 1;
  operation: "dashboard.dependency.cancel.queued.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  observed_at: string;
  run_identity: string;
  receipt: OperationalCancellationReceiptV1 | null;
};

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

export function parseOperationalActionEnvelopeV1(value: unknown): OperationalActionEnvelopeV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "action_identity", "capability", "run_identity",
    "principal_ref", "authorization_digest", "transition_version", "kind", "state",
    "domain_effect_digest", "claim_absence_observed_at", "expires_at",
  ]) || value.schema_version !== 1 || value.operation !== "dashboard.operational_action.v1"
    || typeof value.action_identity !== "string" || !ACTION_IDENTITY.test(value.action_identity)
    || value.capability !== "dependency.cancel.queued" || !isRunIdentityV1(value.run_identity)
    || typeof value.principal_ref !== "string" || !PRINCIPAL.test(value.principal_ref)
    || typeof value.authorization_digest !== "string" || !DIGEST.test(value.authorization_digest)
    || !Number.isSafeInteger(value.transition_version) || Number(value.transition_version) < 1
    || value.kind !== "dependency" || value.state !== "queued"
    || value.domain_effect_digest !== EMPTY_DOMAIN_EFFECT_DIGEST_V1
    || !timestamp(value.claim_absence_observed_at) || !timestamp(value.expires_at)
    || Date.parse(value.expires_at) <= Date.parse(value.claim_absence_observed_at)
    || Date.parse(value.expires_at) - Date.parse(value.claim_absence_observed_at) > 60_000) return null;
  return value as OperationalActionEnvelopeV1;
}

function receiptIdentityInput(value: Omit<OperationalCancellationReceiptV1, "receipt_identity">) {
  return JSON.stringify([
    value.schema_version, value.operation, value.action_identity, value.run_identity,
    value.prior_state, value.prior_transition_version, value.state, value.transition_version,
    value.principal_ref, value.authorization_digest, value.cancelled_at,
  ]);
}

export function operationalCancellationReceiptIdentityV1(
  value: Omit<OperationalCancellationReceiptV1, "receipt_identity">,
) {
  return `dashboard-operational-cancellation-v1-${createHash("sha256")
    .update(receiptIdentityInput(value))
    .digest("hex")}`;
}

export function parseOperationalCancellationReceiptV1(
  value: unknown,
): OperationalCancellationReceiptV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "receipt_identity", "action_identity", "run_identity",
    "prior_state", "prior_transition_version", "state", "transition_version", "principal_ref",
    "authorization_digest", "cancelled_at",
  ]) || value.schema_version !== 1 || value.operation !== "dashboard.dependency.cancel.queued.v1"
    || typeof value.receipt_identity !== "string" || !RECEIPT_IDENTITY.test(value.receipt_identity)
    || typeof value.action_identity !== "string" || !ACTION_IDENTITY.test(value.action_identity)
    || !isRunIdentityV1(value.run_identity) || value.prior_state !== "queued"
    || !Number.isSafeInteger(value.prior_transition_version) || Number(value.prior_transition_version) < 1
    || value.state !== "cancelled" || value.transition_version !== Number(value.prior_transition_version) + 1
    || typeof value.principal_ref !== "string" || !PRINCIPAL.test(value.principal_ref)
    || typeof value.authorization_digest !== "string" || !DIGEST.test(value.authorization_digest)
    || !timestamp(value.cancelled_at)) return null;
  const { receipt_identity: receiptIdentity, ...unsigned } = value;
  return receiptIdentity === operationalCancellationReceiptIdentityV1(
    unsigned as Omit<OperationalCancellationReceiptV1, "receipt_identity">,
  ) ? value as OperationalCancellationReceiptV1 : null;
}

export function parseOperationalCancellationEnvelopeV1(
  value: unknown,
): OperationalCancellationEnvelopeV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "availability", "unavailable_reason", "observed_at",
    "run_identity", "receipt",
  ]) || value.schema_version !== 1 || value.operation !== "dashboard.dependency.cancel.queued.v1"
    || !isRunIdentityV1(value.run_identity) || !timestamp(value.observed_at)) return null;
  if (value.availability === "unavailable") {
    return typeof value.unavailable_reason === "string" && value.receipt === null
      ? value as OperationalCancellationEnvelopeV1 : null;
  }
  const receipt = parseOperationalCancellationReceiptV1(value.receipt);
  return value.availability === "available" && value.unavailable_reason === null && receipt
    && receipt.run_identity === value.run_identity
    && Date.parse(receipt.cancelled_at) <= Date.parse(value.observed_at)
    ? { ...(value as OperationalCancellationEnvelopeV1), receipt }
    : null;
}

export function parseOperationalCancellationReadbackV1(
  value: unknown,
  runIdentity: string,
  observedAt: string,
): OperationalCancellationReadbackV1 | null {
  if (!object(value) || !exactKeys(value, [
    "state", "unavailable_reason", "action_envelope", "receipt",
  ]) || !["none", "pending", "receipt", "unavailable"].includes(String(value.state))) return null;
  if (value.state === "pending") {
    const action = parseOperationalActionEnvelopeV1(value.action_envelope);
    return value.unavailable_reason === null && value.receipt === null && action
      && action.run_identity === runIdentity
      && Date.parse(action.claim_absence_observed_at) <= Date.parse(observedAt)
      && Date.parse(action.expires_at) > Date.parse(observedAt)
      ? { ...(value as OperationalCancellationReadbackV1), action_envelope: action }
      : null;
  }
  if (value.state === "receipt") {
    const receipt = parseOperationalCancellationReceiptV1(value.receipt);
    return value.unavailable_reason === null && value.action_envelope === null && receipt
      && receipt.run_identity === runIdentity && Date.parse(receipt.cancelled_at) <= Date.parse(observedAt)
      ? { ...(value as OperationalCancellationReadbackV1), receipt }
      : null;
  }
  if (value.state === "unavailable") {
    return typeof value.unavailable_reason === "string" && value.action_envelope === null
      && value.receipt === null ? value as OperationalCancellationReadbackV1 : null;
  }
  return value.unavailable_reason === null && value.action_envelope === null && value.receipt === null
    ? value as OperationalCancellationReadbackV1 : null;
}
