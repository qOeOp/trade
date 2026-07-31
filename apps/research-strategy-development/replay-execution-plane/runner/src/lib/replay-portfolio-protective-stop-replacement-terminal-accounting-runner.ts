import { createHash } from "node:crypto"
import { createReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence } from
  "../../../accounting/src/lib/replay-portfolio-protective-stop-replacement-terminal-accounting"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome,
  replayPortfolioProtectiveStopReplacementTerminalAccountingOutcomeHash,
  type ReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-replacement-terminal-accounting-contracts"
import {
  assertReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
  assertReplayPortfolioProtectiveStopReplacementTerminalEvidence,
  type ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
  type ReplayPortfolioProtectiveStopReplacementTerminalArtifactRole,
  type ReplayPortfolioProtectiveStopReplacementTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-stop-replacement-terminal-contracts"
import type {
  ReplayPortfolioProtectiveTerminalArtifactManifest,
  ReplayPortfolioProtectiveTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { assertCertifiedReplayArtifactStore } from "./replay-artifact-store"
import { readReplayPortfolioProtectiveTerminalArtifactEvidence } from
  "./replay-portfolio-protective-terminal-accounting-runner"
import { publishReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifact } from
  "./replay-portfolio-protective-stop-replacement-terminal-accounting-artifact-publisher"
import {
  runReplayPortfolioProtectiveStopReplacementTerminal,
  type ReplayPortfolioProtectiveStopReplacementTerminalRunInput,
} from "./replay-portfolio-protective-stop-replacement-terminal-runner"

const REPLACEMENT_MANIFEST = "portfolio-protective-stop-replacement-terminal-artifact-manifest.json"

export interface ReplayPortfolioProtectiveStopReplacementTerminalAccountingRunInput
  extends ReplayPortfolioProtectiveStopReplacementTerminalRunInput {
  publish_replacement_terminal_accounting_artifact?:
    typeof publishReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifact
}

export function runReplayPortfolioProtectiveStopReplacementTerminalAccounting(
  input: ReplayPortfolioProtectiveStopReplacementTerminalAccountingRunInput,
): ReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome {
  const terminal = runReplayPortfolioProtectiveStopReplacementTerminal(input)
  if (terminal.status !== "completed" || !terminal.evidence || !terminal.artifact_manifest) {
    return failed(input, "replacement-terminal-execution-failed",
      terminal.failure?.message ?? "Replacement terminal execution failed")
  }
  let replacement: ReturnType<typeof readReplayPortfolioProtectiveStopReplacementTerminalArtifactEvidence>
  let riskResult
  try {
    replacement = readReplayPortfolioProtectiveStopReplacementTerminalArtifactEvidence(
      input, terminal.evidence, terminal.artifact_manifest,
    )
    const source = readReplayPortfolioProtectiveTerminalArtifactEvidence({
      ...input,
      allow_predeclared_protective_stop_replacement_projection: true,
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
    evidence = createReplayPortfolioProtectiveStopReplacementTerminalAccountingEvidence({
      replacement_terminal_evidence: replacement.replacement_terminal_evidence,
      replacement_terminal_manifest: replacement.replacement_terminal_manifest,
      risk_result: riskResult,
    })
  } catch (error) {
    return failed(input, "replacement-terminal-accounting-invalid", error)
  }
  try {
    const published = (input.publish_replacement_terminal_accounting_artifact
      ?? publishReplayPortfolioProtectiveStopReplacementTerminalAccountingArtifact)({
      replacement_terminal_manifest: replacement.replacement_terminal_manifest,
      replacement_terminal_evidence: replacement.replacement_terminal_evidence,
      risk_result: riskResult,
      evidence,
      authority_frozen_at: input.allocation_reservation.issued_at,
      artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome,
      "outcome_hash"> = {
        schema_version:
          REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
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
        replayPortfolioProtectiveStopReplacementTerminalAccountingOutcomeHash(body),
    }
    assertReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "replacement-terminal-accounting-artifact-failed", error)
  }
}

export function readReplayPortfolioProtectiveStopReplacementTerminalArtifactEvidence(
  input: ReplayPortfolioProtectiveStopReplacementTerminalAccountingRunInput,
  expectedEvidence: ReplayPortfolioProtectiveStopReplacementTerminalEvidence,
  expectedManifest: ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest,
): {
  replacement_terminal_manifest: ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest
  replacement_terminal_evidence: ReplayPortfolioProtectiveStopReplacementTerminalEvidence
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
    ReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest
  assertReplayPortfolioProtectiveStopReplacementTerminalArtifactManifest(manifest)
  if (canonicalHash(manifest) !== canonicalHash(expectedManifest)) {
    throw new Error("Replacement Terminal Artifact manifest read drift")
  }
  const values = new Map<ReplayPortfolioProtectiveStopReplacementTerminalArtifactRole, unknown>()
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.ref !== read.ref || file.sha256 !== sha256(read.bytes)) {
      throw new Error("Replacement Terminal Artifact payload hash drift")
    }
    values.set(file.role, JSON.parse(new TextDecoder().decode(read.bytes)))
  }
  const evidence = values.get("replacement_terminal_evidence") as
    ReplayPortfolioProtectiveStopReplacementTerminalEvidence | undefined
  const sourceManifest = values.get("source_protective_terminal_artifact_manifest") as
    ReplayPortfolioProtectiveTerminalArtifactManifest | undefined
  const sourceEvidence = values.get("source_protective_terminal_evidence") as
    ReplayPortfolioProtectiveTerminalEvidence | undefined
  if (!evidence || !sourceManifest || !sourceEvidence) {
    throw new Error("Replacement Terminal Artifact accounting sources missing")
  }
  assertReplayPortfolioProtectiveStopReplacementTerminalEvidence(evidence)
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
  input: ReplayPortfolioProtectiveStopReplacementTerminalAccountingRunInput,
  code: NonNullable<ReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome {
  const body: Omit<ReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome,
    "outcome_hash"> = {
      schema_version:
        REPLAY_PORTFOLIO_PROTECTIVE_STOP_REPLACEMENT_TERMINAL_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
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
    outcome_hash: replayPortfolioProtectiveStopReplacementTerminalAccountingOutcomeHash(body),
  }
  assertReplayPortfolioProtectiveStopReplacementTerminalAccountingOutcome(outcome)
  return outcome
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
