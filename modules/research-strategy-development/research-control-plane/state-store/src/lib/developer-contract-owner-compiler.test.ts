import { describe, expect, test } from "bun:test"
import { canonicalHash } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
  createDeveloperDataSnapshotBinding,
  readStrategyFamilyCapability,
} from "../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
import {
  DEVELOPER_SEMANTIC_CONTRACT_SCHEMA_VERSION,
  compileDeveloperContractDraft,
  selectDeterministicCandidateAssignments,
  type DeveloperSemanticContract,
} from "./developer-contract-owner-compiler"
import { reconcileDeveloperContractDraft } from "./developer-contract-draft-validation"
import { buildDeveloperContractDraftSubmission } from "../../../../agent-roles/developer/src/lib/developer-role"
import {
  DEVELOPER_DEVELOPMENT_BRIEF_SCHEMA_VERSION,
  TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
  createDeveloperDevelopmentBrief,
  type DeveloperDevelopmentBrief,
} from "../../../contracts/src/lib/developer-contract-draft"

const HASH = "a".repeat(64)

describe("Developer contract owner compiler", () => {
  test("compiles semantic intent into a structurally valid exact experiment draft", () => {
    const draft = compileDeveloperContractDraft({
      brief,
      source_revision: "413a4abe",
      draft_revision: 2,
      requested_trial_budget: 8,
      family_capability: family(),
      data_snapshot_binding: dataBinding(),
      semantic_contract: semantic(),
      created_at: "2026-07-23T13:00:00.000Z",
    })
    const submission = buildDeveloperContractDraftSubmission({
      brief,
      developer_run_id: "developer-run-compiler-1",
      draft_revision: 2,
      requested_trial_budget: 8,
      draft_json: draft,
      created_at: "2026-07-23T13:00:00.000Z",
    })
    expect(reconcileDeveloperContractDraft(brief, submission, 1).errors).toEqual([])
    expect(draft.candidate_assignments).toHaveLength(8)
    expect((draft.contract as Record<string, unknown>).data_snapshot_ref)
      .toBe(dataBinding().snapshot_ref)
    expect((draft.assumptions_binding as Record<string, unknown>).assumptions_hash)
      .toMatch(/^[a-f0-9]{64}$/)
  })

  test("selects bounded candidates deterministically across the declared space", () => {
    const candidateSpace = { alpha: [1, 2, 3], side: ["long", "short"], enabled: [false, true] }
    const first = selectDeterministicCandidateAssignments(candidateSpace, 5, "hypothesis-1")
    const second = selectDeterministicCandidateAssignments(candidateSpace, 5, "hypothesis-1")
    expect(second).toEqual(first)
    expect(first).toHaveLength(5)
    expect(first[0]?.parameters).toEqual({ alpha: 1, enabled: false, side: "long" })
    expect(first.at(-1)?.parameters).toEqual({ alpha: 3, enabled: true, side: "short" })
    expect(new Set(first.map((item) => canonicalHash(item.parameters))).size).toBe(5)
  })

  test("preserves a larger predeclared Trial budget when the space has fewer unique candidates", () => {
    const smallSpace = { side: ["long", "short"] }
    const smallBrief = createDeveloperDevelopmentBrief({
      ...brief,
      brief_id: "brief-small-space",
      candidate_space: smallSpace,
      max_trial_budget: 4,
    })
    const draft = compileDeveloperContractDraft({
      brief: smallBrief,
      source_revision: "413a4abe",
      draft_revision: 1,
      requested_trial_budget: 4,
      family_capability: family(),
      data_snapshot_binding: createDeveloperDataSnapshotBinding({
        ...dataBinding(),
        hypothesis_id: smallBrief.hypothesis_id,
      }),
      semantic_contract: semantic(),
      created_at: "2026-07-23T13:00:00.000Z",
    })
    const submission = buildDeveloperContractDraftSubmission({
      brief: smallBrief,
      developer_run_id: "developer-small-space",
      draft_revision: 1,
      requested_trial_budget: 4,
      draft_json: draft,
      created_at: "2026-07-23T13:00:00.000Z",
    })
    expect(draft.candidate_assignments).toHaveLength(2)
    expect(reconcileDeveloperContractDraft(smallBrief, submission, 1).errors).toEqual([])
  })

  test("refuses to silently treat supplemental families as OHLCV-only", () => {
    const supplementalFamily = readStrategyFamilyCapability(
      "canonical:carry/funding-carry/funding-carry",
    )
    if (!supplementalFamily) throw new Error("supplemental fixture family is missing")
    const supplementalBrief = createDeveloperDevelopmentBrief({
      ...brief,
      brief_id: "brief-supplemental",
      universe_node_id: supplementalFamily.canonical_node_id,
      dataset_requirements: ["funding", "ohlcv"],
    })
    expect(() => compileDeveloperContractDraft({
      brief: supplementalBrief,
      source_revision: "413a4abe",
      draft_revision: 2,
      requested_trial_budget: 2,
      family_capability: supplementalFamily,
      data_snapshot_binding: createDeveloperDataSnapshotBinding({
        ...dataBinding(),
        schema_version: DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
        dataset_kinds: ["funding", "ohlcv"],
      }),
      semantic_contract: semantic(),
      created_at: "2026-07-23T13:00:00.000Z",
    })).toThrow("explicit supplemental requirement binding")
  })

  test("rejects semantic preclaims and implementation details before Draft intake", () => {
    const compile = (semanticContract: DeveloperSemanticContract) =>
      compileDeveloperContractDraft({
        brief,
        source_revision: "413a4abe",
        draft_revision: 2,
        requested_trial_budget: 8,
        family_capability: family(),
        data_snapshot_binding: dataBinding(),
        semantic_contract: semanticContract,
        created_at: "2026-07-23T13:00:00.000Z",
      })
    expect(() => compile({
      ...semantic(),
      hypothesis: {
        ...semantic().hypothesis,
        falsifiable_prediction: "The optimal 50 bar setting is statistically significant.",
      },
    })).toThrow("must not preclaim numeric results or parameters")
    expect(() => compile({
      ...semantic(),
      economic_rationale: {
        ...semantic().economic_rationale,
        persistence_rationale: "The break_even_after_r control protects capital after reversal.",
      },
    })).toThrow("unsupported preclaim or implementation detail")
    expect(() => compile({
      ...semantic(),
      hypothesis: {
        ...semantic().hypothesis,
        proposed_market_mechanism: "Directional displacement persists after new information.",
      },
    })).toThrow("must remain explicitly provisional")
  })
})

const candidateSpace = {
  side: ["long", "short", "both"],
  lookback_bars: [20, 40, 80],
  threshold_atr: [0.5, 1, 1.5],
  stop_atr: [1, 1.5, 2],
  max_risk_atr: [1, 1.5, 2],
  reward_risk: [1.5, 2, 3],
  break_even_after_r: [0, 1, 1.5],
  break_even_offset_r: [0, 0.1, 0.2],
}

const brief: DeveloperDevelopmentBrief = createDeveloperDevelopmentBrief({
  schema_version: DEVELOPER_DEVELOPMENT_BRIEF_SCHEMA_VERSION,
  brief_id: "brief-compiler-1",
  proposal_id: "proposal-compiler-1",
  proposal_revision: 1,
  proposal_hash: HASH,
  proposal_admission_hash: HASH,
  hypothesis_id: "hypothesis-compiler-1",
  universe_node_id: "canonical:trend/time-series-trend/time-series-momentum",
  objective: "test trend persistence after costs",
  dataset_requirements: ["ohlcv"],
  candidate_space: structuredClone(candidateSpace),
  max_trial_budget: 8,
  evaluation_protocol_ref: "rd-evaluation://discovery-v1",
  target_contract_schema_version: TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
  authority_scope: "contract_draft_only",
  issued_at: "2026-07-23T12:00:00.000Z",
})

function family() {
  const value = readStrategyFamilyCapability(brief.universe_node_id)
  if (!value) throw new Error("fixture family is missing")
  return value
}

function dataBinding() {
  return createDeveloperDataSnapshotBinding({
    schema_version: DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
    snapshot_ref: "dataset-split://split-1/BTCUSDT/discovery/4h",
    snapshot_hash: HASH,
    dataset_kinds: ["ohlcv"],
    hypothesis_id: brief.hypothesis_id,
    symbol: "BTCUSDT",
    exchange: "binanceusdm",
    segment: "discovery",
    timeframe: "4h",
    manifest_ref: "data/rd-datasets/split-1/btcusdt/discovery/manifest.json",
    evidence_ref: "agent-artifact://durable/a",
  })
}

function semantic(): DeveloperSemanticContract {
  return {
    schema_version: DEVELOPER_SEMANTIC_CONTRACT_SCHEMA_VERSION,
    hypothesis: {
      proposed_market_mechanism: "Volatility-normalized displacement may persist after a directional shock.",
      falsifiable_prediction: "The predeclared momentum family may retain positive cost-adjusted out-of-sample expectancy.",
      null_hypothesis: "The observed displacement may contain no repeatable directional information after costs.",
    },
    economic_rationale: {
      proposed_edge_source: "Slow positioning adjustment may extend directional price moves.",
      persistence_rationale: "Fragmented reactions to new information might delay complete price adjustment.",
      failure_modes: ["Fast arbitrage may remove the continuation effect before execution."],
    },
    evaluation_question: "Does the bounded family survive the referenced evidence gates after exact costs?",
  }
}
