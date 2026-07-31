import {
  assertReplayDecisionInputSnapshot,
  assertReplayDecisionMarketInputSnapshot,
  canonicalHash,
  type ReplayDecisionHarnessContext,
  type ReplayDecisionInputSnapshot,
  type ReplayDecisionMarketInputSnapshot,
} from "./replay-contracts"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_SCHEMA_VERSION = "trade.rd-replay-decision-worker-input-assembly.v2" as const
export const REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_ENTRY_SCHEMA_VERSION = "trade.rd-replay-decision-worker-input-assembly-entry.v2" as const
export const REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_POLICY_VERSION = "rd-replay-decision-worker-input-assembly-v2" as const

export interface ReplayDecisionWorkerInputAssemblyV2Entry {
  schema_version: typeof REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_ENTRY_SCHEMA_VERSION
  decision_sequence: number
  decision_time: string
  decision_phase: "pre_entry" | "initial_entry" | "pending_entry" | "position_open"
  harness_context_binding_entry_hash: string
  harness_context: ReplayDecisionHarnessContext
  harness_context_hash: string
  supplemental_input_source: "r4_97_empty_input_materialization" | "r4_98_initial_signal_materialization"
  decision_input_snapshot: ReplayDecisionInputSnapshot
  decision_input_snapshot_hash: string
  market_input_source: "r4_100_market_input_materialization"
  decision_market_input_snapshot: ReplayDecisionMarketInputSnapshot
  decision_market_input_snapshot_hash: string
  r4_97_embedded_market_compatibility: "exact_snapshot_match" | "not_applicable_nonempty_supplemental"
  state_input_status: "not_applicable_non_position_phase" | "runtime_state_required_not_materialized"
  decision_state_snapshot: null
  input_tuple_status: "complete_non_executable_build_unbound" | "incomplete_runtime_state_snapshot"
  worker_request: null
  harness_invocation: "forbidden"
  execution_effect: "none"
  entry_hash: string
}

export type ReplayDecisionWorkerInputAssemblyV2EntryBody = Omit<ReplayDecisionWorkerInputAssemblyV2Entry, "entry_hash">

export interface ReplayDecisionWorkerInputAssemblyV2 {
  schema_version: typeof REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_SCHEMA_VERSION
  assembly_id: string
  assembly_hash: string
  assembly_policy_version: typeof REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_POLICY_VERSION
  scope: "pre_worker_non_economic_complete_input_tuple_assembly"
  purpose: "bind_context_supplemental_and_market_snapshots_without_creating_worker_request"
  parent_validation: "self_hash_and_cross_object_binding_only"
  source_bundle_binding: "not_bound"
  build_attestation_binding: "not_bound"
  invocation_identity_materialization: "forbidden"
  worker_request_materialization: "forbidden"
  harness_invocation: "forbidden"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  runner_compatibility: "not_bound"
  request_hash: string
  run_id: string
  experiment_id: string
  trial_group_id: string
  trial_id: string
  candidate_id: string
  candidate_hash: string
  harness_context_binding_id: string
  harness_context_binding_hash: string
  observation_input_materialization_id: string | null
  observation_input_materialization_hash: string | null
  initial_signal_supplemental_materialization_id: string | null
  initial_signal_supplemental_materialization_hash: string | null
  market_input_materialization_id: string
  market_input_materialization_hash: string
  supplemental_source_policy: "exactly_one_request_bound_r4_97_or_r4_98_materialization"
  market_source_policy: "required_same_request_context_bound_r4_100_materialization"
  r4_97_embedded_market_policy: "require_exact_match_then_use_r4_100"
  entry_count: number
  entries: ReplayDecisionWorkerInputAssemblyV2Entry[]
  entries_hash: string
  entry_hashes_hash: string
  complete_entry_count: number
  incomplete_state_entry_count: number
  missing_market_entry_count: 0
  worker_request_count: 0
}

export type ReplayDecisionWorkerInputAssemblyV2Body = Omit<ReplayDecisionWorkerInputAssemblyV2, "assembly_hash">

export function createReplayDecisionWorkerInputAssemblyV2Entry(
  body: ReplayDecisionWorkerInputAssemblyV2EntryBody,
): ReplayDecisionWorkerInputAssemblyV2Entry {
  const value = { ...structuredClone(body), entry_hash: canonicalHash(body) }
  assertReplayDecisionWorkerInputAssemblyV2Entry(value)
  return value
}

export function createReplayDecisionWorkerInputAssemblyV2(
  body: ReplayDecisionWorkerInputAssemblyV2Body,
): ReplayDecisionWorkerInputAssemblyV2 {
  const value = { ...structuredClone(body), assembly_hash: canonicalHash(body) }
  assertReplayDecisionWorkerInputAssemblyV2(value)
  return value
}

export function assertReplayDecisionWorkerInputAssemblyV2Entry(
  value: ReplayDecisionWorkerInputAssemblyV2Entry,
): void {
  assertFields(value, ENTRY_FIELDS, "decision Worker input assembly v2 entry")
  if (value.schema_version !== REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_ENTRY_SCHEMA_VERSION
      || value.market_input_source !== "r4_100_market_input_materialization"
      || !["r4_97_empty_input_materialization", "r4_98_initial_signal_materialization"].includes(value.supplemental_input_source)
      || value.decision_state_snapshot !== null || value.worker_request !== null
      || value.harness_invocation !== "forbidden" || value.execution_effect !== "none") {
    throw new Error("unsupported decision Worker input assembly v2 entry authority")
  }
  requireUtc(value.decision_time, "decision Worker input assembly v2 decision time")
  for (const item of [value.harness_context_binding_entry_hash, value.harness_context_hash,
    value.decision_input_snapshot_hash, value.decision_market_input_snapshot_hash, value.entry_hash]) {
    requireHash(item, "decision Worker input assembly v2 entry hash")
  }
  if (!Number.isSafeInteger(value.decision_sequence) || value.decision_sequence < 1
      || !["pre_entry", "initial_entry", "pending_entry", "position_open"].includes(value.decision_phase)) {
    throw new Error("decision Worker input assembly v2 sequence or phase is invalid")
  }
  assertReplayDecisionInputSnapshot(value.decision_input_snapshot)
  assertReplayDecisionMarketInputSnapshot(value.decision_market_input_snapshot)
  const stateMissing = value.decision_phase === "position_open"
  const expectedCompatibility = value.supplemental_input_source === "r4_97_empty_input_materialization"
    ? "exact_snapshot_match" : "not_applicable_nonempty_supplemental"
  if (value.harness_context.decision_sequence !== value.decision_sequence
      || value.harness_context.decision_time !== value.decision_time
      || value.harness_context.decision_phase !== value.decision_phase
      || value.harness_context_hash !== canonicalHash(value.harness_context)
      || value.decision_input_snapshot.run_id !== value.harness_context.run_id
      || value.decision_input_snapshot.decision_time !== value.decision_time
      || value.decision_input_snapshot.snapshot_hash !== value.decision_input_snapshot_hash
      || value.decision_market_input_snapshot.run_id !== value.harness_context.run_id
      || value.decision_market_input_snapshot.decision_time !== value.decision_time
      || value.decision_market_input_snapshot.snapshot_hash !== value.decision_market_input_snapshot_hash
      || value.r4_97_embedded_market_compatibility !== expectedCompatibility
      || stateMissing !== (value.state_input_status === "runtime_state_required_not_materialized")
      || value.input_tuple_status !== (stateMissing
        ? "incomplete_runtime_state_snapshot" : "complete_non_executable_build_unbound")) {
    throw new Error("decision Worker input assembly v2 entry semantic drift")
  }
  const { entry_hash: entryHash, ...body } = value
  if (entryHash !== canonicalHash(body)) throw new Error("decision Worker input assembly v2 entry hash mismatch")
}

export function assertReplayDecisionWorkerInputAssemblyV2(value: ReplayDecisionWorkerInputAssemblyV2): void {
  assertFields(value, ASSEMBLY_FIELDS, "decision Worker input assembly v2")
  if (value.schema_version !== REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_SCHEMA_VERSION
      || value.assembly_policy_version !== REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_POLICY_VERSION
      || value.scope !== "pre_worker_non_economic_complete_input_tuple_assembly"
      || value.purpose !== "bind_context_supplemental_and_market_snapshots_without_creating_worker_request"
      || value.parent_validation !== "self_hash_and_cross_object_binding_only"
      || value.source_bundle_binding !== "not_bound" || value.build_attestation_binding !== "not_bound"
      || value.invocation_identity_materialization !== "forbidden"
      || value.worker_request_materialization !== "forbidden" || value.harness_invocation !== "forbidden"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.runner_compatibility !== "not_bound" || value.missing_market_entry_count !== 0
      || value.worker_request_count !== 0) {
    throw new Error("unsupported decision Worker input assembly v2 authority")
  }
  for (const item of [value.assembly_id, value.run_id, value.experiment_id, value.trial_group_id,
    value.trial_id, value.candidate_id, value.harness_context_binding_id, value.market_input_materialization_id]) {
    requireText(item, "decision Worker input assembly v2 identity")
  }
  for (const item of [value.assembly_hash, value.request_hash, value.candidate_hash,
    value.harness_context_binding_hash, value.market_input_materialization_hash,
    value.entries_hash, value.entry_hashes_hash]) {
    requireHash(item, "decision Worker input assembly v2 hash")
  }
  assertParentSelection(value)
  const expectedSupplementalSource = value.observation_input_materialization_id !== null
    ? "r4_97_empty_input_materialization" : "r4_98_initial_signal_materialization"
  let complete = 0
  let stateMissing = 0
  for (const [index, entry] of value.entries.entries()) {
    assertReplayDecisionWorkerInputAssemblyV2Entry(entry)
    if (entry.supplemental_input_source !== expectedSupplementalSource
        || entry.decision_sequence !== index + 1 || entry.harness_context.run_id !== value.run_id
        || entry.harness_context.experiment_id !== value.experiment_id
        || entry.harness_context.trial_group_id !== value.trial_group_id
        || entry.harness_context.trial_id !== value.trial_id
        || entry.harness_context.candidate_id !== value.candidate_id
        || entry.harness_context.candidate_hash !== value.candidate_hash) {
      throw new Error("decision Worker input assembly v2 member identity drift")
    }
    if (entry.input_tuple_status === "complete_non_executable_build_unbound") complete += 1
    if (entry.input_tuple_status === "incomplete_runtime_state_snapshot") stateMissing += 1
  }
  if (!Number.isSafeInteger(value.entry_count) || value.entry_count < 1
      || value.entry_count !== value.entries.length || value.complete_entry_count !== complete
      || value.incomplete_state_entry_count !== stateMissing
      || value.entries_hash !== canonicalHash(value.entries)
      || value.entry_hashes_hash !== canonicalHash(value.entries.map((entry) => entry.entry_hash))) {
    throw new Error("decision Worker input assembly v2 fold drift")
  }
  const { assembly_hash: assemblyHash, ...body } = value
  const { assembly_id: assemblyId, ...bodyWithoutId } = body
  if (assemblyId !== `decision-worker-input-v2-${canonicalHash(bodyWithoutId).slice(0, 24)}`
      || assemblyHash !== canonicalHash(body)) {
    throw new Error("decision Worker input assembly v2 identity or hash mismatch")
  }
}

function assertParentSelection(value: ReplayDecisionWorkerInputAssemblyV2): void {
  if (value.supplemental_source_policy !== "exactly_one_request_bound_r4_97_or_r4_98_materialization"
      || value.market_source_policy !== "required_same_request_context_bound_r4_100_materialization"
      || value.r4_97_embedded_market_policy !== "require_exact_match_then_use_r4_100") {
    throw new Error("decision Worker input assembly v2 parent policy drift")
  }
  for (const item of [value.observation_input_materialization_hash,
    value.initial_signal_supplemental_materialization_hash]) {
    if (item !== null) requireHash(item, "decision Worker input assembly v2 supplemental parent hash")
  }
  for (const item of [value.observation_input_materialization_id,
    value.initial_signal_supplemental_materialization_id]) {
    if (item !== null) requireText(item, "decision Worker input assembly v2 supplemental parent identity")
  }
  const hasR497 = value.observation_input_materialization_id !== null
    && value.observation_input_materialization_hash !== null
  const hasR498 = value.initial_signal_supplemental_materialization_id !== null
    && value.initial_signal_supplemental_materialization_hash !== null
  if (hasR497 === hasR498
      || (value.observation_input_materialization_id === null) !== (value.observation_input_materialization_hash === null)
      || (value.initial_signal_supplemental_materialization_id === null)
        !== (value.initial_signal_supplemental_materialization_hash === null)) {
    throw new Error("decision Worker input assembly v2 requires exactly one supplemental parent")
  }
}

const ENTRY_FIELDS = ["decision_input_snapshot", "decision_input_snapshot_hash", "decision_market_input_snapshot",
  "decision_market_input_snapshot_hash", "decision_phase", "decision_sequence", "decision_state_snapshot",
  "decision_time", "entry_hash", "execution_effect", "harness_context", "harness_context_binding_entry_hash",
  "harness_context_hash", "harness_invocation", "input_tuple_status", "market_input_source",
  "r4_97_embedded_market_compatibility", "schema_version", "state_input_status", "supplemental_input_source",
  "worker_request"].sort()
const ASSEMBLY_FIELDS = ["assembly_hash", "assembly_id", "assembly_policy_version", "build_attestation_binding",
  "candidate_hash", "candidate_id", "complete_entry_count", "decision_output_authority", "economic_authority",
  "entries", "entries_hash", "entry_count", "entry_hashes_hash", "experiment_id", "harness_context_binding_hash",
  "harness_context_binding_id", "harness_invocation", "incomplete_state_entry_count",
  "initial_signal_supplemental_materialization_hash", "initial_signal_supplemental_materialization_id",
  "invocation_identity_materialization", "market_input_materialization_hash", "market_input_materialization_id",
  "market_source_policy", "missing_market_entry_count", "observation_input_materialization_hash",
  "observation_input_materialization_id", "order_authority", "parent_validation", "purpose",
  "r4_97_embedded_market_policy", "request_hash", "runner_compatibility", "run_id", "schema_version", "scope",
  "signal_authority", "source_bundle_binding", "supplemental_source_policy", "trial_group_id", "trial_id",
  "worker_request_count", "worker_request_materialization"].sort()

function assertFields(value: object, expected: string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) throw new Error(`${label} field whitelist drift`)
}
