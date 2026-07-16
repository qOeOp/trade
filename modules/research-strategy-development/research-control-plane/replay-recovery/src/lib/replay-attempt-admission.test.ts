import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
  createReplayInstrumentStatusProviderCertificationSnapshot,
  hashTrialReservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
  type TrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import type { ClaimReplayAttemptInput } from "../../../state-store/src/lib/replay-attempt-authority"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import { admitReplayAttemptAfterCancellationRecovery } from "./replay-attempt-admission"

const RECOVERED_AT = "2026-07-16T08:00:00Z"
const CLAIMED_AT = "2026-07-16T08:00:01Z"
const HASH = "a".repeat(64)

test("Attempt admission runs complete recovery before invoking the authoritative claim", () => {
  const fixture = setup("rd-replay-attempt-admission-")
  let claimCount = 0
  try {
    const claim = claimInput()
    const result = admitReplayAttemptAfterCancellationRecovery({
      db_path: fixture.dbPath,
      artifact_root: fixture.artifactRoot,
      recovered_at: RECOVERED_AT,
      claim,
    }, {
      claim: (_db, input) => {
        claimCount += 1
        return leaseFor(input)
      },
    })
    assert.equal(claimCount, 1)
    assert.equal(result.schema_version, "trade.rd-replay-attempt-admission-result.v1")
    assert.equal(result.recovery.status, "no_outbox")
    assert.equal(result.attempt_lease.attempt_id, claim.attempt_id)
    assert.equal(JSON.stringify(result).includes(fixture.dir), false)
  } finally {
    fixture.cleanup()
  }
})

test("malformed outbox fails closed before Attempt claim", () => {
  const fixture = setup("rd-replay-attempt-admission-malformed-")
  const attemptRoot = join(fixture.artifactRoot, "a".repeat(24), "b".repeat(24))
  mkdirSync(attemptRoot, { recursive: true })
  writeFileSync(join(attemptRoot, "cancellation-observation-outbox.json"), "not-json\n", "utf8")
  let claimCount = 0
  try {
    assert.throws(() => admitReplayAttemptAfterCancellationRecovery({
      db_path: fixture.dbPath,
      artifact_root: fixture.artifactRoot,
      recovered_at: RECOVERED_AT,
      claim: claimInput(),
    }, {
      claim: (_db, input) => {
        claimCount += 1
        return leaseFor(input)
      },
    }), /invalid JSON/)
    assert.equal(claimCount, 0)
    const verify = new Database(fixture.dbPath, { readonly: true })
    try {
      const count = verify.query("SELECT COUNT(*) AS count FROM rd_replay_attempt").get() as { count: number }
      assert.equal(count.count, 0)
    } finally {
      verify.close()
    }
  } finally {
    fixture.cleanup()
  }
})

test("default admission adapter reaches authoritative claim only after recovery", () => {
  const fixture = setup("rd-replay-attempt-admission-authority-")
  try {
    assert.throws(() => admitReplayAttemptAfterCancellationRecovery({
      db_path: fixture.dbPath,
      artifact_root: fixture.artifactRoot,
      recovered_at: RECOVERED_AT,
      claim: claimInput(),
    }), /requires a reserved Trial/)
    const verify = new Database(fixture.dbPath, { readonly: true })
    try {
      const count = verify.query("SELECT COUNT(*) AS count FROM rd_replay_attempt").get() as { count: number }
      assert.equal(count.count, 0)
    } finally {
      verify.close()
    }
  } finally {
    fixture.cleanup()
  }
})

test("Attempt admission rejects recovery chronology before opening authority", () => {
  let claimCount = 0
  assert.throws(() => admitReplayAttemptAfterCancellationRecovery({
    db_path: "/missing/authority.db",
    artifact_root: "/missing/artifacts",
    recovered_at: "2026-07-16T08:00:02Z",
    claim: claimInput(),
  }, {
    claim: (_db, input) => {
      claimCount += 1
      return leaseFor(input)
    },
  }), /at or before/)
  assert.equal(claimCount, 0)
})

function setup(prefix: string): { dir: string; dbPath: string; artifactRoot: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const dbPath = join(dir, "rd.db")
  const artifactRoot = join(dir, "artifacts")
  mkdirSync(artifactRoot)
  const db = new Database(dbPath)
  ensureResearchStateSchema(db)
  db.close()
  return { dir, dbPath, artifactRoot, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function claimInput(): ClaimReplayAttemptInput {
  return {
    attempt_id: "attempt-admission-1",
    worker_id: "worker-admission-1",
    idempotency_key: "attempt-admission-key-1",
    request_hash: "b".repeat(64),
    claimed_at: CLAIMED_AT,
    lease_expires_at: "2026-07-16T08:05:00Z",
    trial_reservation: reservation(),
  }
}

function leaseFor(input: ClaimReplayAttemptInput): ReplayAttemptLeaseSnapshot {
  return {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: input.attempt_id,
    attempt_ordinal: 1,
    worker_id: input.worker_id,
    trial_id: input.trial_reservation.identity.trial_id,
    run_id: input.trial_reservation.run_id,
    reservation_ref: input.trial_reservation.reservation_ref,
    reservation_hash: hashTrialReservationSnapshot(input.trial_reservation),
    request_hash: input.request_hash,
    status: "claimed",
    lease_generation: 1,
    claimed_at: input.claimed_at,
    heartbeat_at: input.claimed_at,
    lease_expires_at: input.lease_expires_at,
  }
}

function reservation(): TrialReservationSnapshot {
  const certification = createReplayInstrumentStatusProviderCertificationSnapshot({
    schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
    certification_id: "status-provider-certification-admission",
    certification_ref: "certification://status-provider/admission",
    status: "certified",
    certified_at: "2026-07-01T00:00:00Z",
    valid_until: "2026-08-01T00:00:00Z",
    certifier_id: "research-control-plane",
    certification_policy_version: "rd-status-provider-certification-v1",
    provider_capability_hash: HASH,
    producer_domain: "market-data-products",
    producer_id: "market-data.instrument-status-provider",
    producer_version: "v1",
    producer_build_hash: HASH,
    normalization_policy_version: "normalization-v1",
    normalization_policy_hash: HASH,
    allowed_source_kind: "venue_status_event_archive",
    allowed_completeness: "complete_history",
  })
  return {
    schema_version: TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
    reservation_id: "reservation-admission-1",
    reservation_ref: "reservation://admission/1",
    issued_at: "2026-07-16T07:00:00Z",
    expires_at: "2026-07-16T09:00:00Z",
    status: "reserved",
    identity: {
      schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
      experiment_id: "experiment-admission-1",
      trial_group_id: "group-admission-1",
      trial_group_hash: HASH,
      trial_id: "trial-admission-1",
      candidate_id: "candidate-admission-1",
      candidate_hash: HASH,
      identity_hash_policy_version: "trade-flow.identity-hash.v1",
      experiment_contract_hash: HASH,
    },
    trial_ordinal: 1,
    run_id: "run-admission-1",
    counts_against_budget: true,
    trial_accounting_policy_version: "count-all-v1",
    candidate_assignment_hash: HASH,
    bindings: {
      replay_idempotency_key: "replay-admission-1",
      execution_spec_hash: HASH,
      dataset_manifest_ref: "dataset://admission/1",
      dataset_hash: HASH,
      liquidity_capacity_attestation_hash: null,
      supplemental_facts_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      supplemental_requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144",
      venue_risk_policy_schedule_hash: HASH,
      instrument_spec_schedule_hash: HASH,
      instrument_status_schedule_hash: HASH,
      instrument_status_provenance_hash: HASH,
      instrument_status_provider_capability_hash: HASH,
      instrument_status_provider_certification_hash: certification.certification_hash,
      harness_hash: HASH,
      assumptions_hash: HASH,
      cost_policy_hash: HASH,
      margin_policy_hash: HASH,
      simulator_policy_version: "rd-replay-simulator-v16",
      execution_mode: "step",
    },
    instrument_status_provider_certification: certification,
    required_capabilities: ["closed-candle", "step"],
  }
}
