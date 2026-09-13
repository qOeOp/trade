import { createHash } from "node:crypto";

import { operationDeploymentStateV1, registryEntryDigestV1 } from "./compatibility-envelope.ts";
import { validDevelopComposerIdentityV2 } from "./develop-composer-action-contract.ts";
import { DEVELOP_COMPOSER_SHADOW_READ_OPERATION } from "./operation-registry.ts";
import {
  PRODUCT_EDGE_DEVELOP_COMPOSER_ROUTING_KEY_V2,
  resolveProductEdgeRoutingV1,
  type ProductEdgeExecutionRoutingV1,
  type ProductEdgeRoutingObservationV1,
} from "./product-edge-routing-client.ts";

export const DEVELOP_COMPOSER_EXECUTE_OPERATION = "develop_composer.submit_or_resolve.v2" as const;

export const developComposerOperationV2 = {
  schema_version: 1,
  operation_id: DEVELOP_COMPOSER_EXECUTE_OPERATION,
  owner_operation: DEVELOP_COMPOSER_EXECUTE_OPERATION,
  owner_schema: "rd-develop-composer-operation-v2",
  capability: "rd.develop_composer.execute",
  effect_set: ["R_AND_D_DEVELOP_COMPOSER_MUTATION_V2"],
  dependency_operation_ids: [DEVELOP_COMPOSER_SHADOW_READ_OPERATION],
  orchestration_contract: {
    identity: "dashboard-develop-composer-orchestrator-v2",
    fresh_run_order: ["PROJECT", "RESOLVE", "SUBMIT_IF_ABSENT", "RESOLVE"],
    response_loss_recovery_order: ["PROJECT", "RESOLVE"],
    duplicate_effect_replay: "FORBIDDEN",
  },
  timeout_class: { identity: "develop-composer-120s", milliseconds: 120_000 },
  recovery_identity_fields: ["request_identity", "projection_digest"],
  channels: ["DASHBOARD_DISPOSABLE_EXECUTION"],
} as const;

export type DevelopComposerRecoveryIdentityV2 = {
  request_identity: string;
  projection_digest: string;
};

export type DevelopComposerExecutionAdmissionV2 =
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

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ROUTING_IDENTITY = /^product-edge-operation-routing-binding-v1-[0-9a-f]{64}$/;
const unavailableRouting: ProductEdgeRoutingObservationV1 = {
  state: "UNAVAILABLE", dispatcher: "NONE", binding_identity: null,
  binding_digest: null, generation: null, history_head_identity: null,
};

export function developComposerRegistryEntryDigestV2(): string {
  return registryEntryDigestV1(developComposerOperationV2);
}

export function canonicalDevelopComposerRecoveryIdentityV2(
  value: Record<string, string>,
): DevelopComposerRecoveryIdentityV2 | null {
  if (Object.keys(value).sort().join(",") !== "projection_digest,request_identity"
    || !validDevelopComposerIdentityV2(value.request_identity)
    || !DIGEST.test(value.projection_digest)) return null;
  return { request_identity: value.request_identity, projection_digest: value.projection_digest };
}

export function developComposerRecoveryIdentityDigestV2(
  value: Record<string, string>,
): string | null {
  const canonical = canonicalDevelopComposerRecoveryIdentityV2(value);
  return canonical
    ? `sha256:${createHash("sha256").update(JSON.stringify({
      operation_id: DEVELOP_COMPOSER_EXECUTE_OPERATION,
      recovery_identity: canonical,
    })).digest("hex")}`
    : null;
}

export function validDevelopComposerExecutionAdmissionV2(
  value: DevelopComposerExecutionAdmissionV2,
): value is Extract<DevelopComposerExecutionAdmissionV2, { availability: "available" }> {
  return value.availability === "available"
    && value.registry_entry_digest === developComposerRegistryEntryDigestV2()
    && DIGEST.test(value.compatibility_envelope_digest)
    && value.routing.state === "ACTIVE" && value.routing.dispatcher === "TRADE_DASHBOARD"
    && ROUTING_IDENTITY.test(value.routing.binding_identity)
    && DIGEST.test(value.routing.binding_digest)
    && Number.isSafeInteger(value.routing.generation) && value.routing.generation > 0;
}

export async function admitDevelopComposerExecutionV2({
  environment = process.env,
  nowEpochMs = Date.now(),
  routingResolver = (key) => resolveProductEdgeRoutingV1(key, { environment }),
}: {
  environment?: Record<string, string | undefined>;
  nowEpochMs?: number;
  routingResolver?: (
    key: typeof PRODUCT_EDGE_DEVELOP_COMPOSER_ROUTING_KEY_V2,
  ) => Promise<ProductEdgeRoutingObservationV1>;
}): Promise<DevelopComposerExecutionAdmissionV2> {
  const deployment = operationDeploymentStateV1(developComposerOperationV2, environment, nowEpochMs);
  if (deployment.deployment_state !== "available" || !deployment.compatibility_envelope_digest) {
    return { availability: "unavailable", unavailable_reason: "COMPATIBILITY_UNAVAILABLE",
      registry_entry_digest: null, compatibility_envelope_digest: null, routing: unavailableRouting };
  }
  let routing: ProductEdgeRoutingObservationV1;
  try {
    routing = await routingResolver(PRODUCT_EDGE_DEVELOP_COMPOSER_ROUTING_KEY_V2);
  } catch {
    routing = unavailableRouting;
  }
  if (routing.state !== "ACTIVE" || routing.dispatcher !== "TRADE_DASHBOARD") {
    return { availability: "unavailable", unavailable_reason: "DASHBOARD_ROUTING_UNAVAILABLE",
      registry_entry_digest: null, compatibility_envelope_digest: null, routing };
  }
  return { availability: "available", unavailable_reason: null,
    registry_entry_digest: developComposerRegistryEntryDigestV2(),
    compatibility_envelope_digest: deployment.compatibility_envelope_digest, routing };
}
