#!/usr/bin/env bun

import { existsSync, lstatSync, readFileSync } from "node:fs"
import { isAbsolute, normalize } from "node:path"

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

const manifestPath = process.env.RD_REPLAY_MATURITY_GATE_PATH || "docs/research/reliability/rd-replay-maturity-gate.json"
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as GateManifest
const issues: string[] = []

const evidenceRefs = new Set<string>()
for (const ref of manifest.evidence_refs) {
  const normalized = normalize(ref).replace(/\\/g, "/")
  if (!ref || isAbsolute(ref) || normalized.startsWith("../") || normalized === "..") {
    issues.push(`Replay evidence ref must be a repo-relative path: ${ref}`)
    continue
  }
  if (evidenceRefs.has(normalized)) issues.push(`duplicate Replay evidence ref: ${normalized}`)
  evidenceRefs.add(normalized)
  if (!existsSync(normalized) || !lstatSync(normalized).isFile()) {
    issues.push(`Replay evidence ref does not exist as a file: ${normalized}`)
  }
}

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
if (canonicalArray(manifest.completed_milestones) !== canonicalArray(["M3-G1", "M3-G2", "M3-G3", "M3-G4", "M3-G5", "M3-G6", "M3-G7", "M3-G8", "M4-P1", "M4-P2", "M4-P3", "M4-P4", "M4-P5", "M4-P6", "M4-P7", "M4-P8", "M4-P9", "M4-P10", "M4-P11", "M4-P12", "M4-P13", "M4-P14", "M4-P15", "M4-P16", "M4-P17", "M4-P18", "M4-P19", "M4-P20", "M4-P21", "M4-P22", "M4-P23", "M4-P24", "M4-P25", "M4-P26", "M4-P27", "M4-P28"])) {
  issues.push("Replay completed milestone history is incomplete")
}
if (manifest.active_milestone.id !== "M4-P29"
    || manifest.active_milestone.name !== "bounded-bar-linked-aggregate-trade-stop-entry-path-end-to-end") {
  issues.push("the active Replay milestone must be M4-P29")
}
if (manifest.active_milestone.functional_commit_budget !== 6
    || !Number.isSafeInteger(manifest.active_milestone.functional_commits_used)
    || manifest.active_milestone.functional_commits_used < 0
    || manifest.active_milestone.functional_commits_used > manifest.active_milestone.functional_commit_budget) {
  issues.push("M4-P29 functional commit budget is invalid or exhausted")
}
if (!manifest.policy.zero_instance_progress_forbidden
    || !manifest.policy.phase_number_progress_forbidden
    || !manifest.policy.new_schema_requires_same_change_set_consumer
    || !manifest.policy.maturity_requires_all_gates
    || manifest.policy.max_consecutive_commits_without_blocker_reduction !== 3) {
  issues.push("Replay convergence stop policy was weakened")
}

const expectedGateNames = {
  functional: ["immutable_kline_aggregate_trade_bar_link", "ohlcv_volume_trade_count_and_id_reconciliation", "control_plane_bar_link_and_exact_path_authority", "opt_in_step_engine_stop_entry_path_consumer", "checkpoint_result_fingerprint_and_manifest_binding", "typed_unresolved_fallback_without_partial_result"],
  evidence: ["same_ohlcv_opposite_ordered_paths_for_long_and_short", "entry_trade_cannot_retroactively_trigger_protection", "half_open_window_pit_availability_and_bar_boundary", "price_volume_quote_volume_trade_count_and_id_tamper_fail_closed", "missing_or_unlinked_source_remains_unresolved", "clean_resume_path_and_result_parity", "artifact_idempotent_replay_and_payload_tamper_rejection", "insurance_adl_queue_fill_quantity_slippage_and_impact_not_overclaimed"],
  cutover: ["production_opt_in_lane_consumer", "default_ohlcv_and_portfolio_paths_unchanged", "p15_through_p28_preserved", "bar_relative_path_evidence_keeps_external_completeness_not_verified", "no_generic_aggregate_trade_source_merge", "no_queue_partial_fill_slippage_impact_insurance_adl_cross_margin_borrow_or_fast"],
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
  issues.push("M4-P29 can certify only a bar-linked aggregate-trade price path for one Stop-market entry ambiguity; external completeness remains not verified and queue, Fill quantity, slippage, impact, insurance/ADL, cross-margin, borrow and Fast remain unsupported, so Replay must stay M3")
}
if (!allGates && manifest.active_milestone.status !== "in_progress") {
  issues.push("M4-P29 cannot be complete while a gate remains false")
}
if (allGates && manifest.active_milestone.status !== "complete") {
  issues.push("all M4-P29 gates require milestone completion")
}
if (allGates && manifest.evidence_refs.length === 0) {
  issues.push("completed M4-P29 gates require durable test or artifact evidence refs")
}
const expectedNextOutcome = allGates
  ? "audit-and-select-next-bounded-m4-fidelity-gap-after-bar-linked-aggregate-trade-path"
  : "all-m4-p29-gates-true-in-one-bounded-change-set"
if (manifest.next_allowed_outcome !== expectedNextOutcome) {
  issues.push("Replay next outcome does not match M4-P29 gate state")
}

function canonicalArray(values: string[]): string {
  return JSON.stringify([...values].sort())
}

if (issues.length > 0) {
  console.error(`RD Replay maturity gate violations:\n${issues.join("\n")}`)
  process.exit(1)
}
