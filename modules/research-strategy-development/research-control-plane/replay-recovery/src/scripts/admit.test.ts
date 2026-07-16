import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import {
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  createReplayInstrumentStatusProviderCertificationSnapshot,
  hashTrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import { run } from "./admit"

test("Replay Attempt admission CLI gates claim behind recovery", () => {
  const relativeRoot = "tmp/check/rd-replay-attempt-admission-cli"
  const absoluteRoot = join(repoRoot(), relativeRoot)
  const dbPath = `${relativeRoot}/rd.db`
  const artifactRoot = `${relativeRoot}/artifacts`
  rmSync(absoluteRoot, { recursive: true, force: true })
  mkdirSync(join(repoRoot(), artifactRoot), { recursive: true })
  const db = new Database(join(repoRoot(), dbPath))
  ensureResearchStateSchema(db)
  db.close()
  const claim = testClaim()
  try {
    const response = run([
      "--db", dbPath,
      "--artifact-root", artifactRoot,
      "--recovered-at", "2026-07-16T08:00:00Z",
      "--json", JSON.stringify(claim),
    ], {
      claim: (_db, input) => ({
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
      }),
    })
    assert.equal(response.ok, true)
    const data = response.data as Record<string, unknown>
    assert.equal(data.schema_version, "trade.rd-replay-attempt-admission-result.v1")
    assert.equal(JSON.stringify(response).includes(repoRoot()), false)
  } finally {
    rmSync(absoluteRoot, { recursive: true, force: true })
  }
})

test("Replay Attempt admission CLI requires explicit recovery evidence", () => {
  const response = run(["--artifact-root", "tmp/check/missing", "--json", "{}"])
  assert.equal(response.ok, false)
  assert.match(String(response.error), /recovered-at/)
})

function testClaim(): Record<string, unknown> {
  const certification = createReplayInstrumentStatusProviderCertificationSnapshot({
    schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
    certification_id: "certification-cli-1",
    certification_ref: "certification://cli/1",
    status: "certified",
    certified_at: "2026-07-01T00:00:00Z",
    valid_until: "2026-08-01T00:00:00Z",
    certifier_id: "research-control-plane",
    certification_policy_version: "rd-status-provider-certification-v1",
    provider_capability_hash: "a".repeat(64),
    producer_domain: "market-data-products",
    producer_id: "market-data.instrument-status-provider",
    producer_version: "v1",
    producer_build_hash: "a".repeat(64),
    normalization_policy_version: "normalization-v1",
    normalization_policy_hash: "a".repeat(64),
    allowed_source_kind: "venue_status_event_archive",
    allowed_completeness: "complete_history",
  })
  return {
    attempt_id: "attempt-cli-1",
    worker_id: "worker-cli-1",
    idempotency_key: "attempt-cli-key-1",
    request_hash: "b".repeat(64),
    claimed_at: "2026-07-16T08:00:01Z",
    lease_expires_at: "2026-07-16T08:05:00Z",
    trial_reservation: {
      schema_version: "trade.rd-trial-reservation-snapshot.v8",
      reservation_id: "reservation-cli-1",
      reservation_ref: "reservation://cli/1",
      issued_at: "2026-07-16T07:00:00Z",
      expires_at: "2026-07-16T09:00:00Z",
      status: "reserved",
      identity: {
        schema_version: "trade.rd-identity-binding.v1",
        experiment_id: "experiment-cli-1",
        trial_group_id: "group-cli-1",
        trial_group_hash: "a".repeat(64),
        trial_id: "trial-cli-1",
        candidate_id: "candidate-cli-1",
        candidate_hash: "a".repeat(64),
        identity_hash_policy_version: "trade-flow.identity-hash.v1",
        experiment_contract_hash: "a".repeat(64),
      },
      trial_ordinal: 1,
      run_id: "run-cli-1",
      counts_against_budget: true,
      trial_accounting_policy_version: "count-all-v1",
      candidate_assignment_hash: "a".repeat(64),
      bindings: {
        replay_idempotency_key: "replay-cli-1",
        execution_spec_hash: "a".repeat(64),
        dataset_manifest_ref: "dataset://cli/1",
        dataset_hash: "a".repeat(64),
        supplemental_facts_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        supplemental_requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144",
        venue_risk_policy_schedule_hash: "a".repeat(64),
        instrument_spec_schedule_hash: "a".repeat(64),
        instrument_status_schedule_hash: "a".repeat(64),
        instrument_status_provenance_hash: "a".repeat(64),
        instrument_status_provider_capability_hash: "a".repeat(64),
        instrument_status_provider_certification_hash: certification.certification_hash,
        harness_hash: "a".repeat(64),
        assumptions_hash: "a".repeat(64),
        cost_policy_hash: "a".repeat(64),
        margin_policy_hash: "a".repeat(64),
        simulator_policy_version: "rd-replay-simulator-v10",
        execution_mode: "step",
      },
      instrument_status_provider_certification: certification,
      required_capabilities: ["closed-candle", "step"],
    },
  }
}
