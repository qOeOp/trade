import { createHash } from "node:crypto";

import {
  PRODUCT_EDGE_RESEARCH_GOAL_ROUTING_KEY_V2,
  PRODUCT_EDGE_SOURCE_INTAKE_ROUTING_KEY_V1,
  type ProductEdgeExecutionRoutingV1,
} from "./product-edge-routing-client.ts";
import { RESEARCH_GOAL_EFFECT_SET_V2 } from "./research-goal-operation.ts";
import { SOURCE_INTAKE_EFFECT_SET_V1 } from "./source-intake-operation.ts";

export const SOURCE_RESEARCH_EXECUTE_OPERATION =
  "source_intake.research.submit_or_resolve.v1" as const;

export const sourceResearchRunOperationV1 = {
  schema_version: 1,
  operation_id: SOURCE_RESEARCH_EXECUTE_OPERATION,
  owner_operations: [
    "source_intake.openalex_work_by_doi.submit_or_resolve.v1",
    "research_goal.submit_or_resolve.v2",
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
    PRODUCT_EDGE_RESEARCH_GOAL_ROUTING_KEY_V2,
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

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;

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
