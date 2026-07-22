import { createHash } from "node:crypto"
import { createReplayPortfolioCycleSequenceAccountingEvidence } from "./replay-portfolio-cycle-sequence-accounting"
import {
  REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioCycleSequenceAccountingOutcome,
  replayPortfolioCycleSequenceAccountingOutcomeHash,
  type ReplayPortfolioCycleSequenceAccountingOutcome,
} from "../../../../contracts/src/lib/replay-portfolio-cycle-sequence-accounting-contracts"
import type {
  ReplayPortfolioCycleSequenceArtifactManifest,
  ReplayPortfolioCycleSequenceResult,
} from "../../../../contracts/src/lib/replay-portfolio-cycle-sequence-contracts"
import {
  assertReplayRuntimeSharedWalletPortfolioEvidence,
  type ReplayRuntimeSharedWalletPortfolioEvidence,
} from "../../../../contracts/src/lib/replay-runtime-shared-wallet-artifact-contracts"
import { canonicalHash } from "../../../../contracts/src/lib/replay-contracts"
import { assertCertifiedReplayArtifactStore } from "../../../../runner/src/lib/replay-artifact-store"
import {
  publishReplayPortfolioCycleSequenceAccountingArtifact,
} from "./replay-portfolio-cycle-sequence-accounting-artifact-publisher"
import {
  runReplayPortfolioCycleSequence,
  type ReplayPortfolioCycleSequenceRunInput,
} from "../../../../runner/src/lib/replay-portfolio-cycle-sequence-runner"

const SEQUENCE_MANIFEST = "portfolio-cycle-sequence-artifact-manifest.json"

export interface ReplayPortfolioCycleSequenceAccountingRunInput
  extends ReplayPortfolioCycleSequenceRunInput {
  publish_accounting_artifact?: typeof publishReplayPortfolioCycleSequenceAccountingArtifact
}

export function runReplayPortfolioCycleSequenceAccounting(
  input: ReplayPortfolioCycleSequenceAccountingRunInput,
): ReplayPortfolioCycleSequenceAccountingOutcome {
  const sequence = runReplayPortfolioCycleSequence(input)
  if (sequence.status !== "completed" || !sequence.result || !sequence.artifact_manifest) {
    return failed(input, "sequence-execution-failed", sequence.failure?.message ?? "Sequence execution failed")
  }
  let cycleEvidence: ReplayRuntimeSharedWalletPortfolioEvidence[]
  try {
    cycleEvidence = readCycleEvidence(input, sequence.result, sequence.artifact_manifest)
  } catch (error) {
    return failed(input, "sequence-artifact-read-failed", error)
  }
  let evidence
  try {
    evidence = createReplayPortfolioCycleSequenceAccountingEvidence({
      authority: {
        experiment_id: input.reservation.experiment_id,
        trial_group_id: input.reservation.trial_group_id,
        trial_group_hash: input.reservation.trial_group_hash,
        portfolio_id: input.reservation.portfolio_id,
        sequence_reservation_hash: input.reservation.reservation_hash,
        issued_at: input.reservation.issued_at,
        settlement_asset: input.reservation.settlement_asset,
      },
      sequence_result: sequence.result,
      sequence_manifest: sequence.artifact_manifest,
      cycle_evidence: cycleEvidence,
    })
  } catch (error) {
    return failed(input, "sequence-accounting-invalid", error)
  }
  try {
    const published = (input.publish_accounting_artifact
      ?? publishReplayPortfolioCycleSequenceAccountingArtifact)({
      sequence_result: sequence.result,
      sequence_manifest: sequence.artifact_manifest,
      cycle_evidence: cycleEvidence,
      evidence,
      authority_frozen_at: input.reservation.issued_at,
      artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioCycleSequenceAccountingOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.plan.portfolio_id,
      sequence_plan_hash: input.plan.plan_hash,
      status: "completed",
      sequence_result: sequence.result,
      evidence,
      artifact_manifest: published.manifest,
      idempotent_replay: sequence.idempotent_replay && published.idempotent_replay,
      failure: null,
    }
    const outcome = { ...body,
      outcome_hash: replayPortfolioCycleSequenceAccountingOutcomeHash(
        body as ReplayPortfolioCycleSequenceAccountingOutcome,
      ) }
    assertReplayPortfolioCycleSequenceAccountingOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "sequence-accounting-artifact-failed", error)
  }
}

function readCycleEvidence(
  input: ReplayPortfolioCycleSequenceAccountingRunInput,
  result: ReplayPortfolioCycleSequenceResult,
  expectedManifest: ReplayPortfolioCycleSequenceArtifactManifest,
): ReplayRuntimeSharedWalletPortfolioEvidence[] {
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({ sequence_plan_hash: input.plan.plan_hash }),
    attempt_id_hash: result.result_hash,
  })
  const manifestRead = namespace.read(SEQUENCE_MANIFEST)
  const manifest = JSON.parse(
    new TextDecoder().decode(manifestRead.bytes),
  ) as ReplayPortfolioCycleSequenceArtifactManifest
  if (canonicalHash(manifest) !== canonicalHash(expectedManifest)) {
    throw new Error("Sequence Artifact manifest read drift")
  }
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.ref !== read.ref || file.sha256 !== sha256(read.bytes)) {
      throw new Error("Sequence Artifact payload hash drift")
    }
  }
  const cycleFile = manifest.files.find((file) => file.role === "cycle_evidence")
  if (!cycleFile) throw new Error("Sequence Artifact lacks cycle evidence")
  const items = JSON.parse(new TextDecoder().decode(namespace.read(cycleFile.name).bytes)) as Array<{
    cycle_index: number
    allocation_result: { result_hash: string }
    risk_result: { result_hash: string }
    portfolio_evidence: ReplayRuntimeSharedWalletPortfolioEvidence
    integrated_result: { result_hash: string }
  }>
  if (items.length !== result.cycle_count) throw new Error("Sequence cycle evidence coverage drift")
  return items.map((item, index) => {
    const record = result.cycle_records[index]
    assertReplayRuntimeSharedWalletPortfolioEvidence(item.portfolio_evidence)
    if (!record || item.cycle_index !== index + 1
        || item.allocation_result.result_hash !== record.allocation_result_hash
        || item.risk_result.result_hash !== record.risk_result_hash
        || item.portfolio_evidence.evidence_hash !== record.portfolio_evidence_hash
        || item.integrated_result.result_hash !== record.integrated_result_hash) {
      throw new Error(`Sequence cycle ${index + 1} Artifact evidence binding drift`)
    }
    return item.portfolio_evidence
  })
}

function failed(
  input: ReplayPortfolioCycleSequenceAccountingRunInput,
  code: NonNullable<ReplayPortfolioCycleSequenceAccountingOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioCycleSequenceAccountingOutcome {
  const body: Omit<ReplayPortfolioCycleSequenceAccountingOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_CYCLE_SEQUENCE_ACCOUNTING_OUTCOME_SCHEMA_VERSION,
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
      partial_result_published: false,
    },
  }
  const outcome = { ...body,
    outcome_hash: replayPortfolioCycleSequenceAccountingOutcomeHash(
      body as ReplayPortfolioCycleSequenceAccountingOutcome,
    ) }
  assertReplayPortfolioCycleSequenceAccountingOutcome(outcome)
  return outcome
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
