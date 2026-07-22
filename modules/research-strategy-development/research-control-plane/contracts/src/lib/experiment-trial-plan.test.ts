import { expect, test } from "bun:test"
import {
  EXPERIMENT_TRIAL_PLAN_POLICY_VERSION,
  EXPERIMENT_TRIAL_PLAN_RECORD_SCHEMA_VERSION,
  assertExperimentTrialPlanRecord,
  createExperimentTrialPlanRecord,
} from "./experiment-trial-plan"

test("Experiment Trial Plan binds bounded Control Plane Trial reservations without Replay authority", () => {
  const hash = "a".repeat(64)
  const record = createExperimentTrialPlanRecord({
    schema_version: EXPERIMENT_TRIAL_PLAN_RECORD_SCHEMA_VERSION,
    plan_id: "plan-1", freeze_id: "freeze-1", freeze_hash: hash,
    experiment_id: "experiment-1", experiment_contract_hash: hash,
    trial_group_id: "group-1", trial_group_hash: hash,
    identity_hash_policy_version: "identity-v1",
    trial_accounting_policy_version: "trial-accounting-v1", max_trials: 2,
    trials: [{
      trial_id: "trial-1", trial_ordinal: 1, candidate_id: "candidate-1",
      candidate_identity_hash: hash, run_id: "run-1", trial_idempotency_key: "trial-key-1",
    }],
    discovery_lifecycle_event_id: "event-discovery-1",
    trial_plan_policy_version: EXPERIMENT_TRIAL_PLAN_POLICY_VERSION,
    planned_at: "2026-07-22T12:09:00Z",
  })
  expect(record.status).toBe("started_and_reserved")
  expect(record.replay_execution_authority).toBe("none_until_replay_trial_reservation_snapshot")
  expect(record).not.toHaveProperty("dataset_hash")
  expect(record).not.toHaveProperty("reservation_ref")
  expect(() => assertExperimentTrialPlanRecord({ ...record, trial_group_id: "drift" })).toThrow("hash-drifted")
})
