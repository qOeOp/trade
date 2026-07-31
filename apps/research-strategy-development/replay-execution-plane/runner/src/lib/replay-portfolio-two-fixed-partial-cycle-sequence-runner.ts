import { createHash } from "node:crypto"
import {
  assertReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot,
  assertReplayPortfolioTwoFixedPartialReservationSnapshot,
  type ReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot,
  type ReplayPortfolioTwoFixedPartialReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES,
  assertReplayPortfolioTwoFixedPartialCycleSequenceArtifactManifest,
  assertReplayPortfolioTwoFixedPartialCycleSequenceEvidence,
  replayPortfolioTwoFixedPartialCycleSequenceArtifactManifestHash,
  type ReplayPortfolioTwoFixedPartialCycleSequenceArtifactManifest,
  type ReplayPortfolioTwoFixedPartialCycleSequenceArtifactRole,
  type ReplayPortfolioTwoFixedPartialCycleSequenceOutcome,
} from "../../../contracts/src/lib/replay-portfolio-two-fixed-partial-cycle-sequence-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  createReplayPortfolioTwoFixedPartialCycleSequenceEvidence,
  type ReplayPortfolioTwoFixedPartialCycleSource,
} from "../../../accounting/src/lib/replay-portfolio-two-fixed-partial-cycle-sequence-accounting"
import { assertCertifiedReplayArtifactStore, type ReplayArtifactNamespace,
  type ReplayArtifactStore } from "./replay-artifact-store"
import {
  runReplayPortfolioTwoFixedPartialTerminalAccounting,
} from "./replay-portfolio-two-fixed-partial-accounting-runner"
import type { ReplayTrialRunInput, ReplayTrialRunOutcome } from "./replay-trial-runner"

const MANIFEST = "portfolio-two-fixed-partial-cycle-sequence-artifact-manifest.json"
const NAMES: Record<ReplayPortfolioTwoFixedPartialCycleSequenceArtifactRole, string> =
  Object.fromEntries(REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES.map((role) =>
    [role, `${role.replaceAll("_", "-")}.json`])) as Record<
      ReplayPortfolioTwoFixedPartialCycleSequenceArtifactRole, string>
export interface ReplayPortfolioTwoFixedPartialCycleInput {
  cycle_index: number
  authority: ReplayPortfolioTwoFixedPartialReservationSnapshot
  lanes: Array<{ lane_id: string; trial: ReplayTrialRunInput }>
}
export interface ReplayPortfolioTwoFixedPartialCycleSequenceRunInput {
  sequence_authority: ReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot
  cycles: ReplayPortfolioTwoFixedPartialCycleInput[]
  artifact_store: ReplayArtifactStore
  execute_lane_replay?: (input: ReplayTrialRunInput) => ReplayTrialRunOutcome
}

export function runReplayPortfolioTwoFixedPartialCycleSequence(
  input: ReplayPortfolioTwoFixedPartialCycleSequenceRunInput,
): ReplayPortfolioTwoFixedPartialCycleSequenceOutcome {
  try { validateInput(input) }
  catch (error) { return failed("cycle-sequence-input-invalid", null, error) }
  const sources: ReplayPortfolioTwoFixedPartialCycleSource[] = []
  let openingCash = input.sequence_authority.initial_cash
  let priorClose = Number.NEGATIVE_INFINITY
  let childIdempotent = true
  for (const cycle of input.cycles) {
    const child = runReplayPortfolioTwoFixedPartialTerminalAccounting({
      authority: cycle.authority, lanes: cycle.lanes, artifact_store: input.artifact_store,
      execute_lane_replay: input.execute_lane_replay,
    })
    if (!child.evidence || !child.terminal_evidence || !child.artifact_manifest || !child.lane_results) {
      return failed("cycle-child-failed", cycle.cycle_index,
        child.failure?.message ?? "P27 cycle child failed")
    }
    const terminal = child.terminal_evidence
    if (terminal.lane_records.some((record) => record.ending_open)
        || terminal.ending_reserved_isolated_collateral !== 0 || terminal.ending_unrealized_pnl !== 0
        || terminal.ending_gross_mark_exposure !== 0 || terminal.ending_net_mark_exposure !== 0
        || terminal.ending_active_stop_bounded_risk !== 0
        || child.evidence.trial_balance.ending_reserved_isolated_collateral !== 0
        || child.evidence.trial_balance.ending_unrealized_pnl !== 0) {
      return failed("cycle-not-full-flat", cycle.cycle_index, "P27 cycle child is not full-flat")
    }
    if (child.evidence.shared_initial_cash !== openingCash) {
      return failed("cycle-cash-bridge-drift", cycle.cycle_index,
        "P27 cycle opening cash does not equal predecessor committed Trial Balance")
    }
    const entryTimes = child.lane_results.flatMap((lane) => lane.result.fills
      .filter((fill) => fill.order_role === "entry").map((fill) => fill.timestamp))
    const closeTimes = terminal.lane_records.flatMap((record) => record.terminal_time ? [record.terminal_time] : [])
    const firstEntry = Math.min(...entryTimes.map(Date.parse)); const lastClose = Math.max(...closeTimes.map(Date.parse))
    const declaredTime = Date.parse(input.sequence_authority.cycles[cycle.cycle_index - 1]!.earliest_cycle_time)
    if (entryTimes.length !== terminal.lane_records.length || closeTimes.length !== terminal.lane_records.length
        || !Number.isFinite(firstEntry) || firstEntry !== declaredTime || firstEntry <= priorClose
        || !Number.isFinite(lastClose) || lastClose < firstEntry) {
      return failed("cycle-not-full-flat", cycle.cycle_index, "P27 cycle chronology drift")
    }
    sources.push({ cycle_index: cycle.cycle_index, child_reservation_hash: cycle.authority.reservation_hash,
      terminal_evidence: terminal, accounting_evidence: child.evidence,
      accounting_manifest: child.artifact_manifest })
    openingCash = child.evidence.trial_balance.ending_available_cash
    priorClose = lastClose
    childIdempotent = childIdempotent && child.idempotent_replay
  }
  try {
    const evidence = createReplayPortfolioTwoFixedPartialCycleSequenceEvidence({
      authority: input.sequence_authority, cycles: sources,
    })
    const published = publish(input, sources, evidence)
    return { status: "completed", evidence, artifact_manifest: published.manifest,
      idempotent_replay: childIdempotent && published.idempotent_replay, failure: null }
  } catch (error) { return failed("cycle-sequence-artifact-failed", null, error) }
}

function validateInput(input: ReplayPortfolioTwoFixedPartialCycleSequenceRunInput): void {
  assertReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot(input.sequence_authority)
  if (input.cycles.length !== input.sequence_authority.cycle_count) {
    throw new Error("P27 cycle input coverage drift")
  }
  input.cycles.forEach((cycle, index) => {
    const declared = input.sequence_authority.cycles[index]!
    assertReplayPortfolioTwoFixedPartialReservationSnapshot(cycle.authority)
    if (cycle.cycle_index !== index + 1 || declared.cycle_index !== cycle.cycle_index
        || cycle.authority.reservation_hash !== declared.two_fixed_partial_reservation_hash
        || cycle.authority.experiment_id !== input.sequence_authority.experiment_id
        || cycle.authority.trial_group_id !== input.sequence_authority.trial_group_id
        || cycle.authority.trial_group_hash !== input.sequence_authority.trial_group_hash
        || cycle.authority.portfolio_id !== input.sequence_authority.portfolio_id
        || cycle.authority.settlement_asset !== input.sequence_authority.settlement_asset
        || Date.parse(cycle.authority.issued_at) > Date.parse(input.sequence_authority.issued_at)
        || Date.parse(cycle.authority.expires_at) < Date.parse(input.sequence_authority.expires_at)
        || canonicalHash(cycle.authority.lanes.map((lane) => ({ lane_id: lane.lane_id,
          priority_rank: lane.priority_rank, trial_id: lane.trial_id, run_id: lane.run_id,
          trial_reservation_hash: lane.trial_reservation_hash, request_hash: lane.request_hash })))
          !== canonicalHash(declared.lanes)
        || cycle.lanes.length !== declared.lanes.length) throw new Error(`P27 cycle ${index + 1} authority drift`)
  })
}

function publish(input: ReplayPortfolioTwoFixedPartialCycleSequenceRunInput,
  sources: ReplayPortfolioTwoFixedPartialCycleSource[],
  evidence: NonNullable<ReplayPortfolioTwoFixedPartialCycleSequenceOutcome["evidence"]>) {
  assertReplayPortfolioTwoFixedPartialCycleSequenceEvidence(evidence)
  const values: Record<ReplayPortfolioTwoFixedPartialCycleSequenceArtifactRole, unknown> = {
    sequence_reservation: input.sequence_authority,
    cycle_child_reservations: input.cycles.map((cycle) => cycle.authority),
    cycle_accounting_artifact_manifests: sources.map((source) => source.accounting_manifest),
    cycle_terminal_evidence: sources.map((source) => source.terminal_evidence),
    cycle_accounting_evidence: sources.map((source) => source.accounting_evidence),
    consolidated_ledger: evidence.consolidated_ledger,
    consolidated_journal: evidence.consolidated_journal,
    consolidated_trial_balance: evidence.consolidated_trial_balance,
    cycle_sequence_fingerprint: { fingerprint_hash: evidence.fingerprint_hash,
      cycle_commits_hash: evidence.cycle_commits_hash }, cycle_sequence_evidence: evidence,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({ idempotency_key_hash: canonicalHash({
    sequence_reservation_hash: input.sequence_authority.reservation_hash, policy: evidence.policy_version,
  }), attempt_id_hash: evidence.evidence_hash })
  if (namespace.exists(MANIFEST)) return {
    manifest: readCommitted(namespace, evidence, values), idempotent_replay: true,
  }
  const files = REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES.map((role) => {
    const name = NAMES[role]; return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
  })
  const body: Omit<ReplayPortfolioTwoFixedPartialCycleSequenceArtifactManifest, "manifest_hash"> = {
    schema_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id: `replay-portfolio-two-fixed-partial-cycle-sequence:${evidence.fingerprint_hash}`,
    portfolio_id: evidence.portfolio_id, sequence_reservation_hash: input.sequence_authority.reservation_hash,
    evidence_hash: evidence.evidence_hash, fingerprint_hash: evidence.fingerprint_hash, files,
    completeness: { authoritative_result: true,
      required_roles: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES,
      commit_marker: MANIFEST, partial_payload_without_manifest_is_authoritative: false },
    authority_frozen_at: input.sequence_authority.issued_at,
  }
  const manifest = { ...body,
    manifest_hash: replayPortfolioTwoFixedPartialCycleSequenceArtifactManifestHash(body) }
  assertReplayPortfolioTwoFixedPartialCycleSequenceArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest))
  return { manifest, idempotent_replay: false }
}
function readCommitted(namespace: ReplayArtifactNamespace,
  evidence: NonNullable<ReplayPortfolioTwoFixedPartialCycleSequenceOutcome["evidence"]>,
  values: Record<ReplayPortfolioTwoFixedPartialCycleSequenceArtifactRole, unknown>) {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as
    ReplayPortfolioTwoFixedPartialCycleSequenceArtifactManifest
  assertReplayPortfolioTwoFixedPartialCycleSequenceArtifactManifest(manifest)
  if (manifest.evidence_hash !== evidence.evidence_hash) throw new Error("P27 sequence manifest identity drift")
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("P27 sequence committed payload drift")
    }
  }
  return manifest
}
function failed(code: NonNullable<ReplayPortfolioTwoFixedPartialCycleSequenceOutcome["failure"]>["code"],
  cycleIndex: number | null, error: unknown): ReplayPortfolioTwoFixedPartialCycleSequenceOutcome {
  return { status: "failed", evidence: null, artifact_manifest: null, idempotent_replay: false,
    failure: { code, cycle_index: cycleIndex, message: error instanceof Error ? error.message : String(error),
      partial_sequence_result_published: false } }
}
function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
