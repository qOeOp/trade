import {
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES,
  assertReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactRole,
  type ReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-replacement-terminal-accounting-contracts"
import type {
  ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
  ReplayPortfolioProtectiveStopReplacementTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-replacement-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import type { ReplayArtifactStore } from "./replay-artifact-store"
import {
  publishReplayPortfolioProtectiveReplacementTerminalAccountingArtifact,
  type ReplayPortfolioProtectiveReplacementTerminalAccountingArtifactCommonInput,
} from "./replay-portfolio-protective-replacement-terminal-accounting-artifact-publisher-common"

const NAMES: Record<ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactRole, string> = {
  replacement_terminal_artifact_manifest: "replacement-terminal-artifact-manifest.json",
  risk_result: "risk-result.json",
  replacement_terminal_evidence: "replacement-terminal-evidence.json",
  replacement_terminal_ledger: "replacement-terminal-ledger.json",
  replacement_terminal_journal: "replacement-terminal-journal.json",
  replacement_terminal_trial_balance: "replacement-terminal-trial-balance.json",
  replacement_terminal_accounting_fingerprint: "replacement-terminal-accounting-fingerprint.json",
  replacement_terminal_accounting_evidence: "replacement-terminal-accounting-evidence.json",
}

export interface ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactPublishInput {
  replacement_terminal_manifest: ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest
  replacement_terminal_evidence: ReplayPortfolioProtectiveStopReplacementTerminalEvidence
  risk_result: ReplayRuntimeSharedWalletRiskResult
  evidence: ReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence
  authority_frozen_at: string
  artifact_store: ReplayArtifactStore
}

export function publishReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifact(
  input: ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactPublishInput,
): { manifest: ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest; idempotent_replay: boolean } {
  return publishReplayPortfolioProtectiveReplacementTerminalAccountingArtifact({
    schema_version:
      REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    roles: REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES,
    names: NAMES,
    manifest_name: "portfolio-protective-stop-replacement-terminal-accounting-artifact-manifest.json",
    artifact_id_prefix: "replay-portfolio-protective-stop-replacement-terminal-accounting",
    assert_manifest: (value) => assertReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest(
      value as ReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifactManifest,
    ),
  }, input as unknown as ReplayPortfolioProtectiveReplacementTerminalAccountingArtifactCommonInput)
}
