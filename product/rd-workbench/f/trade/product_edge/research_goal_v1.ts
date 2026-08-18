type Channel = "APP" | "MCP"
type Action = "SUBMIT" | "RESOLVE"

export type ResearchSourceV1 = {
  locator: string
  content_digest: string
  observed_at: string
  source_cut: string
  license_basis: string
  interpretation: string
}

export type SourcedResearchGoalV1 = {
  hypothesis: string
  mechanism: string
  falsification_question: string
  expected_observation: string
  required_data: string[]
  cost_assumption: string
  capacity_assumption: string
  protected_feedback_frontier: string
  sources: ResearchSourceV1[]
}

const OWNER_URL = "http://rd-owner-api:8080"

function unknown(requestIdentity: string) {
  return {
    schema_version: 1,
    resolution: "SUBMITTED_OR_UNKNOWN",
    request_identity: requestIdentity,
    owner_receipt: null,
    research_view: null,
    next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY",
  }
}

export async function main(
  action: Action,
  request_identity: string,
  channel: Channel,
  goal?: SourcedResearchGoalV1,
) {
  const token = process.env.RD_OWNER_API_TOKEN
  if (!token) {
    return unknown(request_identity)
  }
  const isResolve = action === "RESOLVE"
  if (!isResolve && !goal) {
    return {
      ...unknown(request_identity),
      resolution: "REJECTED_NO_WRITE",
      rejection_code: "MISSING_TYPED_GOAL",
      next_legal_action: "CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST",
    }
  }
  const path = isResolve
    ? `/v1/research-goals/${encodeURIComponent(request_identity)}/resolve`
    : "/v1/research-goals"
  const body = isResolve
    ? {}
    : { request_identity, channel, goal }
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
    if (response.status >= 500) {
      return unknown(request_identity)
    }
    return result
  } catch {
    return unknown(request_identity)
  }
}
