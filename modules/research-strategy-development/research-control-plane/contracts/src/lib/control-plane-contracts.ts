import { createHash } from "node:crypto"

export const CONTROL_PLANE_IDENTITY_SCHEMA_VERSION = "trade.rd-identity-binding.v1" as const
export const DRAFT_AUTHORIZATION_SCHEMA_VERSION = "trade.rd-draft-authorization.v1" as const
export const STRATEGY_DRAFT_BINDING_SCHEMA_VERSION = "trade.rd-strategy-draft-binding.v1" as const
export const TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION = "trade.rd-trial-reservation-snapshot.v1" as const
export const REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION = "trade.rd-replay-attempt-lease.v1" as const
export const REPLAY_CHECKPOINT_RECEIPT_SCHEMA_VERSION = "trade.rd-replay-checkpoint-receipt.v1" as const
export const REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION = "trade.rd-replay-resume-authorization-snapshot.v1" as const

export interface ResearchIdentityBinding {
  schema_version: typeof CONTROL_PLANE_IDENTITY_SCHEMA_VERSION
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  trial_id: string
  candidate_id: string
  candidate_hash: string
  identity_hash_policy_version: string
  experiment_contract_hash: string
}

export interface ReplayReservationBindings {
  replay_idempotency_key: string
  execution_spec_hash: string
  dataset_manifest_ref: string
  dataset_hash: string
  venue_risk_policy_snapshot_hash: string
  instrument_spec_snapshot_hash: string
  harness_hash: string
  assumptions_hash: string
  cost_policy_hash: string
  margin_policy_hash: string
  simulator_policy_version: string
  execution_mode: "step"
}

export interface TrialReservationSnapshot {
  schema_version: typeof TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION
  reservation_id: string
  reservation_ref: string
  issued_at: string
  status: "reserved"
  identity: ResearchIdentityBinding
  trial_ordinal: number
  run_id: string
  counts_against_budget: boolean
  trial_accounting_policy_version: string
  candidate_assignment_hash: string
  bindings: ReplayReservationBindings
  required_capabilities: string[]
}

export interface ReplayAttemptLeaseSnapshot {
  schema_version: typeof REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  trial_id: string
  run_id: string
  reservation_ref: string
  reservation_hash: string
  request_hash: string
  status: "claimed" | "running"
  lease_generation: number
  claimed_at: string
  heartbeat_at: string
  lease_expires_at: string
}

export interface ReplayResumeAuthorizationSnapshot {
  schema_version: typeof REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION
  authorization_id: string
  authorization_ref: string
  authorization_hash: string
  issued_at: string
  status: "authorized"
  trial_id: string
  run_id: string
  request_hash: string
  reservation_ref: string
  reservation_hash: string
  source_attempt_id: string
  source_attempt_ordinal: number
  source_attempt_status: "cancelled" | "expired"
  diagnostic_checkpoint_ref: string
  diagnostic_checkpoint_hash: string
  target_attempt_id: string
  target_attempt_ordinal: number
  target_worker_id: string
  target_claimed_at: string
  target_lease_generation_floor: number
  target_attempt_lease_hash: string
}

export interface ReplayCheckpointReceiptSnapshot {
  schema_version: typeof REPLAY_CHECKPOINT_RECEIPT_SCHEMA_VERSION
  receipt_id: string
  receipt_ref: string
  receipt_hash: string
  recorded_at: string
  status: "recorded"
  trial_id: string
  run_id: string
  request_hash: string
  reservation_ref: string
  reservation_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  attempt_lease_hash: string
  diagnostic_checkpoint_ref: string
  diagnostic_checkpoint_hash: string
  engine_checkpoint_ref: string
  engine_checkpoint_payload_hash: string
  engine_checkpoint_hash: string
  next_source_offset: number
}

export type ReplayCheckpointReceiptBody = Omit<ReplayCheckpointReceiptSnapshot, "receipt_hash">
export type ReplayResumeAuthorizationBody = Omit<ReplayResumeAuthorizationSnapshot, "authorization_hash">

export interface DraftStrategyAuthorization {
  schema_version: typeof DRAFT_AUTHORIZATION_SCHEMA_VERSION
  decision: "accept_for_draft"
  decision_id: string
  reviewer_run_id: string
  primary_result_id: string
  primary_result_hash: string
  selected_trial_id: string
  selected_candidate_id: string
  candidate_frozen_at: string
  identity: ResearchIdentityBinding
}

export interface StrategyDraftBinding {
  schema_version: typeof STRATEGY_DRAFT_BINDING_SCHEMA_VERSION
  draft_id: string
  strategy_id: string
  strategy_version: string
  strategy_ref: string
  strategy_policy_hash: string
  materialization_status: "ready"
  created_at: string
  authorization: DraftStrategyAuthorization
}

export function assertResearchIdentityBinding(value: ResearchIdentityBinding): void {
  assertIdentityFields(value)
}

export function assertTrialReservationSnapshot(value: TrialReservationSnapshot): void {
  if (value.schema_version !== TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION) fail("reservation schema_version")
  requireText(value.reservation_id, "reservation.reservation_id")
  requireText(value.reservation_ref, "reservation.reservation_ref")
  requireUtcTimestamp(value.issued_at, "reservation.issued_at")
  if (value.status !== "reserved") fail("reservation status must be reserved")
  assertIdentityFields(value.identity)
  if (!Number.isSafeInteger(value.trial_ordinal) || value.trial_ordinal < 1) fail("reservation.trial_ordinal must be positive")
  requireText(value.run_id, "reservation.run_id")
  if (typeof value.counts_against_budget !== "boolean") fail("reservation.counts_against_budget must be boolean")
  requireText(value.trial_accounting_policy_version, "reservation.trial_accounting_policy_version")
  requireHash(value.candidate_assignment_hash, "reservation.candidate_assignment_hash")
  const bindings = value.bindings
  for (const [field, binding] of Object.entries({
    replay_idempotency_key: bindings.replay_idempotency_key,
    dataset_manifest_ref: bindings.dataset_manifest_ref,
    simulator_policy_version: bindings.simulator_policy_version,
  })) requireText(binding, `reservation.bindings.${field}`)
  for (const [field, binding] of Object.entries({
    execution_spec_hash: bindings.execution_spec_hash,
    dataset_hash: bindings.dataset_hash,
    venue_risk_policy_snapshot_hash: bindings.venue_risk_policy_snapshot_hash,
    instrument_spec_snapshot_hash: bindings.instrument_spec_snapshot_hash,
    harness_hash: bindings.harness_hash,
    assumptions_hash: bindings.assumptions_hash,
    cost_policy_hash: bindings.cost_policy_hash,
    margin_policy_hash: bindings.margin_policy_hash,
  })) requireHash(binding, `reservation.bindings.${field}`)
  if (bindings.execution_mode !== "step") fail("reservation only supports step execution")
  if (!Array.isArray(value.required_capabilities) || value.required_capabilities.length === 0) {
    fail("reservation.required_capabilities must not be empty")
  }
  const capabilities = value.required_capabilities.map((capability, index) => requireText(capability, `reservation.required_capabilities[${index}]`))
  const normalized = [...new Set(capabilities)].sort()
  if (normalized.length !== capabilities.length || normalized.some((capability, index) => capability !== capabilities[index])) {
    fail("reservation.required_capabilities must be unique and sorted")
  }
}

export function hashTrialReservationSnapshot(value: TrialReservationSnapshot): string {
  assertTrialReservationSnapshot(value)
  return createHash("sha256").update(canonicalReservationJson(value), "utf8").digest("hex")
}

export function assertReplayAttemptLeaseSnapshot(value: ReplayAttemptLeaseSnapshot): void {
  if (value.schema_version !== REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION) fail("attempt lease schema_version")
  requireText(value.attempt_id, "attempt.attempt_id")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1) fail("attempt.attempt_ordinal must be positive")
  requireText(value.worker_id, "attempt.worker_id")
  requireText(value.trial_id, "attempt.trial_id")
  requireText(value.run_id, "attempt.run_id")
  requireText(value.reservation_ref, "attempt.reservation_ref")
  requireHash(value.reservation_hash, "attempt.reservation_hash")
  requireHash(value.request_hash, "attempt.request_hash")
  if (value.status !== "claimed" && value.status !== "running") fail("attempt status must be claimed or running")
  if (!Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) fail("attempt.lease_generation must be positive")
  requireUtcTimestamp(value.claimed_at, "attempt.claimed_at")
  requireUtcTimestamp(value.heartbeat_at, "attempt.heartbeat_at")
  requireUtcTimestamp(value.lease_expires_at, "attempt.lease_expires_at")
  const claimed = Date.parse(value.claimed_at)
  const heartbeat = Date.parse(value.heartbeat_at)
  const expires = Date.parse(value.lease_expires_at)
  if (heartbeat < claimed || expires <= heartbeat) fail("attempt lease timestamps must satisfy claimed_at <= heartbeat_at < lease_expires_at")
}

export function hashReplayAttemptLeaseSnapshot(value: ReplayAttemptLeaseSnapshot): string {
  assertReplayAttemptLeaseSnapshot(value)
  return createHash("sha256").update(canonicalReservationJson(value), "utf8").digest("hex")
}

export function assertReplayCheckpointReceiptSnapshot(value: ReplayCheckpointReceiptSnapshot): void {
  if (value.schema_version !== REPLAY_CHECKPOINT_RECEIPT_SCHEMA_VERSION) fail("checkpoint receipt schema_version")
  for (const [field, item] of Object.entries({
    receipt_id: value.receipt_id,
    receipt_ref: value.receipt_ref,
    trial_id: value.trial_id,
    run_id: value.run_id,
    reservation_ref: value.reservation_ref,
    attempt_id: value.attempt_id,
    worker_id: value.worker_id,
    diagnostic_checkpoint_ref: value.diagnostic_checkpoint_ref,
    engine_checkpoint_ref: value.engine_checkpoint_ref,
  })) requireText(item, `checkpoint_receipt.${field}`)
  for (const [field, item] of Object.entries({
    receipt_hash: value.receipt_hash,
    request_hash: value.request_hash,
    reservation_hash: value.reservation_hash,
    attempt_lease_hash: value.attempt_lease_hash,
    diagnostic_checkpoint_hash: value.diagnostic_checkpoint_hash,
    engine_checkpoint_payload_hash: value.engine_checkpoint_payload_hash,
    engine_checkpoint_hash: value.engine_checkpoint_hash,
  })) requireHash(item, `checkpoint_receipt.${field}`)
  requireUtcTimestamp(value.recorded_at, "checkpoint_receipt.recorded_at")
  if (value.status !== "recorded") fail("checkpoint receipt status must be recorded")
  for (const [field, item] of Object.entries({
    attempt_ordinal: value.attempt_ordinal,
    lease_generation: value.lease_generation,
    next_source_offset: value.next_source_offset,
  })) {
    if (!Number.isSafeInteger(item) || item < 1) fail(`checkpoint_receipt.${field} must be positive`)
  }
  const { receipt_hash: receiptHash, ...body } = value
  if (receiptHash !== createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")) {
    fail("checkpoint receipt hash mismatch")
  }
}

export function createReplayCheckpointReceiptSnapshot(
  body: ReplayCheckpointReceiptBody,
): ReplayCheckpointReceiptSnapshot {
  const value: ReplayCheckpointReceiptSnapshot = {
    ...body,
    receipt_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayCheckpointReceiptSnapshot(value)
  return value
}

export function hashReplayCheckpointReceiptSnapshot(value: ReplayCheckpointReceiptSnapshot): string {
  assertReplayCheckpointReceiptSnapshot(value)
  return value.receipt_hash
}

export function assertReplayResumeAuthorizationSnapshot(value: ReplayResumeAuthorizationSnapshot): void {
  if (value.schema_version !== REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION) fail("resume authorization schema_version")
  for (const [field, item] of Object.entries({
    authorization_id: value.authorization_id,
    authorization_ref: value.authorization_ref,
    trial_id: value.trial_id,
    run_id: value.run_id,
    reservation_ref: value.reservation_ref,
    source_attempt_id: value.source_attempt_id,
    diagnostic_checkpoint_ref: value.diagnostic_checkpoint_ref,
    target_attempt_id: value.target_attempt_id,
    target_worker_id: value.target_worker_id,
  })) requireText(item, `resume_authorization.${field}`)
  for (const [field, item] of Object.entries({
    authorization_hash: value.authorization_hash,
    request_hash: value.request_hash,
    reservation_hash: value.reservation_hash,
    diagnostic_checkpoint_hash: value.diagnostic_checkpoint_hash,
    target_attempt_lease_hash: value.target_attempt_lease_hash,
  })) requireHash(item, `resume_authorization.${field}`)
  requireUtcTimestamp(value.issued_at, "resume_authorization.issued_at")
  requireUtcTimestamp(value.target_claimed_at, "resume_authorization.target_claimed_at")
  if (value.status !== "authorized") fail("resume authorization status must be authorized")
  if (value.source_attempt_status !== "cancelled" && value.source_attempt_status !== "expired") {
    fail("resume authorization source Attempt must be cancelled or expired")
  }
  for (const [field, item] of Object.entries({
    source_attempt_ordinal: value.source_attempt_ordinal,
    target_attempt_ordinal: value.target_attempt_ordinal,
    target_lease_generation_floor: value.target_lease_generation_floor,
  })) {
    if (!Number.isSafeInteger(item) || item < 1) fail(`resume_authorization.${field} must be positive`)
  }
  if (value.source_attempt_id === value.target_attempt_id
      || value.target_attempt_ordinal <= value.source_attempt_ordinal) {
    fail("resume authorization target Attempt must be a later Attempt")
  }
  const { authorization_hash: authorizationHash, ...body } = value
  if (authorizationHash !== createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex")) {
    fail("resume authorization hash mismatch")
  }
}

export function createReplayResumeAuthorizationSnapshot(
  body: ReplayResumeAuthorizationBody,
): ReplayResumeAuthorizationSnapshot {
  const value: ReplayResumeAuthorizationSnapshot = {
    ...body,
    authorization_hash: createHash("sha256").update(canonicalReservationJson(body), "utf8").digest("hex"),
  }
  assertReplayResumeAuthorizationSnapshot(value)
  return value
}

export function hashReplayResumeAuthorizationSnapshot(value: ReplayResumeAuthorizationSnapshot): string {
  assertReplayResumeAuthorizationSnapshot(value)
  return value.authorization_hash
}

export function assertDraftStrategyAuthorization(value: DraftStrategyAuthorization): void {
  if (value.schema_version !== DRAFT_AUTHORIZATION_SCHEMA_VERSION) fail("authorization schema_version")
  if (value.decision !== "accept_for_draft") fail("authorization decision")
  requireText(value.decision_id, "authorization.decision_id")
  requireText(value.reviewer_run_id, "authorization.reviewer_run_id")
  requireText(value.primary_result_id, "authorization.primary_result_id")
  requireHash(value.primary_result_hash, "authorization.primary_result_hash")
  requireText(value.selected_trial_id, "authorization.selected_trial_id")
  requireText(value.selected_candidate_id, "authorization.selected_candidate_id")
  requireTimestamp(value.candidate_frozen_at, "authorization.candidate_frozen_at")
  assertIdentityFields(value.identity)
  if (value.selected_trial_id !== value.identity.trial_id) fail("selected Trial does not match identity")
  if (value.selected_candidate_id !== value.identity.candidate_id) fail("selected Candidate does not match identity")
}

export function assertStrategyDraftBinding(value: StrategyDraftBinding): void {
  if (value.schema_version !== STRATEGY_DRAFT_BINDING_SCHEMA_VERSION) fail("draft binding schema_version")
  requireText(value.draft_id, "draft_id")
  requireText(value.strategy_id, "strategy_id")
  requireText(value.strategy_version, "strategy_version")
  requireText(value.strategy_ref, "strategy_ref")
  requireHash(value.strategy_policy_hash, "strategy_policy_hash")
  if (value.materialization_status !== "ready") fail("draft is not ready")
  requireTimestamp(value.created_at, "created_at")
  assertDraftStrategyAuthorization(value.authorization)
}

function assertIdentityFields(value: ResearchIdentityBinding): void {
  if (value.schema_version !== CONTROL_PLANE_IDENTITY_SCHEMA_VERSION) fail("identity schema_version")
  requireText(value.experiment_id, "identity.experiment_id")
  requireText(value.trial_group_id, "identity.trial_group_id")
  requireHash(value.trial_group_hash, "identity.trial_group_hash")
  requireText(value.trial_id, "identity.trial_id")
  requireText(value.candidate_id, "identity.candidate_id")
  requireHash(value.candidate_hash, "identity.candidate_hash")
  requireText(value.identity_hash_policy_version, "identity.identity_hash_policy_version")
  requireHash(value.experiment_contract_hash, "identity.experiment_contract_hash")
}

function requireHash(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) fail(`${field} must be a lowercase sha256 hex digest`)
}

function requireTimestamp(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!Number.isFinite(Date.parse(text))) fail(`${field} must be an ISO timestamp`)
}

function requireUtcTimestamp(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text) || !Number.isFinite(Date.parse(text))) {
    fail(`${field} must be an RFC 3339 UTC timestamp`)
  }
}

function canonicalReservationJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"))
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("reservation hash rejects non-finite numbers")
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalReservationJson).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .map((source) => ({ source, normalized: source.normalize("NFC") }))
      .sort((left, right) => left.normalized < right.normalized ? -1 : left.normalized > right.normalized ? 1 : 0)
    if (new Set(entries.map((entry) => entry.normalized)).size !== entries.length) fail("reservation hash key collision after NFC normalization")
    return `{${entries.map((entry) => `${JSON.stringify(entry.normalized)}:${canonicalReservationJson(record[entry.source])}`).join(",")}}`
  }
  fail("reservation hash rejects unsupported values")
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${field} is required`)
  return value.trim()
}

function fail(message: string): never {
  throw new Error(message)
}
