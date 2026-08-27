import {
  deriveResearchConsumerProjectionV1,
  unknownResearchProjectionV1,
  verifyResearchConsumerProjectionV1,
} from "./consumer_projection_v1.ts"

type Action = "RUN" | "RESOLVE"

export type SourceIntakeResearchOperationV1 = {
  proposal: {
    request_identity: string
    channel: "WINDMILL_PRODUCT_EDGE"
    goal: Record<string, unknown>
    trial_family_proposal: Record<string, unknown>
  }
  ancestry: {
    request_identity: string
    attempt_identity: string
    terminal_receipt_identity: string
  }
  policy_query: {
    request_identity: string
    gateway: "WINDMILL_PRODUCT_EDGE"
    admission: Record<string, unknown>
    operation_manifest_identity: string
    operation_manifest_digest: string
    connector_policy_locator: string
    network_policy_locator: string
    rights_policy_locator: string
    retention_policy_locator: string
    dns_observation_locator: string
    shared_time_head: Record<string, unknown>
    shared_time_successor: Record<string, unknown> | null
  }
}

const OWNER_URL = "http://rd-owner-api:8080"

function validOperation(value: SourceIntakeResearchOperationV1): boolean {
  const requestIdentity = value?.proposal?.request_identity
  return typeof requestIdentity === "string"
    && requestIdentity.length > 0
    && value.proposal.channel === "WINDMILL_PRODUCT_EDGE"
    && value.ancestry.request_identity === value.policy_query.request_identity
}

async function runOwnerOperation(
  action: Action,
  operation: SourceIntakeResearchOperationV1,
) {
  const requestIdentity = operation?.proposal?.request_identity ?? "unbound"
  const token = process.env.RD_OWNER_API_TOKEN
  if (!token || !validOperation(operation)) return unknownResearchProjectionV1(requestIdentity)
  const path = action === "RESOLVE"
    ? `/v1/source-intake-research/${encodeURIComponent(requestIdentity)}/resolve`
    : "/v1/source-intake-research"
  try {
    const response = await fetch(`${OWNER_URL}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(operation),
      signal: AbortSignal.timeout(8_000),
    })
    if (response.status >= 500) return unknownResearchProjectionV1(requestIdentity)
    return await response.json()
  } catch {
    return unknownResearchProjectionV1(requestIdentity)
  }
}

export async function main(
  action: Action,
  operation: SourceIntakeResearchOperationV1,
) {
  const requestIdentity = operation?.proposal?.request_identity ?? "unbound"
  const raw = await runOwnerOperation(action, operation)
  return await verifyResearchConsumerProjectionV1(
    await deriveResearchConsumerProjectionV1(raw, requestIdentity),
    requestIdentity,
  )
}
