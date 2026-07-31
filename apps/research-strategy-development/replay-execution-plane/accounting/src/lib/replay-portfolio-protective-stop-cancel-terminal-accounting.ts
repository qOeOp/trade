import {
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_LIMITATIONS,
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-cancel-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveStopCancelTerminalArtifactManifest,
  assertReplayPortfolioProtectiveStopCancelTerminalEvidence,
  type ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest,
  type ReplayPortfolioProtectiveStopCancelTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-cancel-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import {
  createReplayPortfolioProtectiveReplacementTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput,
} from "./replay-portfolio-protective-replacement-terminal-accounting-common"

export interface ReplayPortfolioProtectiveStopCancelTerminalAccountingInput {
  cancel_terminal_evidence: ReplayPortfolioProtectiveStopCancelTerminalEvidence
  cancel_terminal_manifest: ReplayPortfolioProtectiveStopCancelTerminalArtifactManifest
  risk_result: ReplayRuntimeSharedWalletRiskResult
}

export function createReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence(
  input: ReplayPortfolioProtectiveStopCancelTerminalAccountingInput,
): ReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence {
  const commonInput = {
    replacement_terminal_evidence: input.cancel_terminal_evidence,
    replacement_terminal_manifest: {
      ...input.cancel_terminal_manifest,
      replacement_terminal_evidence_hash: input.cancel_terminal_manifest.cancel_terminal_evidence_hash,
    },
    risk_result: input.risk_result,
  } as unknown as ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput
  return createReplayPortfolioProtectiveReplacementTerminalAccountingEvidence({
    source_kind: "cancel",
    evidence_schema_version:
      REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
    accounting_policy_version:
      REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION,
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_STOP_CANCEL_TERMINAL_ACCOUNTING_LIMITATIONS,
    trial_balance_error: "Protective-stop cancel Trial Balance does not reconcile target-only economics",
    assert_terminal_evidence: (value) => assertReplayPortfolioProtectiveStopCancelTerminalEvidence(
      value as ReplayPortfolioProtectiveStopCancelTerminalEvidence,
    ),
    assert_terminal_manifest: () => assertReplayPortfolioProtectiveStopCancelTerminalArtifactManifest(
      input.cancel_terminal_manifest,
    ),
    assert_accounting_evidence: (value) =>
      assertReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence(
        value as ReplayPortfolioProtectiveStopCancelTerminalAccountingEvidence,
        input,
      ),
  }, commonInput)
}
