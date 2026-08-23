type Action = "SUBMIT" | "RESOLVE"
const PRODUCT_EDGE_GATEWAY = "WINDMILL_PRODUCT_EDGE" as const

import {
  deriveResearchConsumerProjectionV1,
  unknownResearchProjectionV1,
  verifyResearchConsumerProjectionV1,
} from "./consumer_projection_v1.ts"

export type ResearchSourceV1 = {
  locator: string
  content_digest: string
  observed_at: string
  source_cut: string
  license_basis: string
  interpretation: string
}

export type SourcedResearchGoalV2 = {
  hypothesis: string
  mechanism: string
  falsification_question: string
  expected_observation: string
  required_data: string[]
  cost_assumption: string
  capacity_assumption: string
  sources: ResearchSourceV1[]
}

export type TrialFamilyProposalV1 = {
  trial_budget: number
  stop_rule: string
  pit_rule_identity: string
  cost_model_identity: string
  slippage_model_identity: string
  capacity_model_identity: string
  independence_rationale: string
}

const OWNER_URL = "http://rd-owner-api:8080"

function unknown(requestIdentity: string) {
  return unknownResearchProjectionV1(requestIdentity)
}

async function runOwnerOperation(
  action: Action,
  request_identity: string,
  goal?: SourcedResearchGoalV2,
  trial_family_proposal?: TrialFamilyProposalV1,
) {
  const token = process.env.RD_OWNER_API_TOKEN
  if (!token) return unknown(request_identity)
  const isResolve = action === "RESOLVE"
  if (!isResolve && (!goal || !trial_family_proposal)) {
    return {
      ...unknown(request_identity),
      resolution: "REJECTED_NO_WRITE",
      rejection_code: "MISSING_TYPED_GOAL_OR_FAMILY_PROPOSAL",
      next_legal_action: "CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST",
    }
  }
  const path = isResolve
    ? `/v2/research-goals/${encodeURIComponent(request_identity)}/resolve`
    : "/v2/research-goals"
  const body = isResolve
    ? {}
    : {
        request_identity,
        channel: PRODUCT_EDGE_GATEWAY,
        goal,
        trial_family_proposal,
      }
  try {
    const response = await fetch(`${OWNER_URL}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    })
    const result = await response.json()
    if (response.status >= 500) return unknown(request_identity)
    return result
  } catch {
    return unknown(request_identity)
  }
}

export async function main(
  action: Action,
  request_identity: string,
  goal?: SourcedResearchGoalV2,
  trial_family_proposal?: TrialFamilyProposalV1,
) {
  const raw = await runOwnerOperation(
    action,
    request_identity,
    goal,
    trial_family_proposal,
  )
  return await verifyResearchConsumerProjectionV1(
    await deriveResearchConsumerProjectionV1(raw, request_identity),
    request_identity,
  )
}
