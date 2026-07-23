import { canonicalControlPlaneHash } from "../../../contracts/src/lib/control-plane-contracts"
import {
  DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION,
  TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
  type DeveloperDevelopmentBrief,
} from "../../../contracts/src/lib/developer-contract-draft"
import {
  REPLAY_MARGIN_POLICY_VERSION,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_SIMULATOR_POLICY_VERSION,
  REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import {
  readStrategyFamilyCapability,
  type DeveloperDataSnapshotBinding,
  type StrategyFamilyCapability,
} from "../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
import { IDENTITY_HASH_POLICY_VERSION } from "./research-identity-hash"
import { RESEARCH_LIFECYCLE_RULE_VERSION } from "./research-control-plane-schema"
import { RESEARCH_CONTRACT_VALIDATOR_VERSION } from "./research-contract-validator"
import { compileDeveloperContractFreezeTrialGroup } from "./developer-contract-freeze-compiler"

export const DEVELOPER_SEMANTIC_CONTRACT_SCHEMA_VERSION =
  "trade.rd-developer-semantic-contract.v3" as const
export const DEVELOPER_EXPERIMENT_ASSUMPTIONS_SCHEMA_VERSION =
  "trade.rd-developer-experiment-assumptions.v1" as const
export const DEVELOPER_CONTRACT_OWNER_COMPILER_VERSION =
  "trade.rd-developer-contract-owner-compiler.v2" as const
export const RESEARCH_SCOPE_POLICY_VERSION = "trade-flow.rd-scope.v1" as const

export interface DeveloperSemanticContract extends JSONRecord {
  schema_version: typeof DEVELOPER_SEMANTIC_CONTRACT_SCHEMA_VERSION
  hypothesis: {
    proposed_market_mechanism: string
    falsifiable_prediction: string
    null_hypothesis: string
  }
  economic_rationale: {
    proposed_edge_source: string
    persistence_rationale: string
    failure_modes: string[]
  }
  evaluation_question: string
}

export interface DeveloperExperimentAssumptions extends JSONRecord {
  schema_version: typeof DEVELOPER_EXPERIMENT_ASSUMPTIONS_SCHEMA_VERSION
  compiler_version: typeof DEVELOPER_CONTRACT_OWNER_COMPILER_VERSION
  source_revision: string
  family_capability_hash: string
  data_snapshot_binding_hash: string
  market: {
    exchange: string
    symbol: string
    timeframe: string
    segment: "discovery" | "validation"
  }
  replay: {
    signal_visibility: "closed_candle"
    earliest_execution: "next_open"
    same_bar_policy: "stop_first"
    cost_policy_resolution: "bind_from_reserved_execution_spec"
    venue_risk_resolution: "bind_from_dataset_manifest_at_reservation"
    simulator_policy_version: typeof REPLAY_SIMULATOR_POLICY_VERSION
    margin_policy_version: typeof REPLAY_MARGIN_POLICY_VERSION
  }
  assumptions_hash: string
}

export function compileDeveloperContractDraft(input: {
  brief: DeveloperDevelopmentBrief
  source_revision: string
  draft_revision: number
  requested_trial_budget: number
  family_capability: StrategyFamilyCapability
  data_snapshot_binding: DeveloperDataSnapshotBinding
  semantic_contract: DeveloperSemanticContract
  created_at: string
}): JSONRecord {
  const semantic = semanticContract(input.semantic_contract)
  const family = input.family_capability
  const data = input.data_snapshot_binding
  const registeredFamily = readStrategyFamilyCapability(input.brief.universe_node_id)
  if (family.canonical_node_id !== input.brief.universe_node_id
      || family.replay_coverage !== "ready"
      || canonicalControlPlaneHash(withoutCapabilityHash(family)) !== family.capability_hash
      || !registeredFamily
      || registeredFamily.capability_hash !== family.capability_hash) {
    throw new Error("Developer owner compiler requires the exact replay-ready family capability")
  }
  if (data.hypothesis_id !== input.brief.hypothesis_id
      || data.segment !== "discovery"
      || canonicalControlPlaneHash(withoutHash(data)) !== data.binding_hash) {
    throw new Error("Developer owner compiler requires the exact discovery data binding")
  }
  if (!sameStrings(data.dataset_kinds, input.brief.dataset_requirements)
      || !sameStrings(family.required_data, input.brief.dataset_requirements)) {
    throw new Error("Developer owner compiler data requirements drifted")
  }
  if (!sameStrings(input.brief.dataset_requirements, ["ohlcv"])) {
    throw new Error("Developer owner compiler requires an explicit supplemental requirement binding")
  }
  if (!Number.isSafeInteger(input.requested_trial_budget)
      || input.requested_trial_budget < 1
      || input.requested_trial_budget > input.brief.max_trial_budget) {
    throw new Error("Developer owner compiler trial budget is outside the Brief")
  }
  const assignments = selectDeterministicCandidateAssignments(
    input.brief.candidate_space,
    input.requested_trial_budget,
    input.brief.hypothesis_id,
  )
  const assignmentSetHash = canonicalControlPlaneHash(assignments)
  const trialGroupId = `${input.brief.hypothesis_id}:draft-${input.draft_revision}`
  const group = compileDeveloperContractFreezeTrialGroup({
    trial_group_id: trialGroupId,
    hypothesis_id: input.brief.hypothesis_id,
    candidate_space: input.brief.candidate_space,
    candidate_assignments: assignments,
    max_trials: input.requested_trial_budget,
    compiled_at: input.created_at,
  })
  const assumptions = compileAssumptions({
    source_revision: input.source_revision,
    family,
    data,
  })
  const codeRef = revisionRef(input.source_revision, family.module_ref)
  const harnessRef = revisionRef(
    input.source_revision,
    "modules/research-strategy-development/agent-roles/developer/candidate-batch-engine",
  )
  return {
    schema_version: DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION,
    compiler_version: DEVELOPER_CONTRACT_OWNER_COMPILER_VERSION,
    canonical_node_id: input.brief.universe_node_id,
    required_data: [...input.brief.dataset_requirements],
    candidate_space: structuredClone(input.brief.candidate_space),
    candidate_assignments: assignments,
    assumptions_binding: assumptions,
    data_snapshot_binding: structuredClone(data),
    family_capability: structuredClone(family),
    contract: {
      schema_version: TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
      canonical_node_id: input.brief.universe_node_id,
      code_family_id: family.family_id,
      implementation_version: family.implementation_version,
      contract_versions: {
        identity_hash_policy: IDENTITY_HASH_POLICY_VERSION,
        validator: RESEARCH_CONTRACT_VALIDATOR_VERSION,
        lifecycle_rule: RESEARCH_LIFECYCLE_RULE_VERSION,
        scope_policy: RESEARCH_SCOPE_POLICY_VERSION,
      },
      hypothesis: semantic.hypothesis,
      economic_rationale: semantic.economic_rationale,
      asset_universe_definition: {
        exchange: data.exchange,
        symbols: [data.symbol],
        selection_timestamp_rule: "point_in_time",
      },
      timeframe: { signal: data.timeframe, execution: data.timeframe },
      sampling_and_alignment: {
        closed_candle_only: true,
        signal_visibility: "bar_close",
        earliest_execution: "next_open",
      },
      required_data: [...input.brief.dataset_requirements],
      feature_definition: structuredClone(family.implementation_contract.feature_definition),
      target_definition: {
        objective: input.brief.objective,
        evaluation_intent: compileEvaluationIntent(
          semantic.evaluation_question,
          input.brief.evaluation_protocol_ref,
        ),
      },
      forecast_definition: {
        predeclared_hypothesis: structuredClone(semantic.hypothesis),
        no_prediction_claim_beyond_hypothesis: true,
      },
      signal_definition: structuredClone(family.implementation_contract.signal_definition),
      position_rule: structuredClone(family.implementation_contract.position_rule),
      portfolio_construction: {
        symbols: [data.symbol],
        quantity_policy: "bind_in_replay_execution_request",
        overlapping_position_policy: "bind_in_replay_execution_request",
      },
      risk_rule: structuredClone(family.implementation_contract.risk_rule),
      execution_rule: structuredClone(family.implementation_contract.execution_rule),
      transaction_cost_model: {
        fee_policy: "bind_exact_policy_at_replay_reservation",
        slippage_policy: "bind_exact_policy_at_replay_reservation",
        numeric_cost_claims_without_evidence: "forbidden",
      },
      expected_holding_period: {
        status: "measured_not_preclaimed",
        terminal_conditions: ["family_stop", "family_target", "replay_end_of_data"],
      },
      benchmark: {
        source: "evaluation_protocol",
        evaluation_protocol_ref: input.brief.evaluation_protocol_ref,
      },
      validation_plan: {
        evaluation_intent: compileEvaluationIntent(
          semantic.evaluation_question,
          input.brief.evaluation_protocol_ref,
        ),
        evaluation_protocol_ref: input.brief.evaluation_protocol_ref,
        data_segment: data.segment,
      },
      rejection_criteria: [
        "Reject when the referenced evaluation protocol reports any blocking gate.",
        "Reject when no predeclared candidate has positive cost-adjusted out-of-sample expectancy.",
        "Reject on insufficient evidence, negative-control failure, excessive drawdown, cost fragility, regime fragility, parameter fragility, or selection-bias veto.",
      ],
      trial_group_ref: {
        trial_group_id: group.trial_group_id,
        group_hash: group.group_hash,
        search_space_hash: input.brief.allowed_candidate_space_hash,
        max_trials: input.requested_trial_budget,
      },
      candidate_registration: {
        candidate_ids: assignments.map((item) => item.candidate_id),
        candidate_space_hash: input.brief.allowed_candidate_space_hash,
        candidate_assignment_set_hash: assignmentSetHash,
      },
      parent_experiment_id: null,
      random_seed: 1,
      code_commit_ref: codeRef,
      harness_commit_ref: harnessRef,
      data_snapshot_ref: data.snapshot_ref,
      assumptions_ref: `rd-assumptions://${assumptions.assumptions_hash}`,
      replay_execution_input: {
        supplemental_requirement_set_schema_version:
          REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
        supplemental_requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
      },
    },
  }
}

export function selectDeterministicCandidateAssignments(
  candidateSpace: JSONRecord,
  maxTrials: number,
  hypothesisId: string,
): Array<{ candidate_id: string; parameters: JSONRecord }> {
  const axes = Object.entries(candidateSpace).sort(([left], [right]) => left.localeCompare(right))
  if (axes.length === 0) throw new Error("candidate_space must not be empty")
  const values = axes.map(([name, choices]) => {
    if (!Array.isArray(choices) || choices.length === 0 || choices.some((choice) => !isScalar(choice))) {
      throw new Error(`candidate_space.${name} must be a non-empty scalar enumeration`)
    }
    if (new Set(choices.map(canonicalControlPlaneHash)).size !== choices.length) {
      throw new Error(`candidate_space.${name} choices must be unique`)
    }
    return choices
  })
  const total = values.reduce((product, choices) => product * BigInt(choices.length), 1n)
  const count = Number(total < BigInt(maxTrials) ? total : BigInt(maxTrials))
  const indexes = quantileIndexes(total, count)
  return indexes.map((index, ordinal) => {
    let cursor = index
    const parameters: JSONRecord = {}
    for (let axisIndex = axes.length - 1; axisIndex >= 0; axisIndex -= 1) {
      const choices = values[axisIndex]!
      const choiceIndex = Number(cursor % BigInt(choices.length))
      cursor /= BigInt(choices.length)
      parameters[axes[axisIndex]![0]] = structuredClone(choices[choiceIndex])
    }
    return {
      candidate_id: `${hypothesisId}:candidate-${String(ordinal + 1).padStart(3, "0")}`,
      parameters,
    }
  })
}

function compileAssumptions(input: {
  source_revision: string
  family: StrategyFamilyCapability
  data: DeveloperDataSnapshotBinding
}): DeveloperExperimentAssumptions {
  const body = {
    schema_version: DEVELOPER_EXPERIMENT_ASSUMPTIONS_SCHEMA_VERSION,
    compiler_version: DEVELOPER_CONTRACT_OWNER_COMPILER_VERSION,
    source_revision: input.source_revision,
    family_capability_hash: input.family.capability_hash,
    data_snapshot_binding_hash: input.data.binding_hash,
    market: {
      exchange: input.data.exchange,
      symbol: input.data.symbol,
      timeframe: input.data.timeframe,
      segment: input.data.segment,
    },
    replay: {
      signal_visibility: "closed_candle",
      earliest_execution: "next_open",
      same_bar_policy: "stop_first",
      cost_policy_resolution: "bind_from_reserved_execution_spec",
      venue_risk_resolution: "bind_from_dataset_manifest_at_reservation",
      simulator_policy_version: REPLAY_SIMULATOR_POLICY_VERSION,
      margin_policy_version: REPLAY_MARGIN_POLICY_VERSION,
    },
  } as const
  return { ...body, assumptions_hash: canonicalControlPlaneHash(body) }
}

function semanticContract(value: DeveloperSemanticContract): DeveloperSemanticContract {
  if (!isRecord(value)
      || value.schema_version !== DEVELOPER_SEMANTIC_CONTRACT_SCHEMA_VERSION) {
    throw new Error("Developer semantic contract schema is unsupported")
  }
  if (!isRecord(value.hypothesis)
      || !hasExactKeys(value.hypothesis, [
        "proposed_market_mechanism",
        "falsifiable_prediction",
        "null_hypothesis",
      ])) {
    throw new Error("Developer semantic contract hypothesis fields are invalid")
  }
  if (!isRecord(value.economic_rationale)
      || !hasExactKeys(value.economic_rationale, [
        "proposed_edge_source",
        "persistence_rationale",
        "failure_modes",
      ])
      || !Array.isArray(value.economic_rationale.failure_modes)
      || value.economic_rationale.failure_modes.length < 1
      || value.economic_rationale.failure_modes.length > 8) {
    throw new Error("Developer semantic contract economic_rationale fields are invalid")
  }
  const narratives = [
    value.hypothesis.proposed_market_mechanism,
    value.hypothesis.falsifiable_prediction,
    value.hypothesis.null_hypothesis,
    value.economic_rationale.proposed_edge_source,
    value.economic_rationale.persistence_rationale,
    value.evaluation_question,
    ...value.economic_rationale.failure_modes,
  ]
  for (const narrative of narratives) {
    semanticNarrative(narrative)
  }
  for (const provisional of [
    value.hypothesis.proposed_market_mechanism,
    value.hypothesis.falsifiable_prediction,
    value.economic_rationale.proposed_edge_source,
    value.economic_rationale.persistence_rationale,
  ]) {
    if (!/\b(?:may|might|could|would|hypothes(?:is|ized)|test whether)\b/i.test(provisional)) {
      throw new Error("Developer semantic mechanism and prediction must remain explicitly provisional")
    }
  }
  if (!value.evaluation_question.endsWith("?")) {
    throw new Error("Developer semantic evaluation_question must be a question")
  }
  return structuredClone(value)
}

function compileEvaluationIntent(
  evaluationQuestion: string,
  evaluationProtocolRef: string,
): JSONRecord {
  return {
    evaluation_question: evaluationQuestion,
    protocol_authority: evaluationProtocolRef,
    candidate_selection: "predeclared_assignments_only",
    required_evidence: [
      "out_of_sample_expectancy",
      "profit_factor",
      "drawdown",
      "cost_stress",
      "regime_robustness",
      "parameter_stability",
      "negative_controls",
      "selection_bias",
    ],
    thresholds: "owned_by_referenced_evaluation_protocol_and_engine_gates",
  }
}

function semanticNarrative(value: unknown): string {
  if (typeof value !== "string"
      || value.trim() !== value
      || value.length < 12
      || value.length > 800) {
    throw new Error("Developer semantic narrative must be a bounded non-empty string")
  }
  if (/[0-9%$€£¥]/u.test(value)) {
    throw new Error("Developer semantic narrative must not preclaim numeric results or parameters")
  }
  const forbidden = [
    /\bstatistically significant\b/i,
    /\boptimal\b/i,
    /\bproven\b/i,
    /\bguarantee(?:d|s)?\b/i,
    /\bprotects? capital\b/i,
    /\blocks? in gains?\b/i,
    /\bcreates? positive expectancy\b/i,
    /\b(?:lookback_bars|threshold_atr|stop_atr|max_risk_atr|reward_risk|break_even_after_r|break_even_offset_r)\b/i,
  ]
  if (forbidden.some((pattern) => pattern.test(value))) {
    throw new Error("Developer semantic narrative contains an unsupported preclaim or implementation detail")
  }
  return value
}

function hasExactKeys(value: JSONRecord, expected: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
}

function quantileIndexes(total: bigint, count: number): bigint[] {
  if (count < 1) throw new Error("candidate assignment count must be positive")
  if (count === 1 || total === 1n) return [0n]
  const denominator = BigInt(count - 1)
  return Array.from({ length: count }, (_, index) =>
    (BigInt(index) * (total - 1n)) / denominator)
}

function revisionRef(revision: string, moduleRef: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(revision)) {
    throw new Error("source_revision is invalid")
  }
  if (!moduleRef.startsWith("modules/") || moduleRef.includes("..")) {
    throw new Error("family module_ref is invalid")
  }
  return `repo-git://${revision}/${moduleRef}`
}

function withoutHash(value: DeveloperDataSnapshotBinding): JSONRecord {
  const { binding_hash: _hash, ...body } = value
  return body
}

function withoutCapabilityHash(value: StrategyFamilyCapability): JSONRecord {
  const { capability_hash: _hash, ...body } = value
  return body
}

function sameStrings(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function isRecord(value: unknown): value is JSONRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isScalar(value: unknown): boolean {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
}
