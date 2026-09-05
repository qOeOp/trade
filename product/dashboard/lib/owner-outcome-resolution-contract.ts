import { isRunIdentityV1 } from "./run-contract.ts";

const OPERATION_ID = /^[A-Za-z0-9._:-]{1,192}$/;

export type OwnerOutcomeResolutionRunV1 = {
  schema_version: 1;
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  run_identity: string | null;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown" | null;
  owner_outcome_state: "available" | "rejected" | "unknown" | "unavailable"
    | "not_applicable" | null;
  transition_version: number | null;
};

export type OwnerOutcomeResolutionEnvelopeV1 = {
  schema_version: 1;
  operation: "dashboard.owner_outcome.resolve.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  observed_at: string;
  source_run_identity: string | null;
  source_transition_version: number | null;
  resolved_operation_id: string | null;
  owner_outcome_state: OwnerOutcomeResolutionRunV1["owner_outcome_state"];
  replacement_run: OwnerOutcomeResolutionRunV1 | null;
};

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseReplacementRun(value: unknown): OwnerOutcomeResolutionRunV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const run = value as Record<string, unknown>;
  if (!exactKeys(run, [
    "schema_version", "availability", "unavailable_reason", "run_identity", "state",
    "owner_outcome_state", "transition_version",
  ]) || run.schema_version !== 1
    || !["available", "unavailable"].includes(String(run.availability))) return null;
  if (run.availability === "available") {
    return run.unavailable_reason === null && isRunIdentityV1(run.run_identity)
      && run.state === "succeeded"
      && ["available", "rejected", "unknown", "unavailable", "not_applicable"]
        .includes(String(run.owner_outcome_state))
      && Number.isSafeInteger(run.transition_version) && Number(run.transition_version) >= 2
      ? run as OwnerOutcomeResolutionRunV1 : null;
  }
  const empty = run.run_identity === null && run.state === null
    && run.owner_outcome_state === null && run.transition_version === null;
  const retained = isRunIdentityV1(run.run_identity)
    && run.state === "running" && run.owner_outcome_state === "unknown"
    && Number.isSafeInteger(run.transition_version) && Number(run.transition_version) >= 1;
  return typeof run.unavailable_reason === "string" && (empty || retained)
    ? run as OwnerOutcomeResolutionRunV1 : null;
}

export function parseOwnerOutcomeResolutionEnvelopeV1(
  value: unknown,
): OwnerOutcomeResolutionEnvelopeV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (!exactKeys(envelope, [
    "schema_version", "operation", "availability", "unavailable_reason", "observed_at",
    "source_run_identity", "source_transition_version", "resolved_operation_id",
    "owner_outcome_state", "replacement_run",
  ]) || envelope.schema_version !== 1
    || envelope.operation !== "dashboard.owner_outcome.resolve.v1"
    || !["available", "unavailable"].includes(String(envelope.availability))
    || !timestamp(envelope.observed_at)) return null;
  const replacement = envelope.replacement_run === null
    ? null : parseReplacementRun(envelope.replacement_run);
  if (envelope.replacement_run !== null && !replacement) return null;
  if (envelope.availability === "available") {
    return envelope.unavailable_reason === null
      && isRunIdentityV1(envelope.source_run_identity)
      && Number.isSafeInteger(envelope.source_transition_version)
      && Number(envelope.source_transition_version) >= 1
      && typeof envelope.resolved_operation_id === "string"
      && OPERATION_ID.test(envelope.resolved_operation_id)
      && replacement?.availability === "available"
      && replacement.run_identity !== envelope.source_run_identity
      && envelope.owner_outcome_state === replacement.owner_outcome_state
      ? envelope as OwnerOutcomeResolutionEnvelopeV1 : null;
  }
  const preflight = envelope.source_run_identity === null
    && envelope.source_transition_version === null && envelope.resolved_operation_id === null
    && envelope.owner_outcome_state === null && envelope.replacement_run === null;
  const postDispatch = isRunIdentityV1(envelope.source_run_identity)
    && Number.isSafeInteger(envelope.source_transition_version)
    && Number(envelope.source_transition_version) >= 1
    && typeof envelope.resolved_operation_id === "string"
    && OPERATION_ID.test(envelope.resolved_operation_id)
    && envelope.owner_outcome_state === null
    && replacement?.availability === "unavailable"
    && replacement.run_identity !== envelope.source_run_identity;
  return typeof envelope.unavailable_reason === "string" && (preflight || postDispatch)
    ? envelope as OwnerOutcomeResolutionEnvelopeV1 : null;
}
