export const RESEARCH_SHADOW_RESOLVE_OPERATION = "research_goal.shadow_resolve.v1" as const;
export const LEGACY_RESEARCH_QUARANTINE_READ_OPERATION = "research_goal.legacy_quarantine_read.v1" as const;
export const ARTIFACT_SHADOW_RESOLVE_OPERATION = "artifact_build.shadow_resolve.v1" as const;
export const SOURCE_INTAKE_SHADOW_READ_OPERATION = "source_intake.shadow_read.v1" as const;
export const RD_FORMATION_CATALOG_SHADOW_READ_OPERATION = "rd_formation_catalog.shadow_read.v1" as const;
export const RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION = "rd_historical_custody.shadow_read.v1" as const;
export const RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION = "rd_iteration_timeline.shadow_read.v1" as const;
export const EXPLORATORY_REPLAY_SHADOW_READ_OPERATION = "exploratory_replay.shadow_read.v2" as const;
export const DEVELOP_COMPOSER_SHADOW_READ_OPERATION = "develop_composer.shadow_read.v2" as const;

export type RegisteredOperationId =
  | typeof RESEARCH_SHADOW_RESOLVE_OPERATION
  | typeof LEGACY_RESEARCH_QUARANTINE_READ_OPERATION
  | typeof ARTIFACT_SHADOW_RESOLVE_OPERATION
  | typeof SOURCE_INTAKE_SHADOW_READ_OPERATION
  | typeof RD_FORMATION_CATALOG_SHADOW_READ_OPERATION
  | typeof RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION
  | typeof RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION
  | typeof EXPLORATORY_REPLAY_SHADOW_READ_OPERATION
  | typeof DEVELOP_COMPOSER_SHADOW_READ_OPERATION;

export type OperationDispatchBindingV1 = {
  registry_entry_digest: string;
  compatibility_envelope_set_digest: string;
};

export type OperationDescriptorV1 = {
  schema_version: 1;
  operation_id: RegisteredOperationId;
  owner_operation: string;
  owner_schema: string;
  capability: string;
  effect_set: readonly string[];
  dependency_operation_ids: readonly RegisteredOperationId[];
  owner_route: {
    method: "GET" | "POST";
    path_template: string;
    identity_fields: readonly string[];
    body_schema: null | "empty-object-v1";
  };
  timeout_class: {
    identity: "owner-read-8s";
    milliseconds: 8_000;
  };
  recovery_identity_fields: readonly string[];
  allowed_operational_reads: readonly string[];
  channels: readonly ["DASHBOARD_SHADOW_READ"];
  deployment_state: "unavailable";
  compatibility_envelope_digest: null;
  compatibility_observed_at_epoch_ms: null;
  compatibility_valid_through_epoch_ms: null;
  deployment_unavailable_reason: "COMPATIBILITY_ENVELOPE_UNAVAILABLE";
};

export const operationRegistryV1 = [
  {
    schema_version: 1,
    operation_id: LEGACY_RESEARCH_QUARANTINE_READ_OPERATION,
    owner_operation: "research_goal.submit_or_resolve.v1",
    owner_schema: "sourced-research-goal-v1",
    capability: "rd.research.legacy_quarantine.read",
    effect_set: [],
    dependency_operation_ids: [],
    owner_route: {
      method: "POST",
      path_template: "/v1/research-goals/{request_identity}/resolve",
      identity_fields: ["request_identity"],
      body_schema: "empty-object-v1",
    },
    timeout_class: { identity: "owner-read-8s", milliseconds: 8_000 },
    recovery_identity_fields: ["request_identity"],
    allowed_operational_reads: ["legacy_owner_receipt", "quarantine_state"],
    channels: ["DASHBOARD_SHADOW_READ"],
    deployment_state: "unavailable",
    compatibility_envelope_digest: null,
    compatibility_observed_at_epoch_ms: null,
    compatibility_valid_through_epoch_ms: null,
    deployment_unavailable_reason: "COMPATIBILITY_ENVELOPE_UNAVAILABLE",
  },
  {
    schema_version: 1,
    operation_id: RESEARCH_SHADOW_RESOLVE_OPERATION,
    owner_operation: "research_goal.readback.v2",
    owner_schema: "sourced-research-goal-v2",
    capability: "rd.research.resolve.read",
    effect_set: [],
    dependency_operation_ids: [],
    owner_route: {
      method: "GET",
      path_template: "/v2/research-goals/{request_identity}/readback",
      identity_fields: ["request_identity"],
      body_schema: null,
    },
    timeout_class: { identity: "owner-read-8s", milliseconds: 8_000 },
    recovery_identity_fields: ["request_identity"],
    allowed_operational_reads: ["owner_outcome", "trial_family_frontier"],
    channels: ["DASHBOARD_SHADOW_READ"],
    deployment_state: "unavailable",
    compatibility_envelope_digest: null,
    compatibility_observed_at_epoch_ms: null,
    compatibility_valid_through_epoch_ms: null,
    deployment_unavailable_reason: "COMPATIBILITY_ENVELOPE_UNAVAILABLE",
  },
  {
    schema_version: 1,
    operation_id: ARTIFACT_SHADOW_RESOLVE_OPERATION,
    owner_operation: "artifact_build.readback.v1",
    owner_schema: "rd-artifact-build-request-v1",
    capability: "rd.artifact.resolve.read",
    effect_set: [],
    dependency_operation_ids: [RESEARCH_SHADOW_RESOLVE_OPERATION],
    owner_route: {
      method: "GET",
      path_template: "/v1/artifact-builds/{build_request_identity}/attempts/{attempt_identity}/readback",
      identity_fields: ["build_request_identity", "attempt_identity"],
      body_schema: null,
    },
    timeout_class: { identity: "owner-read-8s", milliseconds: 8_000 },
    recovery_identity_fields: [
      "research_request_identity",
      "build_request_identity",
      "attempt_identity",
    ],
    allowed_operational_reads: [
      "owner_outcome",
      "artifact_review",
      "artifact_trial_family_binding",
      "provider_custody_state",
    ],
    channels: ["DASHBOARD_SHADOW_READ"],
    deployment_state: "unavailable",
    compatibility_envelope_digest: null,
    compatibility_observed_at_epoch_ms: null,
    compatibility_valid_through_epoch_ms: null,
    deployment_unavailable_reason: "COMPATIBILITY_ENVELOPE_UNAVAILABLE",
  },
  {
    schema_version: 1,
    operation_id: RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
    owner_operation: "rd.formation_catalog.read.v1",
    owner_schema: "rd-formation-catalog-v1",
    capability: "rd.formation.catalog.read",
    effect_set: [],
    dependency_operation_ids: [],
    owner_route: {
      method: "GET",
      path_template: "/v1/formation-catalog",
      identity_fields: [],
      body_schema: null,
    },
    timeout_class: { identity: "owner-read-8s", milliseconds: 8_000 },
    recovery_identity_fields: [],
    allowed_operational_reads: ["verified_formations", "verified_attempt_history"],
    channels: ["DASHBOARD_SHADOW_READ"],
    deployment_state: "unavailable",
    compatibility_envelope_digest: null,
    compatibility_observed_at_epoch_ms: null,
    compatibility_valid_through_epoch_ms: null,
    deployment_unavailable_reason: "COMPATIBILITY_ENVELOPE_UNAVAILABLE",
  },
  {
    schema_version: 1,
    operation_id: RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION,
    owner_operation: "rd.historical_custody_quarantine.read.v1",
    owner_schema: "rd-historical-custody-quarantine-v1",
    capability: "rd.historical.custody.quarantine.read",
    effect_set: [],
    dependency_operation_ids: [],
    owner_route: {
      method: "GET",
      path_template: "/v1/historical-custodies",
      identity_fields: [],
      body_schema: null,
    },
    timeout_class: { identity: "owner-read-8s", milliseconds: 8_000 },
    recovery_identity_fields: [],
    allowed_operational_reads: ["custody_candidate_identity", "custody_observed_time"],
    channels: ["DASHBOARD_SHADOW_READ"],
    deployment_state: "unavailable",
    compatibility_envelope_digest: null,
    compatibility_observed_at_epoch_ms: null,
    compatibility_valid_through_epoch_ms: null,
    deployment_unavailable_reason: "COMPATIBILITY_ENVELOPE_UNAVAILABLE",
  },
  {
    schema_version: 1,
    operation_id: RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
    owner_operation: "rd.iteration_timeline.read.v1",
    owner_schema: "rd-iteration-timeline-v1",
    capability: "rd.iteration.timeline.read",
    effect_set: [],
    dependency_operation_ids: [RD_FORMATION_CATALOG_SHADOW_READ_OPERATION],
    owner_route: {
      method: "GET",
      path_template: "/v1/trial-families/{trial_family_identity}/iterations",
      identity_fields: ["trial_family_identity"],
      body_schema: null,
    },
    timeout_class: { identity: "owner-read-8s", milliseconds: 8_000 },
    recovery_identity_fields: ["trial_family_identity"],
    allowed_operational_reads: ["iteration_decisions", "successor_readiness", "trial_family_frontier"],
    channels: ["DASHBOARD_SHADOW_READ"],
    deployment_state: "unavailable",
    compatibility_envelope_digest: null,
    compatibility_observed_at_epoch_ms: null,
    compatibility_valid_through_epoch_ms: null,
    deployment_unavailable_reason: "COMPATIBILITY_ENVELOPE_UNAVAILABLE",
  },
  {
    schema_version: 1,
    operation_id: EXPLORATORY_REPLAY_SHADOW_READ_OPERATION,
    owner_operation: "exploratory_replay.readback.v2",
    owner_schema: "backtest-replay-request-v2",
    capability: "rd.exploratory_replay.read",
    effect_set: [],
    dependency_operation_ids: [RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION],
    owner_route: {
      method: "GET",
      path_template: "/v2/exploratory-replay-requests/{request_identity}/readback?meaning_digest={meaning_digest}",
      identity_fields: ["request_identity", "meaning_digest"],
      body_schema: null,
    },
    timeout_class: { identity: "owner-read-8s", milliseconds: 8_000 },
    recovery_identity_fields: ["request_identity", "meaning_digest"],
    allowed_operational_reads: [
      "sealed_request",
      "canonical_request_bytes",
      "owner_receipt",
      "owner_cut",
    ],
    channels: ["DASHBOARD_SHADOW_READ"],
    deployment_state: "unavailable",
    compatibility_envelope_digest: null,
    compatibility_observed_at_epoch_ms: null,
    compatibility_valid_through_epoch_ms: null,
    deployment_unavailable_reason: "COMPATIBILITY_ENVELOPE_UNAVAILABLE",
  },
  {
    schema_version: 1,
    operation_id: DEVELOP_COMPOSER_SHADOW_READ_OPERATION,
    owner_operation: "develop_composer.readback.v2",
    owner_schema: "rd-develop-composer-operation-v2",
    capability: "rd.develop_composer.read",
    effect_set: [],
    dependency_operation_ids: [RESEARCH_SHADOW_RESOLVE_OPERATION],
    owner_route: {
      method: "GET",
      path_template: "/v2/develop-composer/runs/{request_identity}/readback",
      identity_fields: ["request_identity"],
      body_schema: null,
    },
    timeout_class: { identity: "owner-read-8s", milliseconds: 8_000 },
    recovery_identity_fields: ["request_identity"],
    allowed_operational_reads: ["disposition", "operation_receipt", "artifact_projection"],
    channels: ["DASHBOARD_SHADOW_READ"],
    deployment_state: "unavailable",
    compatibility_envelope_digest: null,
    compatibility_observed_at_epoch_ms: null,
    compatibility_valid_through_epoch_ms: null,
    deployment_unavailable_reason: "COMPATIBILITY_ENVELOPE_UNAVAILABLE",
  },
  {
    schema_version: 1,
    operation_id: SOURCE_INTAKE_SHADOW_READ_OPERATION,
    owner_operation: "source_intake.readback.v1",
    owner_schema: "rd-source-intake-terminal-v1",
    capability: "rd.source_intake.terminal.read",
    effect_set: [],
    dependency_operation_ids: [],
    owner_route: {
      method: "GET",
      path_template: "/v1/source-intakes/{request_identity}/readback",
      identity_fields: ["request_identity"],
      body_schema: null,
    },
    timeout_class: { identity: "owner-read-8s", milliseconds: 8_000 },
    recovery_identity_fields: ["request_identity"],
    allowed_operational_reads: [
      "owner_outcome",
      "source_terminal",
      "source_receipt",
      "source_provenance_locator",
    ],
    channels: ["DASHBOARD_SHADOW_READ"],
    deployment_state: "unavailable",
    compatibility_envelope_digest: null,
    compatibility_observed_at_epoch_ms: null,
    compatibility_valid_through_epoch_ms: null,
    deployment_unavailable_reason: "COMPATIBILITY_ENVELOPE_UNAVAILABLE",
  },
] as const satisfies readonly OperationDescriptorV1[];

export function operationByIdV1(operationId: RegisteredOperationId): OperationDescriptorV1 {
  const operation = operationRegistryV1.find((entry) => entry.operation_id === operationId);
  if (!operation) throw new Error("OPERATION_NOT_REGISTERED");
  return operation;
}

export function operationManifestV1(operationId: RegisteredOperationId) {
  const operation = operationByIdV1(operationId);
  return {
    schema_version: operation.schema_version,
    operation_id: operation.operation_id,
    owner_operation: operation.owner_operation,
    owner_schema: operation.owner_schema,
    capability: operation.capability,
    effect_set: operation.effect_set,
    dependency_operation_ids: operation.dependency_operation_ids,
    owner_route: operation.owner_route,
    timeout_class: operation.timeout_class,
    recovery_identity_fields: operation.recovery_identity_fields,
    allowed_operational_reads: operation.allowed_operational_reads,
    channels: operation.channels,
  };
}

export function operationRegistryEntryDigestV1(operationId: RegisteredOperationId): string {
  return registryEntryDigestV1(operationManifestV1(operationId));
}

export function operationDeploymentForIdV1(
  operationId: RegisteredOperationId,
  environment: Record<string, string | undefined> = process.env,
  nowEpochMs = Date.now(),
) {
  const operation = operationByIdV1(operationId);
  const deployment = operationDeploymentStateV1(
    operationManifestV1(operationId),
    environment,
    nowEpochMs,
  );
  if (deployment.deployment_state !== "available") return deployment;
  for (const dependencyOperationId of operation.dependency_operation_ids) {
    const dependency = operationDeploymentStateV1(
      operationManifestV1(dependencyOperationId),
      environment,
      nowEpochMs,
    );
    if (dependency.deployment_state !== "available") {
      return {
        deployment_state: "unavailable" as const,
        compatibility_envelope_digest: null,
        compatibility_observed_at_epoch_ms: null,
        compatibility_valid_through_epoch_ms: null,
        deployment_unavailable_reason: "DEPENDENCY_COMPATIBILITY_UNAVAILABLE" as const,
      };
    }
  }
  return deployment;
}

export function operationDispatchBindingForIdV1(
  operationId: RegisteredOperationId,
  environment: Record<string, string | undefined> = process.env,
  nowEpochMs = Date.now(),
): OperationDispatchBindingV1 | null {
  const envelopes = new Map<RegisteredOperationId, {
    operation_id: RegisteredOperationId;
    registry_entry_digest: string;
    compatibility_envelope_digest: string;
  }>();
  const visiting = new Set<RegisteredOperationId>();
  const collect = (currentOperationId: RegisteredOperationId): boolean => {
    if (envelopes.has(currentOperationId)) return true;
    if (visiting.has(currentOperationId)) return false;
    visiting.add(currentOperationId);
    const operation = operationByIdV1(currentOperationId);
    const deployment = operationDeploymentStateV1(
      operationManifestV1(currentOperationId),
      environment,
      nowEpochMs,
    );
    if (deployment.deployment_state !== "available"
      || !deployment.compatibility_envelope_digest
      || !operation.dependency_operation_ids.every(collect)) return false;
    visiting.delete(currentOperationId);
    envelopes.set(currentOperationId, {
      operation_id: currentOperationId,
      registry_entry_digest: operationRegistryEntryDigestV1(currentOperationId),
      compatibility_envelope_digest: deployment.compatibility_envelope_digest,
    });
    return true;
  };
  if (!collect(operationId)) return null;
  const envelopeSet = [...envelopes.values()].sort((left, right) => (
    Buffer.compare(Buffer.from(left.operation_id), Buffer.from(right.operation_id))
  ));
  return {
    registry_entry_digest: operationRegistryEntryDigestV1(operationId),
    compatibility_envelope_set_digest: `sha256:${createHash("sha256")
      .update(JSON.stringify(envelopeSet)).digest("hex")}`,
  };
}

function exactIdentityFields(actual: Record<string, string>, expected: readonly string[]): boolean {
  const keys = Object.keys(actual).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

export function ownerOperationUrlV1({
  operationId,
  baseUrl,
  identities,
}: {
  operationId: RegisteredOperationId;
  baseUrl: string;
  identities: Record<string, string>;
}): URL | null {
  const operation = operationByIdV1(operationId);
  if (!exactIdentityFields(identities, operation.owner_route.identity_fields)) return null;
  try {
    const base = new URL(baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password
      || base.search || base.hash) return null;
    let path = operation.owner_route.path_template;
    for (const field of operation.owner_route.identity_fields) {
      const value = identities[field];
      if (!value) return null;
      path = path.replace(`{${field}}`, encodeURIComponent(value));
    }
    if (path.includes("{")) return null;
    return new URL(path, base);
  } catch {
    return null;
  }
}

export async function operationRegistryEnvelopeV1(
  environment: Record<string, string | undefined> = process.env,
  nowEpochMs = Date.now(),
) {
  const operations = await Promise.all(operationRegistryV1.map(async (operation) => {
    const manifest = operationManifestV1(operation.operation_id);
    return {
      ...operation,
      ...operationDeploymentForIdV1(operation.operation_id, environment, nowEpochMs),
      registry_entry_digest: operationRegistryEntryDigestV1(operation.operation_id),
    };
  }));
  return {
    schema_version: 1 as const,
    operation: "dashboard.operation_registry.read.v1" as const,
    availability: "available" as const,
    observed_at: new Date().toISOString(),
    operations,
  };
}
import {
  operationDeploymentStateV1,
  registryEntryDigestV1,
} from "./compatibility-envelope.ts";
import { createHash } from "node:crypto";
