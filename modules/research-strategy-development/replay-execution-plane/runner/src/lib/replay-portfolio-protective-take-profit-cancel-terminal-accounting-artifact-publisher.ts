import {
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES,
  assertReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactRole,
  type ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-cancel-terminal-accounting-contracts"
import type {
  ReplayPortfolioProtectiveTakeProfitCancelTerminalArtifactManifest,
  ReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-cancel-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import type { ReplayArtifactStore } from "./replay-artifact-store"
import {
  publishReplayPortfolioProtectiveReplacementTerminalAccountingArtifact,
  type ReplayPortfolioProtectiveReplacementTerminalAccountingArtifactCommonInput,
} from "./replay-portfolio-protective-replacement-terminal-accounting-artifact-publisher-common"

const NAMES: Record<ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactRole, string> = {
  cancel_terminal_artifact_manifest: "cancel-terminal-artifact-manifest.json",
  risk_result: "risk-result.json",
  cancel_terminal_evidence: "cancel-terminal-evidence.json",
  cancel_terminal_ledger: "cancel-terminal-ledger.json",
  cancel_terminal_journal: "cancel-terminal-journal.json",
  cancel_terminal_trial_balance: "cancel-terminal-trial-balance.json",
  cancel_terminal_accounting_fingerprint: "cancel-terminal-accounting-fingerprint.json",
  cancel_terminal_accounting_evidence: "cancel-terminal-accounting-evidence.json",
}

export interface ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactPublishInput {
  cancel_terminal_manifest: ReplayPortfolioProtectiveTakeProfitCancelTerminalArtifactManifest
  cancel_terminal_evidence: ReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence
  risk_result: ReplayRuntimeSharedWalletRiskResult
  evidence: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence
  authority_frozen_at: string
  artifact_store: ReplayArtifactStore
}

export function publishReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifact(
  input: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactPublishInput,
): { manifest: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifest; idempotent_replay: boolean } {
  return publishReplayPortfolioProtectiveReplacementTerminalAccountingArtifact({
    source_kind: "cancel",
    schema_version:
      REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    roles: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES,
    names: NAMES,
    manifest_name: "portfolio-protective-take-profit-cancel-terminal-accounting-artifact-manifest.json",
    artifact_id_prefix: "replay-portfolio-protective-take-profit-cancel-terminal-accounting",
    assert_manifest: (value) => assertReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifest(
      value as ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingArtifactManifest,
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
