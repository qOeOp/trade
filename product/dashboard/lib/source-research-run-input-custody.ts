import { createHash } from "node:crypto";

import {
  type SourceResearchRunRequestV1,
  validSourceResearchOperationRequestV1,
} from "./source-research-input-contract.ts";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_CANONICAL_REQUEST_BYTES = 1_048_576;

export type SourceResearchRunInputCustodyStateV1 =
  | "AVAILABLE"
  | "NOT_APPLICABLE"
  | "LEGACY_UNAVAILABLE";

export type SourceResearchRunInputReadbackV1 = {
  schema_version: 1;
  availability: "available";
  unavailable_reason: null;
  request_schema_version: 1;
  request: SourceResearchRunRequestV1;
  request_digest: string;
} | {
  schema_version: 1;
  availability: "unavailable";
  unavailable_reason: "NOT_APPLICABLE" | "LEGACY_UNAVAILABLE" | "INVALID";
  request_schema_version: null;
  request: null;
  request_digest: null;
};

export function canonicalSourceResearchRunRequestV1(
  request: SourceResearchRunRequestV1,
): SourceResearchRunRequestV1 | null {
  if (!validSourceResearchOperationRequestV1(request) || request.action !== "RUN") return null;
  return {
    action: "RUN",
    source: {
      request_identity: request.source.request_identity,
      normalized_doi: request.source.normalized_doi,
      interpretation: {
        bounded_explanation: request.source.interpretation.bounded_explanation,
        plausible_alternatives: [...request.source.interpretation.plausible_alternatives],
        differentiating_prediction: request.source.interpretation.differentiating_prediction,
        falsifier: request.source.interpretation.falsifier,
      },
    },
    research: {
      request_identity: request.research.request_identity,
      goal: {
        hypothesis: request.research.goal.hypothesis,
        mechanism: request.research.goal.mechanism,
        falsification_question: request.research.goal.falsification_question,
        expected_observation: request.research.goal.expected_observation,
        required_data: [...request.research.goal.required_data],
        cost_assumption: request.research.goal.cost_assumption,
        capacity_assumption: request.research.goal.capacity_assumption,
      },
      trial_family_proposal: {
        trial_budget: request.research.trial_family_proposal.trial_budget,
        stop_rule: request.research.trial_family_proposal.stop_rule,
        pit_rule_identity: request.research.trial_family_proposal.pit_rule_identity,
        cost_model_identity: request.research.trial_family_proposal.cost_model_identity,
        slippage_model_identity: request.research.trial_family_proposal.slippage_model_identity,
        capacity_model_identity: request.research.trial_family_proposal.capacity_model_identity,
        independence_rationale: request.research.trial_family_proposal.independence_rationale,
      },
    },
  };
}

export function sourceResearchRunInputCustodyV1(
  request: SourceResearchRunRequestV1,
): SourceResearchRunInputReadbackV1 | null {
  const canonical = canonicalSourceResearchRunRequestV1(request);
  if (!canonical) return null;
  const bytes = Buffer.from(JSON.stringify(canonical), "utf8");
  if (bytes.byteLength > MAX_CANONICAL_REQUEST_BYTES) return null;
  return {
    schema_version: 1,
    availability: "available",
    unavailable_reason: null,
    request_schema_version: 1,
    request: canonical,
    request_digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

export function readSourceResearchRunInputCustodyV1({
  state,
  requestSchemaVersion,
  request,
  requestDigest,
}: {
  state: unknown;
  requestSchemaVersion: number | null;
  request: unknown;
  requestDigest: string | null;
}): SourceResearchRunInputReadbackV1 {
  if (state === "NOT_APPLICABLE" || state === "LEGACY_UNAVAILABLE") {
    if (requestSchemaVersion !== null || request !== null || requestDigest !== null) return invalid();
    return {
      schema_version: 1,
      availability: "unavailable",
      unavailable_reason: state === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "LEGACY_UNAVAILABLE",
      request_schema_version: null,
      request: null,
      request_digest: null,
    };
  }
  if (state !== "AVAILABLE") return invalid();
  if (requestSchemaVersion !== 1 || !DIGEST.test(requestDigest ?? "")) {
    return invalid();
  }
  const custody = sourceResearchRunInputCustodyV1(request as SourceResearchRunRequestV1);
  if (!custody || custody.request_digest !== requestDigest) return invalid();
  return custody;
}

function invalid(): SourceResearchRunInputReadbackV1 {
  return {
    schema_version: 1,
    availability: "unavailable",
    unavailable_reason: "INVALID",
    request_schema_version: null,
    request: null,
    request_digest: null,
  };
}
