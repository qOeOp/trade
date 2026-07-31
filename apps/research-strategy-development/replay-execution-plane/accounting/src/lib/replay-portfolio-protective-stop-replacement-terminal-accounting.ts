import {
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_LIMITATIONS,
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-replacement-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
  assertReplayPortfolioProtectiveStopReplacementTerminalEvidence,
  type ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
  type ReplayPortfolioProtectiveStopReplacementTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-replacement-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import {
  createReplayPortfolioProtectiveReplacementTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput,
} from "./replay-portfolio-protective-replacement-terminal-accounting-common"

export interface ReplayPortfolioProtectiveStopReplacementTerminalAccountingInput {
  replacement_terminal_evidence: ReplayPortfolioProtectiveStopReplacementTerminalEvidence
  replacement_terminal_manifest: ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest
  risk_result: ReplayRuntimeSharedWalletRiskResult
}

export function createReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence(
  input: ReplayPortfolioProtectiveStopReplacementTerminalAccountingInput,
): ReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence {
  return createReplayPortfolioProtectiveReplacementTerminalAccountingEvidence({
    evidence_schema_version:
      REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_EVIDENCE_SCHEMA_VERSION,
    accounting_policy_version:
      REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_POLICY_VERSION,
    limitations: REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_LIMITATIONS,
    trial_balance_error: "Replacement terminal Trial Balance does not reconcile P19 economics",
    assert_terminal_evidence: (value) =>
      assertReplayPortfolioProtectiveStopReplacementTerminalEvidence(
        value as ReplayPortfolioProtectiveStopReplacementTerminalEvidence,
      ),
    assert_terminal_manifest: (value) =>
      assertReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest(
        value as ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
      ),
    assert_accounting_evidence: (value, source) =>
      assertReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence(
        value as ReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence,
        source as unknown as ReplayPortfolioProtectiveStopReplacementTerminalAccountingInput,
      ),
  }, input as unknown as ReplayPortfolioProtectiveReplacementTerminalAccountingCommonInput)
}
