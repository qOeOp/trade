import { isRunIdentityV1 } from "./run-contract.ts";
import type { OperationalRunReferenceV1 } from "./operational-run-reference.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export type SourceResearchActionEnvelopeV1 = {
  schema_version: 1;
  operation: "source_intake.research.submit_or_resolve.v1";
  channel: "DASHBOARD_DISPOSABLE_EXECUTION";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  source: {
    schema_version: 1;
    request_identity: string;
    resolution: "RETRIEVED";
    binding_identity: string;
    receipt_identity: string;
    content_digest: string;
  } | null;
  research: {
    schema_version: 1;
    request_identity: string;
    resolution: "ACCEPTED" | "REJECTED_NO_WRITE";
    intent_identity: string | null;
    trial_family_identity: string | null;
    next_legal_action: string;
  } | null;
  operational_run: OperationalRunReferenceV1;
};

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function operationalRun(value: unknown): OperationalRunReferenceV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "availability", "unavailable_reason", "run_identity", "state",
    "owner_outcome_state", "transition_version",
  ]) || value.schema_version !== 1) return null;
  if (value.availability === "available") {
    return value.unavailable_reason === null && isRunIdentityV1(value.run_identity)
      && ["succeeded", "failed"].includes(String(value.state))
      && ["available", "rejected"].includes(String(value.owner_outcome_state))
      && value.transition_version === 4 ? value as OperationalRunReferenceV1 : null;
  }
  if (value.availability !== "unavailable" || typeof value.unavailable_reason !== "string") {
    return null;
  }
  if (value.run_identity === null) {
    return value.state === null && value.owner_outcome_state === null
      && value.transition_version === null ? value as OperationalRunReferenceV1 : null;
  }
  return isRunIdentityV1(value.run_identity) && value.state === "running"
    && value.owner_outcome_state === "unknown" && Number.isSafeInteger(value.transition_version)
    && Number(value.transition_version) >= 1 && Number(value.transition_version) <= 3
    ? value as OperationalRunReferenceV1 : null;
}

export function parseSourceResearchActionEnvelopeV1(
  value: unknown,
  sourceRequestIdentity: string,
  researchRequestIdentity: string,
): SourceResearchActionEnvelopeV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "channel", "availability", "unavailable_reason", "source", "research",
    "operational_run",
  ]) || value.schema_version !== 1 || value.operation !== "source_intake.research.submit_or_resolve.v1"
    || value.channel !== "DASHBOARD_DISPOSABLE_EXECUTION"
    || !["available", "unavailable"].includes(String(value.availability))) return null;
  const run = operationalRun(value.operational_run);
  if (!run) return null;
  if (value.availability === "unavailable") {
    return typeof value.unavailable_reason === "string" && IDENTITY.test(value.unavailable_reason)
      && value.source === null && value.research === null ? value as SourceResearchActionEnvelopeV1 : null;
  }
  if (value.unavailable_reason !== null || !object(value.source) || !object(value.research)
    || !exactKeys(value.source, [
      "schema_version", "request_identity", "resolution", "binding_identity", "receipt_identity", "content_digest",
    ]) || value.source.schema_version !== 1 || value.source.request_identity !== sourceRequestIdentity
    || value.source.resolution !== "RETRIEVED"
    || ![value.source.binding_identity, value.source.receipt_identity].every((entry) => (
      typeof entry === "string" && IDENTITY.test(entry)
    )) || typeof value.source.content_digest !== "string" || !DIGEST.test(value.source.content_digest)
    || !exactKeys(value.research, [
      "schema_version", "request_identity", "resolution", "intent_identity", "trial_family_identity", "next_legal_action",
    ]) || value.research.schema_version !== 1 || value.research.request_identity !== researchRequestIdentity
    || !["ACCEPTED", "REJECTED_NO_WRITE"].includes(String(value.research.resolution))
    || typeof value.research.next_legal_action !== "string"
    || !IDENTITY.test(value.research.next_legal_action)) return null;
  const accepted = value.research.resolution === "ACCEPTED";
  if (accepted !== (typeof value.research.intent_identity === "string"
      && IDENTITY.test(value.research.intent_identity))
    || accepted !== (typeof value.research.trial_family_identity === "string"
      && IDENTITY.test(value.research.trial_family_identity))
    || (!accepted && (value.research.intent_identity !== null
      || value.research.trial_family_identity !== null))) return null;
  const expectedOutcome = accepted ? "available" : "rejected";
  const expectedState = accepted ? "succeeded" : "failed";
  return run.availability === "available" && run.owner_outcome_state === expectedOutcome
    && run.state === expectedState ? value as SourceResearchActionEnvelopeV1 : null;
}
