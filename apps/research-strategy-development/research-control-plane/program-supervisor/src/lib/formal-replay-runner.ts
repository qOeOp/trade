import { createHash, randomUUID } from "node:crypto"
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import { Database } from "bun:sqlite"
import { canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  buildDatabaseIdentity,
  ensureDatabaseIdentity,
} from "../../../../../contracts/runtime-core/src/database-identity"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { runOwnerToolRecordSync } from "../../../../../contracts/runtime-core/src/owner-tool-client"
import {
  assertProjectRuntimePath,
  displayPath,
  resolveRepoPath,
} from "../../../../../contracts/runtime-core/src/paths"
import {
  EVALUATION_EVIDENCE_CLASSIFICATION_SCHEMA,
  EVALUATION_EVIDENCE_POLICY_VERSION,
  createEvaluationEvidenceClassification,
} from "../../../contracts/src/lib/evaluation-evidence-classification"
import {
  REPLAY_ATTEMPT_ADMISSION_REQUEST_SCHEMA_VERSION,
} from "../../../contracts/src/lib/replay-attempt-admission"
import type {
  ReplayRequestRegistrationRecord,
} from "../../../contracts/src/lib/replay-request-registration"
import type {
  ReplayTrialReservationAdmissionRecord,
} from "../../../contracts/src/lib/replay-trial-reservation-admission"
import {
  finalizeReplayAttempt,
} from "../../../state-store/src/lib/replay-attempt-authority"
import {
  readReplayRequestRegistration,
} from "../../../state-store/src/lib/replay-request-registration"
import {
  readReplayTrialReservationAdmission,
} from "../../../state-store/src/lib/replay-trial-reservation-admission"
import {
  publishExperimentResultAndFinishTrials,
  type ExperimentResultWrite,
} from "../../../state-store/src/lib/research-control-plane-operations"
import {
  ensureResearchStateSchema,
} from "../../../state-store/src/lib/research-state-store"
import {
  registerEvaluationEvidenceClassification,
} from "../../../state-store/src/lib/evaluation-evidence-classification"

export const FORMAL_REPLAY_JOB_REQUEST_SCHEMA =
  "trade.rd-formal-replay-job-request.v1" as const
export const FORMAL_REPLAY_DATA_BUNDLE_SCHEMA =
  "trade.rd-formal-replay-data-bundle.v1" as const

export interface FormalReplayJobRequest {
  schema_version: typeof FORMAL_REPLAY_JOB_REQUEST_SCHEMA
  execution_id: string
  request_registration_id: string
  request_registration_hash: string
  data_bundle_ref: string
  data_bundle_sha256: string
  artifact_root: string
  environment_id: string
  worker_id: string
  lease_duration_ms: number
}

export interface FormalReplayJobResult {
  schema_version: "trade.rd-formal-replay-job-result.v1"
  status: "completed" | "failed" | "cancelled"
  execution_id: string
  request_registration_id: string
  attempt_id: string
  result_id: string | null
  artifact_ref: string | null
  dispatch_ref: string | null
  dispatch_sha256: string | null
  recovered_result: boolean
  formal_evidence_kind: "mechanical_replay" | null
  review_authority: "classified_result_only" | "none"
  deployment_authority: "none"
  trading_authority: false
  failure_class?: string
}

export interface FormalReplayContext {
  registration: ReplayRequestRegistrationRecord
  admission: ReplayTrialReservationAdmissionRecord
  request: JSONRecord
  manifest: JSONRecord
  stored_manifest_hash: string
}

export interface FormalReplayRunnerDependencies {
  now(): Date
  load_context(db: Database, registrationId: string): FormalReplayContext
  admit(args: string[]): JSONRecord
  run(args: string[]): JSONRecord
  persist(
    db: Database,
    request: FormalReplayJobRequest,
    context: FormalReplayContext,
    outcome: JSONRecord,
    dispatch: { ref: string; sha256: string },
    completedAt: string,
    resultId: string,
  ): FormalReplayJobResult
}

const DEFAULT_DEPENDENCIES: FormalReplayRunnerDependencies = {
  now: () => new Date(),
  load_context: loadFormalReplayContext,
  admit: (args) => runOwnerToolRecordSync(
    "research.replay-attempt-admission",
    args,
    "formal Replay Attempt admission",
  ),
  persist: persistOutcome,
  run: (args) => runOwnerToolRecordSync(
    "research.replay-execution",
    args,
    "formal Replay execution",
  ),
}

export function runFormalReplayJob(
  dbPath: string,
  rawRequest: JSONRecord,
  dependencies: FormalReplayRunnerDependencies = DEFAULT_DEPENDENCIES,
): FormalReplayJobResult {
  const request = parseRequest(rawRequest)
  assertProjectRuntimePath(dbPath)
  assertProjectRuntimePath(request.data_bundle_ref)
  assertProjectRuntimePath(request.artifact_root)
  const db = new Database(resolveRepoPath(dbPath))
  try {
    ensureDatabaseIdentity(
      db,
      buildDatabaseIdentity(request.environment_id, "research_state_store"),
    )
    ensureResearchStateSchema(db)
    const context = dependencies.load_context(
      db,
      request.request_registration_id,
    )
    assertFormalReplayContext(request, context)
    const resultId = formalResultId(context.registration)
    const recovered = readCompletedResult(db, request, context, resultId)
    if (recovered) return recovered
    const bundle = readDataBundle(request, context)
    const executionClock = loadOrCreateExecutionClock(
      request,
      canonicalTime(dependencies.now()),
    )
    const claimedAt = executionClock.claimed_at
    const leaseExpiresAt = executionClock.lease_expires_at
    const attemptId = `formal-replay-attempt:${request.execution_id}`
    const claim = {
      schema_version: REPLAY_ATTEMPT_ADMISSION_REQUEST_SCHEMA_VERSION,
      attempt_id: attemptId,
      worker_id: request.worker_id,
      idempotency_key: `formal-replay-attempt:${request.execution_id}`,
      request_registration_id: context.registration.registration_id,
      request_registration_hash: context.registration.registration_hash,
      claimed_at: claimedAt,
      lease_expires_at: leaseExpiresAt,
    }
    const admission = dependencies.admit([
      "--db",
      displayPath(resolveRepoPath(dbPath)),
      "--artifact-root",
      displayPath(resolveRepoPath(request.artifact_root)),
      "--recovered-at",
      claimedAt,
      "--json",
      canonicalJson(claim),
    ])
    const dispatch = persistDispatchInput(
      request,
      context,
      bundle,
      record(admission.dispatch_authority, "dispatch_authority"),
      claimedAt,
    )
    const outcome = dependencies.run(["--input", dispatch.ref])
    const completedAt = canonicalTime(dependencies.now())
    if (Date.parse(completedAt) >= Date.parse(leaseExpiresAt)) {
      throw new Error("formal Replay lease expired before result publication")
    }
    return dependencies.persist(
      db,
      request,
      context,
      outcome,
      dispatch,
      completedAt,
      resultId,
    )
  } finally {
    db.close()
  }
}

export function loadFormalReplayContext(
  db: Database,
  registrationId: string,
): FormalReplayContext {
  const registration = readReplayRequestRegistration(db, registrationId)
  const admission = readReplayTrialReservationAdmission(
    db,
    registration.reservation_admission_id,
  )
  const row = db.query(`
    SELECT dataset_manifest_hash, dataset_manifest_json
    FROM rd_replay_trial_reservation_admission
    WHERE admission_id=$admission_id
  `).get({ $admission_id: admission.admission_id }) as {
    dataset_manifest_hash: string
    dataset_manifest_json: string
  } | null
  if (!row) throw new Error("formal Replay Reservation Admission is missing")
  return {
    registration,
    admission,
    request: record(registration.replay_request, "registered replay_request"),
    manifest: record(JSON.parse(row.dataset_manifest_json), "stored dataset manifest"),
    stored_manifest_hash: row.dataset_manifest_hash,
  }
}

export function assertFormalReplayContext(
  request: Pick<
    FormalReplayJobRequest,
    "request_registration_id" | "request_registration_hash"
  >,
  context: FormalReplayContext,
): void {
  if (context.registration.registration_hash !== request.request_registration_hash
      || context.registration.registration_id !== request.request_registration_id
      || context.registration.reservation_admission_id !== context.admission.admission_id
      || context.registration.reservation_admission_hash !== context.admission.admission_hash
      || context.registration.trial_id !== context.request.trial_id
      || context.registration.run_id !== context.request.run_id
      || context.registration.dataset_manifest_hash !== context.stored_manifest_hash
      || context.request.dataset_manifest_ref !== context.manifest.manifest_ref
      || context.request.dataset_hash !== context.manifest.data_hash) {
    throw new Error("formal Replay Registration, Reservation, Request, or Dataset lineage drifted")
  }
}

function readDataBundle(
  request: FormalReplayJobRequest,
  context: FormalReplayContext,
): JSONRecord {
  const path = resolveRepoPath(request.data_bundle_ref)
  if (!existsSync(path)) throw new Error("formal Replay data bundle is missing")
  const bytes = readFileSync(path)
  if (hash(bytes) !== request.data_bundle_sha256) {
    throw new Error("formal Replay data bundle content drifted")
  }
  const value = record(JSON.parse(bytes.toString("utf8")), "formal Replay data bundle")
  if (value.schema_version !== FORMAL_REPLAY_DATA_BUNDLE_SCHEMA
      || value.dataset_manifest_hash !== context.registration.dataset_manifest_hash
      || !Array.isArray(value.bars) || !Array.isArray(value.funding_events)
      || !Array.isArray(value.mark_events)
      || !Array.isArray(value.supplemental_facts)) {
    throw new Error("formal Replay data bundle contract is invalid")
  }
  return value
}

function persistDispatchInput(
  request: FormalReplayJobRequest,
  context: FormalReplayContext,
  bundle: JSONRecord,
  dispatchAuthority: JSONRecord,
  observedAt: string,
): { ref: string; sha256: string } {
  const root = resolveRepoPath(request.artifact_root)
  const ref = displayPath(resolve(
    root,
    "formal-dispatch",
    `${hash(Buffer.from([
      context.registration.registration_hash,
      request.data_bundle_sha256,
      request.execution_id,
    ].join(":")))}.json`,
  ))
  const path = resolveRepoPath(ref)
  const body = {
    dispatch_authority: dispatchAuthority,
    trial_reservation: context.admission.reservation_snapshot,
    observed_at: observedAt,
    dataset_manifest: context.manifest,
    bars: bundle.bars,
    funding_events: bundle.funding_events,
    mark_events: bundle.mark_events,
    supplemental_facts: bundle.supplemental_facts,
    artifact_root: root,
  }
  const bytes = persistFormalReplayImmutableJson(
    path,
    body,
    "formal Replay dispatch input",
  )
  return { ref, sha256: hash(bytes) }
}

function loadOrCreateExecutionClock(
  request: FormalReplayJobRequest,
  sampledAt: string,
): { claimed_at: string; lease_expires_at: string } {
  const requestHash = hash(Buffer.from(canonicalJson(request)))
  const ref = displayPath(resolve(
    resolveRepoPath(request.artifact_root),
    "formal-jobs",
    `${hash(Buffer.from(request.execution_id))}.json`,
  ))
  const path = resolveRepoPath(ref)
  if (existsSync(path)) {
    const prior = record(
      JSON.parse(readFileSync(path, "utf8")),
      "formal Replay execution clock",
    )
    if (prior.schema_version !== "trade.rd-formal-replay-execution-clock.v1"
        || prior.execution_id !== request.execution_id
        || prior.request_hash !== requestHash) {
      throw new Error("formal Replay execution_id was reused with different content")
    }
    return {
      claimed_at: canonicalTimestamp(prior.claimed_at, "claimed_at"),
      lease_expires_at: canonicalTimestamp(
        prior.lease_expires_at,
        "lease_expires_at",
      ),
    }
  }
  const leaseExpiresAt = new Date(
    Date.parse(sampledAt) + request.lease_duration_ms,
  ).toISOString()
  persistFormalReplayImmutableJson(path, {
    schema_version: "trade.rd-formal-replay-execution-clock.v1",
    execution_id: request.execution_id,
    request_hash: requestHash,
    claimed_at: sampledAt,
    lease_expires_at: leaseExpiresAt,
  }, "formal Replay execution clock")
  return { claimed_at: sampledAt, lease_expires_at: leaseExpiresAt }
}

export function persistFormalReplayImmutableJson(
  path: string,
  body: JSONRecord,
  label: string,
): Buffer {
  const bytes = Buffer.from(`${canonicalJson(body)}\n`)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (existsSync(path)) {
    if (!readFileSync(path).equals(bytes)) {
      throw new Error(`${label} identity collision`)
    }
    return bytes
  }
  const partial = `${path}.partial-${process.pid}-${randomUUID()}`
  try {
    writeFileSync(partial, bytes, { flag: "wx", mode: 0o600 })
    linkSync(partial, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST"
        && existsSync(path)
        && readFileSync(path).equals(bytes)) {
      return bytes
    }
    throw error
  } finally {
    if (existsSync(partial)) unlinkSync(partial)
  }
  return bytes
}

function persistOutcome(
  db: Database,
  request: FormalReplayJobRequest,
  context: FormalReplayContext,
  outcome: JSONRecord,
  dispatch: { ref: string; sha256: string },
  completedAt: string,
  resultId: string,
): FormalReplayJobResult {
  const attemptId = text(outcome.attempt_id, "outcome.attempt_id")
  const leaseGeneration = positiveInteger(
    outcome.lease_generation,
    "outcome.lease_generation",
  )
  if (attemptId !== `formal-replay-attempt:${request.execution_id}`) {
    throw new Error("formal Replay outcome Attempt identity drifted")
  }
  const status = terminalStatus(outcome.status)
  if (status !== "completed") {
    const failure = optionalRecord(outcome.failure)
    const failureClass = failure
      ? replayFailureClass(failure.failure_class)
      : "resource"
    const diagnostic = optionalRecord(outcome.diagnostic_checkpoint_commit)
    finalizeReplayAttempt(db, {
      attempt_id: attemptId,
      worker_id: request.worker_id,
      expected_lease_generation: leaseGeneration,
      status,
      finalized_at: completedAt,
      failure_class: failureClass,
      ...(diagnostic
        ? {
          diagnostic_checkpoint_ref: text(
            diagnostic.checkpoint_ref,
            "diagnostic checkpoint_ref",
          ),
          diagnostic_checkpoint_hash: digestValue(
            diagnostic.checkpoint_sha256,
            "diagnostic checkpoint_sha256",
          ),
        }
        : {}),
    })
    return {
      schema_version: "trade.rd-formal-replay-job-result.v1",
      status,
      execution_id: request.execution_id,
      request_registration_id: context.registration.registration_id,
      attempt_id: attemptId,
      result_id: null,
      artifact_ref: null,
      dispatch_ref: dispatch.ref,
      dispatch_sha256: dispatch.sha256,
      recovered_result: false,
      formal_evidence_kind: null,
      review_authority: "none",
      deployment_authority: "none",
      trading_authority: false,
      failure_class: failureClass,
    }
  }
  const result = record(outcome.result, "completed Replay Result")
  const fingerprint = record(result.fingerprint, "Replay Result fingerprint")
  const artifact = record(outcome.artifact_commit, "committed Replay Artifact")
  const artifactRef = text(artifact.ref, "artifact.ref")
  const artifactHash = digestValue(artifact.sha256, "artifact.sha256")
  const terminalCheckpointHash = digestValue(
    artifact.terminal_checkpoint_hash,
    "artifact.terminal_checkpoint_hash",
  )
  const summary: JSONRecord = {
    schema_version: "trade.rd-formal-replay-result-summary.v1",
    evidence_kind: "mechanical_replay",
    producer: "replay_owner",
    request_registration_id: context.registration.registration_id,
    request_registration_hash: context.registration.registration_hash,
    replay_request_hash: context.registration.request_hash,
    reservation_admission_id: context.admission.admission_id,
    reservation_admission_hash: context.admission.admission_hash,
    attempt_id: attemptId,
    attempt_lease_generation: leaseGeneration,
    data_bundle_ref: request.data_bundle_ref,
    data_bundle_sha256: request.data_bundle_sha256,
    dispatch_ref: dispatch.ref,
    dispatch_sha256: dispatch.sha256,
    result,
    artifact_commit: artifact,
  }
  const resultWrite: ExperimentResultWrite = {
    result_id: resultId,
    experiment_id: text(context.request.experiment_id, "experiment_id"),
    result_scope: "trial",
    trial_id: text(context.request.trial_id, "trial_id"),
    trial_group_id: text(context.request.trial_group_id, "trial_group_id"),
    run_id: text(context.request.run_id, "run_id"),
    idempotency_key: formalResultKey(context.registration),
    stage_id: "historical_validation",
    result_type_id: "mechanical_replay",
    artifact_ref: artifactRef,
    evidence_fingerprint_json: fingerprint,
    summary_json: summary,
    created_at: completedAt,
  }
  const classification = createEvaluationEvidenceClassification({
    schema_version: EVALUATION_EVIDENCE_CLASSIFICATION_SCHEMA,
    policy_version: EVALUATION_EVIDENCE_POLICY_VERSION,
    result_id: resultId,
    experiment_id: resultWrite.experiment_id,
    evidence_kind: "mechanical_replay",
    producer: "replay_owner",
    artifact_ref: artifactRef,
    evidence_hash: artifactHash,
    classified_at: completedAt,
  })
  db.transaction(() => {
    finalizeReplayAttempt(db, {
      attempt_id: attemptId,
      worker_id: request.worker_id,
      expected_lease_generation: leaseGeneration,
      status: "completed",
      finalized_at: completedAt,
      result_hash: digestValue(fingerprint.result_hash, "result_hash"),
      artifact_ref: artifactRef,
      artifact_hash: artifactHash,
      terminal_checkpoint_hash: terminalCheckpointHash,
    })
    publishExperimentResultAndFinishTrials(db, {
      result: resultWrite,
      trial_ids: [resultWrite.trial_id!],
      completed_at: completedAt,
    })
    registerEvaluationEvidenceClassification(db, classification)
  }).immediate()
  return completedResult(
    request,
    context,
    attemptId,
    resultId,
    artifactRef,
    dispatch,
    false,
  )
}

function readCompletedResult(
  db: Database,
  request: FormalReplayJobRequest,
  context: FormalReplayContext,
  resultId: string,
): FormalReplayJobResult | null {
  const row = db.query(`
    SELECT result.summary_json, result.artifact_ref, classification.evidence_kind,
           classification.producer
    FROM rd_experiment_result AS result
    JOIN rd_evaluation_evidence_classification AS classification
      ON classification.result_id=result.result_id
    WHERE result.idempotency_key=$idempotency_key
  `).get({
    $idempotency_key: formalResultKey(context.registration),
  }) as {
    summary_json: string
    artifact_ref: string
    evidence_kind: string
    producer: string
  } | null
  if (!row) return null
  const summary = record(JSON.parse(row.summary_json), "persisted formal Replay summary")
  if (summary.request_registration_hash !== context.registration.registration_hash
      || summary.data_bundle_ref !== request.data_bundle_ref
      || summary.data_bundle_sha256 !== request.data_bundle_sha256
      || row.evidence_kind !== "mechanical_replay"
      || row.producer !== "replay_owner") {
    throw new Error("persisted formal Replay Result identity or classification drifted")
  }
  return completedResult(
    request,
    context,
    text(summary.attempt_id, "persisted attempt_id"),
    resultId,
    row.artifact_ref,
    {
      ref: text(summary.dispatch_ref, "persisted dispatch_ref"),
      sha256: digestValue(summary.dispatch_sha256, "persisted dispatch_sha256"),
    },
    true,
  )
}

function completedResult(
  request: FormalReplayJobRequest,
  context: FormalReplayContext,
  attemptId: string,
  resultId: string,
  artifactRef: string,
  dispatch: { ref: string; sha256: string },
  recovered: boolean,
): FormalReplayJobResult {
  return {
    schema_version: "trade.rd-formal-replay-job-result.v1",
    status: "completed",
    execution_id: executionIdFromAttempt(attemptId),
    request_registration_id: context.registration.registration_id,
    attempt_id: attemptId,
    result_id: resultId,
    artifact_ref: artifactRef,
    dispatch_ref: dispatch.ref,
    dispatch_sha256: dispatch.sha256,
    recovered_result: recovered,
    formal_evidence_kind: "mechanical_replay",
    review_authority: "classified_result_only",
    deployment_authority: "none",
    trading_authority: false,
  }
}

function executionIdFromAttempt(attemptId: string): string {
  const prefix = "formal-replay-attempt:"
  if (!attemptId.startsWith(prefix) || attemptId.length === prefix.length) {
    throw new Error("persisted formal Replay Attempt identity is invalid")
  }
  return attemptId.slice(prefix.length)
}

function parseRequest(value: JSONRecord): FormalReplayJobRequest {
  const request = value as unknown as FormalReplayJobRequest
  const expected = [
    "artifact_root",
    "data_bundle_ref",
    "data_bundle_sha256",
    "environment_id",
    "execution_id",
    "lease_duration_ms",
    "request_registration_hash",
    "request_registration_id",
    "schema_version",
    "worker_id",
  ]
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)
      || request.schema_version !== FORMAL_REPLAY_JOB_REQUEST_SCHEMA) {
    throw new Error("formal Replay job request contract is invalid")
  }
  for (const [field, item] of Object.entries({
    execution_id: request.execution_id,
    request_registration_id: request.request_registration_id,
    environment_id: request.environment_id,
    worker_id: request.worker_id,
  })) identifier(item, field)
  digestValue(request.request_registration_hash, "request_registration_hash")
  digestValue(request.data_bundle_sha256, "data_bundle_sha256")
  safeRef(request.data_bundle_ref, "data_bundle_ref")
  safeRef(request.artifact_root, "artifact_root")
  if (!Number.isSafeInteger(request.lease_duration_ms)
      || request.lease_duration_ms < 300_000
      || request.lease_duration_ms > 14_400_000) {
    throw new Error("formal Replay lease_duration_ms must be between 5 minutes and 4 hours")
  }
  return structuredClone(request)
}

function formalResultId(registration: ReplayRequestRegistrationRecord): string {
  return `formal-replay-result:${registration.registration_hash.slice(0, 24)}`
}

function formalResultKey(registration: ReplayRequestRegistrationRecord): string {
  return `formal-replay-result:${registration.registration_hash}`
}

function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function digestValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function identifier(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
}

function safeRef(value: string, field: string): void {
  if (!value || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error(`${field} must be repository-relative`)
  }
}

function canonicalTime(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new Error("formal Replay clock is invalid")
  return value.toISOString()
}

function canonicalTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be canonical UTC`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}

function record(value: unknown, field: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as JSONRecord
}

function optionalRecord(value: unknown): JSONRecord | null {
  return value == null ? null : record(value, "optional record")
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${field} is required`)
  return value
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${field} must be a positive integer`)
  }
  return Number(value)
}

function terminalStatus(value: unknown): "completed" | "failed" | "cancelled" {
  if (value !== "completed" && value !== "failed" && value !== "cancelled") {
    throw new Error("formal Replay outcome status is invalid")
  }
  return value
}

function replayFailureClass(
  value: unknown,
): "input_invalid" | "unsupported_contract" | "data_integrity" |
  "deterministic_engine" | "resource" | "external_io" {
  if (![
    "input_invalid",
    "unsupported_contract",
    "data_integrity",
    "deterministic_engine",
    "resource",
    "external_io",
  ].includes(String(value))) {
    throw new Error("formal Replay failure_class is invalid")
  }
  return value as ReturnType<typeof replayFailureClass>
}
