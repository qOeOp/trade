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

// The instrument scope a V3 Research request studies, in R&D's wire form
// (`ResearchInstrumentScopeWireV1`): the form states exactly one Instrument Master identity.
export type ResearchInstrumentScopeInputV1 = {
  schema_version: 1;
  identities: [string];
};

// A V3 request is a V2 request plus the instrument scope it studies, as R&D stores it: one request
// shape in which `instrument_scope` is present exactly for V3.
export type ResearchGoalExecutionInputV3 = ResearchGoalExecutionInputV2 & {
  instrument_scope: ResearchInstrumentScopeInputV1;
};

export type SourceResearchRunRequestV1 = {
  action: "RUN";
  source: SourceIntakeExecutionInputV1;
  // New runs carry V3. A V2 input is only ever read back from a run recorded before the form moved
  // to V3, so that run can still be resolved.
  research: ResearchGoalExecutionInputV2 | ResearchGoalExecutionInputV3;
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

// The instrument identity rule R&D applies (`ResearchInstrumentScopeV1::from_identities` in
// crates/data/src/owner/research_instrument_scope_v1.rs): not empty, at most 1024 UTF-8 bytes, no
// Unicode control character (Cc), and no leading or trailing Unicode White_Space. That is Rust's
// `trim`, not JavaScript's, which also strips U+FEFF. Both sides are tested against one vector file,
// product/rd-owner-client/fixtures/research_instrument_identity_vectors_v1.json, so neither can
// change alone. Whether the identity names an eligible instrument is R&D's answer, not this one's.
export const RESEARCH_INSTRUMENT_IDENTITY_MAX_BYTES_V1 = 1_024;
const EDGE_WHITE_SPACE =
  /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;

export function validResearchInstrumentIdentityV1(value: unknown): value is string {
  // A lone surrogate is not UTF-8, so R&D could not even receive it. With the `u` flag only an
  // unpaired surrogate reads as Cs; a valid pair reads as one supplementary code point.
  return typeof value === "string" && value.length > 0 && !/\p{Cs}/u.test(value)
    && new TextEncoder().encode(value).byteLength <= RESEARCH_INSTRUMENT_IDENTITY_MAX_BYTES_V1
    && !/\p{Cc}/u.test(value) && !EDGE_WHITE_SPACE.test(value);
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

function validResearchGoalFieldsV2(value: ResearchGoalExecutionInputV2): boolean {
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

const RESEARCH_V2_KEYS = ["request_identity", "goal", "trial_family_proposal"] as const;

export function validResearchGoalExecutionInputV2(value: ResearchGoalExecutionInputV2): boolean {
  return object(value) && exactKeys(value, RESEARCH_V2_KEYS) && validResearchGoalFieldsV2(value);
}

export function validResearchInstrumentScopeInputV1(value: unknown): value is ResearchInstrumentScopeInputV1 {
  return object(value) && exactKeys(value, ["schema_version", "identities"])
    && value.schema_version === 1 && Array.isArray(value.identities)
    && value.identities.length === 1 && validResearchInstrumentIdentityV1(value.identities[0]);
}

export function validResearchGoalExecutionInputV3(value: ResearchGoalExecutionInputV3): boolean {
  return object(value) && exactKeys(value, [...RESEARCH_V2_KEYS, "instrument_scope"])
    && validResearchGoalFieldsV2(value) && validResearchInstrumentScopeInputV1(value.instrument_scope);
}

// Which Research request an input is: V3 exactly when it states an instrument scope.
export function researchGoalInputIsV3(
  value: ResearchGoalExecutionInputV2 | ResearchGoalExecutionInputV3,
): value is ResearchGoalExecutionInputV3 {
  return object(value) && "instrument_scope" in value;
}

// A request as custody holds it: a recorded run may carry either Research input.
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
    && (researchGoalInputIsV3(value.research)
      ? validResearchGoalExecutionInputV3(value.research)
      : validResearchGoalExecutionInputV2(value.research));
}

// A request as it arrives to be dispatched: the form submits only V3, so a new run must state its
// instrument. A resolve names identities only.
export function validSourceResearchSubmissionV1(value: SourceResearchOperationRequestV1): boolean {
  return validSourceResearchOperationRequestV1(value)
    && (value.action === "RESOLVE" || researchGoalInputIsV3(value.research));
}
