import { createHash } from "node:crypto";

import {
  operationDeploymentStateV1,
  registryEntryDigestV1,
} from "./compatibility-envelope.ts";
import {
  operationDeploymentForIdV1,
  RESEARCH_SHADOW_RESOLVE_OPERATION,
} from "./operation-registry.ts";
import {
  PRODUCT_EDGE_ARTIFACT_BUILD_ROUTING_KEY_V1,
  resolveProductEdgeRoutingV1,
  type ProductEdgeRoutingObservationV1,
} from "./product-edge-routing-client.ts";

export const ARTIFACT_FORMATION_EXECUTE_OPERATION =
  "artifact_build.formation_execute.v1" as const;

export const ARTIFACT_FORMATION_EFFECT_SET_V1 = [
  "R_AND_D_ARTIFACT_BUILD_MUTATION_V1",
  "R_AND_D_PROVIDER_INVOCATION_V1",
] as const;

export const artifactFormationOperationV1 = {
  schema_version: 1,
  operation_id: ARTIFACT_FORMATION_EXECUTE_OPERATION,
  owner_operation: "artifact_build.submit_or_resolve.v1",
  owner_schema: "rd-artifact-build-request-v1",
  capability: "rd.artifact.formation.execute",
  effect_set: ARTIFACT_FORMATION_EFFECT_SET_V1,
  dependency_operation_ids: [RESEARCH_SHADOW_RESOLVE_OPERATION],
  orchestration_contract: {
    identity: "dashboard-artifact-formation-orchestrator-v1",
    owner_routes: [
      "POST /v2/research-goals/{research_request_identity}/resolve",
      "POST /v1/artifact-builds/{build_request_identity}/attempts/{attempt_identity}/resolve",
      "POST /v1/artifact-builds/prepare",
      "POST /v1/artifact-builds/claim-provider-invocation",
      "POST /v1/artifact-builds/start-provider-invocation",
      "POST /v1/artifact-builds/candidate",
      "POST /v1/artifact-builds/fail",
    ],
    provider_invocation_limit: 1,
    provider_invocation_after_owner_state: "INVOCATION_STARTED",
    started_without_terminal_recovery: "MANUAL_RECONCILIATION_ONLY",
  },
  timeout_class: {
    identity: "artifact-formation-180s",
    milliseconds: 180_000,
  },
  recovery_identity_fields: [
    "research_request_identity",
    "build_request_identity",
    "attempt_identity",
  ],
  allowed_operational_reads: [
    "owner_outcome",
    "provider_custody_state",
    "artifact_review",
    "artifact_trial_family_binding",
  ],
  channels: ["DASHBOARD_DISPOSABLE_EXECUTION"],
} as const;

export type ArtifactFormationRecoveryIdentityV1 = {
  research_request_identity: string;
  build_request_identity: string;
  attempt_identity: string;
};

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;

export function artifactFormationOperationManifestV1() {
  return artifactFormationOperationV1;
}

export function artifactFormationRegistryEntryDigestV1(): string {
  return registryEntryDigestV1(artifactFormationOperationManifestV1());
}

export function canonicalArtifactFormationRecoveryIdentityV1(
  value: Record<string, string>,
): ArtifactFormationRecoveryIdentityV1 | null {
  const expected = artifactFormationOperationV1.recovery_identity_fields;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || !keys.every((key, index) => key === wanted[index])) {
    return null;
  }
  if (!expected.every((field) => IDENTITY.test(value[field]))) return null;
  return {
    research_request_identity: value.research_request_identity,
    build_request_identity: value.build_request_identity,
    attempt_identity: value.attempt_identity,
  };
}

export function artifactFormationRecoveryIdentityDigestV1(
  value: Record<string, string>,
): string | null {
  const recoveryIdentity = canonicalArtifactFormationRecoveryIdentityV1(value);
  if (!recoveryIdentity) return null;
  return `sha256:${createHash("sha256").update(JSON.stringify({
    operation_id: ARTIFACT_FORMATION_EXECUTE_OPERATION,
    recovery_identity: recoveryIdentity,
  })).digest("hex")}`;
}

export function artifactFormationDeploymentStateV1(
  environment: Record<string, string | undefined> = process.env,
  nowEpochMs = Date.now(),
) {
  const own = operationDeploymentStateV1(
    artifactFormationOperationManifestV1(),
    environment,
    nowEpochMs,
  );
  if (own.deployment_state !== "available") return own;
  const research = operationDeploymentForIdV1(
    RESEARCH_SHADOW_RESOLVE_OPERATION,
    environment,
    nowEpochMs,
  );
  if (research.deployment_state !== "available") {
    return {
      deployment_state: "unavailable" as const,
      compatibility_envelope_digest: null,
      deployment_unavailable_reason: "DEPENDENCY_COMPATIBILITY_UNAVAILABLE" as const,
    };
  }
  return own;
}

export type ArtifactFormationExecutionAdmissionV1 =
  | {
      availability: "available";
      unavailable_reason: null;
      registry_entry_digest: string;
      compatibility_envelope_digest: string;
      routing: ProductEdgeRoutingObservationV1;
    }
  | {
      availability: "unavailable";
      unavailable_reason:
        | "COMPATIBILITY_UNAVAILABLE"
        | "DASHBOARD_ROUTING_UNAVAILABLE";
      registry_entry_digest: null;
      compatibility_envelope_digest: null;
      routing: ProductEdgeRoutingObservationV1;
    };

const unavailableRouting: ProductEdgeRoutingObservationV1 = {
  state: "UNAVAILABLE",
  dispatcher: "NONE",
  binding_identity: null,
  binding_digest: null,
  generation: null,
  history_head_identity: null,
};

export async function admitArtifactFormationExecutionV1({
  action,
  environment = process.env,
  nowEpochMs = Date.now(),
  routingResolver = (key) => resolveProductEdgeRoutingV1(key, { environment }),
}: {
  action: "RUN" | "RESOLVE";
  environment?: Record<string, string | undefined>;
  nowEpochMs?: number;
  routingResolver?: (
    key: typeof PRODUCT_EDGE_ARTIFACT_BUILD_ROUTING_KEY_V1,
  ) => Promise<ProductEdgeRoutingObservationV1>;
}): Promise<ArtifactFormationExecutionAdmissionV1> {
  const deployment = artifactFormationDeploymentStateV1(environment, nowEpochMs);
  if (deployment.deployment_state !== "available"
    || !deployment.compatibility_envelope_digest) {
    return {
      availability: "unavailable",
      unavailable_reason: "COMPATIBILITY_UNAVAILABLE",
      registry_entry_digest: null,
      compatibility_envelope_digest: null,
      routing: unavailableRouting,
    };
  }
  const routing = action === "RUN"
    ? await routingResolver(PRODUCT_EDGE_ARTIFACT_BUILD_ROUTING_KEY_V1)
    : unavailableRouting;
  if (action === "RUN"
    && (routing.state !== "ACTIVE" || routing.dispatcher !== "TRADE_DASHBOARD")) {
    return {
      availability: "unavailable",
      unavailable_reason: "DASHBOARD_ROUTING_UNAVAILABLE",
      registry_entry_digest: null,
      compatibility_envelope_digest: null,
      routing,
    };
  }
  return {
    availability: "available",
    unavailable_reason: null,
    registry_entry_digest: artifactFormationRegistryEntryDigestV1(),
    compatibility_envelope_digest: deployment.compatibility_envelope_digest,
    routing,
  };
}
