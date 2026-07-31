import {
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_LIMITATIONS,
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-replacement-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-replacement-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import {
  createReplayPortfolioProtectiveReplacementTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput,
} from "./replay-portfolio-protective-replacement-terminal-accounting-common"

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingInput {
  replacement_terminal_evidence: ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence
  replacement_terminal_manifest: ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest
  risk_result: ReplayRuntimeSharedWalletRiskResult
}

export function createReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence(
  input: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingInput,
): ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence {
  return createReplayPortfolioProtectiveReplacementTerminalAccountingEvidence({
    evidence_schema_version:
      REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
    accounting_policy_version:
      REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION,
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_LIMITATIONS,
    trial_balance_error: "Take-profit replacement terminal Trial Balance does not reconcile successor economics",
    assert_terminal_evidence: (value) =>
      assertReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence(
        value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
      ),
    assert_terminal_manifest: (value) =>
      assertReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest(
        value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest,
      ),
    assert_accounting_evidence: (value, source) =>
      assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence(
        value as ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence,
        source as unknown as ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingInput,
      ),
  }, input as unknown as ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput)
}
