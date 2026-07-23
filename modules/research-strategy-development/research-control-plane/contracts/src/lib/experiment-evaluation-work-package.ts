import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import type {
  DeveloperDataSnapshotBinding,
  FamilyEvaluationProtocol,
  StrategyFamilyCapability,
} from "../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
import { canonicalControlPlaneHash } from "./control-plane-contracts"
import { digest, isRecord, positiveInteger, required, utc } from "./developer-contract-draft"

export const EXPERIMENT_EVALUATION_WORK_PACKAGE_START_SCHEMA_VERSION =
  "trade.rd-experiment-evaluation-work-package-start.v1" as const
export const COMPATIBILITY_EVALUATION_POLICY_SCHEMA_VERSION =
  "trade.rd-compatibility-evaluation-policy.v1" as const
export const EXPERIMENT_EVALUATION_WORK_PACKAGE_SCHEMA_VERSION =
  "trade.rd-experiment-evaluation-work-package.v1" as const
export const EXPERIMENT_EVALUATION_WORK_PACKAGE_COMPILER_VERSION =
  "trade.rd-experiment-evaluation-work-package-compiler.v1" as const
export const COMPATIBILITY_EVALUATION_RUN_REQUEST_SCHEMA_VERSION =
  "trade.rd-compatibility-evaluation-run-request.v1" as const
export const COMPATIBILITY_EVALUATION_RUN_RESULT_SCHEMA_VERSION =
  "trade.rd-compatibility-evaluation-run-result.v1" as const

export interface ExperimentEvaluationWorkPackageStart extends JSONRecord {
  schema_version: typeof EXPERIMENT_EVALUATION_WORK_PACKAGE_START_SCHEMA_VERSION
  plan_id: string
  plan_hash: string
  compiled_at: string
}

export interface CompatibilityEvaluationPolicyBody extends JSONRecord {
  schema_version: typeof COMPATIBILITY_EVALUATION_POLICY_SCHEMA_VERSION
  evaluation_owner_ref: "research.candidate-batch"
  execution_profile: "compatibility_mechanical_candidate_batch_v1"
  execution_command: "research.rd-loop-runner"
  max_hold_bars: number
  oos_split_ratio: number
  fee_bps: number
  slippage_bps: number
  adverse_funding_bps_per_8h: number
  cost_policy_ref: string
  cost_policy_hash: string
  source_policy_hash: string
  anti_overfit_stage: "selection_validation"
  closed_candles_only: true
  result_publication_authority: "control_plane_only"
}

export interface CompatibilityEvaluationPolicy extends CompatibilityEvaluationPolicyBody {
  policy_hash: string
}

export interface ExperimentEvaluationWorkItem extends JSONRecord {
  trial_id: string
  trial_ordinal: number
  candidate_id: string
  candidate_identity_hash: string
  evaluation_candidate_id: string
  candidate_parameters: JSONRecord
  candidate_parameters_hash: string
  run_id: string
}

export interface ExperimentEvaluationWorkPackageSource extends JSONRecord {
  schema_version: typeof EXPERIMENT_EVALUATION_WORK_PACKAGE_SCHEMA_VERSION
  package_id: string
  plan_id: string
  plan_hash: string
  freeze_id: string
  freeze_hash: string
  experiment_id: string
  experiment_contract_hash: string
  trial_group_id: string
  trial_group_hash: string
  batch_run_id: string
  evaluation_protocol: FamilyEvaluationProtocol
  family_capability: StrategyFamilyCapability
  data_snapshot_binding: DeveloperDataSnapshotBinding
  assumptions_hash: string
  code_commit_ref: string
  harness_commit_ref: string
  evaluation_policy: CompatibilityEvaluationPolicy
  trials: ExperimentEvaluationWorkItem[]
  compiler_version: typeof EXPERIMENT_EVALUATION_WORK_PACKAGE_COMPILER_VERSION
  compiled_at: string
}

export interface ExperimentEvaluationWorkPackageBody
  extends ExperimentEvaluationWorkPackageSource {
  evaluation_kind: "mechanical_compatibility_evaluation"
  evidence_kind: "compatibility_mechanical_replay"
  formal_replay_execution_authority: "none"
  trial_count: number
}

export interface ExperimentEvaluationWorkPackage
  extends ExperimentEvaluationWorkPackageBody {
  package_hash: string
}

export interface CompatibilityEvaluationRunRequest extends JSONRecord {
  schema_version: typeof COMPATIBILITY_EVALUATION_RUN_REQUEST_SCHEMA_VERSION
  package_id: string
  package_hash: string
  environment_id: string
  artifact_root: string
  catalog_db_path: string
  completed_at: string
}

export interface CompatibilityEvaluationRunResult extends JSONRecord {
  schema_version: typeof COMPATIBILITY_EVALUATION_RUN_RESULT_SCHEMA_VERSION
  package_id: string
  package_hash: string
  result_id: string
  result_ref: string
  evidence_kind: "compatibility_mechanical_replay"
  outcome: string
  recovered_artifact: boolean
  completed_at: string
}

export function assertExperimentEvaluationWorkPackageStart(
  value: ExperimentEvaluationWorkPackageStart,
): void {
  if (!isRecord(value)) throw new Error("Evaluation Work Package start must be an object")
  const expected: ExperimentEvaluationWorkPackageStart = {
    schema_version: EXPERIMENT_EVALUATION_WORK_PACKAGE_START_SCHEMA_VERSION,
    plan_id: required(value.plan_id, "plan_id"),
    plan_hash: digest(value.plan_hash, "plan_hash"),
    compiled_at: utc(value.compiled_at, "compiled_at"),
  }
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Evaluation Work Package start is non-canonical")
  }
}

export function createCompatibilityEvaluationPolicy(
  input: CompatibilityEvaluationPolicyBody,
): CompatibilityEvaluationPolicy {
  if (input.schema_version !== COMPATIBILITY_EVALUATION_POLICY_SCHEMA_VERSION
      || input.evaluation_owner_ref !== "research.candidate-batch"
      || input.execution_profile !== "compatibility_mechanical_candidate_batch_v1"
      || input.execution_command !== "research.rd-loop-runner"
      || input.anti_overfit_stage !== "selection_validation"
      || input.closed_candles_only !== true
      || input.result_publication_authority !== "control_plane_only") {
    throw new Error("Compatibility Evaluation Policy is unsupported")
  }
  const body: CompatibilityEvaluationPolicyBody = {
    schema_version: COMPATIBILITY_EVALUATION_POLICY_SCHEMA_VERSION,
    evaluation_owner_ref: "research.candidate-batch",
    execution_profile: "compatibility_mechanical_candidate_batch_v1",
    execution_command: "research.rd-loop-runner",
    max_hold_bars: positiveInteger(input.max_hold_bars, "max_hold_bars"),
    oos_split_ratio: boundedRatio(input.oos_split_ratio, "oos_split_ratio"),
    fee_bps: nonNegative(input.fee_bps, "fee_bps"),
    slippage_bps: nonNegative(input.slippage_bps, "slippage_bps"),
    adverse_funding_bps_per_8h: nonNegative(
      input.adverse_funding_bps_per_8h,
      "adverse_funding_bps_per_8h",
    ),
    cost_policy_ref: required(input.cost_policy_ref, "cost_policy_ref"),
    cost_policy_hash: digest(input.cost_policy_hash, "cost_policy_hash"),
    source_policy_hash: prefixedDigest(input.source_policy_hash, "source_policy_hash"),
    anti_overfit_stage: "selection_validation",
    closed_candles_only: true,
    result_publication_authority: "control_plane_only",
  }
  return { ...body, policy_hash: canonicalControlPlaneHash(body) }
}

export function createExperimentEvaluationWorkPackage(
  input: ExperimentEvaluationWorkPackageSource,
): ExperimentEvaluationWorkPackage {
  if (input.schema_version !== EXPERIMENT_EVALUATION_WORK_PACKAGE_SCHEMA_VERSION
      || input.compiler_version !== EXPERIMENT_EVALUATION_WORK_PACKAGE_COMPILER_VERSION) {
    throw new Error("Evaluation Work Package schema or compiler is unsupported")
  }
  const policy = createCompatibilityEvaluationPolicy(withoutPolicyHash(input.evaluation_policy))
  if (policy.policy_hash !== input.evaluation_policy.policy_hash) {
    throw new Error("Evaluation Work Package policy hash drifted")
  }
  const trials = normalizeWorkItems(input.trials)
  const body: ExperimentEvaluationWorkPackageBody = {
    schema_version: EXPERIMENT_EVALUATION_WORK_PACKAGE_SCHEMA_VERSION,
    package_id: required(input.package_id, "package_id"),
    plan_id: required(input.plan_id, "plan_id"),
    plan_hash: digest(input.plan_hash, "plan_hash"),
    freeze_id: required(input.freeze_id, "freeze_id"),
    freeze_hash: digest(input.freeze_hash, "freeze_hash"),
    experiment_id: required(input.experiment_id, "experiment_id"),
    experiment_contract_hash: digest(
      input.experiment_contract_hash,
      "experiment_contract_hash",
    ),
    trial_group_id: required(input.trial_group_id, "trial_group_id"),
    trial_group_hash: digest(input.trial_group_hash, "trial_group_hash"),
    batch_run_id: required(input.batch_run_id, "batch_run_id"),
    evaluation_protocol: structuredClone(input.evaluation_protocol),
    family_capability: structuredClone(input.family_capability),
    data_snapshot_binding: structuredClone(input.data_snapshot_binding),
    assumptions_hash: digest(input.assumptions_hash, "assumptions_hash"),
    code_commit_ref: required(input.code_commit_ref, "code_commit_ref"),
    harness_commit_ref: required(input.harness_commit_ref, "harness_commit_ref"),
    evaluation_policy: policy,
    trials,
    compiler_version: EXPERIMENT_EVALUATION_WORK_PACKAGE_COMPILER_VERSION,
    evaluation_kind: "mechanical_compatibility_evaluation",
    evidence_kind: "compatibility_mechanical_replay",
    formal_replay_execution_authority: "none",
    trial_count: trials.length,
    compiled_at: utc(input.compiled_at, "compiled_at"),
  }
  return { ...body, package_hash: canonicalControlPlaneHash(body) }
}

export function assertExperimentEvaluationWorkPackage(
  value: ExperimentEvaluationWorkPackage,
): void {
  if (!isRecord(value)) throw new Error("Evaluation Work Package must be an object")
  const {
    package_hash: _packageHash,
    evaluation_kind: _evaluationKind,
    evidence_kind: _evidenceKind,
    formal_replay_execution_authority: _formalReplayExecutionAuthority,
    trial_count: _trialCount,
    ...source
  } = value
  const expected = createExperimentEvaluationWorkPackage(source)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Evaluation Work Package is non-canonical or hash-drifted")
  }
}

function normalizeWorkItems(value: unknown): ExperimentEvaluationWorkItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Evaluation Work Package requires at least one Trial")
  }
  const trials = value.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`trials[${index}] must be an object`)
    if (!isRecord(raw.candidate_parameters)) {
      throw new Error(`trials[${index}].candidate_parameters must be an object`)
    }
    const parameters = structuredClone(raw.candidate_parameters)
    const parameterHash = canonicalControlPlaneHash(parameters)
    if (digest(raw.candidate_parameters_hash as string, `trials[${index}].candidate_parameters_hash`)
        !== parameterHash) {
      throw new Error("Evaluation Work Package candidate parameters hash drifted")
    }
    return {
      trial_id: required(raw.trial_id as string, `trials[${index}].trial_id`),
      trial_ordinal: positiveInteger(
        raw.trial_ordinal as number,
        `trials[${index}].trial_ordinal`,
      ),
      candidate_id: required(raw.candidate_id as string, `trials[${index}].candidate_id`),
      candidate_identity_hash: digest(
        raw.candidate_identity_hash as string,
        `trials[${index}].candidate_identity_hash`,
      ),
      evaluation_candidate_id: required(
        raw.evaluation_candidate_id as string,
        `trials[${index}].evaluation_candidate_id`,
      ),
      candidate_parameters: parameters,
      candidate_parameters_hash: parameterHash,
      run_id: required(raw.run_id as string, `trials[${index}].run_id`),
    }
  }).sort((left, right) => left.trial_ordinal - right.trial_ordinal)
  if (trials.some((trial, index) => trial.trial_ordinal !== index + 1)) {
    throw new Error("Evaluation Work Package Trial ordinals must be contiguous")
  }
  for (const values of [
    trials.map((trial) => trial.trial_id),
    trials.map((trial) => trial.evaluation_candidate_id),
    trials.map((trial) => trial.run_id),
  ]) {
    if (new Set(values).size !== values.length) {
      throw new Error("Evaluation Work Package Trial identities must be unique")
    }
  }
  return trials
}

function withoutPolicyHash(
  value: CompatibilityEvaluationPolicy,
): CompatibilityEvaluationPolicyBody {
  const { policy_hash: _hash, ...body } = value
  return body
}

function nonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be non-negative`)
  return value
}

function boundedRatio(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`${field} must be strictly between zero and one`)
  }
  return value
}

function prefixedDigest(value: string, field: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a sha256-prefixed digest`)
  }
  return value
}
