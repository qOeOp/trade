import { createHash } from "node:crypto"
import { createReplayPortfolioProtectiveTerminalAccountingEvidence } from
  "../../../accounting/src/lib/replay-portfolio-protective-terminal-accounting"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioProtectiveTerminalAccountingOutcome,
  replayPortfolioProtectiveTerminalAccountingOutcomeHash,
  type ReplayPortfolioProtectiveTerminalAccountingOutcome,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTerminalEvidence,
  type ReplayPortfolioProtectiveTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTerminalArtifactRole,
  type ReplayPortfolioProtectiveTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import {
  replayRuntimeSharedWalletRiskResultHash,
  type ReplayRuntimeSharedWalletRiskResult,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { assertCertifiedReplayArtifactStore } from "./replay-artifact-store"
import {
  publishReplayPortfolioProtectiveTerminalAccountingArtifact,
} from "./replay-portfolio-protective-terminal-accounting-artifact-publisher"
import {
  runReplayPortfolioProtectiveTerminal,
  type ReplayPortfolioProtectiveTerminalRunInput,
} from "./replay-portfolio-protective-terminal-runner"

const PROTECTIVE_MANIFEST = "portfolio-protective-terminal-artifact-manifest.json"

export interface ReplayPortfolioProtectiveTerminalAccountingRunInput
  extends ReplayPortfolioProtectiveTerminalRunInput {
  publish_protective_terminal_accounting_artifact?:
    typeof publishReplayPortfolioProtectiveTerminalAccountingArtifact
}

export function runReplayPortfolioProtectiveTerminalAccounting(
  input: ReplayPortfolioProtectiveTerminalAccountingRunInput,
): ReplayPortfolioProtectiveTerminalAccountingOutcome {
  const terminal = runReplayPortfolioProtectiveTerminal(input)
  if (terminal.status !== "completed" || !terminal.evidence || !terminal.artifact_manifest) {
    return failed(input, "protective-terminal-execution-failed",
      terminal.failure?.message ?? "Protective terminal execution failed")
  }
  let source: ReturnType<typeof readReplayPortfolioProtectiveTerminalArtifactEvidence>
  try {
    source = readReplayPortfolioProtectiveTerminalArtifactEvidence(
      input, terminal.evidence, terminal.artifact_manifest,
    )
  } catch (error) {
    return failed(input, "protective-terminal-artifact-read-failed", error)
  }
  let evidence
  try {
    evidence = createReplayPortfolioProtectiveTerminalAccountingEvidence({
      protective_terminal_evidence: source.protective_terminal_evidence,
      protective_terminal_manifest: source.protective_terminal_manifest,
      risk_result: source.risk_result,
    })
  } catch (error) {
    return failed(input, "protective-terminal-accounting-invalid", error)
  }
  try {
    const published = (input.publish_protective_terminal_accounting_artifact
      ?? publishReplayPortfolioProtectiveTerminalAccountingArtifact)({
      protective_terminal_manifest: source.protective_terminal_manifest,
      protective_terminal_evidence: source.protective_terminal_evidence,
      risk_result: source.risk_result,
      evidence,
      authority_frozen_at: input.allocation_reservation.issued_at,
      artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioProtectiveTerminalAccountingOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.integrated_plan.portfolio_id,
      status: "completed",
      protective_terminal_evidence: source.protective_terminal_evidence,
      evidence,
      artifact_manifest: published.manifest,
      idempotent_replay: terminal.idempotent_replay && published.idempotent_replay,
      failure: null,
    }
    const outcome = {
      ...body,
      outcome_hash: replayPortfolioProtectiveTerminalAccountingOutcomeHash(body),
    }
    assertReplayPortfolioProtectiveTerminalAccountingOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "protective-terminal-accounting-artifact-failed", error)
  }
}

export function readReplayPortfolioProtectiveTerminalArtifactEvidence(
  input: ReplayPortfolioProtectiveTerminalAccountingRunInput,
  expectedEvidence: ReplayPortfolioProtectiveTerminalEvidence,
  expectedManifest: ReplayPortfolioProtectiveTerminalArtifactManifest,
): {
  protective_terminal_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
  protective_terminal_evidence: ReplayPortfolioProtectiveTerminalEvidence
  risk_result: ReplayRuntimeSharedWalletRiskResult
} {
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({
      revaluation_evidence_hash: expectedEvidence.mark_risk_revaluation_evidence_hash,
      protective_terminal_policy: expectedEvidence.policy_version,
    }),
    attempt_id_hash: expectedEvidence.evidence_hash,
  })
  const manifestRead = namespace.read(PROTECTIVE_MANIFEST)
  const manifest = JSON.parse(new TextDecoder().decode(manifestRead.bytes)) as
    ReplayPortfolioProtectiveTerminalArtifactManifest
  assertReplayPortfolioProtectiveTerminalArtifactManifest(manifest)
  if (canonicalHash(manifest) !== canonicalHash(expectedManifest)) {
    throw new Error("Protective Terminal Artifact manifest read drift")
  }
  const values = new Map<ReplayPortfolioProtectiveTerminalArtifactRole, unknown>()
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.ref !== read.ref || file.sha256 !== sha256(read.bytes)) {
      throw new Error("Protective Terminal Artifact payload hash drift")
    }
    values.set(file.role, JSON.parse(new TextDecoder().decode(read.bytes)))
  }
  const evidence = values.get("protective_terminal_evidence") as ReplayPortfolioProtectiveTerminalEvidence | undefined
  const risk = values.get("risk_result") as ReplayRuntimeSharedWalletRiskResult | undefined
  if (!evidence || !risk) throw new Error("Protective Terminal Artifact accounting sources missing")
  assertReplayPortfolioProtectiveTerminalEvidence(evidence)
  if (risk.result_hash !== replayRuntimeSharedWalletRiskResultHash(risk)
      || canonicalHash(evidence) !== canonicalHash(expectedEvidence)
      || evidence.evidence_hash !== manifest.protective_terminal_evidence_hash
      || risk.result_hash !== evidence.risk_result_hash) {
    throw new Error("Protective Terminal Artifact accounting source binding drift")
  }
  return {
    protective_terminal_manifest: manifest,
    protective_terminal_evidence: evidence,
    risk_result: risk,
  }
}

function failed(
  input: ReplayPortfolioProtectiveTerminalAccountingRunInput,
  code: NonNullable<ReplayPortfolioProtectiveTerminalAccountingOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioProtectiveTerminalAccountingOutcome {
  const body: Omit<ReplayPortfolioProtectiveTerminalAccountingOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.integrated_plan.portfolio_id,
    status: "failed",
    protective_terminal_evidence: null,
    evidence: null,
    artifact_manifest: null,
    idempotent_replay: false,
    failure: {
      code,
      message: error instanceof Error ? error.message : String(error),
      partial_result_published: false,
    },
  }
  const outcome = {
    ...body,
    outcome_hash: replayPortfolioProtectiveTerminalAccountingOutcomeHash(body),
  }
  assertReplayPortfolioProtectiveTerminalAccountingOutcome(outcome)
  return outcome
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
