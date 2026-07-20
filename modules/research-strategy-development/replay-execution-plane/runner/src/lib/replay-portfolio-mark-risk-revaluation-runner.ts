import { createHash } from "node:crypto"
import type { ReplayPortfolioAllocationReservationSnapshot } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { executeReplayPortfolioMarkRiskRevaluation } from "../../../engine/src/lib/replay-portfolio-mark-risk-revaluation-engine"
import {
  REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_OUTCOME_SCHEMA_VERSION,
  assertReplayPortfolioMarkRiskRevaluationOutcome,
  replayPortfolioMarkRiskRevaluationOutcomeHash,
  type ReplayPortfolioMarkRiskRevaluationOutcome,
} from "../../../contracts/src/lib/replay-portfolio-mark-risk-revaluation-contracts"
import type {
  ReplayIntegratedPortfolioArtifactManifest,
  ReplayIntegratedPortfolioResult,
} from "../../../contracts/src/lib/replay-integrated-portfolio-contracts"
import type { ReplayPortfolioAllocationResult } from "../../../contracts/src/lib/replay-portfolio-allocation-contracts"
import type { ReplayRuntimeSharedWalletRiskResult } from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import { assertCertifiedReplayArtifactStore } from "./replay-artifact-store"
import {
  runReplayIntegratedPortfolio,
  type ReplayIntegratedPortfolioRunInput,
} from "./replay-integrated-portfolio-runner"
import {
  publishReplayPortfolioMarkRiskRevaluationArtifact,
} from "./replay-portfolio-mark-risk-revaluation-artifact-publisher"

const INTEGRATED_MANIFEST = "integrated-portfolio-artifact-manifest.json"

export interface ReplayPortfolioMarkRiskRevaluationRunInput extends ReplayIntegratedPortfolioRunInput {
  execute_revaluation?: typeof executeReplayPortfolioMarkRiskRevaluation
  publish_revaluation_artifact?: typeof publishReplayPortfolioMarkRiskRevaluationArtifact
}

export function runReplayPortfolioMarkRiskRevaluation(
  input: ReplayPortfolioMarkRiskRevaluationRunInput,
): ReplayPortfolioMarkRiskRevaluationOutcome {
  const integrated = runReplayIntegratedPortfolio(input)
  if (integrated.status !== "completed" || !integrated.result || !integrated.risk_result
      || !integrated.artifact?.artifact_manifest) {
    return failed(input, "integrated-execution-failed", integrated.failure?.message ?? "Integrated Portfolio failed")
  }
  let source: ReturnType<typeof readReplayIntegratedPortfolioArtifactEvidence>
  try {
    source = readReplayIntegratedPortfolioArtifactEvidence(
      input, integrated.result, integrated.artifact.artifact_manifest,
    )
  } catch (error) {
    return failed(input, "integrated-artifact-read-failed", error)
  }
  let evidence
  try {
    evidence = (input.execute_revaluation ?? executeReplayPortfolioMarkRiskRevaluation)({
      integrated_plan: input.integrated_plan,
      allocation_plan: input.allocation_plan,
      allocation_reservation: source.allocation_reservation,
      allocation_result: source.allocation_result,
      risk_plan: input.risk_plan,
      risk_reservation: input.risk_reservation,
      risk_result: source.risk_result,
      integrated_result: source.integrated_result,
      integrated_manifest: integrated.artifact.artifact_manifest,
    })
  } catch (error) {
    return failed(input, "mark-risk-revaluation-invalid", error)
  }
  try {
    const published = (input.publish_revaluation_artifact
      ?? publishReplayPortfolioMarkRiskRevaluationArtifact)({
      integrated_result: source.integrated_result,
      integrated_manifest: integrated.artifact.artifact_manifest,
      allocation_reservation: source.allocation_reservation,
      allocation_result: source.allocation_result,
      risk_result: source.risk_result,
      evidence,
      authority_frozen_at: input.allocation_reservation.issued_at,
      artifact_store: input.artifact_store,
    })
    const body: Omit<ReplayPortfolioMarkRiskRevaluationOutcome, "outcome_hash"> = {
      schema_version: REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_OUTCOME_SCHEMA_VERSION,
      portfolio_id: input.integrated_plan.portfolio_id,
      integrated_plan_hash: input.integrated_plan.plan_hash,
      status: "completed",
      integrated_result: source.integrated_result,
      evidence,
      artifact_manifest: published.manifest,
      idempotent_replay: integrated.artifact.idempotent_replay && published.idempotent_replay,
      failure: null,
    }
    const outcome = {
      ...body,
      outcome_hash: replayPortfolioMarkRiskRevaluationOutcomeHash(
        body as ReplayPortfolioMarkRiskRevaluationOutcome,
      ),
    }
    assertReplayPortfolioMarkRiskRevaluationOutcome(outcome)
    return outcome
  } catch (error) {
    return failed(input, "mark-risk-revaluation-artifact-failed", error)
  }
}

export function readReplayIntegratedPortfolioArtifactEvidence(
  input: ReplayPortfolioMarkRiskRevaluationRunInput,
  result: ReplayIntegratedPortfolioResult,
  expectedManifest: ReplayIntegratedPortfolioArtifactManifest,
): {
  allocation_reservation: ReplayPortfolioAllocationReservationSnapshot
  allocation_result: ReplayPortfolioAllocationResult
  risk_result: ReplayRuntimeSharedWalletRiskResult
  integrated_result: ReplayIntegratedPortfolioResult
} {
  assertCertifiedReplayArtifactStore(input.artifact_store)
  const namespace = input.artifact_store.openAttempt({
    idempotency_key_hash: canonicalHash({ integrated_plan_hash: input.integrated_plan.plan_hash }),
    attempt_id_hash: result.result_hash,
  })
  const manifestRead = namespace.read(INTEGRATED_MANIFEST)
  const manifest = JSON.parse(
    new TextDecoder().decode(manifestRead.bytes),
  ) as ReplayIntegratedPortfolioArtifactManifest
  if (canonicalHash(manifest) !== canonicalHash(expectedManifest)) {
    throw new Error("Integrated Portfolio Artifact manifest read drift")
  }
  const payload = new Map<string, unknown>()
  for (const file of manifest.files) {
    const read = namespace.read(file.name)
    if (file.ref !== read.ref || file.sha256 !== sha256(read.bytes)) {
      throw new Error("Integrated Portfolio Artifact payload hash drift")
    }
    payload.set(file.role, JSON.parse(new TextDecoder().decode(read.bytes)))
  }
  const source = {
    allocation_reservation: payload.get("allocation_reservation") as ReplayPortfolioAllocationReservationSnapshot,
    allocation_result: payload.get("allocation_result") as ReplayPortfolioAllocationResult,
    risk_result: payload.get("risk_result") as ReplayRuntimeSharedWalletRiskResult,
    integrated_result: payload.get("integrated_result") as ReplayIntegratedPortfolioResult,
  }
  if (!source.allocation_reservation || !source.allocation_result || !source.risk_result
      || !source.integrated_result
      || canonicalHash(source.allocation_reservation) !== canonicalHash(input.allocation_reservation)
      || source.allocation_result.result_hash !== source.integrated_result.allocation_result_hash
      || source.risk_result.result_hash !== source.integrated_result.risk_result_hash
      || source.integrated_result.result_hash !== result.result_hash) {
    throw new Error("Integrated Portfolio Artifact revaluation source binding drift")
  }
  return source
}

function failed(
  input: ReplayPortfolioMarkRiskRevaluationRunInput,
  code: NonNullable<ReplayPortfolioMarkRiskRevaluationOutcome["failure"]>["code"],
  error: unknown,
): ReplayPortfolioMarkRiskRevaluationOutcome {
  const body: Omit<ReplayPortfolioMarkRiskRevaluationOutcome, "outcome_hash"> = {
    schema_version: REPLAY_PORTFOLIO_MARK_RISK_REVALUATION_OUTCOME_SCHEMA_VERSION,
    portfolio_id: input.integrated_plan.portfolio_id,
    integrated_plan_hash: input.integrated_plan.plan_hash,
    status: "failed",
    integrated_result: null,
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
    outcome_hash: replayPortfolioMarkRiskRevaluationOutcomeHash(
      body as ReplayPortfolioMarkRiskRevaluationOutcome,
    ),
  }
  assertReplayPortfolioMarkRiskRevaluationOutcome(outcome)
  return outcome
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
