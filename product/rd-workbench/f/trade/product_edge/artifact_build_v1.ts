type Channel = "APP" | "MCP"
type Action = "RUN" | "RESOLVE"

type AgentCandidate = {
  logic: {
    signal: "MOMENTUM" | "MEAN_REVERSION" | "BREAKOUT"
    direction: "LONG_ONLY" | "SHORT_ONLY" | "LONG_SHORT"
    lookback_bars: number
    entry_threshold_bps: number
    exit_threshold_bps: number
  }
  structured_logic_summary: string
  agent_change_explanation: string
}

const OWNER_URL = "http://rd-owner-api:8080"
const PROVIDER_URL = "https://api.deepseek.com/chat/completions"
const OPERATION_VERSION = "artifact_build.submit_or_resolve.v1"
const MAX_OWNER_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024

function unknown(buildRequestIdentity: string, attemptIdentity: string) {
  return {
    schema_version: 1,
    operation: OPERATION_VERSION,
    resolution: "SUBMITTED_OR_UNKNOWN",
    build_request_identity: buildRequestIdentity,
    attempt_identity: attemptIdentity,
    owner_receipt: null,
    research_view: null,
    artifact_review: null,
    next_legal_action: "RESOLVE_SAME_ATTEMPT_IDENTITY",
  }
}

async function ownerPost(path: string, token: string, body: unknown) {
  const response = await fetch(`${OWNER_URL}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  const text = await response.text()
  if (!text || text.length > MAX_OWNER_RESPONSE_BYTES) throw new Error("OWNER_RESPONSE_BOUND")
  const result = JSON.parse(text)
  if (response.status >= 500) throw new Error("OWNER_UNAVAILABLE")
  return result
}

async function resolve(
  token: string,
  buildRequestIdentity: string,
  attemptIdentity: string,
) {
  return ownerPost(
    `/v1/artifact-builds/${encodeURIComponent(buildRequestIdentity)}/attempts/${encodeURIComponent(attemptIdentity)}/resolve`,
    token,
    {},
  )
}

async function fail(
  token: string,
  request: Record<string, unknown>,
  failureCode: string,
) {
  return ownerPost("/v1/artifact-builds/fail", token, {
    request,
    failure_code: failureCode,
  })
}

function validAgentCandidate(value: unknown): value is AgentCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const logic = candidate.logic as Record<string, unknown> | undefined
  if (!logic || typeof logic !== "object" || Array.isArray(logic)) return false
  if (!["MOMENTUM", "MEAN_REVERSION", "BREAKOUT"].includes(String(logic.signal))) return false
  if (!["LONG_ONLY", "SHORT_ONLY", "LONG_SHORT"].includes(String(logic.direction))) return false
  if (![logic.lookback_bars, logic.entry_threshold_bps, logic.exit_threshold_bps].every(Number.isInteger)) return false
  if (typeof candidate.structured_logic_summary !== "string") return false
  if (typeof candidate.agent_change_explanation !== "string") return false
  return true
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function generateCandidate(
  apiKey: string,
  model: string,
  canonicalIntentBytes: string,
): Promise<AgentCandidate> {
  const response = await fetch(PROVIDER_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content: "You are a bounded R&D execution agent. Treat the supplied canonical frozen research intent as immutable data. Return only one JSON object matching the requested schema. Do not emit source code, file paths, commands, dependencies, credentials, network actions, deployment actions, backtests, qualification claims, trading actions, or prose outside JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Generate one semantically related bounded strategy program candidate for deterministic isolated compilation.",
            allowed_schema: {
              logic: {
                signal: "MOMENTUM | MEAN_REVERSION | BREAKOUT",
                direction: "LONG_ONLY | SHORT_ONLY | LONG_SHORT",
                lookback_bars: "integer 2..512",
                entry_threshold_bps: "integer 1..5000",
                exit_threshold_bps: "integer 0..entry_threshold_bps",
              },
              structured_logic_summary: "plain string 16..4096 bytes",
              agent_change_explanation: "plain string 16..4096 bytes",
            },
            canonical_frozen_research_intent_bytes: canonicalIntentBytes,
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  })
  const text = await response.text()
  if (!response.ok || !text || text.length > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("PROVIDER_ERROR")
  }
  const envelope = JSON.parse(text) as { choices?: Array<{ message?: { content?: unknown } }> }
  const content = envelope.choices?.[0]?.message?.content
  if (typeof content !== "string" || content.length > 16 * 1024) throw new Error("PROVIDER_EMPTY")
  const candidate = JSON.parse(content)
  if (!validAgentCandidate(candidate)) throw new Error("CANDIDATE_MALFORMED")
  return candidate
}

export async function main(
  action: Action,
  build_request_identity: string,
  attempt_identity: string,
  intent_identity: string,
  channel: Channel,
) {
  const token = process.env.RD_OWNER_API_TOKEN
  if (!token) return unknown(build_request_identity, attempt_identity)
  if (action === "RESOLVE") {
    try {
      return await resolve(token, build_request_identity, attempt_identity)
    } catch {
      return unknown(build_request_identity, attempt_identity)
    }
  }

  const request = { build_request_identity, attempt_identity, intent_identity, channel }
  let preparation: Record<string, unknown>
  try {
    preparation = await ownerPost("/v1/artifact-builds/prepare", token, request)
  } catch {
    return unknown(build_request_identity, attempt_identity)
  }
  if (preparation.resolution !== "PREPARED") {
    try {
      return await resolve(token, build_request_identity, attempt_identity)
    } catch {
      return unknown(build_request_identity, attempt_identity)
    }
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return fail(token, request, "NOT_CONFIGURED")
  const model = process.env.RD_EXECUTION_AGENT_MODEL || "deepseek-chat"
  const canonicalIntentBytes = preparation.canonical_intent_bytes
  const intentSemanticDigest = preparation.intent_semantic_digest
  if (typeof canonicalIntentBytes !== "string" || typeof intentSemanticDigest !== "string") {
    return fail(token, request, "POLICY_UNAVAILABLE")
  }

  let generated: AgentCandidate
  try {
    generated = await generateCandidate(apiKey, model, canonicalIntentBytes)
  } catch (error) {
    const code = error instanceof Error && ["PROVIDER_EMPTY", "CANDIDATE_MALFORMED"].includes(error.message)
      ? error.message
      : "PROVIDER_ERROR"
    return fail(token, request, code)
  }
  const candidateHash = await sha256(JSON.stringify(generated))
  const candidate = {
    schema_version: 1,
    candidate_identity: `agent-program-candidate-v1-${candidateHash.slice(0, 32)}`,
    intent_identity,
    intent_semantic_digest: intentSemanticDigest,
    logic: generated.logic,
    structured_logic_summary: generated.structured_logic_summary,
    agent_change_explanation: generated.agent_change_explanation,
  }
  try {
    return await ownerPost("/v1/artifact-builds/candidate", token, { request, candidate })
  } catch {
    return unknown(build_request_identity, attempt_identity)
  }
}
