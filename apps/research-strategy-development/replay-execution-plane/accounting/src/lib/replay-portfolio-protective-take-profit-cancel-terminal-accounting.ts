import {
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_LIMITATIONS,
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-cancel-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveTakeProfitCancelTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence,
  type ReplayPortfolioProtectiveTakeProfitCancelTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-cancel-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import {
  createReplayPortfolioProtectiveReplacementTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput,
} from "./replay-portfolio-protective-replacement-terminal-accounting-common"

export interface ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingInput {
  cancel_terminal_evidence: ReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence
  cancel_terminal_manifest: ReplayPortfolioProtectiveTakeProfitCancelTerminalArtifactManifest
  risk_result: ReplayRuntimeSharedWalletRiskResult
}

export function createReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence(
  input: ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingInput,
): ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence {
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
      REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
    accounting_policy_version:
      REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION,
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_CANCEL_TERMINAL_ACCOUNTING_LIMITATIONS,
    trial_balance_error: "Take-profit cancel terminal Trial Balance does not reconcile stop-preserved economics",
    assert_terminal_evidence: (value) => assertReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence(
      value as ReplayPortfolioProtectiveTakeProfitCancelTerminalEvidence,
    ),
    assert_terminal_manifest: () => assertReplayPortfolioProtectiveTakeProfitCancelTerminalArtifactManifest(
      input.cancel_terminal_manifest,
    ),
    assert_accounting_evidence: (value) =>
      assertReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence(
        value as ReplayPortfolioProtectiveTakeProfitCancelTerminalAccountingEvidence,
        input,
      ),
  }, commonInput)
}
