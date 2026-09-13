export type SourceInterpretationInputV1 = {
  bounded_explanation: string;
  plausible_alternatives: string[];
  differentiating_prediction: string;
  falsifier: string;
};

export type SourceIntakeExecutionInputV1 = {
  request_identity: string;
  normalized_doi: string;
  interpretation: SourceInterpretationInputV1;
};

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

export type SourceResearchRunRequestV1 = {
  action: "RUN";
  source: SourceIntakeExecutionInputV1;
  research: ResearchGoalExecutionInputV2;
};

export type SourceResearchResolveRequestV1 = {
  action: "RESOLVE";
  source_request_identity: string;
  research_request_identity: string;
};

export type SourceResearchOperationRequestV1 =
  | SourceResearchRunRequestV1
  | SourceResearchResolveRequestV1;

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DOI = /^10\.[a-z0-9./\-_;():]{1,252}$/;

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

function compareUtf8(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}

export function validSourceIntakeExecutionInputV1(value: SourceIntakeExecutionInputV1): boolean {
  if (!object(value) || typeof value.request_identity !== "string"
    || typeof value.normalized_doi !== "string" || !object(value.interpretation)) return false;
  const interpretation = value.interpretation;
  return IDENTITY.test(value.request_identity)
    && DOI.test(value.normalized_doi)
    && validText(interpretation.bounded_explanation)
    && validText(interpretation.differentiating_prediction)
    && validText(interpretation.falsifier)
    && Array.isArray(interpretation.plausible_alternatives)
    && interpretation.plausible_alternatives.length >= 1
    && interpretation.plausible_alternatives.length <= 16
    && interpretation.plausible_alternatives.every(validText)
    && interpretation.plausible_alternatives.slice(1).every((item, index) =>
      compareUtf8(interpretation.plausible_alternatives[index], item) < 0);
}

export function validResearchGoalExecutionInputV2(value: ResearchGoalExecutionInputV2): boolean {
  if (!object(value) || typeof value.request_identity !== "string"
    || !IDENTITY.test(value.request_identity) || !object(value.goal)
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

export function validSourceResearchOperationRequestV1(
  value: SourceResearchOperationRequestV1,
): boolean {
  if (!object(value)) return false;
  if (value.action === "RESOLVE") {
    return exactKeys(value, [
      "action", "source_request_identity", "research_request_identity",
    ]) && typeof value.source_request_identity === "string"
      && typeof value.research_request_identity === "string"
      && IDENTITY.test(value.source_request_identity)
      && IDENTITY.test(value.research_request_identity);
  }
  return value.action === "RUN"
    && exactKeys(value, ["action", "source", "research"])
    && validSourceIntakeExecutionInputV1(value.source)
    && validResearchGoalExecutionInputV2(value.research);
}
