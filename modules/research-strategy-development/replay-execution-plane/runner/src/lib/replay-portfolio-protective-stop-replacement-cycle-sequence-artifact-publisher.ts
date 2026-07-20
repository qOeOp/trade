import type { ReplayPortfolioCycleSequenceReservationSnapshot } from
  "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES,
  assertReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifest,
  type ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifest,
  type ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactRole,
  type ReplayPortfolioProtectiveStopReplacementCycleSequenceEvidence,
  type ReplayPortfolioProtectiveStopReplacementCycleSource,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-replacement-cycle-sequence-contracts"
import type { ReplayPortfolioCycleSequencePlan } from
  "../../../contracts/src/lib/replay-portfolio-cycle-sequence-contracts"
import type { ReplayArtifactStore } from "./replay-artifact-store"
import {
  publishReplayPortfolioProtectiveReplacementCycleSequenceArtifact,
  type ReplayPortfolioProtectiveReplacementCycleArtifactCommonInput,
} from "./replay-portfolio-protective-replacement-cycle-sequence-artifact-publisher-common"

const NAMES: Record<ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactRole, string> = {
  cycle_sequence_plan: "cycle-sequence-plan.json",
  cycle_sequence_reservation: "cycle-sequence-reservation.json",
  cycle_replacement_terminal_artifact_manifests: "cycle-replacement-terminal-artifact-manifests.json",
  cycle_replacement_terminal_evidence: "cycle-replacement-terminal-evidence.json",
  cycle_replacement_terminal_accounting_artifact_manifests:
    "cycle-replacement-terminal-accounting-artifact-manifests.json",
  cycle_replacement_terminal_accounting_evidence: "cycle-replacement-terminal-accounting-evidence.json",
  consolidated_ledger: "consolidated-ledger.json",
  consolidated_journal: "consolidated-journal.json",
  consolidated_trial_balance: "consolidated-trial-balance.json",
  consolidated_fingerprint: "consolidated-fingerprint.json",
  replacement_cycle_sequence_evidence: "replacement-cycle-sequence-evidence.json",
}

export interface ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactPublishInput {
  plan: ReplayPortfolioCycleSequencePlan
  reservation: ReplayPortfolioCycleSequenceReservationSnapshot
  cycles: ReplayPortfolioProtectiveStopReplacementCycleSource[]
  evidence: ReplayPortfolioProtectiveStopReplacementCycleSequenceEvidence
  artifact_store: ReplayArtifactStore
}

export function publishReplayPortfolioProtectiveStopReplacementCycleSequenceArtifact(
  input: ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactPublishInput,
): { manifest: ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifest; idempotent_replay: boolean } {
  return publishReplayPortfolioProtectiveReplacementCycleSequenceArtifact({
    schema_version:
      REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    roles: REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_CYCLE_SEQUENCE_ARTIFACT_ROLES,
    names: NAMES,
    manifest_name: "portfolio-protective-stop-replacement-cycle-sequence-artifact-manifest.json",
    artifact_id_prefix: "replay-portfolio-protective-stop-replacement-cycle-sequence",
    assert_manifest: (value) => assertReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifest(
      value as ReplayPortfolioProtectiveStopReplacementCycleSequenceArtifactManifest,
    ),
  }, input as unknown as ReplayPortfolioProtectiveReplacementCycleArtifactCommonInput)
}
