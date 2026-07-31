import type { ReplayPortfolioCycleSequenceReservationSnapshot } from
  "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_CYCLE_SEQUENCE_ARTIFACT_ROLES,
  assertReplayPortfolioProtectiveStrategyExitCancelCycleSequenceArtifactManifest,
  type ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceArtifactManifest,
  type ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceArtifactRole,
  type ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidence,
  type ReplayPortfolioProtectiveStrategyExitCancelCycleSource,
} from "../../../contracts/src/lib/replay-portfolio-protective-strategy-exit-cancel-cycle-sequence-contracts"
import type { ReplayPortfolioCycleSequencePlan } from
  "../../../contracts/src/lib/replay-portfolio-cycle-sequence-contracts"
import type { ReplayArtifactStore } from "./replay-artifact-store"
import { publishReplayPortfolioProtectiveReplacementCycleSequenceArtifact,
  type ReplayPortfolioProtectiveReplacementCycleArtifactCommonInput } from
  "./replay-portfolio-protective-replacement-cycle-sequence-artifact-publisher-common"

const NAMES: Record<ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceArtifactRole, string> = {
  cycle_sequence_plan: "cycle-sequence-plan.json",
  cycle_sequence_reservation: "cycle-sequence-reservation.json",
  cycle_cancel_terminal_artifact_manifests: "cycle-cancel-terminal-artifact-manifests.json",
  cycle_cancel_terminal_evidence: "cycle-cancel-terminal-evidence.json",
  cycle_cancel_terminal_accounting_artifact_manifests: "cycle-cancel-terminal-accounting-artifact-manifests.json",
  cycle_cancel_terminal_accounting_evidence: "cycle-cancel-terminal-accounting-evidence.json",
  consolidated_ledger: "consolidated-ledger.json", consolidated_journal: "consolidated-journal.json",
  consolidated_trial_balance: "consolidated-trial-balance.json",
  consolidated_fingerprint: "consolidated-fingerprint.json",
  cancel_cycle_sequence_evidence: "cancel-cycle-sequence-evidence.json",
}
export interface ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceArtifactPublishInput {
  plan: ReplayPortfolioCycleSequencePlan
  reservation: ReplayPortfolioCycleSequenceReservationSnapshot
  cycles: ReplayPortfolioProtectiveStrategyExitCancelCycleSource[]
  evidence: ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceEvidence
  artifact_store: ReplayArtifactStore
}
export function publishReplayPortfolioProtectiveStrategyExitCancelCycleSequenceArtifact(
  input: ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceArtifactPublishInput,
): { manifest: ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceArtifactManifest; idempotent_replay: boolean } {
  return publishReplayPortfolioProtectiveReplacementCycleSequenceArtifact({
    source_kind: "cancel",
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    roles: REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_CYCLE_SEQUENCE_ARTIFACT_ROLES, names: NAMES,
    manifest_name: "portfolio-protective-strategy-exit-cancel-cycle-sequence-artifact-manifest.json",
    artifact_id_prefix: "replay-portfolio-protective-strategy-exit-cancel-cycle-sequence",
    assert_manifest: (value) => assertReplayPortfolioProtectiveStrategyExitCancelCycleSequenceArtifactManifest(
      value as ReplayPortfolioProtectiveStrategyExitCancelCycleSequenceArtifactManifest,
    ),
  }, { ...input, cycles: input.cycles.map((cycle) => ({
    replacement_terminal_manifest: cycle.cancel_terminal_manifest,
    replacement_terminal_evidence: cycle.cancel_terminal_evidence,
    accounting_manifest: cycle.accounting_manifest, accounting_evidence: cycle.accounting_evidence,
  })) } as unknown as ReplayPortfolioProtectiveReplacementCycleArtifactCommonInput)
}
