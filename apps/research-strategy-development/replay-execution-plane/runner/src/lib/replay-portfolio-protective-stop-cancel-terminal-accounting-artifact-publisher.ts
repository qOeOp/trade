import {
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES,
  assertReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactRole,
  type ReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-cancel-terminal-accounting-contracts"
import type {
  ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest,
  ReplayPortfolioProtectiveStopCancelTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-cancel-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import type { ReplayArtifactStore } from "./replay-artifact-store"
import {
  publishReplayPortfolioProtectiveReplacementTerminalAccountingArtifact,
  type ReplayPortfolioProtectiveReplacementTerminalAccountingArtifactCommonInput,
} from "./replay-portfolio-protective-replacement-terminal-accounting-artifact-publisher-common"

const NAMES: Record<ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactRole, string> = {
  cancel_terminal_artifact_manifest: "cancel-terminal-artifact-manifest.json",
  risk_result: "risk-result.json",
  cancel_terminal_evidence: "cancel-terminal-evidence.json",
  cancel_terminal_ledger: "cancel-terminal-ledger.json",
  cancel_terminal_journal: "cancel-terminal-journal.json",
  cancel_terminal_trial_balance: "cancel-terminal-trial-balance.json",
  cancel_terminal_accounting_fingerprint: "cancel-terminal-accounting-fingerprint.json",
  cancel_terminal_accounting_evidence: "cancel-terminal-accounting-evidence.json",
}

export interface ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactPublishInput {
  cancel_terminal_manifest: ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest
  cancel_terminal_evidence: ReplayPortfolioProtectiveStopCancelTerminalEvidence
  risk_result: ReplayRuntimeSharedWalletRiskResult
  evidence: ReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence
  authority_frozen_at: string
  artifact_store: ReplayArtifactStore
}

export function publishReplayPortfolioProtectiveStopCancelTerminalAccountingArtifact(
  input: ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactPublishInput,
): { manifest: ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest; idempotent_replay: boolean } {
  return publishReplayPortfolioProtectiveReplacementTerminalAccountingArtifact({
    source_kind: "cancel",
    schema_version:
      REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    roles: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_ARTIFACT_ROLES,
    names: NAMES,
    manifest_name: "portfolio-protective-stop-cancel-terminal-accounting-artifact-manifest.json",
    artifact_id_prefix: "replay-portfolio-protective-stop-cancel-terminal-accounting",
    assert_manifest: (value) => assertReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest(
      value as ReplayPortfolioProtectiveStopCancelTerminalAccountingArtifactManifest,
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
