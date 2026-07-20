import {
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES,
  assertReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingArtifactRole,
  type ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-strategy-exit-cancel-terminal-accounting-contracts"
import type {
  ReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifest,
  ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-strategy-exit-cancel-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import type { ReplayArtifactStore } from "./replay-artifact-store"
import {
  publishReplayPortfolioProtectiveReplacementTerminalAccountingArtifact,
  type ReplayPortfolioProtectiveReplacementTerminalAccountingArtifactCommonInput,
} from "./replay-portfolio-protective-replacement-terminal-accounting-artifact-publisher-common"

const NAMES: Record<ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingArtifactRole, string> = {
  cancel_terminal_artifact_manifest: "cancel-terminal-artifact-manifest.json",
  risk_result: "risk-result.json",
  cancel_terminal_evidence: "cancel-terminal-evidence.json",
  cancel_terminal_ledger: "cancel-terminal-ledger.json",
  cancel_terminal_journal: "cancel-terminal-journal.json",
  cancel_terminal_trial_balance: "cancel-terminal-trial-balance.json",
  cancel_terminal_accounting_fingerprint: "cancel-terminal-accounting-fingerprint.json",
  cancel_terminal_accounting_evidence: "cancel-terminal-accounting-evidence.json",
}

export interface ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingArtifactPublishInput {
  cancel_terminal_manifest: ReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifest
  cancel_terminal_evidence: ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence
  risk_result: ReplayRuntimeSharedWalletRiskResult
  evidence: ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidence
  authority_frozen_at: string
  artifact_store: ReplayArtifactStore
}

export function publishReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingArtifact(
  input: ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingArtifactPublishInput,
): { manifest: ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingArtifactManifest; idempotent_replay: boolean } {
  return publishReplayPortfolioProtectiveReplacementTerminalAccountingArtifact({
    source_kind: "cancel",
    schema_version:
      REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    roles: REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES,
    names: NAMES,
    manifest_name: "portfolio-protective-strategy-exit-cancel-terminal-accounting-artifact-manifest.json",
    artifact_id_prefix: "replay-portfolio-protective-strategy-exit-cancel-terminal-accounting",
    assert_manifest: (value) => assertReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingArtifactManifest(
      value as ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingArtifactManifest,
    ),
  }, {
    replacement_terminal_manifest: input.cancel_terminal_manifest,
    replacement_terminal_evidence: input.cancel_terminal_evidence,
    risk_result: input.risk_result,
    evidence: input.evidence,
    authority_frozen_at: input.authority_frozen_at,
    artifact_store: input.artifact_store,
  } as unknown as ReplayPortfolioProtectiveReplacementTerminalAccountingArtifactCommonInput)
}
