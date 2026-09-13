const OWNER_URL = "http://rd-owner-api:8080"
const MAX_OWNER_RESPONSE_BYTES = 2 * 1024 * 1024

type Action = "RUN" | "RESOLVE"
type Stage = "REPAIR_INPUT_DECISION" | "REPAIR_ACTION" | "MARKET_DATA_REPAIR" | "REPAIRED_REPLAY"
type Json = Record<string, any>

import {
  validExploratoryReplayRequestV2,
  verifyReplayConsumerProjectionV2,
} from "./consumer_projection_v1.ts"

function object(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value: Json, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function identity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^(sha256|blake3):[0-9a-f]{64}$/.test(value)
}

function byteArray(value: unknown, exactLength?: number): value is number[] {
  return Array.isArray(value) && (exactLength === undefined ? value.length > 0 : value.length === exactLength)
    && value.length <= MAX_OWNER_RESPONSE_BYTES
    && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
}

function equalBytes(left: unknown, right: unknown): boolean {
  return byteArray(left) && byteArray(right) && left.length === right.length
    && left.every((byte, index) => byte === right[index])
}

function timestamp(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function replayLocator(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "request_identity", "meaning_digest", "receipt_identity", "seal_digest",
  ]) && identity(value.request_identity) && digest(value.meaning_digest)
    && identity(value.receipt_identity) && digest(value.seal_digest)
}

function decisionPayload(action: Action, value: unknown): value is Json {
  if (!object(value)) return false
  const keys = action === "RUN"
    ? ["trial_family_identity", "result_identity", "request_identity", "attempt_identity"]
    : ["decision_identity", "result_identity"]
  return exactKeys(value, keys) && keys.every((key) => identity(value[key]))
}

function repairActionPayload(action: Action, value: unknown): value is Json {
  if (!object(value)) return false
  const keys = action === "RUN"
    ? ["decision_identity", "result_identity"]
    : ["action_request_identity", "decision_identity"]
  return exactKeys(value, keys) && keys.every((key) => identity(value[key]))
}

function marketDataPayload(value: unknown): value is Json {
  if (!object(value) || !exactKeys(value, [
    "action_request_identity", "decision_identity", "result_identity", "attempt_identity",
    "replay", "shared_time_head",
  ])) return false
  if (![value.action_request_identity, value.decision_identity, value.result_identity,
    value.attempt_identity].every(identity) || !replayLocator(value.replay)) return false
  return object(value.shared_time_head)
    && exactKeys(value.shared_time_head, ["head_identity", "head_digest"])
    && byteArray(value.shared_time_head.head_identity, 32)
    && byteArray(value.shared_time_head.head_digest, 32)
    && value.shared_time_head.head_identity.some((byte: number) => byte !== 0)
    && value.shared_time_head.head_digest.some((byte: number) => byte !== 0)
}

function repairedReplayPayload(action: Action, value: unknown): value is Json {
  if (!object(value)) return false
  if (action === "RESOLVE") {
    return exactKeys(value, ["request_identity", "meaning_digest"])
      && identity(value.request_identity) && digest(value.meaning_digest)
  }
  return exactKeys(value, ["predecessor_request_locator", "repair_resolution_locator"])
    && replayLocator(value.predecessor_request_locator)
    && object(value.repair_resolution_locator)
    && exactKeys(value.repair_resolution_locator, ["resolution_identity", "repair_request_identity"])
    && identity(value.repair_resolution_locator.resolution_identity)
    && identity(value.repair_resolution_locator.repair_request_identity)
}

function validPayload(action: Action, stage: Stage, value: unknown): value is Json {
  switch (stage) {
    case "REPAIR_INPUT_DECISION": return decisionPayload(action, value)
    case "REPAIR_ACTION": return repairActionPayload(action, value)
    case "MARKET_DATA_REPAIR": return marketDataPayload(value)
    case "REPAIRED_REPLAY": return repairedReplayPayload(action, value)
  }
}

function route(action: Action, stage: Stage, payload: Json): [string, unknown] {
  if (stage === "REPAIR_INPUT_DECISION") {
    return [`/v1/iteration-decisions/repair-inputs${action === "RESOLVE" ? "/resolve" : ""}`, payload]
  }
  if (stage === "REPAIR_ACTION") {
    return [`/v1/repair-action-requests${action === "RESOLVE" ? "/resolve" : ""}`, payload]
  }
  if (stage === "MARKET_DATA_REPAIR") {
    return [`/v1/market-data-repair-requests${action === "RESOLVE" ? "/resolve" : ""}`, payload]
  }
  if (action === "RESOLVE") {
    return [
      `/v2/exploratory-replay-requests/${encodeURIComponent(payload.request_identity)}/resolve`,
      { meaning_digest: payload.meaning_digest },
    ]
  }
  return ["/v2/exploratory-replay-requests/market-data-repair-successors", payload]
}

async function ownerPost(path: string, token: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${OWNER_URL}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  const text = await response.text()
  if (!text || text.length > MAX_OWNER_RESPONSE_BYTES) throw new Error("OWNER_RESPONSE_BOUND")
  const result = JSON.parse(text)
  if (!response.ok) throw new Error("OWNER_REQUEST_FAILED")
  return result
}

const categories = new Set([
  "MARKET_DATA", "ARTIFACT", "RUNTIME_KERNEL", "BACKTEST_OPERATIONAL", "SIMULATOR",
  "REPLAY_CONFIGURATION",
])
const targets = new Set([
  "MARKET_DATA", "RESEARCH_DEVELOP", "RUNTIME", "BACKTEST_RUNNER_SERVICE", "SIM_EXCHANGE",
  "RESEARCH_REPLAY_CONFIGURATION",
])

function validEvidenceCut(value: unknown, payload: Json): boolean {
  if (!object(value) || !exactKeys(value, [
    "decision_policy_identity", "decision_policy_version", "decision_policy_digest",
    "decision_policy_binding_digest", "trial_family_identity", "census_frontier_identity",
    "census_frontier_digest", "attempt_frontier_identity", "attempt_frontier_digest",
    "candidate_set_frontier_identity", "candidate_set_frontier_digest", "request_identity",
    "request_digest", "result_identity", "result_digest", "attempt_identity",
  ]) || !identity(value.decision_policy_identity) || !timestamp(value.decision_policy_version)
    || !byteArray(value.decision_policy_digest, 32)
    || !byteArray(value.decision_policy_binding_digest, 32)
    || ![
      value.trial_family_identity, value.census_frontier_identity, value.attempt_frontier_identity,
      value.candidate_set_frontier_identity, value.request_identity, value.result_identity,
      value.attempt_identity,
    ].every(identity) || ![
      value.census_frontier_digest, value.attempt_frontier_digest,
      value.candidate_set_frontier_digest, value.request_digest, value.result_digest,
    ].every(digest)) return false
  return value.result_identity === payload.result_identity
    && (payload.trial_family_identity === undefined
      || value.trial_family_identity === payload.trial_family_identity)
    && (payload.request_identity === undefined || value.request_identity === payload.request_identity)
    && (payload.attempt_identity === undefined || value.attempt_identity === payload.attempt_identity)
}

function validDecisionResponse(value: unknown, payload: Json): boolean {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "decision_identity", "decision_digest", "evidence_cut", "outcome",
    "supported_defects", "receipt_identity", "result_identity", "committed_at_epoch_ms",
  ]) || value.schema_version !== 1 || !identity(value.decision_identity) || !digest(value.decision_digest)
    || !validEvidenceCut(value.evidence_cut, payload) || !object(value.outcome)
    || !exactKeys(value.outcome, ["outcome", "category", "target"])
    || value.outcome.outcome !== "REPAIR_INPUTS" || !categories.has(value.outcome.category)
    || !targets.has(value.outcome.target) || !Array.isArray(value.supported_defects)
    || value.supported_defects.length === 0 || !value.supported_defects.every((entry: unknown) => categories.has(entry))
    || new Set(value.supported_defects).size !== value.supported_defects.length
    || !identity(value.receipt_identity) || !identity(value.result_identity)
    || !timestamp(value.committed_at_epoch_ms)) return false
  return value.result_identity === payload.result_identity
    && (payload.decision_identity === undefined || value.decision_identity === payload.decision_identity)
}

function validRepairActionResponse(value: unknown, payload: Json): boolean {
  return object(value) && exactKeys(value, [
    "schema_version", "action_request_identity", "action_request_digest", "decision_identity",
    "decision_digest", "result_identity", "category", "target", "receipt_identity",
    "receipt_digest", "committed_at_epoch_ms",
  ]) && value.schema_version === 1 && identity(value.action_request_identity)
    && digest(value.action_request_digest) && identity(value.decision_identity)
    && digest(value.decision_digest) && identity(value.result_identity)
    && categories.has(value.category) && targets.has(value.target)
    && identity(value.receipt_identity) && digest(value.receipt_digest)
    && timestamp(value.committed_at_epoch_ms) && value.decision_identity === payload.decision_identity
    && (payload.result_identity === undefined || value.result_identity === payload.result_identity)
    && (payload.action_request_identity === undefined
      || value.action_request_identity === payload.action_request_identity)
}

function validMarketDataResponse(value: unknown, payload: Json): boolean {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "request_identity", "request_digest", "correlation_identity",
    "action_request_identity", "action_request_digest", "decision_identity", "decision_digest",
    "result_identity", "category", "target", "receipt_identity", "receipt_digest",
    "committed_at_epoch_ms", "canonical_request_bytes",
  ]) || value.schema_version !== 1 || !identity(value.request_identity) || !digest(value.request_digest)
    || !byteArray(value.correlation_identity, 32) || !identity(value.action_request_identity)
    || !digest(value.action_request_digest) || !identity(value.decision_identity)
    || !digest(value.decision_digest) || !identity(value.result_identity)
    || value.category !== "MARKET_DATA" || value.target !== "MARKET_DATA"
    || !identity(value.receipt_identity) || !digest(value.receipt_digest)
    || !timestamp(value.committed_at_epoch_ms) || !byteArray(value.canonical_request_bytes)) return false
  try {
    const canonical = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(value.canonical_request_bytes),
    ))
    return object(canonical) && canonical.request_identity === value.request_identity
      && canonical.request_digest === value.request_digest
      && canonical.action_request_identity === payload.action_request_identity
      && canonical.decision_identity === payload.decision_identity
      && canonical.result_identity === payload.result_identity
      && canonical.attempt_identity === payload.attempt_identity
      && canonical.replay_request_identity === payload.replay.request_identity
      && canonical.replay_request_digest === payload.replay.meaning_digest
      && canonical.category === value.category && canonical.target === value.target
      && object(canonical.shared_time_evidence)
      && equalBytes(canonical.shared_time_evidence.head_identity, payload.shared_time_head.head_identity)
      && equalBytes(canonical.shared_time_evidence.head_digest, payload.shared_time_head.head_digest)
      && value.action_request_identity === payload.action_request_identity
      && value.decision_identity === payload.decision_identity && value.result_identity === payload.result_identity
  } catch {
    return false
  }
}

function validRepairedReplayResponse(value: unknown, payload: Json): boolean {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "projection", "locator", "canonical_request_bytes",
  ]) || value.schema_version !== 1 || !object(value.projection) || !replayLocator(value.locator)
    || !byteArray(value.canonical_request_bytes)) return false
  if (!exactKeys(value.projection, [
    "schema_version", "request_identity", "availability", "next_legal_action",
  ]) || value.projection.schema_version !== 1
    || value.projection.request_identity !== value.locator.request_identity
    || value.projection.availability !== "AVAILABLE"
    || value.projection.next_legal_action !== "LOCK_BY_LOCATOR") return false
  try {
    const request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(value.canonical_request_bytes),
    ))
    return validExploratoryReplayRequestV2(request)
      && request.request_identity === value.locator.request_identity
      && request.request_identity !== payload.predecessor_request_locator.request_identity
      && value.locator.meaning_digest !== payload.predecessor_request_locator.meaning_digest
  } catch {
    return false
  }
}

function validResolvedReplay(value: unknown, payload: Json): unknown | null {
  if (!object(value) || !object(value.readback) || !object(value.readback.request)) return null
  const projected = verifyReplayConsumerProjectionV2(
    value, value.readback.request, payload.request_identity, payload.meaning_digest,
  )
  return projected.resolution === "EXPLORATION_ACTIVE" ? projected : null
}

function confirmed(stage: Stage, ownerResult: unknown, nextLegalAction: string) {
  return {
    schema_version: 1,
    stage,
    resolution: "OWNER_CONFIRMED",
    owner_result: ownerResult,
    next_legal_action: nextLegalAction,
  }
}

function unknown(stage: Stage, action: Action) {
  return {
    schema_version: 1,
    stage,
    resolution: "SUBMITTED_OR_UNKNOWN",
    owner_result: null,
    next_legal_action: action === "RUN" ? "REPLAY_SAME_TYPED_REQUEST" : "RESOLVE_SAME_OWNER_LOCATOR",
  }
}

export async function main(action: Action, stage: Stage, payload: unknown) {
  const stages = new Set<Stage>([
    "REPAIR_INPUT_DECISION", "REPAIR_ACTION", "MARKET_DATA_REPAIR", "REPAIRED_REPLAY",
  ])
  const actions = new Set<Action>(["RUN", "RESOLVE"])
  if (!actions.has(action) || !stages.has(stage) || !validPayload(action, stage, payload)) {
    return unknown(stage, action)
  }
  const token = process.env.RD_OWNER_API_TOKEN
  if (!token) return unknown(stage, action)
  const [path, body] = route(action, stage, payload)
  try {
    const result = await ownerPost(path, token, body)
    if (stage === "REPAIR_INPUT_DECISION" && validDecisionResponse(result, payload)) {
      return confirmed(stage, result, "SUBMIT_REPAIR_ACTION")
    }
    if (stage === "REPAIR_ACTION" && validRepairActionResponse(result, payload)) {
      return confirmed(stage, result, "SUBMIT_NATIVE_REPAIR_REQUEST")
    }
    if (stage === "MARKET_DATA_REPAIR" && validMarketDataResponse(result, payload)) {
      return confirmed(stage, result, "WAIT_FOR_MARKET_DATA_TERMINAL")
    }
    if (stage === "REPAIRED_REPLAY") {
      const replay = action === "RUN" ? (validRepairedReplayResponse(result, payload) ? result : null)
        : validResolvedReplay(result, payload)
      if (replay !== null) return confirmed(stage, replay, "EXECUTE_EXPLORATORY_REPLAY")
    }
  } catch {
    // Transport ambiguity never becomes business success.
  }
  return unknown(stage, action)
}
