import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { basename } from "node:path"
import type { Database } from "bun:sqlite"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import { resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import { runOwnerToolRecordSync } from "../../../../../contracts/runtime-core/src/owner-tool-client"
import {
  createDeveloperDataSnapshotBinding,
  readFamilyEvaluationProtocol,
  readStrategyFamilyCapability,
  type DeveloperDataSnapshotBinding,
  type FamilyEvaluationProtocol,
  type StrategyFamilyCapability,
} from "../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
import {
  COMPATIBILITY_EVALUATION_POLICY_SCHEMA_VERSION,
  EXPERIMENT_EVALUATION_WORK_PACKAGE_COMPILER_VERSION,
  EXPERIMENT_EVALUATION_WORK_PACKAGE_SCHEMA_VERSION,
  assertExperimentEvaluationWorkPackage,
  assertExperimentEvaluationWorkPackageStart,
  createCompatibilityEvaluationPolicy,
  createExperimentEvaluationWorkPackage,
  type ExperimentEvaluationWorkPackage,
  type ExperimentEvaluationWorkPackageStart,
} from "../../../contracts/src/lib/experiment-evaluation-work-package"
import {
  assertExperimentTrialPlanRecord,
  type ExperimentTrialPlanRecord,
} from "../../../contracts/src/lib/experiment-trial-plan"
import {
  assertDeveloperContractFreezeRecord,
  type DeveloperContractFreezeRecord,
} from "../../../contracts/src/lib/developer-contract-freeze"
import {
  assertDeveloperContractDraftSubmission,
  type DeveloperContractDraftSubmission,
} from "../../../contracts/src/lib/developer-contract-draft"
import { canonicalControlPlaneHash } from "../../../contracts/src/lib/control-plane-contracts"

interface WorkPackageSourceRow {
  plan_json: string
  plan_hash: string
  freeze_json: string
  submission_json: string
  contract_json: string
  experiment_id: string
  lifecycle_state: string
  group_status: string
}

interface CandidateRow {
  candidate_id: string
  candidate_identity_hash: string
  parameter_assignment_json: string
}

interface RuntimePolicySource {
  runtime_policy: {
    source_hash: string
    cost_model: JSONRecord
  }
  policy_snapshot_ref: JSONRecord
}

export function compileExperimentEvaluationWorkPackage(
  db: Database,
  input: ExperimentEvaluationWorkPackageStart,
  loadPolicy: () => RuntimePolicySource = loadRuntimePolicyFromOwner,
): ExperimentEvaluationWorkPackage {
  assertExperimentEvaluationWorkPackageStart(input)
  const compile = db.transaction(() => {
    const existing = db.query(`
      SELECT package_json FROM rd_experiment_evaluation_work_package WHERE plan_id=$plan_id
    `).get({ $plan_id: input.plan_id }) as { package_json: string } | null
    if (existing) return parseWorkPackage(existing.package_json)

    const source = db.query(`
      SELECT p.plan_json, p.plan_hash, f.freeze_json, d.submission_json,
             e.contract_json, e.experiment_id, e.lifecycle_state,
             g.status AS group_status
      FROM rd_experiment_trial_plan p
      JOIN rd_developer_contract_freeze f ON f.freeze_id=p.freeze_id
      JOIN rd_developer_contract_draft_validation v ON v.validation_id=f.validation_id
      JOIN rd_developer_contract_draft d
        ON d.brief_id=v.brief_id AND d.draft_revision=v.draft_revision
      JOIN rd_experiment_contract e ON e.experiment_id=p.experiment_id
      JOIN rd_trial_group g ON g.trial_group_id=p.trial_group_id
      WHERE p.plan_id=$plan_id
    `).get({ $plan_id: input.plan_id }) as WorkPackageSourceRow | null
    if (!source) throw new Error("Evaluation Work Package requires an authoritative Trial Plan")
    const plan = parseTrialPlan(source.plan_json)
    const freeze = parseFreeze(source.freeze_json)
    const submission = parseSubmission(source.submission_json)
    if (input.plan_hash !== source.plan_hash || input.plan_hash !== plan.plan_hash
        || plan.freeze_id !== freeze.freeze_id || plan.freeze_hash !== freeze.freeze_hash
        || source.experiment_id !== plan.experiment_id
        || source.lifecycle_state !== "discovery" || source.group_status !== "running") {
      throw new Error("Evaluation Work Package source is not the active authoritative Trial Plan")
    }
    if (Date.parse(input.compiled_at) < Date.parse(plan.planned_at)) {
      throw new Error("Evaluation Work Package cannot predate its Trial Plan")
    }

    const draft = record(submission.draft_json, "submission.draft_json")
    const contract = record(JSON.parse(source.contract_json), "contract_json")
    const protocol = registeredProtocol(contract, plan)
    const family = registeredFamily(draft, contract, protocol)
    const data = exactDataBinding(draft, contract)
    assertBoundRuntimeFiles(data)
    const assumptions = record(draft.assumptions_binding, "draft.assumptions_binding")
    const assumptionsHash = digest(assumptions.assumptions_hash, "assumptions_hash")
    const candidates = candidateRows(db, plan)
    const policySource = loadPolicy()
    const policy = evaluationPolicy(policySource)
    const token = plan.plan_hash.slice(0, 16)
    const work = createExperimentEvaluationWorkPackage({
      schema_version: EXPERIMENT_EVALUATION_WORK_PACKAGE_SCHEMA_VERSION,
      package_id: `evaluation-package:${plan.experiment_id}:${token}`,
      plan_id: plan.plan_id,
      plan_hash: plan.plan_hash,
      freeze_id: freeze.freeze_id,
      freeze_hash: freeze.freeze_hash,
      experiment_id: plan.experiment_id,
      experiment_contract_hash: plan.experiment_contract_hash,
      trial_group_id: plan.trial_group_id,
      trial_group_hash: plan.trial_group_hash,
      batch_run_id: `compatibility-evaluation:${plan.experiment_id}:${token}`,
      evaluation_protocol: protocol,
      family_capability: family,
      data_snapshot_binding: data,
      assumptions_hash: assumptionsHash,
      code_commit_ref: text(contract.code_commit_ref, "contract.code_commit_ref"),
      harness_commit_ref: text(contract.harness_commit_ref, "contract.harness_commit_ref"),
      evaluation_policy: policy,
      trials: plan.trials.map((trial) => {
        const candidate = candidates.get(trial.candidate_id)
        if (!candidate || candidate.candidate_identity_hash !== trial.candidate_identity_hash) {
          throw new Error("Evaluation Work Package candidate identity drifted")
        }
        const parameters = record(
          JSON.parse(candidate.parameter_assignment_json),
          "candidate parameter assignment",
        )
        return {
          trial_id: trial.trial_id,
          trial_ordinal: trial.trial_ordinal,
          candidate_id: trial.candidate_id,
          candidate_identity_hash: trial.candidate_identity_hash,
          evaluation_candidate_id: `evaluation:${trial.trial_id}`,
          candidate_parameters: parameters,
          candidate_parameters_hash: canonicalControlPlaneHash(parameters),
          run_id: trial.run_id,
        }
      }),
      compiler_version: EXPERIMENT_EVALUATION_WORK_PACKAGE_COMPILER_VERSION,
      compiled_at: input.compiled_at,
    })
    db.query(`
      INSERT INTO rd_experiment_evaluation_work_package(
        package_id, plan_id, plan_hash, experiment_id, trial_group_id,
        evaluation_protocol_hash, family_capability_hash,
        data_snapshot_binding_hash, evaluation_policy_hash,
        package_hash, package_json, compiled_at
      ) VALUES (
        $package_id, $plan_id, $plan_hash, $experiment_id, $trial_group_id,
        $evaluation_protocol_hash, $family_capability_hash,
        $data_snapshot_binding_hash, $evaluation_policy_hash,
        $package_hash, $package_json, $compiled_at
      )
    `).run({
      $package_id: work.package_id,
      $plan_id: work.plan_id,
      $plan_hash: work.plan_hash,
      $experiment_id: work.experiment_id,
      $trial_group_id: work.trial_group_id,
      $evaluation_protocol_hash: work.evaluation_protocol.protocol_hash,
      $family_capability_hash: work.family_capability.capability_hash,
      $data_snapshot_binding_hash: work.data_snapshot_binding.binding_hash,
      $evaluation_policy_hash: work.evaluation_policy.policy_hash,
      $package_hash: work.package_hash,
      $package_json: JSON.stringify(work),
      $compiled_at: work.compiled_at,
    })
    return work
  })
  return compile.immediate()
}

export function readExperimentEvaluationWorkPackage(
  db: Database,
  packageId: string,
): ExperimentEvaluationWorkPackage {
  if (!packageId.trim()) throw new Error("package_id is required")
  const row = db.query(`
    SELECT package_json FROM rd_experiment_evaluation_work_package WHERE package_id=$package_id
  `).get({ $package_id: packageId }) as { package_json: string } | null
  if (!row) throw new Error("Experiment Evaluation Work Package is missing")
  return parseWorkPackage(row.package_json)
}

function loadRuntimePolicyFromOwner(): RuntimePolicySource {
  return runOwnerToolRecordSync(
    "policy.runtime-policy-compiler",
    [],
    "runtime policy compiler",
  ) as unknown as RuntimePolicySource
}

function registeredProtocol(
  contract: JSONRecord,
  plan: ExperimentTrialPlanRecord,
): FamilyEvaluationProtocol {
  const node = text(contract.canonical_node_id, "contract.canonical_node_id")
  const benchmark = record(contract.benchmark, "contract.benchmark")
  const validation = record(contract.validation_plan, "contract.validation_plan")
  const protocol = readFamilyEvaluationProtocol(node)
  if (!protocol
      || benchmark.evaluation_protocol_ref !== protocol.protocol_ref
      || benchmark.evaluation_protocol_hash !== protocol.protocol_hash
      || benchmark.evaluation_owner_ref !== protocol.evaluation_owner_ref
      || benchmark.execution_profile !== protocol.execution_profile
      || validation.evaluation_protocol_ref !== protocol.protocol_ref
      || validation.evaluation_protocol_hash !== protocol.protocol_hash
      || plan.trial_count > protocol.discovery_policy.max_candidates) {
    throw new Error("Evaluation Work Package requires the exact registered evaluation protocol")
  }
  return protocol
}

function registeredFamily(
  draft: JSONRecord,
  contract: JSONRecord,
  protocol: FamilyEvaluationProtocol,
): StrategyFamilyCapability {
  const supplied = record(
    draft.family_capability,
    "draft.family_capability",
  ) as unknown as StrategyFamilyCapability
  const registered = readStrategyFamilyCapability(text(contract.canonical_node_id, "canonical_node_id"))
  if (!registered
      || registered.capability_hash !== supplied.capability_hash
      || registered.family_id !== contract.code_family_id
      || registered.family_id !== protocol.family_id
      || registered.replay_coverage !== "ready"
      || canonicalNfcJson(registered) !== canonicalNfcJson(supplied)) {
    throw new Error("Evaluation Work Package requires the exact replay-ready family capability")
  }
  return registered
}

function exactDataBinding(
  draft: JSONRecord,
  contract: JSONRecord,
): DeveloperDataSnapshotBinding {
  const supplied = record(
    draft.data_snapshot_binding,
    "draft.data_snapshot_binding",
  ) as unknown as DeveloperDataSnapshotBinding
  const rebuilt = createDeveloperDataSnapshotBinding(supplied)
  if (rebuilt.binding_hash !== supplied.binding_hash
      || contract.data_snapshot_ref !== supplied.snapshot_ref
      || supplied.segment !== "discovery") {
    throw new Error("Evaluation Work Package data snapshot binding drifted")
  }
  return rebuilt
}

function candidateRows(
  db: Database,
  plan: ExperimentTrialPlanRecord,
): Map<string, CandidateRow> {
  const rows = db.query(`
    SELECT candidate_id, candidate_identity_hash, parameter_assignment_json
    FROM rd_trial_group_candidate
    WHERE trial_group_id=$trial_group_id
    ORDER BY candidate_ordinal
  `).all({ $trial_group_id: plan.trial_group_id }) as CandidateRow[]
  return new Map(rows.map((row) => [row.candidate_id, row]))
}

function evaluationPolicy(source: RuntimePolicySource) {
  const cost = source.runtime_policy.cost_model
  const fee = finiteNonNegative(cost.fee_bps, "runtime policy fee_bps")
  const slippage = finiteNonNegative(cost.slippage_bps, "runtime policy slippage_bps")
  const funding = finiteNonNegative(
    cost.adverse_funding_bps_per_8h,
    "runtime policy adverse_funding_bps_per_8h",
  )
  const costPolicyRef = text(
    source.policy_snapshot_ref.cost_model_ref,
    "runtime policy cost_model_ref",
  )
  const costPolicyHash = canonicalControlPlaneHash({
    cost_policy_ref: costPolicyRef,
    source_policy_hash: source.runtime_policy.source_hash,
    fee_bps: fee,
    slippage_bps: slippage,
    adverse_funding_bps_per_8h: funding,
  })
  return createCompatibilityEvaluationPolicy({
    schema_version: COMPATIBILITY_EVALUATION_POLICY_SCHEMA_VERSION,
    evaluation_owner_ref: "research.candidate-batch",
    execution_profile: "compatibility_mechanical_candidate_batch_v1",
    execution_command: "research.rd-loop-runner",
    max_hold_bars: 18,
    oos_split_ratio: 0.3,
    fee_bps: fee,
    slippage_bps: slippage,
    adverse_funding_bps_per_8h: funding,
    cost_policy_ref: costPolicyRef,
    cost_policy_hash: costPolicyHash,
    source_policy_hash: source.runtime_policy.source_hash,
    anti_overfit_stage: "selection_validation",
    closed_candles_only: true,
    result_publication_authority: "control_plane_only",
  })
}

function assertBoundRuntimeFiles(binding: DeveloperDataSnapshotBinding): void {
  const report = readFileSync(resolveRepoPath(binding.report_ref))
  const manifest = readFileSync(resolveRepoPath(binding.manifest_ref))
  const content = readFileSync(resolveRepoPath(binding.content_ref))
  if (hash(report) !== binding.report_hash
      || hash(manifest) !== binding.manifest_hash
      || hash(content) !== binding.content_hash) {
    throw new Error("Evaluation Work Package runtime data content drifted")
  }
  const manifestJson = record(JSON.parse(manifest.toString("utf8")), "segment manifest")
  const timeframe = record(
    record(manifestJson.timeframes, "segment manifest timeframes")[binding.timeframe],
    "segment manifest timeframe",
  )
  if (manifestJson.symbol !== binding.symbol
      || basename(binding.content_ref) !== timeframe.file
      || timeframe.content_sha256 !== binding.content_hash
      || timeframe.rows !== binding.row_count
      || record(manifestJson.split, "segment manifest split").segment !== binding.segment) {
    throw new Error("Evaluation Work Package segment manifest drifted from data binding")
  }
}

function parseTrialPlan(json: string): ExperimentTrialPlanRecord {
  const value = JSON.parse(json) as ExperimentTrialPlanRecord
  assertExperimentTrialPlanRecord(value)
  return value
}

function parseFreeze(json: string): DeveloperContractFreezeRecord {
  const value = JSON.parse(json) as DeveloperContractFreezeRecord
  assertDeveloperContractFreezeRecord(value)
  return value
}

function parseSubmission(json: string): DeveloperContractDraftSubmission {
  const value = JSON.parse(json) as DeveloperContractDraftSubmission
  assertDeveloperContractDraftSubmission(value)
  return value
}

function parseWorkPackage(json: string): ExperimentEvaluationWorkPackage {
  const value = JSON.parse(json) as ExperimentEvaluationWorkPackage
  assertExperimentEvaluationWorkPackage(value)
  return value
}

function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function digest(value: unknown, field: string): string {
  const normalized = text(value, field)
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${field} must be a lowercase sha256 digest`)
  }
  return normalized
}

function finiteNonNegative(value: unknown, field: string): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} is invalid`)
  return number
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value) {
    throw new Error(`${field} is required`)
  }
  return value
}

function record(value: unknown, field: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as JSONRecord
}
