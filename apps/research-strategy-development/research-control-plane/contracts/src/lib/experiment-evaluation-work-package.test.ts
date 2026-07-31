import { expect, test } from "bun:test"
import {
  DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
  createDeveloperDataSnapshotBinding,
  readFamilyEvaluationProtocol,
  readStrategyFamilyCapability,
} from "../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
import {
  COMPATIBILITY_EVALUATION_POLICY_SCHEMA_VERSION,
  EXPERIMENT_EVALUATION_WORK_PACKAGE_COMPILER_VERSION,
  EXPERIMENT_EVALUATION_WORK_PACKAGE_SCHEMA_VERSION,
  createCompatibilityEvaluationPolicy,
  createExperimentEvaluationWorkPackage,
} from "./experiment-evaluation-work-package"
import { canonicalControlPlaneHash } from "./control-plane-contracts"

const HASH = "a".repeat(64)
const NODE = "canonical:trend/time-series-trend/time-series-momentum"

test("Evaluation Work Package binds exact current-contract Trial work without claiming formal Replay authority", () => {
  const protocol = readFamilyEvaluationProtocol(NODE)
  const family = readStrategyFamilyCapability(NODE)
  if (!protocol || !family) throw new Error("fixture capability is missing")
  const policy = createCompatibilityEvaluationPolicy({
    schema_version: COMPATIBILITY_EVALUATION_POLICY_SCHEMA_VERSION,
    evaluation_owner_ref: "research.candidate-batch",
    execution_profile: "compatibility_mechanical_candidate_batch_v1",
    execution_command: "research.rd-loop-runner",
    max_hold_bars: 18,
    oos_split_ratio: 0.3,
    fee_bps: 2,
    slippage_bps: 1,
    adverse_funding_bps_per_8h: 1,
    cost_policy_ref: "policy_registry:cost_model/research/a",
    cost_policy_hash: "b".repeat(64),
    source_policy_hash: `sha256:${"c".repeat(64)}`,
    anti_overfit_stage: "selection_validation",
    closed_candles_only: true,
    result_publication_authority: "control_plane_only",
  })
  const parameters = { lookback_bars: 20, side: "long" }
  const work = createExperimentEvaluationWorkPackage({
    schema_version: EXPERIMENT_EVALUATION_WORK_PACKAGE_SCHEMA_VERSION,
    package_id: "evaluation-package:experiment-1",
    plan_id: "trial-plan:experiment-1",
    plan_hash: HASH,
    freeze_id: "freeze-1",
    freeze_hash: HASH,
    experiment_id: "experiment-1",
    experiment_contract_hash: HASH,
    trial_group_id: "group-1",
    trial_group_hash: HASH,
    batch_run_id: "compatibility-evaluation:experiment-1",
    evaluation_protocol: protocol,
    family_capability: family,
    data_snapshot_binding: createDeveloperDataSnapshotBinding({
      schema_version: DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
      snapshot_ref: "dataset-split://split-1/BTCUSDT/discovery/4h",
      snapshot_hash: HASH,
      dataset_kinds: ["ohlcv"],
      hypothesis_id: "hypothesis-1",
      symbol: "BTCUSDT",
      exchange: "binanceusdm",
      segment: "discovery",
      timeframe: "4h",
      row_count: 500,
      first_open_at: "2026-01-01T00:00:00.000Z",
      last_open_at: "2026-03-01T00:00:00.000Z",
      report_ref: "tmp/splits/split-1/report.json",
      report_hash: "b".repeat(64),
      manifest_ref: "tmp/splits/split-1/discovery/manifest.json",
      manifest_hash: "c".repeat(64),
      content_ref: "tmp/splits/split-1/discovery/4h.csv",
      content_hash: "d".repeat(64),
      evidence_ref: "dataset-split://split-1/BTCUSDT/discovery/4h",
    }),
    assumptions_hash: HASH,
    code_commit_ref: "repo-git://abc/family",
    harness_commit_ref: "repo-git://abc/harness",
    evaluation_policy: policy,
    trials: [1, 2].map((ordinal) => ({
      trial_id: `trial-${ordinal}`,
      trial_ordinal: ordinal,
      candidate_id: "candidate-1",
      candidate_identity_hash: HASH,
      evaluation_candidate_id: `evaluation:trial-${ordinal}`,
      candidate_parameters: parameters,
      candidate_parameters_hash: canonicalControlPlaneHash(parameters),
      run_id: `replay-${ordinal}`,
    })),
    compiler_version: EXPERIMENT_EVALUATION_WORK_PACKAGE_COMPILER_VERSION,
    compiled_at: "2026-07-23T14:00:00.000Z",
  })
  expect(work.evaluation_kind).toBe("mechanical_compatibility_evaluation")
  expect(work.evidence_kind).toBe("compatibility_mechanical_replay")
  expect(work.formal_replay_execution_authority).toBe("none")
  expect(work.trial_count).toBe(2)
  expect(work.trials[0]?.candidate_id).toBe(work.trials[1]?.candidate_id)
  expect(work.trials[0]?.evaluation_candidate_id)
    .not.toBe(work.trials[1]?.evaluation_candidate_id)
  expect(work.package_hash).toMatch(/^[a-f0-9]{64}$/)
})
