import { createHash } from "node:crypto"
import {
  REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES,
  assertReplayPortfolioFixedPartialCycleSequenceArtifactManifest,
  assertReplayPortfolioFixedPartialCycleSequenceEvidence,
  replayPortfolioFixedPartialCycleSequenceArtifactManifestHash,
  type ReplayPortfolioFixedPartialCycleSequenceArtifactManifest,
  type ReplayPortfolioFixedPartialCycleSequenceOutcome,
} from "../../../contracts/src/lib/replay-portfolio-fixed-partial-cycle-sequence-contracts"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { executeReplayPortfolioFixedPartialTerminal } from
  "../../../engine/src/lib/replay-portfolio-fixed-partial-terminal-engine"
import { createReplayPortfolioFixedPartialTerminalAccountingEvidence } from
  "../../../accounting/src/lib/replay-portfolio-fixed-partial-terminal-accounting"
import { createReplayPortfolioFixedPartialCycleSequenceEvidence, type ReplayPortfolioFixedPartialCycleSource } from
  "../../../accounting/src/lib/replay-portfolio-fixed-partial-cycle-sequence-accounting"
import {
  materializeReplayPortfolioCycleSequenceAuthority,
  validateReplayPortfolioCycleSequenceRunInput,
  type ReplayPortfolioCycleSequenceRunInput,
} from "./replay-portfolio-cycle-sequence-runner"
import { runReplayPortfolioProtectiveReplacementCycleSource } from
  "./replay-portfolio-protective-replacement-cycle-source-runner"
import {
  materializeReplayPortfolioFixedPartialTerminalLanes,
  publishReplayPortfolioFixedPartialTerminalArtifact,
} from "./replay-portfolio-fixed-partial-terminal-runner"
import { publishReplayPortfolioFixedPartialTerminalAccountingArtifact } from
  "./replay-portfolio-fixed-partial-terminal-accounting-runner"
import { assertCertifiedReplayArtifactStore, type ReplayArtifactNamespace } from "./replay-artifact-store"
import { runReplayTrial } from "./replay-trial-runner"

const MANIFEST = "portfolio-fixed-partial-cycle-sequence-artifact-manifest.json"
const NAMES = Object.fromEntries(REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES.map((role) =>
  [role, `${role.replaceAll("_", "-")}.json`])) as Record<
    typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES[number], string>
export interface ReplayPortfolioFixedPartialCycleSequenceRunInput extends ReplayPortfolioCycleSequenceRunInput {
  execute_lane_replay?: typeof runReplayTrial
}
export function runReplayPortfolioFixedPartialCycleSequence(
  input: ReplayPortfolioFixedPartialCycleSequenceRunInput,
): ReplayPortfolioFixedPartialCycleSequenceOutcome {
  try { validateReplayPortfolioCycleSequenceRunInput(input) }
  catch (error) { return failed("partial-cycle-sequence-input-invalid", null, error) }
  const cycles: ReplayPortfolioFixedPartialCycleSource[] = []; let openingCash = input.reservation.initial_cash
  let childIdempotent = true
  for (const cycle of input.cycles) {
    let source
    try { source = runReplayPortfolioProtectiveReplacementCycleSource(input, cycle, openingCash,
      "fixed_partial_reduce") } catch (error) { return failed("partial-cycle-source-failed", cycle.cycle_index, error) }
    let terminalEvidence; let terminalManifest; let laneResults
    try {
      const authority = materializeReplayPortfolioCycleSequenceAuthority(input.reservation, cycle, openingCash)
      const materialized = materializeReplayPortfolioFixedPartialTerminalLanes({ lanes: cycle.lanes,
        priority_lanes: authority.risk_materialization.lanes,
        allocation_result: source.allocationResult, artifact_store: input.artifact_store,
        execute_lane_replay: input.execute_lane_replay })
      laneResults = materialized.lane_results
      terminalEvidence = executeReplayPortfolioFixedPartialTerminal({
        source_evidence: source.sourceTerminalEvidence, source_manifest: source.sourceTerminalManifest,
        allocation_result: source.allocationResult, risk_result: source.riskResult, lanes: materialized.lanes })
      const published = publishReplayPortfolioFixedPartialTerminalArtifact({
        source_evidence: source.sourceTerminalEvidence, source_manifest: source.sourceTerminalManifest,
        lane_results: laneResults, evidence: terminalEvidence, authority_frozen_at: input.reservation.issued_at,
        artifact_store: input.artifact_store })
      terminalManifest = published.manifest; childIdempotent = childIdempotent && source.childIdempotent
        && published.idempotent_replay
    } catch (error) { return failed("partial-cycle-terminal-failed", cycle.cycle_index, error) }
    if (terminalEvidence.lane_records.some((record) => record.ending_open)
        || terminalEvidence.ending_reserved_isolated_collateral !== 0
        || terminalEvidence.ending_gross_mark_exposure !== 0 || terminalEvidence.ending_net_mark_exposure !== 0
        || terminalEvidence.ending_portfolio_frozen_stop_risk !== 0) {
      return failed("partial-cycle-not-full-flat", cycle.cycle_index, "fixed-partial cycle not full-flat")
    }
    try {
      const accountingEvidence = createReplayPortfolioFixedPartialTerminalAccountingEvidence({
        terminal_evidence: terminalEvidence, terminal_manifest: terminalManifest })
      const published = publishReplayPortfolioFixedPartialTerminalAccountingArtifact({ terminal_evidence: terminalEvidence,
        terminal_manifest: terminalManifest, evidence: accountingEvidence,
        authority_frozen_at: input.reservation.issued_at, artifact_store: input.artifact_store })
      cycles.push({ cycle_index: cycle.cycle_index, terminal_evidence: terminalEvidence,
        terminal_manifest: terminalManifest, accounting_evidence: accountingEvidence,
        accounting_manifest: published.manifest })
      openingCash = accountingEvidence.trial_balance.ending_available_cash
      childIdempotent = childIdempotent && published.idempotent_replay
    } catch (error) { return failed("partial-cycle-accounting-failed", cycle.cycle_index, error) }
  }
  try {
    const evidence = createReplayPortfolioFixedPartialCycleSequenceEvidence({
      plan: input.plan, reservation: input.reservation, cycles })
    const published = publish(input, cycles, evidence)
    return { status: "completed", evidence, artifact_manifest: published.manifest,
      idempotent_replay: childIdempotent && published.idempotent_replay, failure: null }
  } catch (error) { return failed("partial-cycle-sequence-artifact-failed", null, error) }

  function publish(base: ReplayPortfolioFixedPartialCycleSequenceRunInput,
    sources: ReplayPortfolioFixedPartialCycleSource[], evidence: NonNullable<ReplayPortfolioFixedPartialCycleSequenceOutcome["evidence"]>) {
    assertReplayPortfolioFixedPartialCycleSequenceEvidence(evidence)
    const values: Record<typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES[number], unknown> = {
      cycle_sequence_plan: base.plan, cycle_sequence_reservation: base.reservation,
      cycle_terminal_artifact_manifests: sources.map((item) => item.terminal_manifest),
      cycle_terminal_evidence: sources.map((item) => item.terminal_evidence),
      cycle_accounting_artifact_manifests: sources.map((item) => item.accounting_manifest),
      cycle_accounting_evidence: sources.map((item) => item.accounting_evidence),
      consolidated_ledger: evidence.consolidated_ledger, consolidated_journal: evidence.consolidated_journal,
      consolidated_trial_balance: evidence.consolidated_trial_balance,
      cycle_sequence_fingerprint: evidence.fingerprint, cycle_sequence_evidence: evidence }
    assertCertifiedReplayArtifactStore(base.artifact_store)
    const namespace = base.artifact_store.openAttempt({ idempotency_key_hash: canonicalHash({
      plan: base.plan.plan_hash, policy: evidence.policy_version }), attempt_id_hash: evidence.evidence_hash })
    if (namespace.exists(MANIFEST)) return { manifest: readCommitted(namespace, evidence, values), idempotent_replay: true }
    const files = REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES.map((role) => {
      const name = NAMES[role]; return { role, name, ...namespace.writeImmutable(name, encode(values[role])) } })
    const body: Omit<ReplayPortfolioFixedPartialCycleSequenceArtifactManifest, "manifest_hash"> = {
      schema_version: REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
      artifact_id: `replay-portfolio-fixed-partial-cycle-sequence:${evidence.fingerprint.fingerprint_hash}`,
      portfolio_id: evidence.portfolio_id, evidence_hash: evidence.evidence_hash,
      fingerprint_hash: evidence.fingerprint.fingerprint_hash, files,
      completeness: { authoritative_result: true,
        required_roles: REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES,
        commit_marker: MANIFEST, partial_payload_without_manifest_is_authoritative: false },
      authority_frozen_at: base.reservation.issued_at }
    const manifest = { ...body, manifest_hash: replayPortfolioFixedPartialCycleSequenceArtifactManifestHash(body) }
    assertReplayPortfolioFixedPartialCycleSequenceArtifactManifest(manifest)
    namespace.writeImmutable(MANIFEST, encode(manifest)); return { manifest, idempotent_replay: false }
  }
}
function readCommitted(namespace: ReplayArtifactNamespace,
  evidence: NonNullable<ReplayPortfolioFixedPartialCycleSequenceOutcome["evidence"]>,
  values: Record<typeof REPLAY_PORTFOLIO_FIXED_PARTIAL_CYCLE_SEQUENCE_ARTIFACT_ROLES[number], unknown>) {
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(MANIFEST).bytes)) as
    ReplayPortfolioFixedPartialCycleSequenceArtifactManifest
  assertReplayPortfolioFixedPartialCycleSequenceArtifactManifest(manifest)
  if (manifest.evidence_hash !== evidence.evidence_hash) throw new Error("fixed-partial sequence manifest drift")
  for (const file of manifest.files) { const read = namespace.read(file.name)
    if (file.name !== NAMES[file.role] || file.ref !== read.ref || file.sha256 !== sha256(read.bytes)
        || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes))) !== canonicalHash(values[file.role])) {
      throw new Error("fixed-partial sequence committed payload drift")
    } }
  return manifest
}
function failed(code: NonNullable<ReplayPortfolioFixedPartialCycleSequenceOutcome["failure"]>["code"],
  cycle_index: number | null, error: unknown): ReplayPortfolioFixedPartialCycleSequenceOutcome {
  return { status: "failed", evidence: null, artifact_manifest: null, idempotent_replay: false,
    failure: { code, cycle_index, message: error instanceof Error ? error.message : String(error),
      partial_sequence_result_published: false } }
}
function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex") }
