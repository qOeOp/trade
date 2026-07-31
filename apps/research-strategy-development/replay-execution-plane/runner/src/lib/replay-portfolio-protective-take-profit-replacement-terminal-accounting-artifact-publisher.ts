import {
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES,
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactRole,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-replacement-terminal-accounting-contracts"
import type {
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest,
  ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-replacement-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import type { ReplayArtifactStore } from "./replay-artifact-store"
import {
  publishReplayPortfolioProtectiveReplacementTerminalAccountingArtifact,
  type ReplayPortfolioProtectiveReplacementTerminalAccountingArtifactCommonInput,
} from "./replay-portfolio-protective-replacement-terminal-accounting-artifact-publisher-common"

const NAMES: Record<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactRole, string> = {
  replacement_terminal_artifact_manifest: "replacement-terminal-artifact-manifest.json",
  risk_result: "risk-result.json",
  replacement_terminal_evidence: "replacement-terminal-evidence.json",
  replacement_terminal_ledger: "replacement-terminal-ledger.json",
  replacement_terminal_journal: "replacement-terminal-journal.json",
  replacement_terminal_trial_balance: "replacement-terminal-trial-balance.json",
  replacement_terminal_accounting_fingerprint: "replacement-terminal-accounting-fingerprint.json",
  replacement_terminal_accounting_evidence: "replacement-terminal-accounting-evidence.json",
}

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactPublishInput {
  replacement_terminal_manifest: ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest
  replacement_terminal_evidence: ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence
  risk_result: ReplayRuntimeSharedWalletRiskResult
  evidence: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence
  authority_frozen_at: string
  artifact_store: ReplayArtifactStore
}

export function publishReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifact(
  input: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactPublishInput,
): { manifest: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest; idempotent_replay: boolean } {
  return publishReplayPortfolioProtectiveReplacementTerminalAccountingArtifact({
    schema_version:
      REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    roles: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_ARTIFACT_ROLES,
    names: NAMES,
    manifest_name: "portfolio-protective-take-profit-replacement-terminal-accounting-artifact-manifest.json",
    artifact_id_prefix: "replay-portfolio-protective-take-profit-replacement-terminal-accounting",
    assert_manifest: (value) => assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest(
      value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifactManifest,
    ),
  }, input as unknown as ReplayPortfolioProtectiveReplacementTerminalAccountingArtifactCommonInput)
}
