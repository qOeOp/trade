import {
  CONTRACT_SCHEMA_VERSION,
  DESIGNER_TOOL_ID,
  lintStrategyHypothesisContract,
  strategyHypothesisToQueueItem,
  type StrategyHypothesisLintResult,
} from "../../../../../../contracts/strategy-hypothesis-contract/src/strategy-hypothesis-contract"

type JSONRecord = Record<string, unknown>

interface StrategyHypothesisDesignContextInput {
  program_id?: string
  objective?: string
  latest_failure_summary?: JSONRecord | null
  latest_reliability_gate?: JSONRecord | null
  rejected_mechanisms?: JSONRecord[]
  universe_lessons?: JSONRecord[]
  artifact_refs?: string[]
  existing_strategy_refs?: string[]
  taxonomy_refs?: string[]
  control_plane_context?: JSONRecord | null
}

const DESIGN_CONTEXT_SCHEMA_VERSION = "trade-flow.strategy-hypothesis-design-context.v1" as const

function buildStrategyHypothesisDesignContext(input: StrategyHypothesisDesignContextInput): JSONRecord {
  return {
    schema_version: DESIGN_CONTEXT_SCHEMA_VERSION,
    designer_tool_id: DESIGNER_TOOL_ID,
    output_contract_schema: CONTRACT_SCHEMA_VERSION,
    program_id: stringField(input.program_id),
    objective: stringField(input.objective),
    context_refs: {
      taxonomy: nonEmptyStrings(input.taxonomy_refs).length > 0
        ? nonEmptyStrings(input.taxonomy_refs)
        : ["docs/rd-strategy-universe-design.md", "docs/strategy-universe-family-backlog.json"],
      existing_strategies: nonEmptyStrings(input.existing_strategy_refs),
      artifacts: nonEmptyStrings(input.artifact_refs),
    },
    latest_failure_summary: nullableRecord(input.latest_failure_summary),
    latest_reliability_gate: nullableRecord(input.latest_reliability_gate),
    rejected_mechanisms: (input.rejected_mechanisms || []).map(asRecord),
    universe_lessons: (input.universe_lessons || []).map(asRecord),
    control_plane_context: nullableRecord(input.control_plane_context),
    design_discipline: [
      "Start from a market mechanism, not from parameters.",
      "Filters, universe selection, holding rules, exits, cost assumptions, and risk geometry are part of the hypothesis.",
      "A failed mechanism may not be repaired by post-hoc exclusions; any repair is a new predeclared hypothesis.",
      "Every actionable conclusion must name falsification conditions and negative controls.",
      "Choose only an active L3 canonical from authoritative Control Plane context; coverage never overrides scope.",
      "If family, data, or capability is unavailable, emit backlog work and spend zero trials.",
      "The output must be a structured strategy_hypothesis_contract before any replay or panel trial.",
    ],
  }
}

function renderStrategyDesignerPrompt(context: JSONRecord): string {
  const refs = asRecord(context.context_refs)
  return [
    "You are the R&D strategy hypothesis designer for a real trading research system.",
    "",
    "Your job is to propose one high-quality, predeclared strategy hypothesis before any candidate batch, replay, panel run, or holdout is spent.",
    "",
    "Read first:",
    ...nonEmptyStrings(refs.taxonomy).map((ref) => `- ${ref}`),
    ...nonEmptyStrings(refs.existing_strategies).map((ref) => `- ${ref}`),
    "",
    "Research memory:",
    `- Program: ${stringField(context.program_id) || "not provided"}`,
    `- Objective: ${stringField(context.objective) || "not provided"}`,
    `- Latest failure summary: ${compactJson(context.latest_failure_summary)}`,
    `- Latest reliability gate: ${compactJson(context.latest_reliability_gate)}`,
    `- Rejected mechanisms: ${compactJson(context.rejected_mechanisms)}`,
    `- Universe lessons: ${compactJson(context.universe_lessons)}`,
    `- Authoritative Control Plane context: ${compactJson(context.control_plane_context)}`,
    "",
    "Design rules:",
    ...array(context.design_discipline).map(String).filter(Boolean).map((rule) => `- ${rule}`),
    "",
    `Return exactly one JSON object using schema_version ${CONTRACT_SCHEMA_VERSION}.`,
    "Do not return markdown. Do not return candidate results. Do not claim validation. The contract must include thesis, universe, trade_logic, risk, evidence_plan, data_binding, compilation, and constraints.",
    "",
    "Minimum contract content:",
    "- thesis: mechanism, behavioral_claim, participants, regime, falsification",
    "- trade_logic: timeframe, side, entry, exit, risk",
    "- evidence_plan: primary_tests, negative_controls, validation_plan, promotion_boundary",
    "- compilation: target_family or requires_new_family=true, plus candidate_param_hints only when the existing family can express the idea",
  ].join("\n")
}

function renderControlPlanePlannerPrompt(context: JSONRecord): string {
  return [
    "You are the Research Planner. Produce exactly one machine proposal for the Research Control Plane.",
    "",
    `Objective: ${stringField(context.objective) || "not provided"}`,
    `Authoritative context: ${compactJson(context.control_plane_context)}`,
    `Rejected mechanisms: ${compactJson(context.rejected_mechanisms)}`,
    `Lessons: ${compactJson(context.universe_lessons)}`,
    "",
    "Routing rules:",
    "- Select exactly one active, implementation-ready L3 canonical from authoritative context.",
    "- Coverage cannot make catalog_only or product_out_of_scope nodes researchable.",
    "- If family/data/capability is missing, return trade-flow.rd-family-backlog-contract.v1 and spend zero Trials.",
    "- Otherwise return trade-flow.rd-experiment-contract.v2 with every identity, temporal, pipeline, validation, cost, Trial Group, candidate, code, data, harness, and assumptions field populated.",
    "- Never invent a code family, data surface, capability, evidence strength, Result, or validation outcome.",
    "- Return JSON only. The owner store will independently validate, hash, revision, and materialize it.",
  ].join("\n")
}

function compactJson(value: unknown): string {
  const normalized = value === undefined ? null : value
  return JSON.stringify(normalized)
}

function nullableRecord(value: unknown): JSONRecord | null {
  const record = asRecord(value)
  return Object.keys(record).length > 0 ? record : null
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function nonEmptyStrings(value: unknown): string[] {
  return array(value).map(String).map((item) => item.trim()).filter(Boolean)
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export {
  CONTRACT_SCHEMA_VERSION,
  DESIGNER_TOOL_ID,
  buildStrategyHypothesisDesignContext,
  lintStrategyHypothesisContract,
  renderStrategyDesignerPrompt,
  renderControlPlanePlannerPrompt,
  strategyHypothesisToQueueItem,
  type StrategyHypothesisDesignContextInput,
  type StrategyHypothesisLintResult,
}
