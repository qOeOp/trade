import {
  REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION,
  canonicalHash,
  type ReplayDecisionHarnessContext,
} from "./replay-contracts"

export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_SCHEMA_VERSION = "trade.rd-replay-source-event-decision-observation-harness-context-binding.v1" as const
export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_ENTRY_SCHEMA_VERSION = "trade.rd-replay-source-event-decision-observation-harness-context-binding-entry.v1" as const
export const REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_POLICY_VERSION = "rd-replay-source-event-decision-observation-harness-context-binding-v1" as const

export interface ReplaySourceEventDecisionObservationHarnessContextBindingEntry {
  schema_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_ENTRY_SCHEMA_VERSION
  decision_sequence: number
  decision_time: string
  selected_expected_effect: string
  selected_schedule_entry_hash: string
  schedule_binding_id: string
  schedule_binding_hash: string
  observation_projection_id: string
  observation_projection_hash: string
  observation_as_of_time: string
  observation_count: number
  observations_hash: string
  observation_values_hash: string
  visibility_cut_hash: string
  pit_payload_view_hash: string
  harness_hash: string
  harness_context: ReplayDecisionHarnessContext
  harness_context_hash: string
  entry_hash: string
}

export type ReplaySourceEventDecisionObservationHarnessContextBindingEntryBody = Omit<
  ReplaySourceEventDecisionObservationHarnessContextBindingEntry,
  "entry_hash"
>

export interface ReplaySourceEventDecisionObservationHarnessContextBinding {
  schema_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_SCHEMA_VERSION
  binding_id: string
  binding_hash: string
  binding_policy_version: typeof REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_POLICY_VERSION
  scope: "pre_integration_non_economic_observation_harness_context_binding"
  binding_purpose: "bind_admitted_observation_boundaries_to_frozen_harness_context_identity"
  authority_source: "control_plane_derivation_admission"
  context_derivation: "canonical_request_and_schedule_entry"
  observation_binding: "admitted_bundle_member_identity_only"
  decision_input_materialization: "not_certified"
  supplemental_input_compatibility: "not_bound"
  market_input_compatibility: "not_bound"
  state_input_compatibility: "not_bound"
  worker_request_compatibility: "not_bound"
  harness_invocation: "forbidden"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  runner_compatibility: "not_bound"
  request_schema_version: "trade.rd-replay-execution-request.v38"
  request_hash: string
  run_id: string
  experiment_id: string
  trial_group_id: string
  trial_id: string
  candidate_id: string
  candidate_hash: string
  reservation_ref: string
  reservation_hash: string
  dataset_manifest_ref: string
  dataset_hash: string
  derivation_admission_id: string
  derivation_admission_ref: string
  derivation_admission_hash: string
  bundle_id: string
  bundle_hash: string
  decision_schedule_hash: string
  harness_hash: string
  harness_context_schema_version: typeof REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION
  entry_count: number
  entries: ReplaySourceEventDecisionObservationHarnessContextBindingEntry[]
  entries_hash: string
  entry_hashes_hash: string
  harness_context_hashes_hash: string
  observation_projection_hashes_hash: string
  first_decision_time: string
  last_decision_time: string
}

export type ReplaySourceEventDecisionObservationHarnessContextBindingBody = Omit<
  ReplaySourceEventDecisionObservationHarnessContextBinding,
  "binding_hash"
>

export function createReplaySourceEventDecisionObservationHarnessContextBindingEntry(
  body: ReplaySourceEventDecisionObservationHarnessContextBindingEntryBody,
): ReplaySourceEventDecisionObservationHarnessContextBindingEntry {
  const value = { ...structuredClone(body), entry_hash: canonicalHash(body) }
  assertReplaySourceEventDecisionObservationHarnessContextBindingEntry(value)
  return value
}

export function createReplaySourceEventDecisionObservationHarnessContextBinding(
  body: ReplaySourceEventDecisionObservationHarnessContextBindingBody,
): ReplaySourceEventDecisionObservationHarnessContextBinding {
  const value = { ...structuredClone(body), binding_hash: canonicalHash(body) }
  assertReplaySourceEventDecisionObservationHarnessContextBinding(value)
  return value
}

export function assertReplaySourceEventDecisionObservationHarnessContextBindingEntry(
  value: ReplaySourceEventDecisionObservationHarnessContextBindingEntry,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_ENTRY_SCHEMA_VERSION) {
    throw new Error("unsupported observation Harness Context binding entry schema")
  }
  assertExactFields(value, ENTRY_FIELDS, "observation Harness Context binding entry")
  for (const item of [
    value.selected_expected_effect,
    value.schedule_binding_id,
    value.observation_projection_id,
  ]) requireText(item, "observation Harness Context binding entry identity")
  for (const [field, item] of Object.entries({
    selected_schedule_entry_hash: value.selected_schedule_entry_hash,
    schedule_binding_hash: value.schedule_binding_hash,
    observation_projection_hash: value.observation_projection_hash,
    observations_hash: value.observations_hash,
    observation_values_hash: value.observation_values_hash,
    visibility_cut_hash: value.visibility_cut_hash,
    pit_payload_view_hash: value.pit_payload_view_hash,
    harness_hash: value.harness_hash,
    harness_context_hash: value.harness_context_hash,
    entry_hash: value.entry_hash,
  })) requireHash(item, `observation Harness Context binding entry ${field}`)
  requireUtc(value.decision_time, "observation Harness Context binding entry decision time")
  requireUtc(value.observation_as_of_time, "observation Harness Context binding entry observation time")
  if (!Number.isSafeInteger(value.decision_sequence) || value.decision_sequence < 1) {
    throw new Error("observation Harness Context binding entry sequence is invalid")
  }
  if (!Number.isSafeInteger(value.observation_count) || value.observation_count < 0) {
    throw new Error("observation Harness Context binding entry observation count is invalid")
  }
  assertHarnessContext(value.harness_context)
  if (value.decision_sequence !== value.harness_context.decision_sequence
      || value.decision_time !== value.harness_context.decision_time
      || value.decision_time !== value.observation_as_of_time
      || value.harness_context_hash !== canonicalHash(value.harness_context)) {
    throw new Error("observation Harness Context binding entry context/time drift")
  }
  const { entry_hash: entryHash, ...body } = value
  if (entryHash !== canonicalHash(body)) {
    throw new Error("observation Harness Context binding entry hash mismatch")
  }
}

export function assertReplaySourceEventDecisionObservationHarnessContextBinding(
  value: ReplaySourceEventDecisionObservationHarnessContextBinding,
): void {
  if (value.schema_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_SCHEMA_VERSION
      || value.binding_policy_version !== REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_POLICY_VERSION
      || value.scope !== "pre_integration_non_economic_observation_harness_context_binding"
      || value.binding_purpose !== "bind_admitted_observation_boundaries_to_frozen_harness_context_identity"
      || value.authority_source !== "control_plane_derivation_admission"
      || value.context_derivation !== "canonical_request_and_schedule_entry"
      || value.observation_binding !== "admitted_bundle_member_identity_only"
      || value.decision_input_materialization !== "not_certified"
      || value.supplemental_input_compatibility !== "not_bound"
      || value.market_input_compatibility !== "not_bound"
      || value.state_input_compatibility !== "not_bound"
      || value.worker_request_compatibility !== "not_bound"
      || value.harness_invocation !== "forbidden"
      || value.decision_output_authority !== "none"
      || value.signal_authority !== "none"
      || value.order_authority !== "none"
      || value.economic_authority !== "none"
      || value.runner_compatibility !== "not_bound"
      || value.request_schema_version !== "trade.rd-replay-execution-request.v38"
      || value.harness_context_schema_version !== REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION) {
    throw new Error("unsupported observation Harness Context binding authority")
  }
  assertExactFields(value, BINDING_FIELDS, "observation Harness Context binding")
  for (const item of [
    value.binding_id,
    value.run_id,
    value.experiment_id,
    value.trial_group_id,
    value.trial_id,
    value.candidate_id,
    value.reservation_ref,
    value.dataset_manifest_ref,
    value.derivation_admission_id,
    value.derivation_admission_ref,
    value.bundle_id,
  ]) requireText(item, "observation Harness Context binding identity")
  for (const [field, item] of Object.entries({
    binding_hash: value.binding_hash,
    request_hash: value.request_hash,
    candidate_hash: value.candidate_hash,
    reservation_hash: value.reservation_hash,
    dataset_hash: value.dataset_hash,
    derivation_admission_hash: value.derivation_admission_hash,
    bundle_hash: value.bundle_hash,
    decision_schedule_hash: value.decision_schedule_hash,
    harness_hash: value.harness_hash,
    entries_hash: value.entries_hash,
    entry_hashes_hash: value.entry_hashes_hash,
    harness_context_hashes_hash: value.harness_context_hashes_hash,
    observation_projection_hashes_hash: value.observation_projection_hashes_hash,
  })) requireHash(item, `observation Harness Context binding ${field}`)
  requireUtc(value.first_decision_time, "observation Harness Context binding first decision time")
  requireUtc(value.last_decision_time, "observation Harness Context binding last decision time")
  if (!Number.isSafeInteger(value.entry_count)
      || value.entry_count < 1
      || value.entry_count !== value.entries.length) {
    throw new Error("observation Harness Context binding cardinality drift")
  }
  let priorTime = Number.NEGATIVE_INFINITY
  for (const [index, entry] of value.entries.entries()) {
    assertReplaySourceEventDecisionObservationHarnessContextBindingEntry(entry)
    const decisionTime = Date.parse(entry.decision_time)
    if (entry.decision_sequence !== index + 1 || decisionTime <= priorTime) {
      throw new Error("observation Harness Context binding entry order drift")
    }
    if (entry.harness_hash !== value.harness_hash
        || entry.harness_context.run_id !== value.run_id
        || entry.harness_context.experiment_id !== value.experiment_id
        || entry.harness_context.trial_group_id !== value.trial_group_id
        || entry.harness_context.trial_id !== value.trial_id
        || entry.harness_context.candidate_id !== value.candidate_id
        || entry.harness_context.candidate_hash !== value.candidate_hash) {
      throw new Error("observation Harness Context binding member identity drift")
    }
    priorTime = decisionTime
  }
  if (value.first_decision_time !== value.entries[0]!.decision_time
      || value.last_decision_time !== value.entries.at(-1)!.decision_time
      || value.entries_hash !== canonicalHash(value.entries)
      || value.entry_hashes_hash !== canonicalHash(value.entries.map((item) => item.entry_hash))
      || value.harness_context_hashes_hash !== canonicalHash(value.entries.map((item) => item.harness_context_hash))
      || value.observation_projection_hashes_hash
        !== canonicalHash(value.entries.map((item) => item.observation_projection_hash))) {
    throw new Error("observation Harness Context binding fold drift")
  }
  const { binding_hash: bindingHash, ...body } = value
  const { binding_id: bindingId, ...bodyWithoutId } = body
  if (bindingId !== `source-event-observation-harness-context-${canonicalHash(bodyWithoutId).slice(0, 24)}`) {
    throw new Error("observation Harness Context binding identity mismatch")
  }
  if (bindingHash !== canonicalHash(body)) {
    throw new Error("observation Harness Context binding hash mismatch")
  }
}

const ENTRY_FIELDS = [
  "decision_sequence", "decision_time", "entry_hash", "harness_context",
  "harness_context_hash", "harness_hash", "observation_as_of_time", "observation_count",
  "observation_projection_hash", "observation_projection_id", "observation_values_hash",
  "observations_hash", "pit_payload_view_hash", "schedule_binding_hash", "schedule_binding_id",
  "schema_version", "selected_expected_effect", "selected_schedule_entry_hash",
  "visibility_cut_hash",
].sort()

const BINDING_FIELDS = [
  "authority_source", "binding_hash", "binding_id", "binding_policy_version",
  "binding_purpose", "bundle_hash", "bundle_id", "candidate_hash", "candidate_id",
  "context_derivation", "dataset_hash", "dataset_manifest_ref", "decision_input_materialization",
  "decision_output_authority", "decision_schedule_hash", "derivation_admission_hash",
  "derivation_admission_id", "derivation_admission_ref", "economic_authority", "entries",
  "entries_hash", "entry_count", "entry_hashes_hash", "experiment_id", "first_decision_time",
  "harness_context_hashes_hash", "harness_context_schema_version", "harness_hash",
  "harness_invocation", "last_decision_time", "market_input_compatibility",
  "observation_binding", "observation_projection_hashes_hash", "order_authority",
  "request_hash", "request_schema_version", "reservation_hash", "reservation_ref",
  "run_id", "runner_compatibility", "schema_version", "scope", "signal_authority",
  "state_input_compatibility", "supplemental_input_compatibility", "trial_group_id",
  "trial_id", "worker_request_compatibility",
].sort()

const HARNESS_CONTEXT_FIELDS = [
  "candidate_hash", "candidate_id", "decision_phase", "decision_sequence", "decision_time",
  "earliest_executable_time", "experiment_id", "random_seed", "run_id", "schema_version",
  "strategy_policy_hash", "symbol", "timeframe", "trial_group_id", "trial_id",
].sort()

function assertHarnessContext(value: ReplayDecisionHarnessContext): void {
  assertExactFields(value, HARNESS_CONTEXT_FIELDS, "observation Harness Context")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION
      || !["pre_entry", "initial_entry", "pending_entry", "position_open"].includes(value.decision_phase)) {
    throw new Error("unsupported observation Harness Context")
  }
  for (const item of [
    value.run_id, value.experiment_id, value.trial_group_id, value.trial_id, value.candidate_id,
    value.symbol, value.timeframe,
  ]) requireText(item, "observation Harness Context identity")
  requireHash(value.candidate_hash, "observation Harness Context candidate hash")
  requireUtc(value.decision_time, "observation Harness Context decision time")
  if (value.earliest_executable_time !== null) {
    requireUtc(value.earliest_executable_time, "observation Harness Context earliest executable time")
  }
  if (!Number.isSafeInteger(value.decision_sequence) || value.decision_sequence < 1
      || !Number.isSafeInteger(value.random_seed) || value.random_seed < 0) {
    throw new Error("observation Harness Context sequence/seed is invalid")
  }
  if (value.strategy_policy_hash !== null) {
    requireHash(value.strategy_policy_hash, "observation Harness Context strategy policy hash")
  }
}

function assertExactFields(value: object, expected: string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) {
    throw new Error(`${label} field whitelist drift`)
  }
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`)
}

function requireHash(value: unknown, label: string): asserts value is string {
  requireText(value, label)
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a lowercase sha256 hex digest`)
}

function requireUtc(value: unknown, label: string): asserts value is string {
  requireText(value, label)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
      || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be RFC 3339 UTC`)
  }
}
