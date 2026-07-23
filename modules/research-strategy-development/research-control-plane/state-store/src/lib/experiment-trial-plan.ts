import { Database } from "bun:sqlite"
import { canonicalControlPlaneHash } from "../../../contracts/src/lib/control-plane-contracts"
import {
  EXPERIMENT_TRIAL_PLAN_POLICY_VERSION,
  EXPERIMENT_TRIAL_PLAN_REQUEST_SCHEMA_VERSION,
  EXPERIMENT_TRIAL_PLAN_RECORD_SCHEMA_VERSION,
  assertExperimentTrialPlanRecord,
  assertExperimentTrialPlanRequest,
  assertFrozenExperimentTrialPlanStart,
  createExperimentTrialPlanRecord,
  type ExperimentTrialPlanRecord,
  type ExperimentTrialPlanRequest,
  type FrozenExperimentTrialPlanStart,
} from "../../../contracts/src/lib/experiment-trial-plan"
import {
  assertDeveloperContractFreezeRecord,
  type DeveloperContractFreezeRecord,
} from "../../../contracts/src/lib/developer-contract-freeze"
import { reserveTrial, applySystemTransition } from "./research-control-plane-operations"
import { transitionTrialGroup } from "./research-control-plane"

interface TrialPlanSourceRow {
  freeze_json: string
  freeze_hash: string
  experiment_id: string
  contract_hash: string
  lifecycle_state: string
  lifecycle_version: number
  trial_group_id: string
  trial_group_hash: string
  identity_hash_policy_version: string
  trial_accounting_policy_version: string
  group_status: string
  max_trials: number
}

export function startFrozenExperimentTrialPlan(
  db: Database,
  input: FrozenExperimentTrialPlanStart,
): ExperimentTrialPlanRecord {
  assertFrozenExperimentTrialPlanStart(input)
  const existing = db.query(`
    SELECT plan_json FROM rd_experiment_trial_plan WHERE freeze_id=$freeze_id
  `).get({ $freeze_id: input.freeze_id }) as { plan_json: string } | null
  if (existing) return parseTrialPlanRecord(existing.plan_json)

  const row = db.query(`
    SELECT freeze_json FROM rd_developer_contract_freeze WHERE freeze_id=$freeze_id
  `).get({ $freeze_id: input.freeze_id }) as { freeze_json: string } | null
  if (!row) throw new Error("Frozen Experiment Trial Plan requires an authoritative Contract Freeze Record")
  const freeze = parseFreezeRecord(row.freeze_json)
  const token = freeze.freeze_hash.slice(0, 16)
  return startExperimentTrialPlan(db, {
    schema_version: EXPERIMENT_TRIAL_PLAN_REQUEST_SCHEMA_VERSION,
    plan_id: `trial-plan:${freeze.experiment_id}:${token}`,
    freeze_id: freeze.freeze_id,
    freeze_hash: freeze.freeze_hash,
    experiment_id: freeze.experiment_id,
    trial_group_id: freeze.trial_group_id,
    trial_group_hash: freeze.trial_group_hash,
    trials: freeze.candidates.map((candidate) => {
      const ordinal = candidate.candidate_ordinal
      const candidateToken = candidate.candidate_identity_hash.slice(0, 12)
      return {
        trial_id: `trial:${freeze.experiment_id}:${ordinal}:${candidateToken}`,
        trial_ordinal: ordinal,
        candidate_id: candidate.candidate_id,
        candidate_identity_hash: candidate.candidate_identity_hash,
        run_id: `replay:${freeze.experiment_id}:${ordinal}:${candidateToken}`,
        trial_idempotency_key: `trial-reservation:${freeze.freeze_id}:${ordinal}:${candidateToken}`,
      }
    }),
    discovery_lifecycle_event_id: `lifecycle:${freeze.experiment_id}:discovery:${token}`,
    discovery_lifecycle_idempotency_key: `lifecycle-transition:${freeze.freeze_id}:discovery`,
    idempotency_key: `frozen-trial-plan:${freeze.freeze_id}`,
    planned_at: input.planned_at,
  })
}

export function startExperimentTrialPlan(
  db: Database,
  request: ExperimentTrialPlanRequest,
): ExperimentTrialPlanRecord {
  assertExperimentTrialPlanRequest(request)
  const start = db.transaction(() => {
    const requestHash = canonicalControlPlaneHash(request)
    const replay = db.query(`
      SELECT plan_request_hash, plan_json
      FROM rd_experiment_trial_plan WHERE idempotency_key=$idempotency_key
    `).get({ $idempotency_key: request.idempotency_key }) as {
      plan_request_hash: string; plan_json: string
    } | null
    if (replay) {
      if (replay.plan_request_hash !== requestHash) {
        throw new Error("Experiment Trial Plan idempotency key already exists with different content")
      }
      return parseTrialPlanRecord(replay.plan_json)
    }

    const row = db.query(`
      SELECT f.freeze_json, f.freeze_hash,
             e.experiment_id, e.contract_hash, e.lifecycle_state, e.lifecycle_version,
             g.trial_group_id, g.group_hash AS trial_group_hash,
             g.identity_hash_policy_version, g.trial_accounting_policy_version,
             g.status AS group_status, g.max_trials
      FROM rd_developer_contract_freeze f
      JOIN rd_experiment_contract e ON e.experiment_id=f.experiment_id
      JOIN rd_trial_group g ON g.trial_group_id=f.trial_group_id
      WHERE f.freeze_id=$freeze_id
    `).get({ $freeze_id: request.freeze_id }) as TrialPlanSourceRow | null
    if (!row) throw new Error("Experiment Trial Plan requires an authoritative Contract Freeze Record")
    const freeze = parseFreezeRecord(row.freeze_json)
    assertPlanBindings(request, freeze, row)
    if (Date.parse(request.planned_at) < Date.parse(freeze.frozen_at)) {
      throw new Error("Experiment Trial Plan cannot predate Contract Freeze")
    }
    if (row.group_status !== "registered") {
      throw new Error("Experiment Trial Plan requires a registered Trial Group")
    }
    if (row.lifecycle_state !== "proposed" || row.lifecycle_version !== 1) {
      throw new Error("Experiment Trial Plan requires the bootstrap proposed Experiment")
    }
    if (db.query("SELECT 1 AS present FROM rd_trial WHERE trial_group_id=$trial_group_id LIMIT 1")
      .get({ $trial_group_id: row.trial_group_id })) {
      throw new Error("Experiment Trial Plan cannot adopt pre-existing Trials")
    }
    if (request.trials.length > row.max_trials) throw new Error("Experiment Trial Plan exceeds frozen Trial budget")

    const candidates = db.query(`
      SELECT candidate_id, candidate_identity_hash
      FROM rd_trial_group_candidate
      WHERE trial_group_id=$trial_group_id ORDER BY candidate_ordinal
    `).all({ $trial_group_id: row.trial_group_id }) as Array<{
      candidate_id: string; candidate_identity_hash: string
    }>
    const candidateById = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]))
    for (const trial of request.trials) {
      const candidate = candidateById.get(trial.candidate_id)
      if (!candidate || candidate.candidate_identity_hash !== trial.candidate_identity_hash) {
        throw new Error("Experiment Trial Plan Trial must bind a frozen Candidate identity")
      }
    }
    const plannedCandidateIds = new Set(request.trials.map((trial) => trial.candidate_id))
    if (candidates.some((candidate) => !plannedCandidateIds.has(candidate.candidate_id))) {
      throw new Error("Experiment Trial Plan must cover every frozen Candidate at least once")
    }

    const record = createExperimentTrialPlanRecord({
      schema_version: EXPERIMENT_TRIAL_PLAN_RECORD_SCHEMA_VERSION,
      plan_id: request.plan_id,
      freeze_id: freeze.freeze_id,
      freeze_hash: freeze.freeze_hash,
      experiment_id: row.experiment_id,
      experiment_contract_hash: row.contract_hash,
      trial_group_id: row.trial_group_id,
      trial_group_hash: row.trial_group_hash,
      identity_hash_policy_version: row.identity_hash_policy_version,
      trial_accounting_policy_version: row.trial_accounting_policy_version,
      max_trials: row.max_trials,
      trials: request.trials,
      discovery_lifecycle_event_id: request.discovery_lifecycle_event_id,
      trial_plan_policy_version: EXPERIMENT_TRIAL_PLAN_POLICY_VERSION,
      planned_at: request.planned_at,
    })

    transitionTrialGroup(db, {
      trial_group_id: row.trial_group_id,
      action: "start",
      occurred_at: request.planned_at,
    })
    applySystemTransition(db, {
      experiment_id: row.experiment_id,
      expected_version: 1,
      trigger_type: "system",
      trigger_value: "pre_run_gate_passed",
      trigger_ref: `trial-plan://${request.plan_id}`,
      event_id: request.discovery_lifecycle_event_id,
      idempotency_key: request.discovery_lifecycle_idempotency_key,
      created_at: request.planned_at,
    })
    for (const trial of record.trials) {
      reserveTrial(db, {
        trial_id: trial.trial_id,
        trial_group_id: row.trial_group_id,
        experiment_id: row.experiment_id,
        trial_ordinal: trial.trial_ordinal,
        candidate_id: trial.candidate_id,
        candidate_identity_hash: trial.candidate_identity_hash,
        identity_hash_policy_version: row.identity_hash_policy_version,
        run_id: trial.run_id,
        idempotency_key: trial.trial_idempotency_key,
        created_at: request.planned_at,
      })
    }
    db.query(`
      INSERT INTO rd_experiment_trial_plan(
        plan_id, freeze_id, idempotency_key, plan_request_hash,
        experiment_id, experiment_contract_hash, trial_group_id, trial_group_hash,
        trial_plan_policy_version, trial_count, plan_hash, plan_json, planned_at
      ) VALUES (
        $plan_id, $freeze_id, $idempotency_key, $plan_request_hash,
        $experiment_id, $experiment_contract_hash, $trial_group_id, $trial_group_hash,
        $trial_plan_policy_version, $trial_count, $plan_hash, $plan_json, $planned_at
      )
    `).run({
      $plan_id: record.plan_id,
      $freeze_id: record.freeze_id,
      $idempotency_key: request.idempotency_key,
      $plan_request_hash: requestHash,
      $experiment_id: record.experiment_id,
      $experiment_contract_hash: record.experiment_contract_hash,
      $trial_group_id: record.trial_group_id,
      $trial_group_hash: record.trial_group_hash,
      $trial_plan_policy_version: record.trial_plan_policy_version,
      $trial_count: record.trial_count,
      $plan_hash: record.plan_hash,
      $plan_json: JSON.stringify(record),
      $planned_at: record.planned_at,
    })
    const insertItem = db.query(`
      INSERT INTO rd_experiment_trial_plan_item(
        plan_id, trial_id, trial_ordinal, candidate_id,
        candidate_identity_hash, run_id, created_at
      ) VALUES ($plan_id, $trial_id, $trial_ordinal, $candidate_id,
                $candidate_identity_hash, $run_id, $created_at)
    `)
    for (const trial of record.trials) {
      insertItem.run({
        $plan_id: record.plan_id,
        $trial_id: trial.trial_id,
        $trial_ordinal: trial.trial_ordinal,
        $candidate_id: trial.candidate_id,
        $candidate_identity_hash: trial.candidate_identity_hash,
        $run_id: trial.run_id,
        $created_at: record.planned_at,
      })
    }
    return record
  })
  return start.immediate()
}

export function readExperimentTrialPlan(db: Database, planId: string): ExperimentTrialPlanRecord {
  if (!planId.trim()) throw new Error("plan_id is required")
  const row = db.query(`SELECT plan_json FROM rd_experiment_trial_plan WHERE plan_id=$plan_id`)
    .get({ $plan_id: planId }) as { plan_json: string } | null
  if (!row) throw new Error("Experiment Trial Plan Record is missing")
  return parseTrialPlanRecord(row.plan_json)
}

function assertPlanBindings(
  request: ExperimentTrialPlanRequest,
  freeze: DeveloperContractFreezeRecord,
  row: TrialPlanSourceRow,
): void {
  if (request.freeze_hash !== freeze.freeze_hash
      || request.experiment_id !== freeze.experiment_id
      || request.trial_group_id !== freeze.trial_group_id
      || request.trial_group_hash !== freeze.trial_group_hash
      || row.freeze_hash !== freeze.freeze_hash
      || row.experiment_id !== freeze.experiment_id
      || row.contract_hash !== freeze.contract_hash
      || row.trial_group_id !== freeze.trial_group_id
      || row.trial_group_hash !== freeze.trial_group_hash
      || row.identity_hash_policy_version !== freeze.identity_hash_policy_version) {
    throw new Error("Experiment Trial Plan bindings drifted from Contract Freeze")
  }
}

function parseFreezeRecord(json: string): DeveloperContractFreezeRecord {
  const value = JSON.parse(json) as DeveloperContractFreezeRecord
  assertDeveloperContractFreezeRecord(value)
  return value
}

function parseTrialPlanRecord(json: string): ExperimentTrialPlanRecord {
  const value = JSON.parse(json) as ExperimentTrialPlanRecord
  assertExperimentTrialPlanRecord(value)
  return value
}
