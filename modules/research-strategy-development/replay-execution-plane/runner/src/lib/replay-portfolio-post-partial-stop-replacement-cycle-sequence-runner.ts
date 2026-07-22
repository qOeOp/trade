import { createHash } from "node:crypto"
import {
  assertReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot,
  type ReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES,
  assertReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifest,
  assertReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence,
  replayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifestHash,
  type ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifest,
  type ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactRole,
  type ReplayPortfolioPostPartialStopReplacementCycleSequenceOutcome,
} from "../../../contracts/src/lib/replay-portfolio-post-partial-stop-replacement-cycle-sequence-contracts"
import { canonicalHash, canonicalJson, type ReplayExecutionRequest } from
  "../../../contracts/src/lib/replay-contracts"
import {
  createReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence,
  type ReplayPortfolioPostPartialStopReplacementCycleSource,
} from "../../../accounting/src/lib/replay-portfolio-post-partial-stop-replacement-cycle-sequence-accounting"
import type { ReplayPortfolioPostPartialStopReplacementAccountingLane } from
  "../../../accounting/src/lib/replay-portfolio-post-partial-stop-replacement-accounting"
import {
  assertCertifiedReplayArtifactStore,
  type ReplayArtifactNamespace,
  type ReplayArtifactStore,
} from "./replay-artifact-store"
import {
  runReplayPortfolioPostPartialStopReplacementAccounting,
} from "./replay-portfolio-post-partial-stop-replacement-accounting-runner"

const MANIFEST =
  "portfolio-post-partial-stop-replacement-cycle-sequence-artifact-manifest.json"
const NAMES: Record<ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactRole, string> =
  Object.fromEntries(
    REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES.map(
      (role) => [role, `${role.replaceAll("_", "-")}.json`],
    ),
  ) as Record<ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactRole, string>

export interface ReplayPortfolioPostPartialStopReplacementCycleInput {
  cycle_index: number
  risk_evidence: ReplayPortfolioPostPartialStopReplacementCycleSource["risk_evidence"]
  lanes: Array<ReplayPortfolioPostPartialStopReplacementAccountingLane & {
    request: ReplayExecutionRequest
  }>
}

export interface ReplayPortfolioPostPartialStopReplacementCycleSequenceRunInput {
  sequence_authority: ReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot
  cycles: ReplayPortfolioPostPartialStopReplacementCycleInput[]
  artifact_store: ReplayArtifactStore
  execute_cycle_accounting?: typeof runReplayPortfolioPostPartialStopReplacementAccounting
}

export function runReplayPortfolioPostPartialStopReplacementCycleSequence(
  input: ReplayPortfolioPostPartialStopReplacementCycleSequenceRunInput,
): ReplayPortfolioPostPartialStopReplacementCycleSequenceOutcome {
  try {
    validateInput(input)
  } catch (error) {
    return failed("cycle-sequence-input-invalid", null, error)
  }
  const sources: ReplayPortfolioPostPartialStopReplacementCycleSource[] = []
  const execute = input.execute_cycle_accounting
    ?? runReplayPortfolioPostPartialStopReplacementAccounting
  let openingCash = input.sequence_authority.initial_cash
  let priorClose = Number.NEGATIVE_INFINITY
  let childIdempotent = true
  for (const cycle of input.cycles) {
    const child = execute({
      risk_evidence: cycle.risk_evidence,
      lanes: cycle.lanes.map(({ lane_id, result, artifact_manifest }) => ({
        lane_id, result, artifact_manifest,
      })),
      artifact_store: input.artifact_store,
    })
    if (!child.evidence || !child.artifact_manifest) {
      return failed("cycle-child-failed", cycle.cycle_index,
        child.failure?.message ?? "P28 cycle child failed")
    }
    const risk = cycle.risk_evidence
    const trial = child.evidence.trial_balance
    if (risk.open_lane_count !== 0 || risk.flat_lane_count !== risk.lane_records.length
        || risk.ending_reserved_isolated_collateral !== 0 || risk.ending_unrealized_pnl !== 0
        || risk.ending_gross_mark_exposure !== 0 || risk.ending_net_mark_exposure !== 0
        || risk.ending_reserved_admission_risk !== 0
        || risk.ending_current_active_stop_bounded_risk !== 0
        || risk.historical_admission_frozen_stop_risk !== risk.total_risk_budget_released
        || trial.ending_reserved_isolated_collateral !== 0 || trial.ending_unrealized_pnl !== 0
        || trial.ending_reserved_admission_risk !== 0
        || trial.ending_current_active_stop_bounded_risk !== 0) {
      return failed("cycle-not-full-flat", cycle.cycle_index, "P28 cycle child is not full-flat")
    }
    if (risk.initial_cash !== openingCash) {
      return failed("cycle-cash-bridge-drift", cycle.cycle_index,
        "P28 cycle opening cash does not equal predecessor committed Trial Balance")
    }
    const entryTimes = cycle.lanes.flatMap((lane) => lane.result.fills
      .filter((fill) => fill.order_role === "entry").map((fill) => fill.timestamp))
    const closeTimes = cycle.lanes.flatMap((lane) => lane.result.fills
      .filter((fill) => ["stop", "target", "strategy_exit", "liquidation"]
        .includes(fill.order_role)).map((fill) => fill.timestamp))
    const firstEntry = Math.min(...entryTimes.map(Date.parse))
    const lastClose = Math.max(...closeTimes.map(Date.parse))
    const declaredTime = Date.parse(
      input.sequence_authority.cycles[cycle.cycle_index - 1]!.earliest_cycle_time,
    )
    if (entryTimes.length !== cycle.lanes.length || closeTimes.length !== cycle.lanes.length
        || !Number.isFinite(firstEntry) || firstEntry !== declaredTime || firstEntry <= priorClose
        || !Number.isFinite(lastClose) || lastClose < firstEntry) {
      return failed("cycle-not-full-flat", cycle.cycle_index, "P28 cycle chronology drift")
    }
    sources.push({
      cycle_index: cycle.cycle_index,
      full_flat_close_time: new Date(lastClose).toISOString(),
      risk_evidence: risk,
      accounting_evidence: child.evidence,
      accounting_manifest: child.artifact_manifest,
    })
    openingCash = trial.ending_available_cash
    priorClose = lastClose
    childIdempotent = childIdempotent && child.idempotent_replay
  }
  try {
    const evidence = createReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence({
      authority: input.sequence_authority,
      cycles: sources,
    })
    const published = publish(input, sources, evidence)
    return {
      status: "completed",
      evidence,
      artifact_manifest: published.manifest,
      idempotent_replay: childIdempotent && published.idempotent_replay,
      failure: null,
    }
  } catch (error) {
    return failed("cycle-sequence-artifact-failed", null, error)
  }
}

function validateInput(input: ReplayPortfolioPostPartialStopReplacementCycleSequenceRunInput): void {
  assertReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot(
    input.sequence_authority,
  )
  if (input.cycles.length !== input.sequence_authority.cycle_count) {
    throw new Error("P28 cycle input coverage drift")
  }
  input.cycles.forEach((cycle, index) => {
    const declared = input.sequence_authority.cycles[index]!
    if (cycle.cycle_index !== index + 1 || declared.cycle_index !== cycle.cycle_index
        || cycle.lanes.length !== declared.lanes.length
        || cycle.risk_evidence.portfolio_id !== input.sequence_authority.portfolio_id
        || cycle.risk_evidence.settlement_asset !== input.sequence_authority.settlement_asset) {
      throw new Error(`P28 cycle ${index + 1} authority coverage drift`)
    }
    cycle.lanes.forEach((lane, laneIndex) => {
      const authority = declared.lanes[laneIndex]!
      if (lane.lane_id !== authority.lane_id || lane.request.run_id !== authority.run_id
          || lane.request.trial_id !== authority.trial_id
          || lane.request.trial_reservation_ref !== authority.trial_reservation_ref
          || lane.request.trial_reservation_hash !== authority.trial_reservation_hash
          || canonicalHash(lane.request) !== authority.request_hash
          || lane.result.run_id !== authority.run_id
          || lane.result.fingerprint.request_hash !== authority.request_hash
          || lane.result.fingerprint.trial_reservation_hash !== authority.trial_reservation_hash
          || lane.artifact_manifest.run_id !== authority.run_id
          || lane.artifact_manifest.result_hash !== lane.result.fingerprint.result_hash) {
        throw new Error(`P28 cycle ${index + 1} Lane ${authority.lane_id} authority drift`)
      }
    })
  })
}

function publish(
  input: ReplayPortfolioPostPartialStopReplacementCycleSequenceRunInput,
  sources: ReplayPortfolioPostPartialStopReplacementCycleSource[],
  evidence: NonNullable<ReplayPortfolioPostPartialStopReplacementCycleSequenceOutcome["evidence"]>,
): { manifest: ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifest
  idempotent_replay: boolean } {
  assertReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence(evidence)
  const values: Record<ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactRole, unknown> = {
    sequence_reservation: input.sequence_authority,
    cycle_risk_evidence: sources.map((source) => source.risk_evidence),
    cycle_accounting_artifact_manifests: sources.map((source) => source.accounting_manifest),
    cycle_accounting_evidence: sources.map((source) => source.accounting_evidence),
    consolidated_ledger: evidence.consolidated_ledger,
    consolidated_journal: evidence.consolidated_journal,
    consolidated_trial_balance: evidence.consolidated_trial_balance,
    cycle_sequence_fingerprint: {
      fingerprint_hash: evidence.fingerprint_hash,
      cycle_commits_hash: evidence.cycle_commits_hash,
    },
    cycle_sequence_evidence: evidence,
  }
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({
      sequence_reservation_hash: input.sequence_authority.reservation_hash,
      policy: evidence.policy_version,
    }),
    attempt_id_hash: evidence.evidence_hash,
  })
  if (namespace.exists(MANIFEST)) {
    return { manifest: readCommitted(namespace, input.sequence_authority, evidence, values),
      idempotent_replay: true }
  }
  const files = REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES.map(
    (role) => {
      const name = NAMES[role]
      return { role, name, ...namespace.writeImmutable(name, encode(values[role])) }
    },
  )
  const body: Omit<ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifest,
  "manifest_hash"> = {
    schema_version:
      REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifact_id:
      `replay-portfolio-post-partial-stop-replacement-cycle-sequence:${evidence.fingerprint_hash}`,
    portfolio_id: evidence.portfolio_id,
    sequence_reservation_hash: input.sequence_authority.reservation_hash,
    evidence_hash: evidence.evidence_hash,
    fingerprint_hash: evidence.fingerprint_hash,
    files,
    completeness: {
      authoritative_result: true,
      required_roles:
        REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES,
      commit_marker: MANIFEST,
      partial_payload_without_manifest_is_authoritative: false,
    },
    authority_frozen_at: input.sequence_authority.issued_at,
  }
  const manifest = { ...body,
    manifest_hash:
      replayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifestHash(body) }
  assertReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifest(manifest)
  namespace.writeImmutable(MANIFEST, encode(manifest))
  return { manifest, idempotent_replay: false }
}

function readCommitted(
  namespace: ReplayArtifactNamespace,
  authority: ReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot,
  evidence: NonNullable<ReplayPortfolioPostPartialStopReplacementCycleSequenceOutcome["evidence"]>,
  values: Record<ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactRole, unknown>,
): ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifest {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as
    ReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifest
  assertReplayPortfolioPostPartialStopReplacementCycleSequenceArtifactManifest(manifest)
  if (manifest.artifact_id
        !== `replay-portfolio-post-partial-stop-replacement-cycle-sequence:${evidence.fingerprint_hash}`
      || manifest.portfolio_id !== evidence.portfolio_id
      || manifest.sequence_reservation_hash !== authority.reservation_hash
      || manifest.evidence_hash !== evidence.evidence_hash
      || manifest.fingerprint_hash !== evidence.fingerprint_hash
      || manifest.authority_frozen_at !== authority.issued_at) {
    throw new Error("P28 sequence committed manifest identity drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes)))
          !== canonicalHash(values[file.role])) {
      throw new Error("P28 sequence committed payload drift")
    }
  }
  return manifest
}

function failed(
  code: NonNullable<ReplayPortfolioPostPartialStopReplacementCycleSequenceOutcome["failure"]>["code"],
  cycleIndex: number | null,
  error: unknown,
): ReplayPortfolioPostPartialStopReplacementCycleSequenceOutcome {
  return {
    status: "failed",
    evidence: null,
    artifact_manifest: null,
    idempotent_replay: false,
    failure: {
      code,
      cycle_index: cycleIndex,
      message: error instanceof Error ? error.message : String(error),
      partial_sequence_result_published: false,
    },
  }
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
