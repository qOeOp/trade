import { createHash } from "node:crypto"
import {
  assertReplayAttemptLeaseSnapshot,
  hashReplayAttemptLeaseSnapshot,
  type ReplayAttemptCancellationObservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION,
  canonicalHash,
  canonicalJson,
  type ReplayExecutionRequest,
} from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayCancellationAcknowledgementOutcome,
} from "./replay-cancellation-coordinator"
import type { ReplayTrialRunOutcome } from "./replay-trial-runner"
import {
  assertCertifiedReplayArtifactStore,
  type ReplayArtifactNamespace,
  type ReplayArtifactStore,
} from "./replay-artifact-store"

export const REPLAY_CANCELLATION_OUTBOX_RECORD_SCHEMA_VERSION = "trade.rd-replay-cancellation-outbox-record.v1" as const
export const REPLAY_CANCELLATION_OUTBOX_COMMIT_SCHEMA_VERSION = "trade.rd-replay-cancellation-outbox-commit.v1" as const

const OUTBOX_RECORD_NAME = "cancellation-observation-outbox.json"

export interface ReplayCancellationOutboxRecord {
  schema_version: typeof REPLAY_CANCELLATION_OUTBOX_RECORD_SCHEMA_VERSION
  persisted_at: string
  request_hash: string
  run_id: string
  attempt_id: string
  lease_generation: number
  boundary_poll_count: number
  replay_outcome: ReplayTrialRunOutcome
  record_hash: string
}

export interface ReplayCancellationOutboxCommit {
  schema_version: typeof REPLAY_CANCELLATION_OUTBOX_COMMIT_SCHEMA_VERSION
  ref: string
  sha256: string
  record_hash: string
  observation_hash: string
  producer_attempt_id: string
  producer_lease_generation: number
  storage_policy_version: typeof REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION
}

export interface ReplayCancellationOutboxLoadedRecord {
  record: ReplayCancellationOutboxRecord
  commit: ReplayCancellationOutboxCommit
}

export interface ReplayCancellationOutboxPort {
  persist(input: {
    replay_outcome: ReplayTrialRunOutcome
    attempt_lease: ReplayAttemptLeaseSnapshot
    boundary_poll_count: number
    persisted_at: string
  }): ReplayCancellationOutboxCommit
  load(): ReplayCancellationOutboxLoadedRecord | null
}

export function createReplayCancellationArtifactOutbox(
  store: ReplayArtifactStore,
  request: ReplayExecutionRequest,
  attemptLease: ReplayAttemptLeaseSnapshot,
): ReplayCancellationOutboxPort {
  assertCertifiedReplayArtifactStore(store)
  assertReplayAttemptLeaseSnapshot(attemptLease)
  const requestHash = canonicalHash(request)
  const namespace = store.openAttempt({
    idempotency_key_hash: canonicalHash(request.idempotency_key),
    attempt_id_hash: canonicalHash(attemptLease.attempt_id),
  })

  const load = (): ReplayCancellationOutboxLoadedRecord | null => loadOutboxRecord(
    namespace,
    requestHash,
    request.run_id,
    attemptLease,
  )

  return {
    persist: ({ replay_outcome: replayOutcome, attempt_lease: currentLease, boundary_poll_count: boundaryPollCount, persisted_at: persistedAt }) => {
      const observation = assertReplayCancellationAcknowledgementOutcome(replayOutcome, boundaryPollCount)
      assertOutboxAuthority(requestHash, request.run_id, attemptLease, replayOutcome, observation, currentLease)
      assertPersistedAt(persistedAt, observation.observed_at)
      const existing = load()
      if (existing) {
        if (existing.record.boundary_poll_count !== boundaryPollCount
            || canonicalJson(existing.record.replay_outcome) !== canonicalJson(replayOutcome)) {
          throw new Error("Replay cancellation outbox already contains different delivery evidence")
        }
        return existing.commit
      }
      const body = {
        schema_version: REPLAY_CANCELLATION_OUTBOX_RECORD_SCHEMA_VERSION,
        persisted_at: persistedAt,
        request_hash: requestHash,
        run_id: replayOutcome.run_id,
        attempt_id: replayOutcome.attempt_id,
        lease_generation: replayOutcome.lease_generation,
        boundary_poll_count: boundaryPollCount,
        replay_outcome: structuredClone(replayOutcome),
      }
      const record: ReplayCancellationOutboxRecord = { ...body, record_hash: canonicalHash(body) }
      const file = namespace.writeImmutable(OUTBOX_RECORD_NAME, `${canonicalJson(record)}\n`)
      return createCommit(file.ref, file.sha256, record)
    },
    load,
  }
}

function loadOutboxRecord(
  namespace: ReplayArtifactNamespace,
  requestHash: string,
  runId: string,
  attemptLease: ReplayAttemptLeaseSnapshot,
): ReplayCancellationOutboxLoadedRecord | null {
  if (!namespace.exists(OUTBOX_RECORD_NAME)) return null
  const file = namespace.read(OUTBOX_RECORD_NAME)
  const sha256 = createHash("sha256").update(file.bytes).digest("hex")
  const text = new TextDecoder().decode(file.bytes)
  let record: ReplayCancellationOutboxRecord
  try {
    record = JSON.parse(text) as ReplayCancellationOutboxRecord
  } catch (error) {
    throw new Error(`Replay cancellation outbox record is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  assertOutboxRecord(record, requestHash, runId, attemptLease)
  if (text !== `${canonicalJson(record)}\n`) {
    throw new Error("Replay cancellation outbox record encoding is not canonical")
  }
  return { record, commit: createCommit(file.ref, sha256, record) }
}

function assertOutboxRecord(
  record: ReplayCancellationOutboxRecord,
  requestHash: string,
  runId: string,
  attemptLease: ReplayAttemptLeaseSnapshot,
): void {
  if (record.schema_version !== REPLAY_CANCELLATION_OUTBOX_RECORD_SCHEMA_VERSION) {
    throw new Error("Replay cancellation outbox record schema is not supported")
  }
  const observation = assertReplayCancellationAcknowledgementOutcome(
    record.replay_outcome,
    record.boundary_poll_count,
  )
  assertOutboxAuthority(requestHash, runId, attemptLease, record.replay_outcome, observation)
  assertPersistedAt(record.persisted_at, observation.observed_at)
  const { record_hash: recordHash, ...body } = record
  if (recordHash !== canonicalHash(body)) {
    throw new Error("Replay cancellation outbox record hash mismatch")
  }
}

function assertOutboxAuthority(
  requestHash: string,
  runId: string,
  attemptLeaseFloor: ReplayAttemptLeaseSnapshot,
  replayOutcome: ReplayTrialRunOutcome,
  observation: ReplayAttemptCancellationObservationSnapshot,
  currentLease?: ReplayAttemptLeaseSnapshot,
): void {
  if (observation.request_hash !== requestHash
      || replayOutcome.run_id !== runId
      || replayOutcome.attempt_id !== attemptLeaseFloor.attempt_id
      || replayOutcome.lease_generation !== observation.target_lease_generation
      || replayOutcome.lease_generation < attemptLeaseFloor.lease_generation
      || !/^[a-f0-9]{64}$/.test(replayOutcome.attempt_lease_hash || "")
      || observation.trial_id !== attemptLeaseFloor.trial_id
      || observation.run_id !== attemptLeaseFloor.run_id
      || observation.reservation_ref !== attemptLeaseFloor.reservation_ref
      || observation.reservation_hash !== attemptLeaseFloor.reservation_hash
      || observation.attempt_id !== attemptLeaseFloor.attempt_id
      || observation.attempt_ordinal !== attemptLeaseFloor.attempt_ordinal
      || observation.worker_id !== attemptLeaseFloor.worker_id) {
    throw new Error("Replay cancellation outbox authority binding mismatch")
  }
  if (!currentLease) return
  assertReplayAttemptLeaseSnapshot(currentLease)
  if (currentLease.trial_id !== attemptLeaseFloor.trial_id
      || currentLease.run_id !== attemptLeaseFloor.run_id
      || currentLease.reservation_ref !== attemptLeaseFloor.reservation_ref
      || currentLease.reservation_hash !== attemptLeaseFloor.reservation_hash
      || currentLease.request_hash !== attemptLeaseFloor.request_hash
      || currentLease.attempt_id !== attemptLeaseFloor.attempt_id
      || currentLease.attempt_ordinal !== attemptLeaseFloor.attempt_ordinal
      || currentLease.worker_id !== attemptLeaseFloor.worker_id
      || currentLease.lease_generation < attemptLeaseFloor.lease_generation
      || replayOutcome.lease_generation !== currentLease.lease_generation
      || replayOutcome.attempt_lease_hash !== hashReplayAttemptLeaseSnapshot(currentLease)) {
    throw new Error("Replay cancellation outbox current lease binding mismatch")
  }
}

function assertPersistedAt(persistedAt: string, observedAt: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(persistedAt)
      || !Number.isFinite(Date.parse(persistedAt))
      || Date.parse(persistedAt) < Date.parse(observedAt)) {
    throw new Error("Replay cancellation outbox persistence time must be RFC 3339 UTC at or after observation")
  }
}

function createCommit(
  ref: string,
  sha256: string,
  record: ReplayCancellationOutboxRecord,
): ReplayCancellationOutboxCommit {
  const observation = record.replay_outcome.cancellation_observation
  if (!observation) throw new Error("Replay cancellation outbox record lost its Observation")
  return {
    schema_version: REPLAY_CANCELLATION_OUTBOX_COMMIT_SCHEMA_VERSION,
    ref,
    sha256,
    record_hash: record.record_hash,
    observation_hash: observation.observation_hash,
    producer_attempt_id: record.attempt_id,
    producer_lease_generation: record.lease_generation,
    storage_policy_version: REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION,
  }
}
