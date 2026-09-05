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

type DiagnosticStage = "OWNER_JSON" | "OWNER_HTTP_ERROR" | "OWNER_TIMEOUT"
  | "OWNER_TRANSPORT_OR_JSON_ERROR" | "DERIVE_UNAVAILABLE" | "VERIFY_UNAVAILABLE"

function diagnostic(stage: DiagnosticStage, status: number | null, started: number) {
  try {
    console.log(JSON.stringify({
      event: "source_intake_research_diagnostic_v1", stage,
      http_status: status, elapsed_ms: Math.max(0, Date.now() - started),
    }))
  } catch {
    // Diagnostic output cannot change the Owner result or projection.
  }
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256
}

function validOperation(value: SourceIntakeResearchOperationV1 | null | undefined): value is SourceIntakeResearchOperationV1 {
  const requestIdentity = value?.proposal?.request_identity
  return validIdentity(requestIdentity)
    && value.proposal.channel === "WINDMILL_PRODUCT_EDGE"
    && value.ancestry?.request_identity === value.policy_query?.request_identity
}

async function runOwnerOperation(
  action: Action,
  requestIdentity: string,
  operation: SourceIntakeResearchOperationV1 | null | undefined,
) {
  const token = process.env.RD_OWNER_API_TOKEN
  if (!token) return unknownResearchProjectionV1(requestIdentity)
  const path = action === "RESOLVE"
    ? `/v1/source-intake-research/${encodeURIComponent(requestIdentity)}/resolve`
    : "/v1/source-intake-research"
  const body = action === "RUN" ? JSON.stringify(operation) : undefined
  const started = Date.now()
  let status: number | null = null
  try {
    const response = await fetch(`${OWNER_URL}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(8_000),
    })
    status = response.status
    if (status >= 500) {
      diagnostic("OWNER_HTTP_ERROR", status, started)
      return unknownResearchProjectionV1(requestIdentity)
    }
    const raw = await response.json()
    diagnostic("OWNER_JSON", status, started)
    return raw
  } catch (error) {
    let stage: DiagnosticStage = "OWNER_TRANSPORT_OR_JSON_ERROR"
    try {
      if (error instanceof Error && error.name === "TimeoutError") stage = "OWNER_TIMEOUT"
    } catch {
      // An untrusted thrown object's properties must not change failure handling.
    }
    diagnostic(stage, status, started)
    return unknownResearchProjectionV1(requestIdentity)
  }
}

export async function main(
  action: Action,
  request_identity: string,
  operation?: SourceIntakeResearchOperationV1 | null,
) {
  const requestIdentity = validIdentity(request_identity) ? request_identity : "unbound"
  const validRun = action === "RUN"
    && validOperation(operation)
    && operation.proposal.request_identity === request_identity
  const validResolve = action === "RESOLVE" && (operation === null || operation === undefined)
  if (!validIdentity(request_identity) || (!validRun && !validResolve)) {
    return unknownResearchProjectionV1(requestIdentity)
  }
  const raw = await runOwnerOperation(action, requestIdentity, operation)
  const started = Date.now()
  const derived = await deriveResearchConsumerProjectionV1(raw, requestIdentity)
  if (derived.resolution === "SUBMITTED_OR_UNKNOWN") diagnostic("DERIVE_UNAVAILABLE", null, started)
  const verified = await verifyResearchConsumerProjectionV1(derived, requestIdentity)
  if (verified.resolution === "SUBMITTED_OR_UNKNOWN") diagnostic("VERIFY_UNAVAILABLE", null, started)
  return verified
}
