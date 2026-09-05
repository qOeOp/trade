import {
  projectResearchOwnerResultWithEvidenceV1,
} from "../../rd-owner-client/consumer_projection_v1.ts";
import {
  PRODUCT_EDGE_RESEARCH_GOAL_ROUTING_KEY_V2,
  type ProductEdgeExecutionRoutingV1,
} from "./product-edge-routing-client.ts";
import {
  rdOwnerJsonOutcomeV1,
  type RdOwnerHttpTransportV1,
} from "./rd-owner-http.ts";

export const RESEARCH_GOAL_EXECUTE_OPERATION = "research_goal.execute.v2" as const;
export const RESEARCH_GOAL_EFFECT_SET_V2 = ["R_AND_D_RESEARCH_MUTATION_V1"] as const;

export type DashboardSourcedResearchGoalV2 = {
  hypothesis: string;
  mechanism: string;
  falsification_question: string;
  expected_observation: string;
  required_data: string[];
  cost_assumption: string;
  capacity_assumption: string;
};

export type DashboardTrialFamilyProposalV1 = {
  trial_budget: number;
  stop_rule: string;
  pit_rule_identity: string;
  cost_model_identity: string;
  slippage_model_identity: string;
  capacity_model_identity: string;
  independence_rationale: string;
};

export type ResearchGoalExecutionInputV2 = {
  request_identity: string;
  goal: DashboardSourcedResearchGoalV2;
  trial_family_proposal: DashboardTrialFamilyProposalV1;
};

export type SourceIntakeAncestryV1 = {
  request_identity: string;
  attempt_identity: string;
  terminal_receipt_identity: string;
};

export const researchGoalOperationV2 = {
  schema_version: 1,
  operation_id: RESEARCH_GOAL_EXECUTE_OPERATION,
  owner_operation: "research_goal.submit_or_resolve.v2",
  owner_schema: "sourced-research-goal-v2",
  capability: "rd.research_goal.execute",
  effect_set: RESEARCH_GOAL_EFFECT_SET_V2,
  execution_boundary: "DISPOSABLE_LOCAL",
  recovery_identity_fields: ["request_identity"],
  routing_dependency_keys: [PRODUCT_EDGE_RESEARCH_GOAL_ROUTING_KEY_V2],
  orchestration_contract: {
    identity: "dashboard-sourced-research-goal-orchestrator-v2",
    run_owner_route: "POST /v2/source-intake-research",
    resolve_owner_route: "POST /v2/source-intake-research/{request_identity}/resolve",
    source_ancestry_required: true,
    resolve_identity_mode: "EXACT",
  },
  channels: ["DASHBOARD_DISPOSABLE_EXECUTION"],
} as const;

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
    && new TextEncoder().encode(value).byteLength <= 8_192 && !/\p{Cc}/u.test(value);
}

export function validResearchGoalExecutionInputV2(value: ResearchGoalExecutionInputV2): boolean {
  if (!IDENTITY.test(value?.request_identity ?? "") || !object(value?.goal)
    || !exactKeys(value.goal, [
      "hypothesis", "mechanism", "falsification_question", "expected_observation",
      "required_data", "cost_assumption", "capacity_assumption",
    ]) || ![
      value.goal.hypothesis,
      value.goal.mechanism,
      value.goal.falsification_question,
      value.goal.expected_observation,
      value.goal.cost_assumption,
      value.goal.capacity_assumption,
    ].every(validText) || !Array.isArray(value.goal.required_data)
    || value.goal.required_data.length < 1 || value.goal.required_data.length > 64
    || !value.goal.required_data.every(validText) || !object(value?.trial_family_proposal)
    || !exactKeys(value.trial_family_proposal, [
      "trial_budget", "stop_rule", "pit_rule_identity", "cost_model_identity",
      "slippage_model_identity", "capacity_model_identity", "independence_rationale",
    ])) return false;
  const proposal = value.trial_family_proposal;
  return Number.isSafeInteger(proposal.trial_budget)
    && proposal.trial_budget >= 1 && proposal.trial_budget <= 64
    && [
      proposal.stop_rule,
      proposal.pit_rule_identity,
      proposal.cost_model_identity,
      proposal.slippage_model_identity,
      proposal.capacity_model_identity,
      proposal.independence_rationale,
    ].every(validText);
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

export async function executeResearchGoalOperationV2({
  action,
  input,
  ancestry,
  transport,
  routing,
}: {
  action: "RUN" | "RESOLVE";
  input: ResearchGoalExecutionInputV2;
  ancestry: SourceIntakeAncestryV1;
  transport: RdOwnerHttpTransportV1;
  routing: ProductEdgeExecutionRoutingV1;
}) {
  if (!validResearchGoalExecutionInputV2(input) || !validAncestry(ancestry)) {
    return unavailable("RESEARCH_EXECUTION_REQUEST_INVALID");
  }
  if (action === "RUN"
    && (routing.state !== "ACTIVE" || routing.dispatcher !== "TRADE_DASHBOARD")) {
    return unavailable("RESEARCH_EXECUTION_ROUTING_UNAVAILABLE");
  }
  const ownerOutcome = await rdOwnerJsonOutcomeV1({
    transport,
    path: action === "RUN"
      ? "/v2/source-intake-research"
      : `/v2/source-intake-research/${encodeURIComponent(input.request_identity)}/resolve`,
    method: "POST",
    body: {
      proposal: {
        request_identity: input.request_identity,
        channel: "WINDMILL_PRODUCT_EDGE",
        goal: input.goal,
        trial_family_proposal: input.trial_family_proposal,
      },
      ancestry,
    },
    tradeDashboardDispatcher: action === "RUN",
  });
  if (ownerOutcome.state === "ABSENT") {
    return unavailable(action === "RESOLVE"
      ? "RESEARCH_OWNER_ABSENT"
      : "RESEARCH_OWNER_RESPONSE_UNAVAILABLE");
  }
  if (ownerOutcome.state === "UNKNOWN") {
    return unavailable("RESEARCH_OWNER_UNKNOWN");
  }
  if (ownerOutcome.state !== "AVAILABLE") {
    return unavailable("RESEARCH_OWNER_RESPONSE_UNAVAILABLE");
  }
  const ownerResponse = ownerOutcome.value;
  const projected = await projectResearchOwnerResultWithEvidenceV1(
    ownerResponse,
    input.request_identity,
  );
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
