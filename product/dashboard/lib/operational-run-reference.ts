import { isRunIdentityV1 } from "./run-contract.ts";
import type { OperationRunV1 } from "./run-store.ts";

export type OperationalRunReferenceV1 = {
  schema_version: 1;
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  run_identity: string | null;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown" | null;
  owner_outcome_state: "available" | "rejected" | "unknown" | "unavailable"
    | "not_applicable" | null;
  transition_version: number | null;
};

export function operationalRunAvailableV1(run: OperationRunV1): OperationalRunReferenceV1 {
  return {
    schema_version: 1,
    availability: "available",
    unavailable_reason: null,
    run_identity: run.run_identity,
    state: run.state,
    owner_outcome_state: run.owner_outcome_state,
    transition_version: run.transition_version,
  };
}

export function operationalRunUnavailableV1(
  reason: string,
  run: OperationRunV1 | null = null,
): OperationalRunReferenceV1 {
  return {
    schema_version: 1,
    availability: "unavailable",
    unavailable_reason: reason,
    run_identity: run?.run_identity ?? null,
    state: run?.state ?? null,
    owner_outcome_state: run?.owner_outcome_state ?? null,
    transition_version: run?.transition_version ?? null,
  };
}

export function validOperationalRunReferenceV1(
  value: unknown,
  expectedOutcome: "available" | "rejected" | "unavailable" | "unknown",
): value is OperationalRunReferenceV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const run = value as Record<string, unknown>;
  const keys = Object.keys(run).sort();
  const expectedKeys = [
    "schema_version", "availability", "unavailable_reason", "run_identity", "state",
    "owner_outcome_state", "transition_version",
  ].sort();
  if (keys.length !== expectedKeys.length
    || !keys.every((key, index) => key === expectedKeys[index])
    || run.schema_version !== 1) return false;
  if (run.availability === "available") {
    return run.unavailable_reason === null
      && isRunIdentityV1(run.run_identity)
      && run.state === "succeeded"
      && run.owner_outcome_state === expectedOutcome
      && run.transition_version === 2;
  }
  if (run.availability !== "unavailable" || typeof run.unavailable_reason !== "string") {
    return false;
  }
  const empty = run.run_identity === null && run.state === null
    && run.owner_outcome_state === null && run.transition_version === null;
  if ([
    "RUN_STORE_CONFIGURATION_UNAVAILABLE",
    "RUN_STORE_UNAVAILABLE",
    "EFFECT_DISPATCH_NOT_ADMITTED",
  ]
    .includes(run.unavailable_reason)) return empty;
  return run.unavailable_reason === "RUN_STORE_TRANSITION_UNAVAILABLE"
    && isRunIdentityV1(run.run_identity)
    && run.state === "running"
    && run.owner_outcome_state === "unknown"
    && run.transition_version === 1;
}
