import { createHash } from "node:crypto";

import {
  operationDeploymentStateV1,
  registryEntryDigestV1,
} from "./compatibility-envelope.ts";
import {
  RESEARCH_OWNER_OPERATION_V2,
  RESEARCH_OWNER_OPERATION_V3,
  type ResearchOwnerOperationV1,
} from "../../rd-owner-client/consumer_projection_v1.ts";
import {
  PRODUCT_EDGE_RESEARCH_GOAL_ROUTING_KEY_V3,
  PRODUCT_EDGE_SOURCE_INTAKE_ROUTING_KEY_V1,
  resolveProductEdgeRoutingV1,
  type ProductEdgeExecutionRoutingV1,
  type ProductEdgeRoutingLookupKeyV1,
  type ProductEdgeRoutingObservationV1,
} from "./product-edge-routing-client.ts";
import {
  RESEARCH_GOAL_EFFECT_SET_V2,
  researchGoalOperationForV1,
  researchGoalOperationV2,
  researchGoalOperationV3,
} from "./research-goal-operation.ts";
import {
  SOURCE_INTAKE_EFFECT_SET_V1,
  sourceIntakeOperationV1,
} from "./source-intake-operation.ts";

export const SOURCE_RESEARCH_EXECUTE_OPERATION =
  "source_intake.research.submit_or_resolve.v1" as const;

export const sourceResearchRunOperationV1 = {
  schema_version: 1,
  operation_id: SOURCE_RESEARCH_EXECUTE_OPERATION,
  // A new run submits Research V3. V2 stays listed because a run recorded before V3 is still
  // resolved through it; no new run is admitted under V2.
  owner_operations: [
    sourceIntakeOperationV1.owner_operation,
    researchGoalOperationV3.owner_operation,
    researchGoalOperationV2.owner_operation,
  ],
  capability: "rd.source_intake_research.execute",
  effect_set: [...SOURCE_INTAKE_EFFECT_SET_V1, ...RESEARCH_GOAL_EFFECT_SET_V2],
  execution_boundary: "DISPOSABLE_LOCAL",
  recovery_identity_fields: [
    "source_request_identity",
    "research_request_identity",
  ],
  routing_dependency_keys: [
    PRODUCT_EDGE_SOURCE_INTAKE_ROUTING_KEY_V1,
    PRODUCT_EDGE_RESEARCH_GOAL_ROUTING_KEY_V3,
  ],
  orchestration_contract: {
    identity: "dashboard-source-research-orchestrator-v1",
    fresh_run_order: ["SOURCE_RUN", "RESEARCH_RUN"],
    response_loss_recovery_order: ["SOURCE_RESOLVE", "RESEARCH_RESOLVE"],
    duplicate_effect_replay: "FORBIDDEN",
  },
  channels: ["DASHBOARD_DISPOSABLE_EXECUTION"],
} as const;

export type SourceResearchRecoveryIdentityV1 = {
  source_request_identity: string;
  research_request_identity: string;
};

export type SourceResearchRoutingAdmissionV1 = {
  source: ProductEdgeExecutionRoutingV1;
  research: ProductEdgeExecutionRoutingV1;
};

export type SourceResearchExecutionAdmissionV1 =
  | {
      availability: "available";
      unavailable_reason: null;
      source_registry_entry_digest: string;
      source_compatibility_envelope_digest: string | null;
      research_registry_entry_digest: string;
      research_compatibility_envelope_digest: string | null;
      routing: SourceResearchRoutingAdmissionV1;
    }
  | {
      availability: "unavailable";
      unavailable_reason: "COMPATIBILITY_UNAVAILABLE" | "DASHBOARD_ROUTING_UNAVAILABLE";
      source_registry_entry_digest: null;
      source_compatibility_envelope_digest: null;
      research_registry_entry_digest: null;
      research_compatibility_envelope_digest: null;
      routing: SourceResearchRoutingAdmissionV1;
    };

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export function sourceResearchOperationManifestDigestV1(): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(sourceResearchRunOperationV1))
    .digest("hex")}`;
}

export function canonicalSourceResearchRecoveryIdentityV1(
  value: Record<string, string>,
): SourceResearchRecoveryIdentityV1 | null {
  const expected = sourceResearchRunOperationV1.recovery_identity_fields;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || !keys.every((key, index) => key === wanted[index])
    || !expected.every((field) => IDENTITY.test(value[field]))) return null;
  return {
    source_request_identity: value.source_request_identity,
    research_request_identity: value.research_request_identity,
  };
}

export function sourceResearchRecoveryIdentityDigestV1(
  value: Record<string, string>,
): string | null {
  const recoveryIdentity = canonicalSourceResearchRecoveryIdentityV1(value);
  if (!recoveryIdentity) return null;
  return `sha256:${createHash("sha256").update(JSON.stringify({
    operation_id: SOURCE_RESEARCH_EXECUTE_OPERATION,
    recovery_identity: recoveryIdentity,
  })).digest("hex")}`;
}

export function unavailableSourceResearchRoutingAdmissionV1(): SourceResearchRoutingAdmissionV1 {
  const unavailable = {
    state: "UNAVAILABLE",
    dispatcher: "NONE",
    binding_identity: null,
    binding_digest: null,
    generation: null,
  } as const;
  return { source: unavailable, research: unavailable };
}

export function validSourceResearchRoutingAdmissionV1(
  action: "RUN" | "RESOLVE",
  routing: SourceResearchRoutingAdmissionV1,
): boolean {
  const observations = [routing.source, routing.research];
  if (action === "RUN") {
    return observations.every((entry) => entry.state === "ACTIVE"
      && entry.dispatcher === "TRADE_DASHBOARD"
      && IDENTITY.test(entry.binding_identity)
      && /^sha256:[0-9a-f]{64}$/.test(entry.binding_digest)
      && Number.isSafeInteger(entry.generation) && entry.generation > 0);
  }
  return observations.every((entry) => entry.state === "UNAVAILABLE"
    && entry.dispatcher === "NONE");
}

// The Research operation an admission's registry digest names, or null for any other digest.
export function researchOperationOfAdmissionV1(
  admission: SourceResearchExecutionAdmissionV1,
): ResearchOwnerOperationV1 | null {
  if (admission.research_registry_entry_digest === registryEntryDigestV1(researchGoalOperationV3)) {
    return RESEARCH_OWNER_OPERATION_V3;
  }
  if (admission.research_registry_entry_digest === registryEntryDigestV1(researchGoalOperationV2)) {
    return RESEARCH_OWNER_OPERATION_V2;
  }
  return null;
}

export function validSourceResearchExecutionAdmissionV1(
  action: "RUN" | "RESOLVE",
  admission: SourceResearchExecutionAdmissionV1,
): admission is Extract<SourceResearchExecutionAdmissionV1, { availability: "available" }> {
  if (admission.availability !== "available"
    || admission.source_registry_entry_digest !== registryEntryDigestV1(sourceIntakeOperationV1)
    || researchOperationOfAdmissionV1(admission) === null
    || !validSourceResearchRoutingAdmissionV1(action, admission.routing)) return false;
  return action === "RUN"
    ? DIGEST.test(admission.source_compatibility_envelope_digest ?? "")
      && DIGEST.test(admission.research_compatibility_envelope_digest ?? "")
    : admission.source_compatibility_envelope_digest === null
      && admission.research_compatibility_envelope_digest === null;
}

// Admits a run of the Research operation named: a new run is admitted only as V3; a resolve
// carries the operation the run it resolves recorded.
export async function admitSourceResearchExecutionV1({
  action,
  researchOperation,
  environment = process.env,
  nowEpochMs = Date.now(),
  routingResolver = (key) => resolveProductEdgeRoutingV1(key, { environment }),
}: {
  action: "RUN" | "RESOLVE";
  researchOperation: ResearchOwnerOperationV1;
  environment?: Record<string, string | undefined>;
  nowEpochMs?: number;
  routingResolver?: (
    key: ProductEdgeRoutingLookupKeyV1,
  ) => Promise<ProductEdgeRoutingObservationV1>;
}): Promise<SourceResearchExecutionAdmissionV1> {
  const unavailableRouting = unavailableSourceResearchRoutingAdmissionV1();
  const researchDescriptor = researchGoalOperationForV1(researchOperation);
  if (!researchDescriptor || (action === "RUN" && researchOperation !== RESEARCH_OWNER_OPERATION_V3)) {
    return {
      availability: "unavailable",
      unavailable_reason: "COMPATIBILITY_UNAVAILABLE",
      source_registry_entry_digest: null,
      source_compatibility_envelope_digest: null,
      research_registry_entry_digest: null,
      research_compatibility_envelope_digest: null,
      routing: unavailableRouting,
    };
  }
  const sourceRegistryDigest = registryEntryDigestV1(sourceIntakeOperationV1);
  const researchRegistryDigest = registryEntryDigestV1(researchDescriptor);
  if (action === "RESOLVE") {
    return {
      availability: "available",
      unavailable_reason: null,
      source_registry_entry_digest: sourceRegistryDigest,
      source_compatibility_envelope_digest: null,
      research_registry_entry_digest: researchRegistryDigest,
      research_compatibility_envelope_digest: null,
      routing: unavailableRouting,
    };
  }
  const sourceDeployment = operationDeploymentStateV1(
    sourceIntakeOperationV1,
    environment,
    nowEpochMs,
  );
  const researchDeployment = operationDeploymentStateV1(
    researchDescriptor,
    environment,
    nowEpochMs,
  );
  if (sourceDeployment.deployment_state !== "available"
    || researchDeployment.deployment_state !== "available") {
    return {
      availability: "unavailable",
      unavailable_reason: "COMPATIBILITY_UNAVAILABLE",
      source_registry_entry_digest: null,
      source_compatibility_envelope_digest: null,
      research_registry_entry_digest: null,
      research_compatibility_envelope_digest: null,
      routing: unavailableRouting,
    };
  }
  let routing: SourceResearchRoutingAdmissionV1;
  try {
    const [source, research] = await Promise.all([
      routingResolver(PRODUCT_EDGE_SOURCE_INTAKE_ROUTING_KEY_V1),
      routingResolver(PRODUCT_EDGE_RESEARCH_GOAL_ROUTING_KEY_V3),
    ]);
    routing = { source, research };
  } catch {
    routing = unavailableRouting;
  }
  if (!validSourceResearchRoutingAdmissionV1("RUN", routing)) {
    return {
      availability: "unavailable",
      unavailable_reason: "DASHBOARD_ROUTING_UNAVAILABLE",
      source_registry_entry_digest: null,
      source_compatibility_envelope_digest: null,
      research_registry_entry_digest: null,
      research_compatibility_envelope_digest: null,
      routing,
    };
  }
  return {
    availability: "available",
    unavailable_reason: null,
    source_registry_entry_digest: sourceRegistryDigest,
    source_compatibility_envelope_digest: sourceDeployment.compatibility_envelope_digest,
    research_registry_entry_digest: researchRegistryDigest,
    research_compatibility_envelope_digest: researchDeployment.compatibility_envelope_digest,
    routing,
  };
}
