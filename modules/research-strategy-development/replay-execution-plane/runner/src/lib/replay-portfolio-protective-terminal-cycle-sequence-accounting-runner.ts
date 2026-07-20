import { createHash } from "node:crypto"
import { createReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence } from
  "../../../accounting/src/lib/replay-portfolio-protective-terminal-cycle-sequence-accounting"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome,
  replayPortfolioProtectiveTerminalCycleSequenceAccountingOutcomeHash,
  type ReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-cycle-sequence-accounting-contracts"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_POLICY_VERSION,
  assertReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest,
  assertReplayPortfolioProtectiveTerminalCycleSequenceResult,
  type ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest,
  type ReplayPortfolioProtectiveTerminalCycleSequenceResult,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-cycle-sequence-contracts"
import {
  REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION,
  assertReplayPortfolioProtectiveTerminalAccountingArtifactManifest,
  assertReplayPortfolioProtectiveTerminalAccountingEvidence,
  type ReplayPortfolioProtectiveTerminalAccountingArtifactManifest,
  type ReplayPortfolioProtectiveTerminalAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-accounting-contracts"
import type {
  ReplayPortfolioProtectiveTerminalArtifactManifest,
  ReplayPortfolioProtectiveTerminalEvidence,
} from "../../../contracts/src/lib/replay-portfolio-protective-terminal-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { assertCertifiedReplayArtifactStore } from "./replay-artifact-store"
import {
  runReplayPortfolioProtectiveTerminalCycleSequence,
  type ReplayPortfolioProtectiveTerminalCycleSequenceRunInput,
} from "./replay-portfolio-protective-terminal-cycle-sequence-runner"
import { publishReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifact } from
  "./replay-portfolio-protective-terminal-cycle-sequence-accounting-artifact-publisher"

const SEQUENCE_MANIFEST = "portfolio-protective-terminal-cycle-sequence-artifact-manifest.json"
const ACCOUNTING_MANIFEST = "portfolio-protective-terminal-accounting-artifact-manifest.json"

export interface ReplayPortfolioProtectiveTerminalCycleSequenceAccountingRunInput
  extends ReplayPortfolioProtectiveTerminalCycleSequenceRunInput {
  publish_protective_cycle_sequence_accounting_artifact?:
    typeof publishReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifact
}

export function runReplayPortfolioProtectiveTerminalCycleSequenceAccounting(
  input: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingRunInput,
): ReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome {
  const sequence = runReplayPortfolioProtectiveTerminalCycleSequence(input)
  if (sequence.status !== "completed" || !sequence.result || !sequence.artifact_manifest) {
    return failed(input, "protective-cycle-sequence-execution-failed",
      sequence.failure?.message ?? "Protective Terminal Cycle Sequence failed")
  }
  let result: ReplayPortfolioProtectiveTerminalCycleSequenceResult
  let sequenceManifest: ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest
  try {
    ;({ result, manifest: sequenceManifest } = readSequenceArtifact(
      input, sequence.result, sequence.artifact_manifest,
    ))
  } catch (error) {
    return failed(input, "protective-cycle-sequence-artifact-read-failed", error)
  }
  let sources: ReturnType<typeof readCycleAccountingArtifacts>
  try {
    sources = readCycleAccountingArtifacts(input, result)
  } catch (error) {
    return failed(input, "protective-cycle-accounting-artifact-read-failed", error)
  }
  let evidence
  try {
    evidence = createReplayPortfolioProtectiveTerminalCycleSequenceAccountingEvidence({
      sequence_result: result,
      sequence_manifest: sequenceManifest,
      cycle_evidence: sources.map((source) => source.evidence),
      cycle_manifests: sources.map((source) => source.manifest),
    })
  } catch (error) {
    return failed(input, "protective-cycle-sequence-accounting-invalid", error)
  }
  try {
    const published = (input.publish_protective_cycle_sequence_accounting_artifact
      ?? publishReplayPortfolioProtectiveTerminalCycleSequenceAccountingArtifact)({
      sequence_result: result,
      sequence_manifest: sequenceManifest,
      cycle_manifests: sources.map((source) => source.manifest),
      cycle_evidence: sources.map((source) => source.evidence),
      evidence,
      authority_frozen_at: input.reservation.issued_at,
      artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.plan.portfolio_id,
      sequence_plan_hash: input.plan.plan_hash,
      status: "completed",
      sequence_result: result,
      evidence,
      artifact_manifest: published.manifest,
      idempotent_replay: sequence.idempotent_replay && published.idempotent_replay,
      failure: null,
    }
    const outcome = { ...body,
      outcome_hash: replayPortfolioProtectiveTerminalCycleSequenceAccountingOutcomeHash(body) }
    assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "protective-cycle-sequence-accounting-artifact-failed", error)
  }
}

function readSequenceArtifact(
  input: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingRunInput,
  expectedResult: ReplayPortfolioProtectiveTerminalCycleSequenceResult,
  expectedManifest: ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest,
): {
  result: ReplayPortfolioProtectiveTerminalCycleSequenceResult
  manifest: ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest
} {
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({
      sequence_plan_hash: input.plan.plan_hash,
      policy_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_POLICY_VERSION,
    }),
    attempt_id_hash: expectedResult.result_hash,
  })
  const manifest = JSON.parse(new TextDecoder().decode(namespace.read(SEQUENCE_MANIFEST).bytes)) as
    ReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest
  assertReplayPortfolioProtectiveTerminalCycleSequenceArtifactManifest(manifest)
  if (canonicalHash(manifest) !== canonicalHash(expectedManifest)) {
    throw new Error("Protective Terminal Cycle Sequence manifest read drift")
  }
  const payload = new Map<string, unknown>()
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.ref !== read.ref || file.sha256 !== sha256(read.bytes)) {
      throw new Error("Protective Terminal Cycle Sequence payload hash drift")
    }
    payload.set(file.role, JSON.parse(new TextDecoder().decode(read.bytes)))
  }
  const result = payload.get("protective_terminal_cycle_sequence_result") as
    ReplayPortfolioProtectiveTerminalCycleSequenceResult
  assertReplayPortfolioProtectiveTerminalCycleSequenceResult(result)
  if (canonicalHash(result) !== canonicalHash(expectedResult)
      || result.result_hash !== manifest.sequence_result_hash) {
    throw new Error("Protective Terminal Cycle Sequence Result binding drift")
  }
  return { result, manifest }
}

function readCycleAccountingArtifacts(
  input: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingRunInput,
  result: ReplayPortfolioProtectiveTerminalCycleSequenceResult,
): Array<{
  manifest: ReplayPortfolioProtectiveTerminalAccountingArtifactManifest
  evidence: ReplayPortfolioProtectiveTerminalAccountingEvidence
}> {
  return result.cycle_commits.map((commit) => {
    const namespace = input.artifact_store.openAttempt({
      idempotency_key_hash: canonicalHash({
        protective_terminal_evidence_hash: commit.protective_terminal_evidence_hash,
        accounting_policy: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_ACCOUNTING_POLICY_VERSION,
      }),
      attempt_id_hash: commit.protective_terminal_accounting_evidence_hash,
    })
    const manifest = JSON.parse(new TextDecoder().decode(namespace.read(ACCOUNTING_MANIFEST).bytes)) as
      ReplayPortfolioProtectiveTerminalAccountingArtifactManifest
    assertReplayPortfolioProtectiveTerminalAccountingArtifactManifest(manifest)
    const payload = new Map<string, unknown>()
    for (const file of manifest.files) {
      const read = namespace.read(file.name)
      if (file.ref !== read.ref || file.sha256 !== sha256(read.bytes)) {
        throw new Error(`Protective Terminal cycle ${commit.cycle_index} accounting payload hash drift`)
      }
      payload.set(file.role, JSON.parse(new TextDecoder().decode(read.bytes)))
    }
    const evidence = payload.get("protective_terminal_accounting_evidence") as
      ReplayPortfolioProtectiveTerminalAccountingEvidence
    const terminalEvidence = payload.get("protective_terminal_evidence") as ReplayPortfolioProtectiveTerminalEvidence
    const terminalManifest = payload.get("protective_terminal_artifact_manifest") as
      ReplayPortfolioProtectiveTerminalArtifactManifest
    const riskResult = payload.get("risk_result") as ReplayRuntimeSharedWalletRiskResult
    assertReplayPortfolioProtectiveTerminalAccountingEvidence(evidence, {
      protective_terminal_evidence: terminalEvidence,
      protective_terminal_manifest: terminalManifest,
      risk_result: riskResult,
    })
    if (manifest.manifest_hash !== commit.protective_terminal_accounting_artifact_manifest_hash
        || manifest.protective_terminal_accounting_evidence_hash
          !== commit.protective_terminal_accounting_evidence_hash
        || evidence.evidence_hash !== commit.protective_terminal_accounting_evidence_hash
        || evidence.trial_balance.trial_balance_hash !== commit.trial_balance_hash) {
      throw new Error(`Protective Terminal cycle ${commit.cycle_index} accounting commit binding drift`)
    }
    return { manifest, evidence }
  })
}

function failed(
  input: ReplayPortfolioProtectiveTerminalCycleSequenceAccountingRunInput,
  code: NonNullable<ReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome {
  const body: Omit<ReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_PROTECTIVE_TERMINAL_CYCLE_SEQUENCE_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.plan.portfolio_id,
    sequence_plan_hash: input.plan.plan_hash,
    status: "failed",
    sequence_result: null,
    evidence: null,
    artifact_manifest: null,
    idempotent_replay: false,
    failure: {
      code,
      message: error instanceof Error ? error.message : String(error),
      partial_accounting_result_published: false,
    },
  }
  const outcome = { ...body,
    outcome_hash: replayPortfolioProtectiveTerminalCycleSequenceAccountingOutcomeHash(body) }
  assertReplayPortfolioProtectiveTerminalCycleSequenceAccountingOutcome(outcome)
  return outcome
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
