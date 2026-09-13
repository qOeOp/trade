import { isRunIdentityV1 } from "./run-contract.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/u;

export type ArtifactFormationBrowserStateV1 = Readonly<{
  availability: "available" | "unavailable";
  unavailableReason: string | null;
  resolution: "SUCCESS" | "FAILED_NO_ARTIFACT" | "REJECTED_NO_WRITE"
    | "OUTCOME_UNKNOWN" | "SUBMITTED_OR_UNKNOWN" | "QUEUED" | null;
  buildRequestIdentity: string | null;
  attemptIdentity: string | null;
  nextLegalAction: string | null;
  runIdentity: string | null;
}>;

export type ArtifactFormationPreflightBrowserStateV1 = Readonly<{
  availability: "available" | "unavailable";
  unavailableReason: string | null;
  researchRequestIdentity: string;
  actionState: "READY" | "REVALIDATION_REQUIRED";
}>;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function identity(value: unknown): value is string {
  return typeof value === "string" && IDENTITY.test(value);
}

function operationalRunIdentity(value: unknown): string | null | undefined {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "availability", "unavailable_reason", "run_identity", "state",
    "owner_outcome_state", "transition_version",
  ]) || value.schema_version !== 1
    || !["available", "unavailable"].includes(String(value.availability))) return undefined;
  const available = value.availability === "available";
  if (value.run_identity === null) {
    return !available && identity(value.unavailable_reason)
      && value.state === null && value.owner_outcome_state === null
      && value.transition_version === null ? null : undefined;
  }
  return (available ? value.unavailable_reason === null : identity(value.unavailable_reason))
    && isRunIdentityV1(value.run_identity)
    && ["queued", "running", "succeeded", "failed", "cancelled", "unknown"].includes(String(value.state))
    && ["available", "rejected", "unknown", "unavailable", "not_applicable"]
      .includes(String(value.owner_outcome_state))
    && Number.isSafeInteger(value.transition_version)
    && Number(value.transition_version) >= 0
    ? value.run_identity
    : undefined;
}

export function parseArtifactFormationPreflightBrowserStateV1(
  value: unknown,
  expectedResearchRequestIdentity: string,
): ArtifactFormationPreflightBrowserStateV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "channel", "phase", "availability",
    "unavailable_reason", "research_request_identity", "action_state",
  ]) || value.schema_version !== 1
    || value.operation !== "artifact_build.formation_execute.v1"
    || value.channel !== "DASHBOARD_DISPOSABLE_EXECUTION"
    || value.phase !== "PREFLIGHT"
    || value.research_request_identity !== expectedResearchRequestIdentity
    || !["available", "unavailable"].includes(String(value.availability))
    || !["READY", "REVALIDATION_REQUIRED"].includes(String(value.action_state))) return null;
  const available = value.availability === "available";
  if (available !== (value.action_state === "READY")
    || available !== (value.unavailable_reason === null)
    || (!available && !identity(value.unavailable_reason))) return null;
  return {
    availability: value.availability,
    unavailableReason: value.unavailable_reason as string | null,
    researchRequestIdentity: expectedResearchRequestIdentity,
    actionState: value.action_state,
  } as ArtifactFormationPreflightBrowserStateV1;
}

export function parseArtifactFormationBrowserStateV1(
  value: unknown,
  expectedBuildRequestIdentity: string,
  expectedAttemptIdentity: string,
): ArtifactFormationBrowserStateV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "channel", "availability", "unavailable_reason",
    "projection", "operational_run",
  ]) || value.schema_version !== 1
    || value.operation !== "artifact_build.formation_execute.v1"
    || value.channel !== "DASHBOARD_DISPOSABLE_EXECUTION"
    || !["available", "unavailable"].includes(String(value.availability))) return null;
  const runIdentity = operationalRunIdentity(value.operational_run);
  if (runIdentity === undefined) return null;
  if (value.availability === "unavailable") {
    if (!identity(value.unavailable_reason) || value.projection !== null) return null;
    return {
      availability: "unavailable",
      unavailableReason: value.unavailable_reason,
      resolution: null,
      buildRequestIdentity: expectedBuildRequestIdentity,
      attemptIdentity: expectedAttemptIdentity,
      nextLegalAction: null,
      runIdentity,
    };
  }
  if (value.unavailable_reason === null && value.projection === null
    && object(value.operational_run)
    && value.operational_run.availability === "available"
    && ["queued", "running"].includes(String(value.operational_run.state))) {
    return {
      availability: "available",
      unavailableReason: null,
      resolution: "QUEUED",
      buildRequestIdentity: expectedBuildRequestIdentity,
      attemptIdentity: expectedAttemptIdentity,
      nextLegalAction: "RESOLVE_SAME_ATTEMPT_IDENTITY",
      runIdentity,
    };
  }
  if (value.unavailable_reason !== null || !object(value.projection)
    || !exactKeys(value.projection, [
      "schema_version", "resolution", "build_request_identity", "attempt_identity",
      "owner_receipt", "research_view", "artifact_review", "artifact_review_actions",
      "trial_family_resolution", "artifact_trial_family", "next_legal_action",
      "provider_invocation", "consumer_projection",
    ]) || value.projection.schema_version !== 1
    || !object(value.projection.consumer_projection)
    || !exactKeys(value.projection.consumer_projection, [
      "schema_version", "operation", "owner_operation", "owner_schema",
    ])
    || value.projection.consumer_projection.schema_version !== 1
    || value.projection.consumer_projection.operation !== "artifact_build.consumer_projection.v1"
    || value.projection.consumer_projection.owner_operation !== "artifact_build.submit_or_resolve.v1"
    || value.projection.consumer_projection.owner_schema !== "rd-artifact-build-request-v1"
    || !["SUCCESS", "FAILED_NO_ARTIFACT", "REJECTED_NO_WRITE", "OUTCOME_UNKNOWN", "SUBMITTED_OR_UNKNOWN"]
      .includes(String(value.projection.resolution))
    || value.projection.build_request_identity !== expectedBuildRequestIdentity
    || value.projection.attempt_identity !== expectedAttemptIdentity
    || !identity(value.projection.next_legal_action)) return null;
  return {
    availability: "available",
    unavailableReason: null,
    resolution: value.projection.resolution,
    buildRequestIdentity: expectedBuildRequestIdentity,
    attemptIdentity: expectedAttemptIdentity,
    nextLegalAction: value.projection.next_legal_action,
    runIdentity,
  } as ArtifactFormationBrowserStateV1;
}
