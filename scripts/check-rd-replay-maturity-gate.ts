#!/usr/bin/env bun

import { readFileSync } from "node:fs"

interface GateManifest {
  schema_version: string
  maturity: number
  maturity_scale: number
  evidence_chain_freeze: string
  completed_milestones: string[]
  active_milestone: {
    id: string
    name: string
    status: "in_progress" | "complete"
    functional_commit_budget: number
    functional_commits_used: number
  }
  policy: {
    zero_instance_progress_forbidden: boolean
    phase_number_progress_forbidden: boolean
    max_consecutive_commits_without_blocker_reduction: number
    new_schema_requires_same_change_set_consumer: boolean
    maturity_requires_all_gates: boolean
  }
  gates: Record<string, Record<string, boolean>>
  evidence_refs: string[]
  next_allowed_outcome: string
}

const manifest = JSON.parse(readFileSync("docs/rd-replay-maturity-gate.json", "utf8")) as GateManifest
const issues: string[] = []

if (manifest.schema_version !== "trade.rd-replay-maturity-gate.v1") {
  issues.push("unsupported Replay maturity gate schema")
}
if (manifest.maturity_scale !== 5 || !Number.isSafeInteger(manifest.maturity)
    || manifest.maturity < 0 || manifest.maturity > manifest.maturity_scale) {
  issues.push("Replay maturity must be an integer on the 0..5 scale")
}
if (manifest.evidence_chain_freeze !== "R4.151") {
  issues.push("Replay evidence-chain freeze must remain R4.151; M3-G1 is a bounded cutover, not R4.152+")
}
if (canonicalArray(manifest.completed_milestones) !== canonicalArray(["M3-G1", "M3-G2", "M3-G3", "M3-G4", "M3-G5", "M3-G6", "M3-G7", "M3-G8", "M4-P1", "M4-P2", "M4-P3", "M4-P4", "M4-P5", "M4-P6", "M4-P7", "M4-P8", "M4-P9", "M4-P10", "M4-P11", "M4-P12", "M4-P13", "M4-P14", "M4-P15", "M4-P16", "M4-P17", "M4-P18", "M4-P19", "M4-P20", "M4-P21", "M4-P22", "M4-P23", "M4-P24", "M4-P25"])) {
  issues.push("Replay completed milestone history is incomplete")
}
if (manifest.active_milestone.id !== "M4-P26"
    || manifest.active_milestone.name !== "fixed-partial-reduce-portfolio-risk-resize-end-to-end") {
  issues.push("the active Replay milestone must be M4-P26")
}
if (manifest.active_milestone.functional_commit_budget !== 8
    || !Number.isSafeInteger(manifest.active_milestone.functional_commits_used)
    || manifest.active_milestone.functional_commits_used < 0
    || manifest.active_milestone.functional_commits_used > manifest.active_milestone.functional_commit_budget) {
  issues.push("M4-P26 functional commit budget is invalid or exhausted")
}
if (!manifest.policy.zero_instance_progress_forbidden
    || !manifest.policy.phase_number_progress_forbidden
    || !manifest.policy.new_schema_requires_same_change_set_consumer
    || !manifest.policy.maturity_requires_all_gates
    || manifest.policy.max_consecutive_commits_without_blocker_reduction !== 3) {
  issues.push("Replay convergence stop policy was weakened")
}

const expectedGateNames = {
  functional: ["explicit_fixed_partial_reduce_projection_opt_in", "fixed_partial_reduce_full_fill_then_generation_two_protection", "quantity_aware_funding_margin_and_liquidation", "realized_pnl_fee_cash_and_collateral_reconciliation", "gross_net_exposure_and_risk_resize", "owner_keyed_terminal_accounting", "bounded_cycle_cash_roll_forward", "terminal_accounting_cycle_manifest_last_artifacts"],
  evidence: ["long_short_fixed_partial_execution", "decision_boundary_initial_bracket_race", "post_partial_stop_target_strategy_exit_and_liquidation_ownership", "funding_before_and_after_partial_uses_t_minus_quantity", "open_at_end_keeps_resized_position_cash_collateral_exposure_and_risk", "cash_collateral_exposure_and_risk_conservation", "four_cycle_cash_and_owner_bridge", "cycle_local_ledger_hash_preservation", "one_sequence_opening_equity", "mid_cycle_failure_no_sequence_evidence", "semantic_tamper_fail_closed", "artifact_idempotent_replay", "interrupted_publication_no_sequence_manifest"],
  cutover: ["production_terminal_accounting_and_cycle_runners", "default_portfolio_projection_rejects_fixed_partial_reduce", "p15_through_p25_preserved", "single_change_set_end_to_end_consumer", "no_successor_cycle_before_full_flat", "no_dynamic_sizing_repeat_partial_reentry_cross_margin_real_liquidity_or_fast"],
} as const
const gateValues: boolean[] = []
for (const [group, names] of Object.entries(expectedGateNames)) {
  const actual = manifest.gates[group]
  if (!actual || JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify([...names].sort())) {
    issues.push(`Replay maturity gate group ${group} has an unexpected shape`)
    continue
  }
  for (const name of names) {
    if (typeof actual[name] !== "boolean") issues.push(`Replay maturity gate ${group}.${name} is not boolean`)
    else gateValues.push(actual[name])
  }
}
const expectedGateCount = Object.values(expectedGateNames).reduce((total, names) => total + names.length, 0)
const allGates = gateValues.length === expectedGateCount && gateValues.every(Boolean)
if (manifest.maturity !== 3) {
  issues.push("M4-P26 selects one predeclared next-open fixed-quantity partial reduce with exact quantity-aware Portfolio risk resize through terminal, accounting and bounded cycles; it does not certify dynamic sizing, repeat partial, reentry, cross-margin, real liquidity or Fast parity, and must not upgrade Replay beyond M3")
}
if (!allGates && manifest.active_milestone.status !== "in_progress") {
  issues.push("M4-P26 cannot be complete while a gate remains false")
}
if (allGates && manifest.active_milestone.status !== "complete") {
  issues.push("all M4-P26 gates require milestone completion")
}
if (allGates && manifest.evidence_refs.length === 0) {
  issues.push("completed M4-P26 gates require durable test or artifact evidence refs")
}
const expectedNextOutcome = allGates
  ? "audit-and-select-next-bounded-m4-fidelity-gap-after-fixed-partial-reduce"
  : "all-m4-p26-gates-true-in-one-bounded-change-set"
if (manifest.next_allowed_outcome !== expectedNextOutcome) {
  issues.push("Replay next outcome does not match M4-P26 gate state")
}

function canonicalArray(values: string[]): string {
  return JSON.stringify([...values].sort())
}

if (issues.length > 0) {
  console.error(`RD Replay maturity gate violations:\n${issues.join("\n")}`)
  process.exit(1)
}
