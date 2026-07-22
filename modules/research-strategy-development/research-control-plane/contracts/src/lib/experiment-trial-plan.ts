import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import { canonicalControlPlaneHash } from "./control-plane-contracts"
import { digest, isRecord, positiveInteger, required, utc } from "./developer-contract-draft"

export const EXPERIMENT_TRIAL_PLAN_REQUEST_SCHEMA_VERSION =
  "trade.rd-experiment-trial-plan-request.v1" as const
export const EXPERIMENT_TRIAL_PLAN_RECORD_SCHEMA_VERSION =
  "trade.rd-experiment-trial-plan-record.v1" as const
export const EXPERIMENT_TRIAL_PLAN_POLICY_VERSION =
  "rd-experiment-trial-plan-v1" as const

export interface ExperimentTrialPlanItem extends JSONRecord {
  trial_id: string
  trial_ordinal: number
  candidate_id: string
  candidate_identity_hash: string
  run_id: string
  trial_idempotency_key: string
}

export interface ExperimentTrialPlanRequest extends JSONRecord {
  schema_version: typeof EXPERIMENT_TRIAL_PLAN_REQUEST_SCHEMA_VERSION
  plan_id: string
  freeze_id: string
  freeze_hash: string
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  trials: ExperimentTrialPlanItem[]
  discovery_lifecycle_event_id: string
  discovery_lifecycle_idempotency_key: string
  idempotency_key: string
  planned_at: string
}

export interface ExperimentTrialPlanRecordSource extends JSONRecord {
  schema_version: typeof EXPERIMENT_TRIAL_PLAN_RECORD_SCHEMA_VERSION
  plan_id: string
  freeze_id: string
  freeze_hash: string
  experiment_id: string
  experiment_contract_hash: string
  trial_group_id: string
  trial_group_hash: string
  identity_hash_policy_version: string
  trial_accounting_policy_version: string
  max_trials: number
  trials: ExperimentTrialPlanItem[]
  discovery_lifecycle_event_id: string
  trial_plan_policy_version: typeof EXPERIMENT_TRIAL_PLAN_POLICY_VERSION
  planned_at: string
}

export interface ExperimentTrialPlanRecordBody extends ExperimentTrialPlanRecordSource {
  status: "started_and_reserved"
  trial_count: number
  counts_against_budget: true
  authority_scope: "control_plane_trial_reservation_only"
  replay_execution_authority: "none_until_replay_trial_reservation_snapshot"
}

export interface ExperimentTrialPlanRecord extends ExperimentTrialPlanRecordBody {
  plan_hash: string
}

export function assertExperimentTrialPlanRequest(value: ExperimentTrialPlanRequest): void {
  if (!isRecord(value)) throw new Error("Experiment Trial Plan request must be an object")
  const expected: ExperimentTrialPlanRequest = {
    schema_version: EXPERIMENT_TRIAL_PLAN_REQUEST_SCHEMA_VERSION,
    plan_id: required(value.plan_id, "plan_id"),
    freeze_id: required(value.freeze_id, "freeze_id"),
    freeze_hash: digest(value.freeze_hash, "freeze_hash"),
    experiment_id: required(value.experiment_id, "experiment_id"),
    trial_group_id: required(value.trial_group_id, "trial_group_id"),
    trial_group_hash: digest(value.trial_group_hash, "trial_group_hash"),
    trials: normalizeTrials(value.trials),
    discovery_lifecycle_event_id: required(value.discovery_lifecycle_event_id, "discovery_lifecycle_event_id"),
    discovery_lifecycle_idempotency_key: required(
      value.discovery_lifecycle_idempotency_key,
      "discovery_lifecycle_idempotency_key",
    ),
    idempotency_key: required(value.idempotency_key, "idempotency_key"),
    planned_at: utc(value.planned_at, "planned_at"),
  }
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Experiment Trial Plan request is non-canonical")
  }
}

export function createExperimentTrialPlanRecord(
  input: ExperimentTrialPlanRecordSource,
): ExperimentTrialPlanRecord {
  if (input.schema_version !== EXPERIMENT_TRIAL_PLAN_RECORD_SCHEMA_VERSION
      || input.trial_plan_policy_version !== EXPERIMENT_TRIAL_PLAN_POLICY_VERSION) {
    throw new Error("unsupported Experiment Trial Plan Record")
  }
  const trials = normalizeTrials(input.trials)
  const body: ExperimentTrialPlanRecordBody = {
    schema_version: EXPERIMENT_TRIAL_PLAN_RECORD_SCHEMA_VERSION,
    plan_id: required(input.plan_id, "plan_id"),
    freeze_id: required(input.freeze_id, "freeze_id"),
    freeze_hash: digest(input.freeze_hash, "freeze_hash"),
    experiment_id: required(input.experiment_id, "experiment_id"),
    experiment_contract_hash: digest(input.experiment_contract_hash, "experiment_contract_hash"),
    trial_group_id: required(input.trial_group_id, "trial_group_id"),
    trial_group_hash: digest(input.trial_group_hash, "trial_group_hash"),
    identity_hash_policy_version: required(input.identity_hash_policy_version, "identity_hash_policy_version"),
    trial_accounting_policy_version: required(
      input.trial_accounting_policy_version,
      "trial_accounting_policy_version",
    ),
    max_trials: positiveInteger(input.max_trials, "max_trials"),
    trials,
    trial_count: trials.length,
    counts_against_budget: true,
    discovery_lifecycle_event_id: required(
      input.discovery_lifecycle_event_id,
      "discovery_lifecycle_event_id",
    ),
    trial_plan_policy_version: EXPERIMENT_TRIAL_PLAN_POLICY_VERSION,
    status: "started_and_reserved",
    authority_scope: "control_plane_trial_reservation_only",
    replay_execution_authority: "none_until_replay_trial_reservation_snapshot",
    planned_at: utc(input.planned_at, "planned_at"),
  }
  if (body.trial_count > body.max_trials) throw new Error("Trial Plan exceeds max_trials")
  return { ...body, plan_hash: canonicalControlPlaneHash(body) }
}

export function assertExperimentTrialPlanRecord(value: ExperimentTrialPlanRecord): void {
  if (!isRecord(value)) throw new Error("Experiment Trial Plan Record must be an object")
  const {
    plan_hash: _planHash,
    status: _status,
    trial_count: _trialCount,
    counts_against_budget: _countsAgainstBudget,
    authority_scope: _authorityScope,
    replay_execution_authority: _replayExecutionAuthority,
    ...source
  } = value
  const expected = createExperimentTrialPlanRecord(source)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Experiment Trial Plan Record is non-canonical or hash-drifted")
  }
}

function normalizeTrials(value: unknown): ExperimentTrialPlanItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Experiment Trial Plan requires at least one Trial")
  }
  const trials = value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`trials[${index}] must be an object`)
    return {
      trial_id: required(item.trial_id as string, `trials[${index}].trial_id`),
      trial_ordinal: positiveInteger(item.trial_ordinal as number, `trials[${index}].trial_ordinal`),
      candidate_id: required(item.candidate_id as string, `trials[${index}].candidate_id`),
      candidate_identity_hash: digest(
        item.candidate_identity_hash as string,
        `trials[${index}].candidate_identity_hash`,
      ),
      run_id: required(item.run_id as string, `trials[${index}].run_id`),
      trial_idempotency_key: required(
        item.trial_idempotency_key as string,
        `trials[${index}].trial_idempotency_key`,
      ),
    }
  }).sort((left, right) => left.trial_ordinal - right.trial_ordinal)
  if (trials.some((trial, index) => trial.trial_ordinal !== index + 1)) {
    throw new Error("Trial ordinals must be contiguous from 1")
  }
  for (const [field, values] of [
    ["trial_id", trials.map((trial) => trial.trial_id)],
    ["run_id", trials.map((trial) => trial.run_id)],
    ["trial_idempotency_key", trials.map((trial) => trial.trial_idempotency_key)],
  ] as const) {
    if (new Set(values).size !== values.length) throw new Error(`Trial Plan ${field} values must be unique`)
  }
  return trials
}
