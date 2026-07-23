import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { Database } from "bun:sqlite"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import {
  assertProjectRuntimePath,
  displayPath,
  resolveRepoPath,
} from "../../../../../contracts/runtime-core/src/paths"
import {
  buildDatabaseIdentity,
  ensureDatabaseIdentity,
} from "../../../../../contracts/runtime-core/src/database-identity"
import {
  EVALUATION_EVIDENCE_CLASSIFICATION_SCHEMA,
  EVALUATION_EVIDENCE_POLICY_VERSION,
  createEvaluationEvidenceClassification,
} from "../../../contracts/src/lib/evaluation-evidence-classification"
import {
  COMPATIBILITY_EVALUATION_RUN_REQUEST_SCHEMA_VERSION,
  COMPATIBILITY_EVALUATION_RUN_RESULT_SCHEMA_VERSION,
  assertExperimentEvaluationWorkPackage,
  type CompatibilityEvaluationRunRequest,
  type CompatibilityEvaluationRunResult,
  type ExperimentEvaluationWorkPackage,
} from "../../../contracts/src/lib/experiment-evaluation-work-package"
import {
  readExperimentEvaluationWorkPackage,
} from "../../../state-store/src/lib/experiment-evaluation-work-package"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import {
  publishExperimentResultAndFinishTrials,
  type ExperimentResultWrite,
} from "../../../state-store/src/lib/research-control-plane-operations"
import {
  registerEvaluationEvidenceClassification,
} from "../../../state-store/src/lib/evaluation-evidence-classification"
import {
  runStrategyRndLoop,
  strategyRndArtifactPath,
} from "../../../../agent-roles/developer/rd-loop-runner/src/lib/rd-loop-runner"
import type {
  StrategyRndLoopInput,
} from "../../../../agent-roles/developer/candidate-batch-engine/src/lib/strategy-rnd-inputs"
import { aggregateEvidenceFingerprint } from "./rd-supervisor-runner"

export function executeCompatibilityEvaluationWorkPackage(
  dbPath: string,
  request: CompatibilityEvaluationRunRequest,
): CompatibilityEvaluationRunResult {
  assertRunRequest(request)
  const db = new Database(dbPath)
  try {
    ensureDatabaseIdentity(
      db,
      buildDatabaseIdentity(request.environment_id, "research_state_store"),
    )
    ensureResearchStateSchema(db)
    const work = readExperimentEvaluationWorkPackage(db, request.package_id)
    assertExperimentEvaluationWorkPackage(work)
    if (work.package_hash !== request.package_hash) {
      throw new Error("Compatibility Evaluation Run package hash drifted")
    }
    const resultId = `result:${work.package_id}`
    const idempotencyKey = `compatibility-evaluation-result:${work.package_hash}`
    const prior = db.query(`
      SELECT artifact_ref, summary_json, created_at
      FROM rd_experiment_result
      WHERE idempotency_key=$idempotency_key
    `).get({ $idempotency_key: idempotencyKey }) as {
      artifact_ref: string
      summary_json: string
      created_at: string
    } | null
    if (prior) {
      const summary = record(JSON.parse(prior.summary_json), "prior Result summary")
      return runResult(work, resultId, prior.artifact_ref, summary, false, prior.created_at)
    }
    assertTrialsReady(db, work)
    assertRuntimeData(work)
    const execution = executeOrRecoverArtifact(work, request)
    assertExactEvaluationResult(work, execution.result)
    const summary: JSONRecord = {
      ...execution.result,
      evaluation_work_package_ref: `control-plane://evaluation-work-package/${work.package_id}`,
      evaluation_work_package_hash: work.package_hash,
      evaluation_protocol_ref: work.evaluation_protocol.protocol_ref,
      evaluation_protocol_hash: work.evaluation_protocol.protocol_hash,
      evaluation_policy_hash: work.evaluation_policy.policy_hash,
      evidence_kind: work.evidence_kind,
      formal_replay_execution_authority: work.formal_replay_execution_authority,
      trial_candidate_map: work.trials.map((trial) => ({
        trial_id: trial.trial_id,
        candidate_id: trial.candidate_id,
        candidate_identity_hash: trial.candidate_identity_hash,
        evaluation_candidate_id: trial.evaluation_candidate_id,
      })),
    }
    const artifactRef = text(execution.result.artifact_ref, "evaluation artifact_ref")
    const artifactHash = hashFile(artifactRef)
    const boundary: JSONRecord = {
      experiment_id: work.experiment_id,
      trial_group_id: work.trial_group_id,
      stage_id: "historical_validation",
      result_type_id: "compatibility_mechanical_replay",
    }
    const trials = work.trials as unknown as JSONRecord[]
    const fingerprint = aggregateEvidenceFingerprint(
      boundary,
      summary,
      trials,
      artifactRef,
    )
    const resultWrite: ExperimentResultWrite = {
      result_id: resultId,
      experiment_id: work.experiment_id,
      result_scope: "trial_group",
      trial_group_id: work.trial_group_id,
      run_id: work.batch_run_id,
      idempotency_key: idempotencyKey,
      stage_id: "historical_validation",
      result_type_id: "compatibility_mechanical_replay",
      artifact_ref: artifactRef,
      evidence_fingerprint_json: fingerprint,
      summary_json: summary,
      created_at: request.completed_at,
    }
    const classification = createEvaluationEvidenceClassification({
      schema_version: EVALUATION_EVIDENCE_CLASSIFICATION_SCHEMA,
      policy_version: EVALUATION_EVIDENCE_POLICY_VERSION,
      result_id: resultId,
      experiment_id: work.experiment_id,
      evidence_kind: "compatibility_mechanical_replay",
      producer: "compatibility_evaluation_owner",
      artifact_ref: artifactRef,
      evidence_hash: artifactHash,
      classified_at: request.completed_at,
    })
    const publish = db.transaction(() => {
      publishExperimentResultAndFinishTrials(db, {
        result: resultWrite,
        trial_ids: work.trials.map((trial) => trial.trial_id),
        completed_at: request.completed_at,
      })
      registerEvaluationEvidenceClassification(db, classification)
    })
    publish.immediate()
    return runResult(
      work,
      resultId,
      artifactRef,
      summary,
      execution.recovered,
      request.completed_at,
    )
  } finally {
    db.close()
  }
}

function executeOrRecoverArtifact(
  work: ExperimentEvaluationWorkPackage,
  request: CompatibilityEvaluationRunRequest,
): { result: JSONRecord; recovered: boolean } {
  const artifactRoot = runtimePath(request.artifact_root, "artifact_root")
  runtimePath(request.catalog_db_path, "catalog_db_path")
  const artifactPath = strategyRndArtifactPath(work.batch_run_id, artifactRoot)
  if (existsSync(artifactPath)) {
    const artifactRef = displayPath(artifactPath)
    if (isExactCatalogedArtifact(
      request.catalog_db_path,
      artifactRef,
      work.batch_run_id,
    )) {
      return {
        result: record(JSON.parse(readFileSync(artifactPath, "utf8")), "recovered evaluation artifact"),
        recovered: true,
      }
    }
  }
  const input: StrategyRndLoopInput = {
    runId: work.batch_run_id,
    batchId: work.package_id,
    hypothesis: work.experiment_id,
    manifestPath: work.data_snapshot_binding.manifest_ref,
    timeframe: work.data_snapshot_binding.timeframe,
    maxHoldBars: work.evaluation_policy.max_hold_bars,
    feeBps: work.evaluation_policy.fee_bps,
    slippageBps: work.evaluation_policy.slippage_bps,
    fundingBpsPer8h: work.evaluation_policy.adverse_funding_bps_per_8h,
    oosSplitRatio: work.evaluation_policy.oos_split_ratio,
    antiOverfitStage: work.evaluation_policy.anti_overfit_stage,
    searchTrialCount: work.trial_count,
    factorCompose: false,
    factorDiscover: false,
    diagnosticMode: false,
    candidates: work.trials.map((trial) => ({
      candidateId: trial.evaluation_candidate_id,
      family: work.family_capability.family_id,
      params: structuredClone(trial.candidate_parameters),
    })),
    artifactRoot,
    catalogDbPath: request.catalog_db_path,
    now: request.completed_at,
  }
  const completed = runStrategyRndLoop(input) as unknown as JSONRecord
  if (completed.artifact_ref !== displayPath(artifactPath) || !existsSync(artifactPath)) {
    throw new Error("Compatibility Evaluation owner did not publish the expected artifact")
  }
  return {
    result: record(JSON.parse(readFileSync(artifactPath, "utf8")), "evaluation artifact"),
    recovered: false,
  }
}

function isExactCatalogedArtifact(
  catalogDbPath: string,
  artifactRef: string,
  runId: string,
): boolean {
  const path = resolveRepoPath(runtimePath(catalogDbPath, "catalog_db_path"))
  if (!existsSync(path)) return false
  const catalog = new Database(path, { readonly: true })
  try {
    const hasArtifact = catalog.query(`
      SELECT 1 AS present FROM sqlite_master
      WHERE type='table' AND name='artifact'
    `).get()
    const hasRef = catalog.query(`
      SELECT 1 AS present FROM sqlite_master
      WHERE type='table' AND name='artifact_ref'
    `).get()
    const hasRunLedger = catalog.query(`
      SELECT 1 AS present FROM sqlite_master
      WHERE type='table' AND name='strategy_rnd_run'
    `).get()
    if (!hasArtifact || !hasRef || !hasRunLedger) return false
    const row = catalog.query(`
      SELECT a.content_hash, a.path
      FROM artifact a
      JOIN artifact_ref r ON r.artifact_id=a.artifact_id
      JOIN strategy_rnd_run s
        ON s.artifact_id=a.artifact_id AND s.run_id=$run_id
      WHERE a.path=$path
        AND r.referrer_type='run'
        AND r.referrer_id=$run_id
        AND r.role='output'
    `).get({
      $path: artifactRef,
      $run_id: runId,
    }) as { content_hash: string | null; path: string } | null
    if (!row) return false
    if (!row.content_hash || row.content_hash !== hashFile(artifactRef)) {
      throw new Error("Compatibility Evaluation recovered artifact content hash drifted")
    }
    return true
  } finally {
    catalog.close()
  }
}

function assertExactEvaluationResult(
  work: ExperimentEvaluationWorkPackage,
  result: JSONRecord,
): void {
  if (result.run_id !== work.batch_run_id) {
    throw new Error("Compatibility Evaluation result run identity drifted")
  }
  const batch = record(result.batch, "evaluation batch")
  if (batch.batch_id !== work.package_id || batch.trial_count !== work.trial_count) {
    throw new Error("Compatibility Evaluation result batch identity drifted")
  }
  const candidates = array(batch.candidates).map((item) => record(item, "evaluation candidate"))
  const expectedIds = work.trials.map((trial) => trial.evaluation_candidate_id).sort()
  const actualIds = candidates.map((candidate) =>
    text(candidate.candidate_id, "evaluation candidate_id")).sort()
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
    throw new Error("Compatibility Evaluation result candidate set drifted")
  }
  const input = record(result.input, "evaluation artifact input")
  if (input.manifest_path !== work.data_snapshot_binding.manifest_ref
      || input.timeframe !== work.data_snapshot_binding.timeframe
      || input.max_hold_bars !== work.evaluation_policy.max_hold_bars
      || input.fee_bps !== work.evaluation_policy.fee_bps
      || input.slippage_bps !== work.evaluation_policy.slippage_bps
      || input.funding_bps_per_8h !== work.evaluation_policy.adverse_funding_bps_per_8h
      || input.oos_split !== work.evaluation_policy.oos_split_ratio
      || input.search_trial_count !== work.trial_count) {
    throw new Error("Compatibility Evaluation artifact input drifted from Work Package")
  }
}

function assertTrialsReady(db: Database, work: ExperimentEvaluationWorkPackage): void {
  const query = db.query(`
    SELECT status, run_id, candidate_id, candidate_identity_hash
    FROM rd_trial WHERE trial_id=$trial_id
  `)
  for (const trial of work.trials) {
    const row = query.get({ $trial_id: trial.trial_id }) as {
      status: string
      run_id: string
      candidate_id: string
      candidate_identity_hash: string
    } | null
    if (!row || row.status !== "reserved"
        || row.run_id !== trial.run_id
        || row.candidate_id !== trial.candidate_id
        || row.candidate_identity_hash !== trial.candidate_identity_hash) {
      throw new Error("Compatibility Evaluation requires every exact planned Trial to remain reserved")
    }
  }
}

function assertRuntimeData(work: ExperimentEvaluationWorkPackage): void {
  const binding = work.data_snapshot_binding
  if (hashFile(binding.report_ref) !== binding.report_hash
      || hashFile(binding.manifest_ref) !== binding.manifest_hash
      || hashFile(binding.content_ref) !== binding.content_hash) {
    throw new Error("Compatibility Evaluation runtime data content drifted")
  }
}

function assertRunRequest(value: CompatibilityEvaluationRunRequest): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.schema_version !== COMPATIBILITY_EVALUATION_RUN_REQUEST_SCHEMA_VERSION) {
    throw new Error("Compatibility Evaluation Run request is unsupported")
  }
  text(value.package_id, "package_id")
  digest(value.package_hash, "package_hash")
  text(value.environment_id, "environment_id")
  runtimePath(value.artifact_root, "artifact_root")
  runtimePath(value.catalog_db_path, "catalog_db_path")
  utc(value.completed_at, "completed_at")
  const expected = [
    "artifact_root",
    "catalog_db_path",
    "completed_at",
    "environment_id",
    "package_hash",
    "package_id",
    "schema_version",
  ].sort()
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
    throw new Error("Compatibility Evaluation Run request is non-canonical")
  }
}

function runResult(
  work: ExperimentEvaluationWorkPackage,
  resultId: string,
  resultRef: string,
  summary: JSONRecord,
  recovered: boolean,
  completedAt: string,
): CompatibilityEvaluationRunResult {
  const batch = record(summary.batch, "evaluation batch")
  return {
    schema_version: COMPATIBILITY_EVALUATION_RUN_RESULT_SCHEMA_VERSION,
    package_id: work.package_id,
    package_hash: work.package_hash,
    result_id: resultId,
    result_ref: resultRef,
    evidence_kind: "compatibility_mechanical_replay",
    outcome: text(batch.outcome, "evaluation outcome"),
    recovered_artifact: recovered,
    completed_at: completedAt,
  }
}

function runtimePath(value: string, field: string): string {
  const normalized = text(value, field)
  assertProjectRuntimePath(normalized)
  const top = normalized.replace(/^\.\//, "").split(/[\\/]/)[0]
  if (top !== "data" && top !== "tmp") {
    throw new Error(`${field} must stay under data/ or tmp/`)
  }
  return normalized
}

function hashFile(ref: string): string {
  const path = resolveRepoPath(ref)
  if (!existsSync(path)) throw new Error(`evidence artifact is missing: ${displayPath(path)}`)
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected an array")
  return value
}

function record(value: unknown, field: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as JSONRecord
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value) {
    throw new Error(`${field} is required`)
  }
  return value
}

function digest(value: unknown, field: string): string {
  const normalized = text(value, field)
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${field} must be a lowercase sha256 digest`)
  }
  return normalized
}

function utc(value: string, field: string): string {
  const normalized = text(value, field)
  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return normalized
}
