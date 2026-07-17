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

export const REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_SCHEMA_VERSION = "trade.rd-replay-decision-worker-input-assembly.v1" as const
export const REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_ENTRY_SCHEMA_VERSION = "trade.rd-replay-decision-worker-input-assembly-entry.v1" as const
export const REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_POLICY_VERSION = "rd-replay-decision-worker-input-assembly-v1" as const

export interface ReplayDecisionWorkerInputAssemblyEntry {
  schema_version: typeof REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_ENTRY_SCHEMA_VERSION
  decision_sequence: number
  decision_time: string
  decision_phase: "pre_entry" | "initial_entry" | "pending_entry" | "position_open"
  harness_context_binding_entry_hash: string
  harness_context: ReplayDecisionHarnessContext
  harness_context_hash: string
  supplemental_input_source: "r4_97_empty_input_materialization" | "r4_98_initial_signal_materialization"
  decision_input_snapshot: ReplayDecisionInputSnapshot
  decision_input_snapshot_hash: string
  market_input_source: "r4_97_observation_input_materialization" | "not_materialized_for_nonempty_request"
  decision_market_input_snapshot: ReplayDecisionMarketInputSnapshot | null
  decision_market_input_snapshot_hash: string | null
  state_input_status: "not_applicable_non_position_phase" | "runtime_state_required_not_materialized"
  decision_state_snapshot: null
  input_tuple_status: "complete_non_executable_build_unbound" | "incomplete_market_snapshot" | "incomplete_runtime_state_snapshot"
  worker_request: null
  harness_invocation: "forbidden"
  execution_effect: "none"
  entry_hash: string
}

export type ReplayDecisionWorkerInputAssemblyEntryBody = Omit<ReplayDecisionWorkerInputAssemblyEntry, "entry_hash">

export interface ReplayDecisionWorkerInputAssembly {
  schema_version: typeof REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_SCHEMA_VERSION
  assembly_id: string
  assembly_hash: string
  assembly_policy_version: typeof REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_POLICY_VERSION
  scope: "pre_worker_non_economic_input_tuple_assembly"
  purpose: "bind_context_and_available_formal_snapshots_without_creating_worker_request"
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
  supplemental_source_policy: "exactly_one_request_bound_materialization"
  entry_count: number
  entries: ReplayDecisionWorkerInputAssemblyEntry[]
  entries_hash: string
  entry_hashes_hash: string
  complete_entry_count: number
  incomplete_market_entry_count: number
  incomplete_state_entry_count: number
  worker_request_count: 0
}

export type ReplayDecisionWorkerInputAssemblyBody = Omit<ReplayDecisionWorkerInputAssembly, "assembly_hash">

export function createReplayDecisionWorkerInputAssemblyEntry(
  body: ReplayDecisionWorkerInputAssemblyEntryBody,
): ReplayDecisionWorkerInputAssemblyEntry {
  const value = { ...structuredClone(body), entry_hash: canonicalHash(body) }
  assertReplayDecisionWorkerInputAssemblyEntry(value)
  return value
}

export function createReplayDecisionWorkerInputAssembly(
  body: ReplayDecisionWorkerInputAssemblyBody,
): ReplayDecisionWorkerInputAssembly {
  const value = { ...structuredClone(body), assembly_hash: canonicalHash(body) }
  assertReplayDecisionWorkerInputAssembly(value)
  return value
}

export function assertReplayDecisionWorkerInputAssemblyEntry(value: ReplayDecisionWorkerInputAssemblyEntry): void {
  if (value.schema_version !== REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_ENTRY_SCHEMA_VERSION
      || !["r4_97_empty_input_materialization", "r4_98_initial_signal_materialization"].includes(value.supplemental_input_source)
      || !["r4_97_observation_input_materialization", "not_materialized_for_nonempty_request"].includes(value.market_input_source)
      || !["not_applicable_non_position_phase", "runtime_state_required_not_materialized"].includes(value.state_input_status)
      || !["complete_non_executable_build_unbound", "incomplete_market_snapshot", "incomplete_runtime_state_snapshot"].includes(value.input_tuple_status)
      || value.decision_state_snapshot !== null || value.worker_request !== null
      || value.harness_invocation !== "forbidden" || value.execution_effect !== "none") {
    throw new Error("unsupported decision Worker input assembly entry authority")
  }
  assertFields(value, ENTRY_FIELDS, "decision Worker input assembly entry")
  requireUtc(value.decision_time, "decision Worker input assembly decision time")
  requireHash(value.harness_context_binding_entry_hash, "decision Worker input assembly context entry hash")
  requireHash(value.harness_context_hash, "decision Worker input assembly context hash")
  requireHash(value.decision_input_snapshot_hash, "decision Worker input assembly supplemental snapshot hash")
  if (!Number.isSafeInteger(value.decision_sequence) || value.decision_sequence < 1
      || !["pre_entry", "initial_entry", "pending_entry", "position_open"].includes(value.decision_phase)) {
    throw new Error("decision Worker input assembly sequence or phase is invalid")
  }
  assertReplayDecisionInputSnapshot(value.decision_input_snapshot)
  if (value.decision_market_input_snapshot) {
    assertReplayDecisionMarketInputSnapshot(value.decision_market_input_snapshot)
    requireHash(value.decision_market_input_snapshot_hash, "decision Worker input assembly market snapshot hash")
  }
  const marketMissing = value.market_input_source === "not_materialized_for_nonempty_request"
  const stateMissing = value.decision_phase === "position_open"
  const expectedStatus = stateMissing
    ? "incomplete_runtime_state_snapshot"
    : marketMissing ? "incomplete_market_snapshot" : "complete_non_executable_build_unbound"
  if (value.harness_context.decision_sequence !== value.decision_sequence
      || value.harness_context.decision_time !== value.decision_time
      || value.harness_context.decision_phase !== value.decision_phase
      || value.harness_context_hash !== canonicalHash(value.harness_context)
      || value.decision_input_snapshot.run_id !== value.harness_context.run_id
      || value.decision_input_snapshot.decision_time !== value.decision_time
      || value.decision_input_snapshot.snapshot_hash !== value.decision_input_snapshot_hash
      || marketMissing !== (value.decision_market_input_snapshot === null)
      || marketMissing !== (value.decision_market_input_snapshot_hash === null)
      || (!marketMissing && (value.decision_market_input_snapshot!.run_id !== value.harness_context.run_id
        || value.decision_market_input_snapshot!.decision_time !== value.decision_time
        || value.decision_market_input_snapshot!.snapshot_hash !== value.decision_market_input_snapshot_hash))
      || stateMissing !== (value.state_input_status === "runtime_state_required_not_materialized")
      || value.input_tuple_status !== expectedStatus) {
    throw new Error("decision Worker input assembly entry semantic drift")
  }
  const { entry_hash: entryHash, ...body } = value
  if (entryHash !== canonicalHash(body)) throw new Error("decision Worker input assembly entry hash mismatch")
}

export function assertReplayDecisionWorkerInputAssembly(value: ReplayDecisionWorkerInputAssembly): void {
  if (value.schema_version !== REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_SCHEMA_VERSION
      || value.assembly_policy_version !== REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_POLICY_VERSION
      || value.scope !== "pre_worker_non_economic_input_tuple_assembly"
      || value.purpose !== "bind_context_and_available_formal_snapshots_without_creating_worker_request"
      || value.parent_validation !== "self_hash_and_cross_object_binding_only"
      || value.source_bundle_binding !== "not_bound" || value.build_attestation_binding !== "not_bound"
      || value.invocation_identity_materialization !== "forbidden"
      || value.worker_request_materialization !== "forbidden" || value.harness_invocation !== "forbidden"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.runner_compatibility !== "not_bound"
      || value.supplemental_source_policy !== "exactly_one_request_bound_materialization"
      || value.worker_request_count !== 0) {
    throw new Error("unsupported decision Worker input assembly authority")
  }
  assertFields(value, ASSEMBLY_FIELDS, "decision Worker input assembly")
  for (const item of [value.assembly_id, value.run_id, value.experiment_id, value.trial_group_id,
    value.trial_id, value.candidate_id, value.harness_context_binding_id]) {
    requireText(item, "decision Worker input assembly identity")
  }
  for (const item of [value.assembly_hash, value.request_hash, value.candidate_hash,
    value.harness_context_binding_hash, value.entries_hash, value.entry_hashes_hash]) {
    requireHash(item, "decision Worker input assembly hash")
  }
  for (const item of [value.observation_input_materialization_hash,
    value.initial_signal_supplemental_materialization_hash]) {
    if (item !== null) requireHash(item, "decision Worker input assembly parent hash")
  }
  if ((value.observation_input_materialization_id === null) !== (value.observation_input_materialization_hash === null)
      || (value.initial_signal_supplemental_materialization_id === null)
        !== (value.initial_signal_supplemental_materialization_hash === null)
      || (value.observation_input_materialization_id === null)
        === (value.initial_signal_supplemental_materialization_id === null)) {
    throw new Error("decision Worker input assembly requires exactly one supplemental materialization source")
  }
  let complete = 0
  let marketMissing = 0
  let stateMissing = 0
  for (const [index, entry] of value.entries.entries()) {
    assertReplayDecisionWorkerInputAssemblyEntry(entry)
    if (entry.decision_sequence !== index + 1 || entry.harness_context.run_id !== value.run_id
        || entry.harness_context.experiment_id !== value.experiment_id
        || entry.harness_context.trial_group_id !== value.trial_group_id
        || entry.harness_context.trial_id !== value.trial_id
        || entry.harness_context.candidate_id !== value.candidate_id
        || entry.harness_context.candidate_hash !== value.candidate_hash) {
      throw new Error("decision Worker input assembly member identity drift")
    }
    if (entry.input_tuple_status === "complete_non_executable_build_unbound") complete += 1
    if (entry.input_tuple_status === "incomplete_market_snapshot") marketMissing += 1
    if (entry.input_tuple_status === "incomplete_runtime_state_snapshot") stateMissing += 1
  }
  if (!Number.isSafeInteger(value.entry_count) || value.entry_count < 1
      || value.entry_count !== value.entries.length || value.complete_entry_count !== complete
      || value.incomplete_market_entry_count !== marketMissing || value.incomplete_state_entry_count !== stateMissing
      || value.entries_hash !== canonicalHash(value.entries)
      || value.entry_hashes_hash !== canonicalHash(value.entries.map((entry) => entry.entry_hash))) {
    throw new Error("decision Worker input assembly fold drift")
  }
  const { assembly_hash: assemblyHash, ...body } = value
  const { assembly_id: assemblyId, ...bodyWithoutId } = body
  if (assemblyId !== `decision-worker-input-${canonicalHash(bodyWithoutId).slice(0, 24)}`
      || assemblyHash !== canonicalHash(body)) {
    throw new Error("decision Worker input assembly identity or hash mismatch")
  }
}

const ENTRY_FIELDS = ["decision_input_snapshot", "decision_input_snapshot_hash", "decision_market_input_snapshot",
  "decision_market_input_snapshot_hash", "decision_phase", "decision_sequence", "decision_state_snapshot",
  "decision_time", "entry_hash", "execution_effect", "harness_context", "harness_context_binding_entry_hash",
  "harness_context_hash", "harness_invocation", "input_tuple_status", "market_input_source", "schema_version",
  "state_input_status", "supplemental_input_source", "worker_request"].sort()
const ASSEMBLY_FIELDS = ["assembly_hash", "assembly_id", "assembly_policy_version", "build_attestation_binding",
  "candidate_hash", "candidate_id", "complete_entry_count", "decision_output_authority", "economic_authority",
  "entries", "entries_hash", "entry_count", "entry_hashes_hash", "experiment_id", "harness_context_binding_hash",
  "harness_context_binding_id", "harness_invocation", "incomplete_market_entry_count", "incomplete_state_entry_count",
  "initial_signal_supplemental_materialization_hash", "initial_signal_supplemental_materialization_id",
  "invocation_identity_materialization", "observation_input_materialization_hash",
  "observation_input_materialization_id", "order_authority", "parent_validation", "purpose", "request_hash",
  "runner_compatibility", "run_id", "schema_version", "scope", "signal_authority", "source_bundle_binding",
  "supplemental_source_policy", "trial_group_id", "trial_id", "worker_request_count",
  "worker_request_materialization"].sort()

function assertFields(value: object, expected: string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) throw new Error(`${label} field whitelist drift`)
}
