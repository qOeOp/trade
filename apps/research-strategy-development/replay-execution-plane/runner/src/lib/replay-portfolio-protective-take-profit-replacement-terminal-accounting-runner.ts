import { createHash } from "node:crypto"
import { createReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence } from
  "../../../accounting/src/lib/replay-portfolio-protective-take-profit-replacement-terminal-accounting"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome,
  replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcomeHash,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-replacement-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest,
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactRole,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-take-profit-replacement-terminal-contracts"
import type {
  ReplayPortfolioProtectiveTerminalArtifactManifest,
  ReplayPortfolioProtectiveTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { assertCertifiedReplayArtifactStore } from "./replay-artifact-store"
import { readReplayPortfolioProtectiveTerminalArtifactEvidence } from
  "./replay-portfolio-protective-terminal-accounting-runner"
import { publishReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifact } from
  "./replay-portfolio-protective-take-profit-replacement-terminal-accounting-artifact-publisher"
import {
  runReplayPortfolioProtectiveTakeProfitReplacementTerminal,
  type ReplayPortfolioProtectiveTakeProfitReplacementTerminalRunInput,
} from "./replay-portfolio-protective-take-profit-replacement-terminal-runner"

const REPLACEMENT_MANIFEST = "portfolio-protective-take-profit-replacement-terminal-artifact-manifest.json"

export interface ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingRunInput
  extends ReplayPortfolioProtectiveTakeProfitReplacementTerminalRunInput {
  publish_replacement_terminal_accounting_artifact?:
    typeof publishReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifact
}

export function runReplayPortfolioProtectiveTakeProfitReplacementTerminalAccounting(
  input: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingRunInput,
): ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome {
  const terminal = runReplayPortfolioProtectiveTakeProfitReplacementTerminal(input)
  if (terminal.status !== "completed" || !terminal.evidence || !terminal.artifact_manifest) {
    return failed(input, "replacement-terminal-execution-failed",
      terminal.failure?.message ?? "Replacement terminal execution failed")
  }
  let replacement: ReturnType<typeof readReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactEvidence>
  let riskResult
  try {
    replacement = readReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactEvidence(
      input, terminal.evidence, terminal.artifact_manifest,
    )
    const source = readReplayPortfolioProtectiveTerminalArtifactEvidence({
      ...input,
      allow_predeclared_take_profit_replacement_projection: true,
    }, replacement.source_protective_terminal_evidence,
    replacement.source_protective_terminal_manifest)
    riskResult = source.risk_result
    if (riskResult.result_hash !== replacement.replacement_terminal_evidence.risk_result_hash) {
      throw new Error("Replacement terminal Risk Result source drift")
    }
  } catch (error) {
    return failed(input, "replacement-terminal-artifact-read-failed", error)
  }
  let evidence
  try {
    evidence = createReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingEvidence({
      replacement_terminal_evidence: replacement.replacement_terminal_evidence,
      replacement_terminal_manifest: replacement.replacement_terminal_manifest,
      risk_result: riskResult,
    })
  } catch (error) {
    return failed(input, "replacement-terminal-accounting-invalid", error)
  }
  try {
    const published = (input.publish_replacement_terminal_accounting_artifact
      ?? publishReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingArtifact)({
      replacement_terminal_manifest: replacement.replacement_terminal_manifest,
      replacement_terminal_evidence: replacement.replacement_terminal_evidence,
      risk_result: riskResult,
      evidence,
      authority_frozen_at: input.allocation_reservation.issued_at,
      artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome,
      "outcome_hash"> = {
        schema_version:
          REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
        portfolio_id: input.integrated_plan.portfolio_id,
        status: "completed",
        replacement_terminal_evidence: replacement.replacement_terminal_evidence,
        evidence,
        artifact_manifest: published.manifest,
        idempotent_replay: terminal.idempotent_replay && published.idempotent_replay,
        failure: null,
      }
    const outcome = {
      ...body,
      outcome_hash:
        replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcomeHash(body),
    }
    assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "replacement-terminal-accounting-artifact-failed", error)
  }
}

export function readReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactEvidence(
  input: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingRunInput,
  expectedEvidence: ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence,
  expectedManifest: ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest,
): {
  replacement_terminal_manifest: ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest
  replacement_terminal_evidence: ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence
  source_protective_terminal_manifest: ReplayPortfolioProtectiveTerminalArtifactManifest
  source_protective_terminal_evidence: ReplayPortfolioProtectiveTerminalEvidence
} {
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({
      source_protective_terminal_evidence_hash: expectedEvidence.source_protective_terminal_evidence_hash,
      replacement_terminal_policy: expectedEvidence.policy_version,
    }),
    attempt_id_hash: expectedEvidence.evidence_hash,
  })
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(REPLACEMENT_MANIFEST).bytes)) as
    ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactManifest(manifest)
  if (canonicalHash(manifest) !== canonicalHash(expectedManifest)) {
    throw new Error("Replacement Terminal Artifact manifest read drift")
  }
  const values = new Map<ReplayPortfolioProtectiveTakeProfitReplacementTerminalArtifactRole, unknown>()
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.ref !== read.ref || file.sha256 !== sha256(read.bytes)) {
      throw new Error("Replacement Terminal Artifact payload hash drift")
    }
    values.set(file.role, JSON.parse(new TextDecoder().decode(read.bytes)))
  }
  const evidence = values.get("replacement_terminal_evidence") as
    ReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence | undefined
  const sourceManifest = values.get("source_protective_terminal_artifact_manifest") as
    ReplayPortfolioProtectiveTerminalArtifactManifest | undefined
  const sourceEvidence = values.get("source_protective_terminal_evidence") as
    ReplayPortfolioProtectiveTerminalEvidence | undefined
  if (!evidence || !sourceManifest || !sourceEvidence) {
    throw new Error("Replacement Terminal Artifact accounting sources missing")
  }
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalEvidence(evidence)
  if (canonicalHash(evidence) !== canonicalHash(expectedEvidence)
      || evidence.evidence_hash !== manifest.replacement_terminal_evidence_hash
      || sourceEvidence.evidence_hash !== evidence.source_protective_terminal_evidence_hash
      || sourceManifest.manifest_hash !== evidence.source_protective_terminal_artifact_manifest_hash
      || sourceManifest.protective_terminal_evidence_hash !== sourceEvidence.evidence_hash) {
    throw new Error("Replacement Terminal Artifact accounting source binding drift")
  }
  return {
    replacement_terminal_manifest: manifest,
    replacement_terminal_evidence: evidence,
    source_protective_terminal_manifest: sourceManifest,
    source_protective_terminal_evidence: sourceEvidence,
  }
}

function failed(
  input: ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingRunInput,
  code: NonNullable<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome {
  const body: Omit<ReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome,
    "outcome_hash"> = {
      schema_version:
        REPLAY_PORTFOLIO_PROTECTIVE_TAKE_PROFIT_REPLACEMENT_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.integrated_plan.portfolio_id,
      status: "failed",
      replacement_terminal_evidence: null,
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
    outcome_hash: replayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcomeHash(body),
  }
  assertReplayPortfolioProtectiveTakeProfitReplacementTerminalAccountingOutcome(outcome)
  return outcome
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
