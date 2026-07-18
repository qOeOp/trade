import type { Database } from "bun:sqlite"
import {
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
  REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_POLICY_VERSION,
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_SCHEMA_VERSION,
  REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_POLICY_VERSION,
  REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_SCHEMA_VERSION,
  assertReplayAttemptLeaseSnapshot,
  assertReplayAttemptLeaseObservationSnapshot,
  assertReplaySpawnBoundaryRevalidationRequest,
  assertReplaySuccessorVerificationLeaseRenewalReceipt,
  assertReplaySuccessorVerificationLeaseRenewalRequest,
  assertTrialReservationSnapshot,
  createReplayAttemptLeaseObservationSnapshot,
  createReplayAttemptLeaseObservationRegistryReadReceipt,
  createReplayDispatchClockAttestation,
  createReplaySpawnBoundaryRevalidationReceipt,
  createReplaySuccessorVerificationLeaseRenewalReceipt,
  hashReplayAttemptLeaseSnapshot,
  hashTrialReservationSnapshot,
  replayDispatchClockAttestationIdentityHash,
  replaySpawnBoundaryRevalidationReceiptIdentityHash,
  replaySuccessorVerificationLeaseRenewalReceiptIdentityHash,
  type ReplayAttemptLeaseObservationSnapshot,
  type ReplayAttemptLeaseObservationRegistryReadReceipt,
  type ReplayAttemptLeaseSnapshot,
  type ReplayDispatchClockAttestation,
  type ReplaySpawnBoundaryRevalidationReceipt,
  type ReplaySpawnBoundaryRevalidationRequest,
  type ReplaySuccessorVerificationLeaseRenewalReceipt,
  type ReplaySuccessorVerificationLeaseRenewalRequest,
  type TrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import { assertReplayReservationClaimNotCancelled } from "./replay-cancellation-authority"

export type ReplayAttemptFailureClass = "input_invalid" | "unsupported_contract" | "data_integrity" | "deterministic_engine" | "resource" | "external_io"

export interface ClaimReplayAttemptInput {
  attempt_id: string
  worker_id: string
  idempotency_key: string
  request_hash: string
  claimed_at: string
  lease_expires_at: string
  trial_reservation: TrialReservationSnapshot
}

export interface RenewReplayAttemptLeaseInput {
  attempt_id: string
  worker_id: string
  expected_lease_generation: number
  heartbeat_at: string
  lease_expires_at: string
}

export interface ObserveCurrentReplayAttemptLeaseInput {
  trial_id: string
  observed_at: string
}

export interface FinalizeReplayAttemptInput {
  attempt_id: string
  worker_id: string
  expected_lease_generation: number
  status: "completed" | "failed" | "cancelled"
  finalized_at: string
  result_hash?: string
  artifact_ref?: string
  artifact_hash?: string
  terminal_checkpoint_hash?: string
  diagnostic_checkpoint_ref?: string
  diagnostic_checkpoint_hash?: string
  failure_class?: ReplayAttemptFailureClass
}

interface AttemptRow {
  attempt_id: string
  trial_id: string
  run_id: string
  attempt_ordinal: number
  worker_id: string
  reservation_ref: string
  reservation_hash: string
  request_hash: string
  status: "claimed" | "running" | "completed" | "failed" | "cancelled" | "expired"
  lease_generation: number
  claimed_at: string
  heartbeat_at: string
  lease_expires_at: string
  finalized_at: string | null
  result_hash: string | null
  artifact_ref: string | null
  artifact_hash: string | null
  terminal_checkpoint_hash: string | null
  diagnostic_checkpoint_ref: string | null
  diagnostic_checkpoint_hash: string | null
  failure_class: ReplayAttemptFailureClass | null
  idempotency_key: string
}

interface LeaseObservationRow {
  observation_id: string
  observation_ref: string
  observation_hash: string
  attempt_id: string
  lease_generation: number
  observed_at: string
  registered_at: string
  observation_json: string
}

interface SuccessorVerificationLeaseRenewalRow {
  receipt_id: string
  receipt_ref: string
  receipt_hash: string
  source_request_id: string
  source_request_key: string
  source_request_hash: string
  source_successor_authority_contract_hash: string
  attempt_id: string
  predecessor_lease_generation: number
  successor_lease_generation: number
  predecessor_attempt_lease_hash: string
  successor_attempt_lease_hash: string
  renewed_at: string
  lease_expires_at: string
  receipt_json: string
}

export interface ReadReplayAttemptLeaseObservationRegistryReceiptInput {
  observation_id: string
  read_at: string
}

export interface ReplayDispatchClockSample {
  wall_time_utc: string
  monotonic_ns: string
}

export interface ReplayDispatchClockPort {
  sample(): ReplayDispatchClockSample
}

export interface ReplaySuccessorVerificationLeaseRenewalAuthorityPortAdapter {
  renew(
    request: ReplaySuccessorVerificationLeaseRenewalRequest,
  ): ReplaySuccessorVerificationLeaseRenewalReceipt
}

export interface AttestReplayDispatchClockInput {
  observation_id: string
}

export interface RevalidateReplaySpawnBoundaryInput {
  request: ReplaySpawnBoundaryRevalidationRequest
}

export function createSystemReplayDispatchClockPort(): ReplayDispatchClockPort {
  return {
    sample: () => ({
      wall_time_utc: new Date(Date.now()).toISOString(),
      monotonic_ns: process.hrtime.bigint().toString(),
    }),
  }
}

export function createSqliteReplaySuccessorVerificationLeaseRenewalAuthorityPort(
  db: Database,
  clock: ReplayDispatchClockPort = createSystemReplayDispatchClockPort(),
): ReplaySuccessorVerificationLeaseRenewalAuthorityPortAdapter {
  return {
    renew: (request) => renewReplayAttemptLeaseForSuccessorVerification(db, request, clock),
  }
}

export function claimReplayAttempt(db: Database, input: ClaimReplayAttemptInput): ReplayAttemptLeaseSnapshot {
  requireText(input.attempt_id, "attempt_id")
  requireText(input.worker_id, "worker_id")
  requireText(input.idempotency_key, "idempotency_key")
  requireHash(input.request_hash, "request_hash")
  requireUtc(input.claimed_at, "claimed_at")
  requireUtc(input.lease_expires_at, "lease_expires_at")
  if (Date.parse(input.lease_expires_at) <= Date.parse(input.claimed_at)) throw new Error("Replay Attempt lease must expire after claim")
  assertTrialReservationSnapshot(input.trial_reservation)
  const reservationHash = hashTrialReservationSnapshot(input.trial_reservation)
  const reservation = input.trial_reservation
  const claimedAt = Date.parse(input.claimed_at)
  if (claimedAt < Date.parse(reservation.issued_at) || claimedAt >= Date.parse(reservation.expires_at)) {
    throw new Error("Replay Attempt claim must satisfy reservation issued_at <= claimed_at < expires_at")
  }

  const claim = db.transaction(() => {
    const replay = readAttemptByIdempotencyKey(db, input.idempotency_key)
    if (replay) {
      if (replay.status !== "claimed" && replay.status !== "running") throw new Error("Replay Attempt idempotency key already reached a terminal state")
      if (replay.attempt_id !== input.attempt_id || replay.worker_id !== input.worker_id
          || replay.request_hash !== input.request_hash || replay.reservation_hash !== reservationHash
          || replay.lease_expires_at !== input.lease_expires_at) {
        throw new Error("Replay Attempt idempotency key was reused with different authority")
      }
      return toLeaseSnapshot(replay)
    }

    assertReplayReservationClaimNotCancelled(db, reservationHash, input.claimed_at)

    const trial = db.query(`
      SELECT trial_id, run_id, status, experiment_id, trial_group_id, candidate_id,
             candidate_identity_hash, identity_hash_policy_version
      FROM rd_trial WHERE trial_id=$trial_id
    `).get({ $trial_id: reservation.identity.trial_id }) as {
      trial_id: string; run_id: string; status: string; experiment_id: string; trial_group_id: string
      candidate_id: string; candidate_identity_hash: string; identity_hash_policy_version: string
    } | null
    if (!trial || trial.status !== "reserved") throw new Error("Replay Attempt requires a reserved Trial")
    if (trial.run_id !== reservation.run_id || trial.experiment_id !== reservation.identity.experiment_id
        || trial.trial_group_id !== reservation.identity.trial_group_id || trial.candidate_id !== reservation.identity.candidate_id
        || trial.candidate_identity_hash !== reservation.identity.candidate_hash
        || trial.identity_hash_policy_version !== reservation.identity.identity_hash_policy_version) {
      throw new Error("Replay Attempt reservation does not match authoritative Trial")
    }

    db.query(`
      UPDATE rd_replay_attempt
      SET status='expired', finalized_at=$now, failure_class='resource'
      WHERE trial_id=$trial_id AND status IN ('claimed', 'running') AND lease_expires_at <= $now
    `).run({ $trial_id: trial.trial_id, $now: input.claimed_at })
    const active = db.query(`
      SELECT attempt_id FROM rd_replay_attempt
      WHERE trial_id=$trial_id AND status IN ('claimed', 'running')
    `).get({ $trial_id: trial.trial_id }) as { attempt_id: string } | null
    if (active) throw new Error(`Replay Trial already has active attempt ${active.attempt_id}`)
    const completed = db.query(`
      SELECT attempt_id FROM rd_replay_attempt WHERE trial_id=$trial_id AND status='completed'
    `).get({ $trial_id: trial.trial_id }) as { attempt_id: string } | null
    if (completed) throw new Error(`Replay Trial already has completed attempt ${completed.attempt_id}`)
    const ordinal = (db.query(`
      SELECT COALESCE(MAX(attempt_ordinal), 0) + 1 AS ordinal FROM rd_replay_attempt WHERE trial_id=$trial_id
    `).get({ $trial_id: trial.trial_id }) as { ordinal: number }).ordinal
    db.query(`
      INSERT INTO rd_replay_attempt(
        attempt_id, trial_id, run_id, attempt_ordinal, worker_id,
        reservation_ref, reservation_hash, request_hash, status,
        lease_generation, claimed_at, heartbeat_at, lease_expires_at, idempotency_key
      ) VALUES (
        $attempt_id, $trial_id, $run_id, $attempt_ordinal, $worker_id,
        $reservation_ref, $reservation_hash, $request_hash, 'claimed',
        1, $claimed_at, $claimed_at, $lease_expires_at, $idempotency_key
      )
    `).run({
      $attempt_id: input.attempt_id, $trial_id: trial.trial_id, $run_id: trial.run_id,
      $attempt_ordinal: ordinal, $worker_id: input.worker_id,
      $reservation_ref: reservation.reservation_ref, $reservation_hash: reservationHash,
      $request_hash: input.request_hash, $claimed_at: input.claimed_at,
      $lease_expires_at: input.lease_expires_at, $idempotency_key: input.idempotency_key,
    })
    return toLeaseSnapshot(readAttempt(db, input.attempt_id))
  })
  return claim()
}

export function renewReplayAttemptLease(db: Database, input: RenewReplayAttemptLeaseInput): ReplayAttemptLeaseSnapshot {
  requireText(input.attempt_id, "attempt_id")
  requireText(input.worker_id, "worker_id")
  requireUtc(input.heartbeat_at, "heartbeat_at")
  requireUtc(input.lease_expires_at, "lease_expires_at")
  const current = readAttempt(db, input.attempt_id)
  if (current.worker_id !== input.worker_id || current.lease_generation !== input.expected_lease_generation) {
    throw new Error("Replay Attempt lease fencing token mismatch")
  }
  if (current.status !== "claimed" && current.status !== "running") throw new Error("Replay Attempt is terminal")
  if (Date.parse(input.heartbeat_at) >= Date.parse(current.lease_expires_at)) throw new Error("Replay Attempt lease already expired")
  if (Date.parse(input.lease_expires_at) <= Date.parse(current.lease_expires_at)) throw new Error("Replay Attempt renewal must extend expiry")
  const result = db.query(`
    UPDATE rd_replay_attempt
    SET status='running', lease_generation=lease_generation+1,
        heartbeat_at=$heartbeat_at, lease_expires_at=$lease_expires_at
    WHERE attempt_id=$attempt_id AND worker_id=$worker_id
      AND lease_generation=$generation AND status IN ('claimed', 'running')
  `).run({
    $attempt_id: input.attempt_id, $worker_id: input.worker_id,
    $generation: input.expected_lease_generation, $heartbeat_at: input.heartbeat_at,
    $lease_expires_at: input.lease_expires_at,
  })
  if (result.changes !== 1) throw new Error("Replay Attempt lease lost during renewal")
  return toLeaseSnapshot(readAttempt(db, input.attempt_id))
}

export function renewReplayAttemptLeaseForSuccessorVerification(
  db: Database,
  request: ReplaySuccessorVerificationLeaseRenewalRequest,
  clock: ReplayDispatchClockPort = createSystemReplayDispatchClockPort(),
): ReplaySuccessorVerificationLeaseRenewalReceipt {
  assertReplaySuccessorVerificationLeaseRenewalRequest(request)
  const renew = db.transaction(() => {
    const existing = db.query(`
      SELECT receipt_id, receipt_ref, receipt_hash, source_request_id, source_request_key,
             source_request_hash, source_successor_authority_contract_hash, attempt_id,
             predecessor_lease_generation, successor_lease_generation,
             predecessor_attempt_lease_hash, successor_attempt_lease_hash,
             renewed_at, lease_expires_at, receipt_json
      FROM rd_replay_successor_verification_lease_renewal
      WHERE source_request_id=$source_request_id OR source_request_key=$source_request_key
         OR source_request_hash=$source_request_hash
         OR source_successor_authority_contract_hash=$source_successor_authority_contract_hash
    `).all({
      $source_request_id: request.request_id,
      $source_request_key: request.request_key,
      $source_request_hash: request.request_hash,
      $source_successor_authority_contract_hash: request.source_successor_authority_contract_hash,
    }) as SuccessorVerificationLeaseRenewalRow[]
    if (existing.length > 0) {
      if (existing.length !== 1 || existing[0]?.source_request_hash !== request.request_hash) {
        throw new Error("Replay successor verification Lease renewal identity was reused with different authority")
      }
      return parseSuccessorVerificationLeaseRenewalReceipt(existing[0])
    }

    const current = readAttempt(db, request.attempt_id)
    if (current.status !== "claimed" && current.status !== "running") {
      throw new Error("Replay successor verification Lease renewal requires an active Attempt")
    }
    const predecessor = toLeaseSnapshot(current)
    if (request.attempt_ordinal !== predecessor.attempt_ordinal
        || request.worker_id !== predecessor.worker_id
        || request.replay_execution_request_hash !== predecessor.request_hash
        || request.expected_current_lease_generation !== predecessor.lease_generation
        || request.expected_current_attempt_lease_hash !== hashReplayAttemptLeaseSnapshot(predecessor)) {
      throw new Error("Replay successor verification Lease renewal fencing or Request binding mismatch")
    }
    if (Date.parse(request.requested_lease_expires_at) <= Date.parse(predecessor.lease_expires_at)) {
      throw new Error("Replay successor verification Lease renewal must extend expiry")
    }
    const renewedAt = readReplayDispatchClockSample(clock, "successor_verification_renewal").wall_time_utc
    if (Date.parse(renewedAt) < Date.parse(predecessor.heartbeat_at)
        || Date.parse(renewedAt) >= Date.parse(predecessor.lease_expires_at)) {
      throw new Error("Replay successor verification Lease renewal must occur inside the active Lease window")
    }
    const result = db.query(`
      UPDATE rd_replay_attempt
      SET status='running', lease_generation=lease_generation+1,
          heartbeat_at=$heartbeat_at, lease_expires_at=$lease_expires_at
      WHERE attempt_id=$attempt_id AND worker_id=$worker_id
        AND lease_generation=$generation AND status IN ('claimed', 'running')
    `).run({
      $attempt_id: request.attempt_id,
      $worker_id: request.worker_id,
      $generation: request.expected_current_lease_generation,
      $heartbeat_at: renewedAt,
      $lease_expires_at: request.requested_lease_expires_at,
    })
    if (result.changes !== 1) {
      throw new Error("Replay successor verification Lease renewal lost authority during transaction")
    }
    const successor = toLeaseSnapshot(readAttempt(db, request.attempt_id))
    const predecessorHash = hashReplayAttemptLeaseSnapshot(predecessor)
    const successorHash = hashReplayAttemptLeaseSnapshot(successor)
    const identity = replaySuccessorVerificationLeaseRenewalReceiptIdentityHash({
      source_request_hash: request.request_hash,
      predecessor_attempt_lease_hash: predecessorHash,
      successor_attempt_lease_hash: successorHash,
      receipt_policy_version: REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_POLICY_VERSION,
    })
    const receipt = createReplaySuccessorVerificationLeaseRenewalReceipt({
      schema_version: REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_SCHEMA_VERSION,
      receipt_id: `replay-successor-verification-lease-renewal-receipt-${identity.slice(0, 24)}`,
      receipt_ref: `receipt://replay-successor-verification-lease-renewal/${identity.slice(0, 24)}`,
      receipt_policy_version: REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_RECEIPT_POLICY_VERSION,
      status: "successor_verification_lease_renewed",
      authority_owner: "research_control_plane",
      authority_source: "research_control_plane_state_store",
      registry_table: "rd_replay_successor_verification_lease_renewal",
      registry_row_immutability: "sqlite_update_and_delete_triggers",
      source_request_id: request.request_id,
      source_request_ref: request.request_ref,
      source_request_hash: request.request_hash,
      source_request: structuredClone(request),
      source_evidence_validation: "opaque_hash_binding_only_replay_lineage_not_revalidated",
      renewal_transaction:
        "single_control_plane_transaction_exact_predecessor_fencing_update_and_receipt_insert",
      clock_source: "control_plane_authority_process_clock_port",
      clock_independence: "authority_internal_sampling_without_caller_heartbeat_time",
      caller_heartbeat_time_input: "forbidden",
      external_time_attestation: "not_provided",
      renewed_at: renewedAt,
      predecessor_attempt_lease_hash: predecessorHash,
      predecessor_attempt_lease: predecessor,
      successor_attempt_lease_hash: successorHash,
      successor_attempt_lease: successor,
      generation_relation: "successor_equals_predecessor_plus_one",
      immutable_attempt_binding:
        "attempt_ordinal_worker_trial_run_reservation_request_and_claimed_at_exactly_equal",
      requested_expiry_relation: "successor_expiry_equals_control_plane_admitted_request_expiry",
      successor_authority: "lease_generation_only_fresh_execution_lineage_still_required",
      process_authority: "none",
      harness_authority: "none",
      decision_output_authority: "none",
      signal_authority: "none",
      order_authority: "none",
      economic_authority: "none",
      trial_authority: "none",
    })
    db.query(`
      INSERT INTO rd_replay_successor_verification_lease_renewal(
        receipt_id, receipt_ref, receipt_hash, receipt_policy_version, status,
        source_request_id, source_request_key, source_request_hash,
        source_successor_authority_contract_hash, source_reproducibility_pair_contract_hash,
        attempt_id, attempt_ordinal, worker_id,
        predecessor_lease_generation, predecessor_attempt_lease_hash,
        successor_lease_generation, successor_attempt_lease_hash,
        renewed_at, lease_expires_at, receipt_json
      ) VALUES (
        $receipt_id, $receipt_ref, $receipt_hash, $receipt_policy_version, $status,
        $source_request_id, $source_request_key, $source_request_hash,
        $source_successor_authority_contract_hash, $source_reproducibility_pair_contract_hash,
        $attempt_id, $attempt_ordinal, $worker_id,
        $predecessor_lease_generation, $predecessor_attempt_lease_hash,
        $successor_lease_generation, $successor_attempt_lease_hash,
        $renewed_at, $lease_expires_at, $receipt_json
      )
    `).run({
      $receipt_id: receipt.receipt_id,
      $receipt_ref: receipt.receipt_ref,
      $receipt_hash: receipt.receipt_hash,
      $receipt_policy_version: receipt.receipt_policy_version,
      $status: receipt.status,
      $source_request_id: request.request_id,
      $source_request_key: request.request_key,
      $source_request_hash: request.request_hash,
      $source_successor_authority_contract_hash: request.source_successor_authority_contract_hash,
      $source_reproducibility_pair_contract_hash: request.source_reproducibility_pair_contract_hash,
      $attempt_id: request.attempt_id,
      $attempt_ordinal: request.attempt_ordinal,
      $worker_id: request.worker_id,
      $predecessor_lease_generation: predecessor.lease_generation,
      $predecessor_attempt_lease_hash: predecessorHash,
      $successor_lease_generation: successor.lease_generation,
      $successor_attempt_lease_hash: successorHash,
      $renewed_at: renewedAt,
      $lease_expires_at: successor.lease_expires_at,
      $receipt_json: JSON.stringify(receipt),
    })
    return receipt
  })
  return renew.immediate()
}

export function readReplaySuccessorVerificationLeaseRenewalReceipt(
  db: Database,
  sourceRequestHash: string,
): ReplaySuccessorVerificationLeaseRenewalReceipt | null {
  requireHash(sourceRequestHash, "successor_verification_lease_renewal.source_request_hash")
  const row = db.query(`
    SELECT receipt_id, receipt_ref, receipt_hash, source_request_id, source_request_key,
           source_request_hash, source_successor_authority_contract_hash, attempt_id,
           predecessor_lease_generation, successor_lease_generation,
           predecessor_attempt_lease_hash, successor_attempt_lease_hash,
           renewed_at, lease_expires_at, receipt_json
    FROM rd_replay_successor_verification_lease_renewal
    WHERE source_request_hash=$source_request_hash
  `).get({ $source_request_hash: sourceRequestHash }) as SuccessorVerificationLeaseRenewalRow | null
  return row ? parseSuccessorVerificationLeaseRenewalReceipt(row) : null
}

export function observeCurrentReplayAttemptLease(
  db: Database,
  input: ObserveCurrentReplayAttemptLeaseInput,
): ReplayAttemptLeaseObservationSnapshot {
  requireText(input.trial_id, "trial_id")
  requireUtc(input.observed_at, "observed_at")
  const observe = db.transaction(() => {
    const row = db.query(`
      SELECT * FROM rd_replay_attempt
      WHERE trial_id=$trial_id AND status IN ('claimed', 'running')
    `).get({ $trial_id: input.trial_id }) as AttemptRow | null
    if (!row) throw new Error("Replay Trial has no active Attempt Lease to observe")
    const lease = toLeaseSnapshot(row)
    const observed = Date.parse(input.observed_at)
    if (observed < Date.parse(lease.heartbeat_at) || observed >= Date.parse(lease.lease_expires_at)) {
      throw new Error("Replay Attempt Lease observation must satisfy heartbeat_at <= observed_at < lease_expires_at")
    }
    const leaseHash = hashReplayAttemptLeaseSnapshot(lease)
    const discriminator = `${leaseHash.slice(0, 16)}-${observed}`
    return createReplayAttemptLeaseObservationSnapshot({
      schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
      observation_id: `replay-attempt-lease-observation-${discriminator}`,
      observation_ref: `observation://replay-attempt-lease/${discriminator}`,
      observation_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
      status: "active_lease_observed",
      observed_at: input.observed_at,
      authority_owner: "research_control_plane",
      authority_source: "research_control_plane_state_store",
      read_consistency: "single_control_plane_transaction",
      clock_evidence: "caller_supplied_utc_not_external_time_attestation",
      trial_id: lease.trial_id,
      run_id: lease.run_id,
      attempt_id: lease.attempt_id,
      attempt_ordinal: lease.attempt_ordinal,
      worker_id: lease.worker_id,
      lease_generation: lease.lease_generation,
      attempt_lease_hash: leaseHash,
      attempt_lease: lease,
    })
  })
  return observe()
}

export function registerReplayAttemptLeaseObservation(
  db: Database,
  observation: ReplayAttemptLeaseObservationSnapshot,
  registeredAt: string,
): ReplayAttemptLeaseObservationSnapshot {
  assertReplayAttemptLeaseObservationSnapshot(observation)
  requireUtc(registeredAt, "registered_at")
  if (Date.parse(registeredAt) < Date.parse(observation.observed_at)) {
    throw new Error("Replay Attempt Lease observation cannot be registered before it was observed")
  }
  const register = db.transaction(() => {
    const existing = db.query(`
      SELECT observation_id, observation_ref, observation_hash, attempt_id,
             lease_generation, observed_at, registered_at, observation_json
      FROM rd_replay_attempt_lease_observation
      WHERE observation_id=$observation_id OR observation_ref=$observation_ref
         OR observation_hash=$observation_hash
         OR (attempt_id=$attempt_id AND lease_generation=$lease_generation AND observed_at=$observed_at)
    `).all({
      $observation_id: observation.observation_id,
      $observation_ref: observation.observation_ref,
      $observation_hash: observation.observation_hash,
      $attempt_id: observation.attempt_id,
      $lease_generation: observation.lease_generation,
      $observed_at: observation.observed_at,
    }) as LeaseObservationRow[]
    if (existing.length > 0) {
      if (existing.length !== 1 || existing[0]?.observation_hash !== observation.observation_hash) {
        throw new Error("Replay Attempt Lease observation identity was reused with different authority")
      }
      return parseLeaseObservation(existing[0])
    }

    if (Date.parse(registeredAt) >= Date.parse(observation.attempt_lease.lease_expires_at)) {
      throw new Error("Replay Attempt Lease observation registration missed the active Lease window")
    }
    const attempt = readAttempt(db, observation.attempt_id)
    if (attempt.status !== "claimed" && attempt.status !== "running") {
      throw new Error("Replay Attempt Lease observation registration requires an active Attempt")
    }
    const currentLease = toLeaseSnapshot(attempt)
    if (hashReplayAttemptLeaseSnapshot(currentLease) !== observation.attempt_lease_hash) {
      throw new Error("Replay Attempt Lease observation no longer matches Control Plane state")
    }
    db.query(`
      INSERT INTO rd_replay_attempt_lease_observation(
        observation_id, observation_ref, observation_hash, observation_policy_version,
        status, observed_at, registered_at, authority_owner, authority_source,
        read_consistency, clock_evidence, trial_id, run_id, attempt_id,
        attempt_ordinal, worker_id, lease_generation, attempt_lease_hash, observation_json
      ) VALUES (
        $observation_id, $observation_ref, $observation_hash, $observation_policy_version,
        $status, $observed_at, $registered_at, $authority_owner, $authority_source,
        $read_consistency, $clock_evidence, $trial_id, $run_id, $attempt_id,
        $attempt_ordinal, $worker_id, $lease_generation, $attempt_lease_hash, $observation_json
      )
    `).run({
      $observation_id: observation.observation_id,
      $observation_ref: observation.observation_ref,
      $observation_hash: observation.observation_hash,
      $observation_policy_version: observation.observation_policy_version,
      $status: observation.status,
      $observed_at: observation.observed_at,
      $registered_at: registeredAt,
      $authority_owner: observation.authority_owner,
      $authority_source: observation.authority_source,
      $read_consistency: observation.read_consistency,
      $clock_evidence: observation.clock_evidence,
      $trial_id: observation.trial_id,
      $run_id: observation.run_id,
      $attempt_id: observation.attempt_id,
      $attempt_ordinal: observation.attempt_ordinal,
      $worker_id: observation.worker_id,
      $lease_generation: observation.lease_generation,
      $attempt_lease_hash: observation.attempt_lease_hash,
      $observation_json: JSON.stringify(observation),
    })
    return structuredClone(observation)
  })
  return register.immediate()
}

export function readReplayAttemptLeaseObservation(
  db: Database,
  observationId: string,
): ReplayAttemptLeaseObservationSnapshot | null {
  requireText(observationId, "observation_id")
  const row = db.query(`
    SELECT observation_id, observation_ref, observation_hash, attempt_id,
           lease_generation, observed_at, registered_at, observation_json
    FROM rd_replay_attempt_lease_observation
    WHERE observation_id=$observation_id
  `).get({ $observation_id: observationId }) as LeaseObservationRow | null
  return row ? parseLeaseObservation(row) : null
}

export function readReplayAttemptLeaseObservationRegistryReceipt(
  db: Database,
  input: ReadReplayAttemptLeaseObservationRegistryReceiptInput,
): ReplayAttemptLeaseObservationRegistryReadReceipt {
  requireText(input.observation_id, "observation_id")
  requireUtc(input.read_at, "read_at")
  const read = db.transaction(() => {
    const row = db.query(`
      SELECT observation_id, observation_ref, observation_hash, attempt_id,
             lease_generation, observed_at, registered_at, observation_json
      FROM rd_replay_attempt_lease_observation
      WHERE observation_id=$observation_id
    `).get({ $observation_id: input.observation_id }) as LeaseObservationRow | null
    if (!row) throw new Error("Replay Attempt Lease observation registry row does not exist")
    const observation = parseLeaseObservation(row)
    const attempt = readAttempt(db, observation.attempt_id)
    if (attempt.status !== "claimed" && attempt.status !== "running") {
      throw new Error("Replay Attempt Lease observation registry read requires an active Attempt")
    }
    const currentLease = toLeaseSnapshot(attempt)
    const currentLeaseHash = hashReplayAttemptLeaseSnapshot(currentLease)
    if (currentLeaseHash !== observation.attempt_lease_hash) {
      throw new Error("Replay Attempt Lease observation registry read no longer matches current Control Plane state")
    }
    const readAt = Date.parse(input.read_at)
    if (readAt < Date.parse(row.registered_at) || readAt >= Date.parse(currentLease.lease_expires_at)) {
      throw new Error("Replay Attempt Lease observation registry read must occur after registration and before expiry")
    }
    const discriminator = `${observation.observation_hash.slice(0, 16)}-${readAt}`
    return createReplayAttemptLeaseObservationRegistryReadReceipt({
      schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
      receipt_id: `replay-attempt-lease-observation-registry-read-${discriminator}`,
      receipt_ref: `receipt://replay-attempt-lease-observation-registry-read/${discriminator}`,
      receipt_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
      status: "registered_active_lease_observation_read",
      authority_owner: "research_control_plane",
      authority_source: "research_control_plane_state_store",
      registry_table: "rd_replay_attempt_lease_observation",
      registry_key: observation.observation_id,
      registry_row_immutability: "sqlite_update_and_delete_triggers",
      read_consistency: "single_control_plane_transaction",
      registry_read_provenance: "registered_row_and_current_attempt_exact_match",
      registered_at: row.registered_at,
      read_at: input.read_at,
      clock_evidence: "caller_supplied_utc_not_external_time_attestation",
      external_time_attestation: "not_provided",
      source_observation_id: observation.observation_id,
      source_observation_ref: observation.observation_ref,
      source_observation_hash: observation.observation_hash,
      source_observation: observation,
      current_attempt_status: currentLease.status,
      current_attempt_lease_hash: currentLeaseHash,
      current_attempt_lease: currentLease,
    })
  })
  return read()
}

export function attestReplayDispatchClock(
  db: Database,
  input: AttestReplayDispatchClockInput,
  clock: ReplayDispatchClockPort = createSystemReplayDispatchClockPort(),
): ReplayDispatchClockAttestation {
  requireText(input.observation_id, "observation_id")
  const started = readReplayDispatchClockSample(clock, "started")
  const receipt = readReplayAttemptLeaseObservationRegistryReceipt(db, {
    observation_id: input.observation_id,
    read_at: started.wall_time_utc,
  })
  const completed = readReplayDispatchClockSample(clock, "completed")
  const identityHash = replayDispatchClockAttestationIdentityHash({
    source_registry_read_receipt_hash: receipt.receipt_hash,
    registry_read_started_at: started.wall_time_utc,
    registry_read_completed_at: completed.wall_time_utc,
    registry_read_started_monotonic_ns: started.monotonic_ns,
    registry_read_completed_monotonic_ns: completed.monotonic_ns,
    attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  })
  return createReplayDispatchClockAttestation({
    schema_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
    attestation_id: `replay-dispatch-clock-attestation-${identityHash.slice(0, 24)}`,
    attestation_ref: `attestation://replay-dispatch-clock/${identityHash.slice(0, 24)}`,
    attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
    status: "authority_clock_bracketed_registry_read",
    authority_owner: "research_control_plane",
    authority_source: "research_control_plane_state_store",
    clock_source: "control_plane_authority_process_clock_port",
    clock_independence: "authority_internal_sampling_without_caller_timestamp_input",
    caller_time_input: "forbidden",
    wall_clock_source: "javascript_date_now_utc",
    monotonic_clock_source: "process_hrtime_bigint",
    external_time_attestation: "not_provided",
    registry_read_bracketing: "wall_and_monotonic_samples_before_and_after_single_transaction_read",
    registry_read_started_at: started.wall_time_utc,
    registry_read_completed_at: completed.wall_time_utc,
    registry_read_started_monotonic_ns: started.monotonic_ns,
    registry_read_completed_monotonic_ns: completed.monotonic_ns,
    source_registry_read_receipt_id: receipt.receipt_id,
    source_registry_read_receipt_ref: receipt.receipt_ref,
    source_registry_read_receipt_hash: receipt.receipt_hash,
    source_registry_read_receipt: receipt,
    attempt_id: receipt.current_attempt_lease.attempt_id,
    worker_id: receipt.current_attempt_lease.worker_id,
    lease_generation: receipt.current_attempt_lease.lease_generation,
    current_attempt_lease_hash: receipt.current_attempt_lease_hash,
  })
}

export function revalidateReplaySpawnBoundary(
  db: Database,
  input: RevalidateReplaySpawnBoundaryInput,
  clock: ReplayDispatchClockPort = createSystemReplayDispatchClockPort(),
): ReplaySpawnBoundaryRevalidationReceipt {
  assertReplaySpawnBoundaryRevalidationRequest(input.request)
  const request = input.request
  const started = readReplayDispatchClockSample(clock, "spawn_revalidation_started")
  const currentLease = db.transaction(() => {
    const attempt = readAttempt(db, request.attempt_id)
    if (attempt.status !== "claimed" && attempt.status !== "running") {
      throw new Error("Replay spawn-boundary revalidation requires an active Attempt")
    }
    const lease = toLeaseSnapshot(attempt)
    const leaseHash = hashReplayAttemptLeaseSnapshot(lease)
    if (lease.attempt_ordinal !== request.attempt_ordinal
        || lease.worker_id !== request.worker_id
        || lease.lease_generation !== request.lease_generation
        || leaseHash !== request.expected_current_attempt_lease_hash
        || lease.lease_expires_at !== request.expected_valid_before) {
      throw new Error("Replay spawn-boundary revalidation no longer matches current Control Plane state")
    }
    if (Date.parse(started.wall_time_utc) < Date.parse(lease.heartbeat_at)
        || Date.parse(started.wall_time_utc) >= Date.parse(lease.lease_expires_at)) {
      throw new Error("Replay spawn-boundary revalidation read must occur inside the active Lease window")
    }
    return lease
  })()
  const completed = readReplayDispatchClockSample(clock, "spawn_revalidation_completed")
  if (Date.parse(completed.wall_time_utc) < Date.parse(started.wall_time_utc)
      || Date.parse(completed.wall_time_utc) >= Date.parse(currentLease.lease_expires_at)) {
    throw new Error("Replay spawn-boundary revalidation completion must remain inside the active Lease window")
  }
  const identityHash = replaySpawnBoundaryRevalidationReceiptIdentityHash({
    source_request_hash: request.request_hash,
    registry_read_started_at: started.wall_time_utc,
    registry_read_completed_at: completed.wall_time_utc,
    registry_read_started_monotonic_ns: started.monotonic_ns,
    registry_read_completed_monotonic_ns: completed.monotonic_ns,
    receipt_policy_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_POLICY_VERSION,
  })
  return createReplaySpawnBoundaryRevalidationReceipt({
    schema_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_SCHEMA_VERSION,
    receipt_id: `replay-spawn-boundary-revalidation-receipt-${identityHash.slice(0, 24)}`,
    receipt_ref: `receipt://replay-spawn-boundary-revalidation/${identityHash.slice(0, 24)}`,
    receipt_policy_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_POLICY_VERSION,
    status: "capsule_bound_current_attempt_revalidated",
    authority_owner: "research_control_plane",
    authority_source: "research_control_plane_state_store",
    source_request_id: request.request_id,
    source_request_ref: request.request_ref,
    source_request_hash: request.request_hash,
    source_request: structuredClone(request),
    clock_source: "control_plane_authority_process_clock_port",
    clock_independence: "authority_internal_sampling_without_caller_timestamp_input",
    caller_time_input: "forbidden",
    wall_clock_source: "javascript_date_now_utc",
    monotonic_clock_source: "process_hrtime_bigint",
    external_time_attestation: "not_provided",
    current_attempt_read: "single_control_plane_transaction_exact_attempt_worker_generation_and_lease_hash",
    registry_read_started_at: started.wall_time_utc,
    registry_read_completed_at: completed.wall_time_utc,
    registry_read_started_monotonic_ns: started.monotonic_ns,
    registry_read_completed_monotonic_ns: completed.monotonic_ns,
    current_attempt_status: currentLease.status,
    current_attempt_lease_hash: hashReplayAttemptLeaseSnapshot(currentLease),
    current_attempt_lease: currentLease,
    revalidated_at: completed.wall_time_utc,
    valid_before: currentLease.lease_expires_at,
    spawn_candidate_authority: "single_immediate_spawn_candidate_not_process_start_evidence",
    race_limit: "receipt_cannot_prove_absence_of_cancellation_or_fencing_after_completed_read",
    process_authority: "none",
  })
}

function readReplayDispatchClockSample(clock: ReplayDispatchClockPort, label: string): ReplayDispatchClockSample {
  const sample = clock.sample()
  requireUtc(sample.wall_time_utc, `dispatch_clock_${label}.wall_time_utc`)
  if (!/^\d+$/.test(sample.monotonic_ns)) throw new Error(`dispatch_clock_${label}.monotonic_ns must be unsigned integer text`)
  return sample
}

export function finalizeReplayAttempt(db: Database, input: FinalizeReplayAttemptInput): void {
  requireText(input.attempt_id, "attempt_id")
  requireText(input.worker_id, "worker_id")
  requireUtc(input.finalized_at, "finalized_at")
  const current = readAttempt(db, input.attempt_id)
  if (current.status === input.status && current.finalized_at === input.finalized_at
      && current.result_hash === (input.result_hash ?? null) && current.artifact_ref === (input.artifact_ref ?? null)
      && current.artifact_hash === (input.artifact_hash ?? null)
      && current.terminal_checkpoint_hash === (input.terminal_checkpoint_hash ?? null)
      && current.diagnostic_checkpoint_ref === (input.diagnostic_checkpoint_ref ?? null)
      && current.diagnostic_checkpoint_hash === (input.diagnostic_checkpoint_hash ?? null)
      && current.failure_class === (input.failure_class ?? null)) return
  if (current.worker_id !== input.worker_id || current.lease_generation !== input.expected_lease_generation) {
    throw new Error("Replay Attempt finalization fencing token mismatch")
  }
  if (current.status !== "claimed" && current.status !== "running") throw new Error("Replay Attempt is already terminal")
  if (Date.parse(input.finalized_at) > Date.parse(current.lease_expires_at)) throw new Error("Replay Attempt lease expired before finalization")
  validateTerminal(input)
  const result = db.query(`
    UPDATE rd_replay_attempt SET
      status=$status, finalized_at=$finalized_at,
      result_hash=$result_hash, artifact_ref=$artifact_ref, artifact_hash=$artifact_hash,
      terminal_checkpoint_hash=$terminal_checkpoint_hash,
      diagnostic_checkpoint_ref=$diagnostic_checkpoint_ref,
      diagnostic_checkpoint_hash=$diagnostic_checkpoint_hash,
      failure_class=$failure_class
    WHERE attempt_id=$attempt_id AND worker_id=$worker_id
      AND lease_generation=$generation AND status IN ('claimed', 'running')
  `).run({
    $status: input.status, $finalized_at: input.finalized_at,
    $result_hash: input.result_hash ?? null, $artifact_ref: input.artifact_ref ?? null,
    $artifact_hash: input.artifact_hash ?? null, $terminal_checkpoint_hash: input.terminal_checkpoint_hash ?? null,
    $diagnostic_checkpoint_ref: input.diagnostic_checkpoint_ref ?? null,
    $diagnostic_checkpoint_hash: input.diagnostic_checkpoint_hash ?? null,
    $failure_class: input.failure_class ?? null, $attempt_id: input.attempt_id,
    $worker_id: input.worker_id, $generation: input.expected_lease_generation,
  })
  if (result.changes !== 1) throw new Error("Replay Attempt lease lost during finalization")
}

function validateTerminal(input: FinalizeReplayAttemptInput): void {
  const checkpointPair = (input.diagnostic_checkpoint_ref == null) === (input.diagnostic_checkpoint_hash == null)
  if (!checkpointPair) throw new Error("diagnostic checkpoint ref/hash must be supplied together")
  if (input.diagnostic_checkpoint_hash) {
    requireText(input.diagnostic_checkpoint_ref, "diagnostic_checkpoint_ref")
    requireHash(input.diagnostic_checkpoint_hash, "diagnostic_checkpoint_hash")
  }
  if (input.status === "completed") {
    requireHash(input.result_hash, "result_hash")
    requireText(input.artifact_ref, "artifact_ref")
    requireHash(input.artifact_hash, "artifact_hash")
    requireHash(input.terminal_checkpoint_hash, "terminal_checkpoint_hash")
    if (input.failure_class || input.diagnostic_checkpoint_ref) throw new Error("completed Replay Attempt cannot carry failure evidence")
  } else {
    if (!input.failure_class) throw new Error("failed or cancelled Replay Attempt requires failure_class")
    if (input.result_hash || input.artifact_ref || input.artifact_hash || input.terminal_checkpoint_hash) {
      throw new Error("non-completed Replay Attempt cannot publish authoritative Result artifacts")
    }
  }
}

function readAttempt(db: Database, attemptId: string): AttemptRow {
  const row = db.query("SELECT * FROM rd_replay_attempt WHERE attempt_id=$attempt_id").get({ $attempt_id: attemptId }) as AttemptRow | null
  if (!row) throw new Error("Replay Attempt does not exist")
  return row
}

function readAttemptByIdempotencyKey(db: Database, key: string): AttemptRow | null {
  return db.query("SELECT * FROM rd_replay_attempt WHERE idempotency_key=$key").get({ $key: key }) as AttemptRow | null
}

function toLeaseSnapshot(row: AttemptRow): ReplayAttemptLeaseSnapshot {
  if (row.status !== "claimed" && row.status !== "running") throw new Error("terminal Replay Attempt has no active lease snapshot")
  const snapshot: ReplayAttemptLeaseSnapshot = {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: row.attempt_id, attempt_ordinal: row.attempt_ordinal, worker_id: row.worker_id,
    trial_id: row.trial_id, run_id: row.run_id, reservation_ref: row.reservation_ref,
    reservation_hash: row.reservation_hash, request_hash: row.request_hash,
    status: row.status, lease_generation: row.lease_generation,
    claimed_at: row.claimed_at, heartbeat_at: row.heartbeat_at, lease_expires_at: row.lease_expires_at,
  }
  assertReplayAttemptLeaseSnapshot(snapshot)
  return snapshot
}

function parseLeaseObservation(row: LeaseObservationRow): ReplayAttemptLeaseObservationSnapshot {
  const observation = JSON.parse(row.observation_json) as ReplayAttemptLeaseObservationSnapshot
  assertReplayAttemptLeaseObservationSnapshot(observation)
  if (row.observation_id !== observation.observation_id
      || row.observation_ref !== observation.observation_ref
      || row.observation_hash !== observation.observation_hash
      || row.attempt_id !== observation.attempt_id
      || row.lease_generation !== observation.lease_generation
      || row.observed_at !== observation.observed_at) {
    throw new Error("Replay Attempt Lease observation registry row does not match its immutable payload")
  }
  return observation
}

function parseSuccessorVerificationLeaseRenewalReceipt(
  row: SuccessorVerificationLeaseRenewalRow,
): ReplaySuccessorVerificationLeaseRenewalReceipt {
  const receipt = JSON.parse(row.receipt_json) as ReplaySuccessorVerificationLeaseRenewalReceipt
  assertReplaySuccessorVerificationLeaseRenewalReceipt(receipt)
  if (row.receipt_id !== receipt.receipt_id || row.receipt_ref !== receipt.receipt_ref
      || row.receipt_hash !== receipt.receipt_hash || row.source_request_id !== receipt.source_request_id
      || row.source_request_key !== receipt.source_request.request_key
      || row.source_request_hash !== receipt.source_request_hash
      || row.source_successor_authority_contract_hash
        !== receipt.source_request.source_successor_authority_contract_hash
      || row.attempt_id !== receipt.successor_attempt_lease.attempt_id
      || row.predecessor_lease_generation !== receipt.predecessor_attempt_lease.lease_generation
      || row.successor_lease_generation !== receipt.successor_attempt_lease.lease_generation
      || row.predecessor_attempt_lease_hash !== receipt.predecessor_attempt_lease_hash
      || row.successor_attempt_lease_hash !== receipt.successor_attempt_lease_hash
      || row.renewed_at !== receipt.renewed_at
      || row.lease_expires_at !== receipt.successor_attempt_lease.lease_expires_at) {
    throw new Error("Replay successor verification Lease renewal row does not match its immutable Receipt")
  }
  return receipt
}

function requireHash(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be a lowercase sha256 hex digest`)
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
}

function requireUtc(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  }
}
