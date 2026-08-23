type Action = "RESOLVE"

export type ResearchSourceV1 = {
  locator: string
  content_digest: string
  observed_at: string
  source_cut: string
  license_basis: string
  interpretation: string
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
  _action: Action,
  request_identity: string,
) {
  const token = process.env.RD_OWNER_API_TOKEN
  if (!token) {
    return unknown(request_identity)
  }
  const path = `/v1/research-goals/${encodeURIComponent(request_identity)}/resolve`
  try {
    const response = await fetch(`${OWNER_URL}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
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
