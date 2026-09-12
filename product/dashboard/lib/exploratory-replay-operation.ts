import { createHash } from "node:crypto";

import {
  operationDeploymentStateV1,
  registryEntryDigestV1,
} from "./compatibility-envelope.ts";
import { validExploratoryReplayOpaqueIdentityV2 } from "./exploratory-replay-identity.ts";
import { ARTIFACT_SHADOW_RESOLVE_OPERATION } from "./operation-registry.ts";
import {
  PRODUCT_EDGE_EXPLORATORY_REPLAY_ROUTING_KEY_V2,
  resolveProductEdgeRoutingV1,
  type ProductEdgeExecutionRoutingV1,
  type ProductEdgeRoutingObservationV1,
} from "./product-edge-routing-client.ts";

export const EXPLORATORY_REPLAY_EXECUTE_OPERATION =
  "exploratory_replay.submit_or_resolve.v2" as const;

export const exploratoryReplayOperationV2 = {
  schema_version: 1,
  operation_id: EXPLORATORY_REPLAY_EXECUTE_OPERATION,
  owner_operation: EXPLORATORY_REPLAY_EXECUTE_OPERATION,
  owner_schema: "rd-exploratory-replay-request-v2",
  capability: "rd.exploratory_replay.execute",
  effect_set: ["R_AND_D_EXPLORATORY_REPLAY_REQUEST_MUTATION_V2"],
  dependency_operation_ids: [ARTIFACT_SHADOW_RESOLVE_OPERATION],
  orchestration_contract: {
    identity: "dashboard-exploratory-replay-orchestrator-v2",
    fresh_run_order: ["IDENTIFY", "RESOLVE", "SUBMIT_IF_ABSENT", "RESOLVE"],
    response_loss_recovery_order: ["IDENTIFY", "RESOLVE"],
    duplicate_effect_replay: "FORBIDDEN",
  },
  timeout_class: {
    identity: "exploratory-replay-120s",
    milliseconds: 120_000,
  },
  recovery_identity_fields: ["request_identity", "meaning_digest"],
  channels: ["DASHBOARD_DISPOSABLE_EXECUTION"],
} as const;

export type ExploratoryReplayRecoveryIdentityV2 = {
  request_identity: string;
  meaning_digest: string;
};

export type ExploratoryReplayExecutionAdmissionV2 =
  | {
      availability: "available";
      unavailable_reason: null;
      registry_entry_digest: string;
      compatibility_envelope_digest: string;
      routing: ProductEdgeExecutionRoutingV1;
    }
  | {
      availability: "unavailable";
      unavailable_reason: "COMPATIBILITY_UNAVAILABLE" | "DASHBOARD_ROUTING_UNAVAILABLE";
      registry_entry_digest: null;
      compatibility_envelope_digest: null;
      routing: ProductEdgeExecutionRoutingV1;
    };

const DIGEST = /^(?:sha256|blake3):[0-9a-f]{64}$/;
const ROUTING_BINDING_IDENTITY = /^product-edge-operation-routing-binding-v1-[0-9a-f]{64}$/;
const unavailableRouting: ProductEdgeRoutingObservationV1 = {
  state: "UNAVAILABLE",
  dispatcher: "NONE",
  binding_identity: null,
  binding_digest: null,
  generation: null,
  history_head_identity: null,
};

export function exploratoryReplayRegistryEntryDigestV2(): string {
  return registryEntryDigestV1(exploratoryReplayOperationV2);
}

export function canonicalExploratoryReplayRecoveryIdentityV2(
  value: Record<string, string>,
): ExploratoryReplayRecoveryIdentityV2 | null {
  if (Object.keys(value).sort().join(",") !== "meaning_digest,request_identity"
    || !validExploratoryReplayOpaqueIdentityV2(value.request_identity)
    || !DIGEST.test(value.meaning_digest)) return null;
  return {
    request_identity: value.request_identity,
    meaning_digest: value.meaning_digest,
  };
}

export function exploratoryReplayRecoveryIdentityDigestV2(
  value: Record<string, string>,
): string | null {
  const canonical = canonicalExploratoryReplayRecoveryIdentityV2(value);
  if (!canonical) return null;
  return `sha256:${createHash("sha256").update(JSON.stringify({
    operation_id: EXPLORATORY_REPLAY_EXECUTE_OPERATION,
    recovery_identity: canonical,
  })).digest("hex")}`;
}

export function validExploratoryReplayExecutionAdmissionV2(
  admission: ExploratoryReplayExecutionAdmissionV2,
): admission is Extract<ExploratoryReplayExecutionAdmissionV2, { availability: "available" }> {
  return admission.availability === "available"
    && admission.registry_entry_digest === exploratoryReplayRegistryEntryDigestV2()
    && DIGEST.test(admission.compatibility_envelope_digest)
    && admission.routing.state === "ACTIVE"
    && admission.routing.dispatcher === "TRADE_DASHBOARD"
    && ROUTING_BINDING_IDENTITY.test(admission.routing.binding_identity)
    && /^sha256:[0-9a-f]{64}$/.test(admission.routing.binding_digest)
    && Number.isSafeInteger(admission.routing.generation)
    && admission.routing.generation > 0;
}

export async function admitExploratoryReplayExecutionV2({
  environment = process.env,
  nowEpochMs = Date.now(),
  routingResolver = (key) => resolveProductEdgeRoutingV1(key, { environment }),
}: {
  environment?: Record<string, string | undefined>;
  nowEpochMs?: number;
  routingResolver?: (
    key: typeof PRODUCT_EDGE_EXPLORATORY_REPLAY_ROUTING_KEY_V2,
  ) => Promise<ProductEdgeRoutingObservationV1>;
}): Promise<ExploratoryReplayExecutionAdmissionV2> {
  const deployment = operationDeploymentStateV1(
    exploratoryReplayOperationV2,
    environment,
    nowEpochMs,
  );
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
  let routing: ProductEdgeRoutingObservationV1;
  try {
    routing = await routingResolver(PRODUCT_EDGE_EXPLORATORY_REPLAY_ROUTING_KEY_V2);
  } catch {
    routing = unavailableRouting;
  }
  if (routing.state !== "ACTIVE" || routing.dispatcher !== "TRADE_DASHBOARD") {
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
    registry_entry_digest: exploratoryReplayRegistryEntryDigestV2(),
    compatibility_envelope_digest: deployment.compatibility_envelope_digest,
    routing,
  };
}
