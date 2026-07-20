import {
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_LIMITATIONS,
  REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-strategy-exit-cancel-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifest,
  assertReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence,
  type ReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifest,
  type ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-strategy-exit-cancel-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import {
  createReplayPortfolioProtectiveReplacementTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput,
} from "./replay-portfolio-protective-replacement-terminal-accounting-common"

export interface ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingInput {
  cancel_terminal_evidence: ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence
  cancel_terminal_manifest: ReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifest
  risk_result: ReplayRuntimeSharedWalletRiskResult
}

export function createReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidence(
  input: ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingInput,
): ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidence {
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
      REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
    accounting_policy_version:
      REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_POLICY_VERSION,
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_STRATEGY_EXIT_CANCEL_TERMINAL_ACCOUNTING_LIMITATIONS,
    trial_balance_error: "Strategy-exit cancel terminal Trial Balance does not reconcile bracket-preserved economics",
    assert_terminal_evidence: (value) => assertReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence(
      value as ReplayPortfolioProtectiveStrategyExitCancelTerminalEvidence,
    ),
    assert_terminal_manifest: () => assertReplayPortfolioProtectiveStrategyExitCancelTerminalArtifactManifest(
      input.cancel_terminal_manifest,
    ),
    assert_accounting_evidence: (value) =>
      assertReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidence(
        value as ReplayPortfolioProtectiveStrategyExitCancelTerminalAccountingEvidence,
        input,
      ),
  }, commonInput)
}
