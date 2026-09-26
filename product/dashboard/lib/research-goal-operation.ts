import {
  projectResearchOwnerResultWithEvidenceV1,
  RESEARCH_OWNER_OPERATION_V2,
  RESEARCH_OWNER_OPERATION_V3,
  type ResearchOwnerOperationV1,
} from "../../rd-owner-client/consumer_projection_v1.ts";
import {
  PRODUCT_EDGE_RESEARCH_GOAL_ROUTING_KEY_V2,
  PRODUCT_EDGE_RESEARCH_GOAL_ROUTING_KEY_V3,
  type ProductEdgeExecutionRoutingV1,
} from "./product-edge-routing-client.ts";
import {
  rdOwnerJsonOutcomeV1,
  type RdOwnerHttpTransportV1,
} from "./rd-owner-http.ts";
import {
  researchGoalInputIsV3,
  validResearchGoalExecutionInputV2,
  validResearchGoalExecutionInputV3,
  type DashboardSourcedResearchGoalV2,
  type DashboardTrialFamilyProposalV1,
  type ResearchGoalExecutionInputV2,
  type ResearchGoalExecutionInputV3,
} from "./source-research-input-contract.ts";

export { validResearchGoalExecutionInputV2 } from "./source-research-input-contract.ts";
export type {
  DashboardSourcedResearchGoalV2,
  DashboardTrialFamilyProposalV1,
  ResearchGoalExecutionInputV2,
  ResearchGoalExecutionInputV3,
} from "./source-research-input-contract.ts";

export const RESEARCH_GOAL_EXECUTE_OPERATION = "research_goal.execute.v2" as const;
export const RESEARCH_GOAL_EXECUTE_OPERATION_V3 = "research_goal.execute.v3" as const;
export const RESEARCH_GOAL_EFFECT_SET_V2 = ["R_AND_D_RESEARCH_MUTATION_V1"] as const;

export type SourceIntakeAncestryV1 = {
  request_identity: string;
  attempt_identity: string;
  terminal_receipt_identity: string;
};

export const researchGoalOperationV2 = {
  schema_version: 1,
  operation_id: RESEARCH_GOAL_EXECUTE_OPERATION,
  owner_operation: RESEARCH_OWNER_OPERATION_V2,
  owner_schema: "sourced-research-goal-v2",
  capability: "rd.research_goal.execute",
  effect_set: RESEARCH_GOAL_EFFECT_SET_V2,
  dependency_operation_ids: [],
  execution_boundary: "DISPOSABLE_LOCAL",
  recovery_identity_fields: ["request_identity"],
  routing_dependency_keys: [PRODUCT_EDGE_RESEARCH_GOAL_ROUTING_KEY_V2],
  orchestration_contract: {
    identity: "dashboard-sourced-research-goal-orchestrator-v2",
    run_owner_route: "POST /v2/source-intake-research",
    resolve_owner_route: "POST /v2/research-goals/{request_identity}/resolve",
    source_ancestry_required: true,
    resolve_identity_mode: "EXACT",
  },
  channels: ["DASHBOARD_DISPOSABLE_EXECUTION"],
} as const;

// The Research request with the instrument it studies (dashboard.md, the Instrument field). New
// runs submit only this; the V2 descriptor above remains for resolving runs recorded before it.
export const researchGoalOperationV3 = {
  schema_version: 1,
  operation_id: RESEARCH_GOAL_EXECUTE_OPERATION_V3,
  owner_operation: RESEARCH_OWNER_OPERATION_V3,
  owner_schema: "sourced-research-goal-v3",
  capability: "rd.research_goal.execute",
  effect_set: RESEARCH_GOAL_EFFECT_SET_V2,
  dependency_operation_ids: [],
  execution_boundary: "DISPOSABLE_LOCAL",
  recovery_identity_fields: ["request_identity"],
  routing_dependency_keys: [PRODUCT_EDGE_RESEARCH_GOAL_ROUTING_KEY_V3],
  orchestration_contract: {
    identity: "dashboard-sourced-research-goal-orchestrator-v3",
    run_owner_route: "POST /v3/source-intake-research",
    resolve_owner_route: "POST /v3/research-goals/{request_identity}/resolve",
    source_ancestry_required: true,
    resolve_identity_mode: "EXACT",
  },
  channels: ["DASHBOARD_DISPOSABLE_EXECUTION"],
} as const;

export type ResearchGoalOperationDescriptorV1 =
  | typeof researchGoalOperationV2
  | typeof researchGoalOperationV3;

// Exactly the two Research operations; anything else names no descriptor, so a caller holding an
// unrecorded or unknown operation fails closed instead of being read as V2.
export function researchGoalOperationForV1(
  operation: ResearchOwnerOperationV1,
): ResearchGoalOperationDescriptorV1 | null {
  if (operation === RESEARCH_OWNER_OPERATION_V3) return researchGoalOperationV3;
  if (operation === RESEARCH_OWNER_OPERATION_V2) return researchGoalOperationV2;
  return null;
}

// The Owner route a descriptor's orchestration contract names, as a request path.
function ownerPath(route: string, requestIdentity?: string): string {
  const path = route.slice(route.indexOf(" ") + 1);
  return requestIdentity === undefined
    ? path
    : path.replace("{request_identity}", encodeURIComponent(requestIdentity));
}

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function validAncestry(value: SourceIntakeAncestryV1): boolean {
  return object(value) && exactKeys(value, [
    "request_identity", "attempt_identity", "terminal_receipt_identity",
  ]) && [
    value.request_identity,
    value.attempt_identity,
    value.terminal_receipt_identity,
  ].every((entry) => IDENTITY.test(entry));
}

function unavailable(reason: string) {
  return {
    availability: "unavailable" as const,
    unavailable_reason: reason,
    owner_response: null,
    owner_outcome_state: null,
  };
}

async function availableTerminalResearch(
  ownerResponse: Record<string, unknown>,
  requestIdentity: string,
  operation: ResearchOwnerOperationV1,
) {
  const projected = await projectResearchOwnerResultWithEvidenceV1(ownerResponse, requestIdentity, operation);
  const projection = projected.projection as Record<string, unknown>;
  if (projected.verified && projection.resolution === "SUBMITTED_OR_UNKNOWN") {
    return unavailable("RESEARCH_OWNER_UNKNOWN");
  }
  if (!projected.verified || !["ACCEPTED", "REJECTED_NO_WRITE"].includes(String(projection.resolution))) {
    return unavailable("RESEARCH_OWNER_PROJECTION_UNAVAILABLE");
  }
  return {
    availability: "available" as const,
    unavailable_reason: null,
    owner_response: ownerResponse,
    owner_outcome_state: projection.resolution === "ACCEPTED"
      ? "available" as const
      : "rejected" as const,
  };
}

// Submits a sourced Research request: V3 for an input that states its instrument, V2 only to finish
// a run recorded before V3. Resolving one, fresh or in recovery, goes through
// `resolveResearchGoalOperation` and the Owner route the same descriptor names.
export async function executeResearchGoalOperation({
  input,
  ancestry,
  transport,
  routing,
}: {
  input: ResearchGoalExecutionInputV2 | ResearchGoalExecutionInputV3;
  ancestry: SourceIntakeAncestryV1;
  transport: RdOwnerHttpTransportV1;
  routing: ProductEdgeExecutionRoutingV1;
}) {
  const isV3 = researchGoalInputIsV3(input);
  const descriptor = isV3 ? researchGoalOperationV3 : researchGoalOperationV2;
  if (!(isV3 ? validResearchGoalExecutionInputV3(input) : validResearchGoalExecutionInputV2(input))
    || !validAncestry(ancestry)) {
    return unavailable("RESEARCH_EXECUTION_REQUEST_INVALID");
  }
  if (routing.state !== "ACTIVE" || routing.dispatcher !== "TRADE_DASHBOARD") {
    return unavailable("RESEARCH_EXECUTION_ROUTING_UNAVAILABLE");
  }
  const ownerOutcome = await rdOwnerJsonOutcomeV1({
    transport,
    path: ownerPath(descriptor.orchestration_contract.run_owner_route),
    method: "POST",
    body: {
      proposal: {
        request_identity: input.request_identity,
        goal: input.goal,
        trial_family_proposal: input.trial_family_proposal,
        ...(isV3 ? { instrument_scope: input.instrument_scope } : {}),
      },
      ancestry,
    },
    tradeDashboardDispatcher: true,
  });
  if (ownerOutcome.state === "ABSENT") {
    return unavailable("RESEARCH_OWNER_RESPONSE_UNAVAILABLE");
  }
  if (ownerOutcome.state === "UNKNOWN") {
    return unavailable("RESEARCH_OWNER_UNKNOWN");
  }
  if (ownerOutcome.state !== "AVAILABLE") {
    return unavailable("RESEARCH_OWNER_RESPONSE_UNAVAILABLE");
  }
  return availableTerminalResearch(ownerOutcome.value, input.request_identity, descriptor.owner_operation);
}

// Resolves a Research request through the route of the operation its run recorded. The Owner answers
// both routes alike; the operation decides which stamp the answer carries.
export async function resolveResearchGoalOperation({
  requestIdentity,
  operation,
  transport,
}: {
  requestIdentity: string;
  operation: ResearchOwnerOperationV1;
  transport: RdOwnerHttpTransportV1;
}) {
  if (!IDENTITY.test(requestIdentity)) return unavailable("RESEARCH_EXECUTION_REQUEST_INVALID");
  const descriptor = researchGoalOperationForV1(operation);
  if (!descriptor) return unavailable("RESEARCH_EXECUTION_REQUEST_INVALID");
  const ownerOutcome = await rdOwnerJsonOutcomeV1({
    transport,
    path: ownerPath(descriptor.orchestration_contract.resolve_owner_route, requestIdentity),
    method: "POST",
  });
  if (ownerOutcome.state === "ABSENT") return unavailable("RESEARCH_OWNER_ABSENT");
  if (ownerOutcome.state === "UNKNOWN") return unavailable("RESEARCH_OWNER_UNKNOWN");
  if (ownerOutcome.state !== "AVAILABLE") return unavailable("RESEARCH_OWNER_RESPONSE_UNAVAILABLE");
  return availableTerminalResearch(ownerOutcome.value, requestIdentity, descriptor.owner_operation);
}
