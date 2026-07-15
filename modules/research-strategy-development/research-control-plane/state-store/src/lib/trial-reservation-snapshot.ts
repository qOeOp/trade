import type { Database } from "bun:sqlite"
import {
  CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
  TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
  assertTrialReservationSnapshot,
  type ReplayReservationBindings,
  type TrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import { hashIdentityPayload } from "./research-identity-hash"

export interface IssueTrialReservationSnapshotInput {
  trial_id: string
  reservation_id: string
  reservation_ref: string
  issued_at: string
  expires_at: string
  bindings: ReplayReservationBindings
  required_capabilities: string[]
}

interface ReservationRow {
  trial_id: string
  trial_group_id: string
  experiment_id: string
  trial_ordinal: number
  candidate_id: string
  candidate_identity_hash: string
  identity_hash_policy_version: string
  run_id: string
  status: string
  counts_against_budget: number
  group_hash: string
  trial_accounting_policy_version: string
  parameter_assignment_json: string
  contract_hash: string
  contract_json: string
}

export function issueTrialReservationSnapshot(
  db: Database,
  input: IssueTrialReservationSnapshotInput,
): TrialReservationSnapshot {
  const row = db.query(`
    SELECT
      t.trial_id, t.trial_group_id, t.experiment_id, t.trial_ordinal,
      t.candidate_id, t.candidate_identity_hash, t.identity_hash_policy_version,
      t.run_id, t.status, t.counts_against_budget,
      g.group_hash, g.trial_accounting_policy_version,
      c.parameter_assignment_json, e.contract_hash, e.contract_json
    FROM rd_trial t
    JOIN rd_trial_group g ON g.trial_group_id = t.trial_group_id
    JOIN rd_trial_group_candidate c
      ON c.trial_group_id = t.trial_group_id AND c.candidate_id = t.candidate_id
    JOIN rd_experiment_contract e
      ON e.experiment_id = t.experiment_id AND e.trial_group_id = t.trial_group_id
    WHERE t.trial_id = $trial_id
  `).get({ $trial_id: input.trial_id }) as ReservationRow | null
  if (!row) throw new Error("Trial Reservation snapshot source does not exist")
  if (row.status !== "reserved") throw new Error("Trial Reservation snapshot source is no longer reserved")
  const contract = JSON.parse(row.contract_json) as {
    replay_execution_input?: { supplemental_requirement_set_hash?: string }
  }
  if (contract.replay_execution_input?.supplemental_requirement_set_hash !== input.bindings.supplemental_requirement_set_hash) {
    throw new Error("Trial Reservation supplemental requirement set does not match the frozen Experiment Contract")
  }
  const snapshot: TrialReservationSnapshot = {
    schema_version: TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
    reservation_id: input.reservation_id,
    reservation_ref: input.reservation_ref,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
    status: "reserved",
    identity: {
      schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
      experiment_id: row.experiment_id,
      trial_group_id: row.trial_group_id,
      trial_group_hash: row.group_hash,
      trial_id: row.trial_id,
      candidate_id: row.candidate_id,
      candidate_hash: row.candidate_identity_hash,
      identity_hash_policy_version: row.identity_hash_policy_version,
      experiment_contract_hash: row.contract_hash,
    },
    trial_ordinal: row.trial_ordinal,
    run_id: row.run_id,
    counts_against_budget: row.counts_against_budget === 1,
    trial_accounting_policy_version: row.trial_accounting_policy_version,
    candidate_assignment_hash: hashIdentityPayload(JSON.parse(row.parameter_assignment_json)),
    bindings: structuredClone(input.bindings),
    required_capabilities: [...input.required_capabilities],
  }
  assertTrialReservationSnapshot(snapshot)
  return snapshot
}
