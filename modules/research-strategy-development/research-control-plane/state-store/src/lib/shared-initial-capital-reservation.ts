import type { Database } from "bun:sqlite"
import {
  REPLAY_SHARED_INITIAL_CAPITAL_RESERVATION_SCHEMA_VERSION,
  assertTrialReservationSnapshot,
  createReplaySharedInitialCapitalReservationSnapshot,
  hashTrialReservationSnapshot,
  type ReplaySharedInitialCapitalReservationSnapshot,
  type TrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"

export interface IssueReplaySharedInitialCapitalReservationInput {
  reservation_id: string
  reservation_ref: string
  issued_at: string
  expires_at: string
  batch_id: string
  batch_plan_hash: string
  settlement_asset: string
  shared_initial_cash: number
  lanes: Array<{
    lane_id: string
    priority_rank: number
    allocated_initial_cash: number
    trial_reservation: TrialReservationSnapshot
  }>
}

interface TrialAuthorityRow {
  trial_id: string
  experiment_id: string
  trial_group_id: string
  group_hash: string
  run_id: string
  status: string
}

export function issueReplaySharedInitialCapitalReservation(
  db: Database,
  input: IssueReplaySharedInitialCapitalReservationInput,
): ReplaySharedInitialCapitalReservationSnapshot {
  if (input.lanes.length < 2) throw new Error("shared initial capital authority requires at least two Trial Reservations")
  const first = input.lanes[0]!.trial_reservation
  const lanes = input.lanes.map((lane) => {
    assertTrialReservationSnapshot(lane.trial_reservation)
    const reservation = lane.trial_reservation
    const row = db.query(`
      SELECT
        t.trial_id, t.experiment_id, t.trial_group_id, t.run_id, t.status,
        g.group_hash
      FROM rd_trial t
      JOIN rd_trial_group g ON g.trial_group_id = t.trial_group_id
      WHERE t.trial_id = $trial_id
    `).get({ $trial_id: reservation.identity.trial_id }) as TrialAuthorityRow | null
    if (!row || row.status !== "reserved" || row.trial_id !== reservation.identity.trial_id
        || row.experiment_id !== reservation.identity.experiment_id
        || row.trial_group_id !== reservation.identity.trial_group_id
        || row.group_hash !== reservation.identity.trial_group_hash
        || row.run_id !== reservation.run_id) {
      throw new Error(`shared initial capital lane ${lane.lane_id} is not backed by a current reserved Trial`)
    }
    if (reservation.identity.experiment_id !== first.identity.experiment_id
        || reservation.identity.trial_group_id !== first.identity.trial_group_id
        || reservation.identity.trial_group_hash !== first.identity.trial_group_hash) {
      throw new Error("shared initial capital lanes must belong to one frozen Experiment and Trial Group")
    }
    if (Date.parse(input.issued_at) < Date.parse(reservation.issued_at)
        || Date.parse(input.expires_at) > Date.parse(reservation.expires_at)) {
      throw new Error("shared initial capital authority window must be contained by every child Trial Reservation")
    }
    return {
      lane_id: lane.lane_id,
      priority_rank: lane.priority_rank,
      trial_id: reservation.identity.trial_id,
      run_id: reservation.run_id,
      trial_reservation_ref: reservation.reservation_ref,
      trial_reservation_hash: hashTrialReservationSnapshot(reservation),
      allocated_initial_cash: lane.allocated_initial_cash,
    }
  })
  return createReplaySharedInitialCapitalReservationSnapshot({
    schema_version: REPLAY_SHARED_INITIAL_CAPITAL_RESERVATION_SCHEMA_VERSION,
    reservation_id: input.reservation_id,
    reservation_ref: input.reservation_ref,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
    status: "reserved",
    authority_id: "research-control-plane",
    experiment_id: first.identity.experiment_id,
    trial_group_id: first.identity.trial_group_id,
    trial_group_hash: first.identity.trial_group_hash,
    batch_id: input.batch_id,
    batch_plan_hash: input.batch_plan_hash,
    settlement_asset: input.settlement_asset,
    capital_policy_version: "rd-shared-initial-capital-static-preallocation-v1",
    execution_priority_policy: "control_plane_explicit_rank_no_ties",
    shared_initial_cash: input.shared_initial_cash,
    total_allocated_initial_cash: input.shared_initial_cash,
    lanes,
    limitations: [
      "no_runtime_cash_reuse_or_rebalancing",
      "no_cross_lane_margin_or_liquidation",
      "no_concurrent_matching_claim",
    ],
  })
}
