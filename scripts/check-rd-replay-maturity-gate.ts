#!/usr/bin/env bun

import { existsSync, lstatSync, readFileSync } from "node:fs"
import { isAbsolute, normalize } from "node:path"

interface GateManifest {
  schema_version: string
  maturity: number
  maturity_scale: number
  evidence_chain_freeze: string
  completed_milestones: string[]
  convergence_workstream: {
    id: string
    status: "in_progress" | "m4_complete" | "complete"
    p30_creation: string
    scope: string
  }
  policy: {
    zero_instance_progress_forbidden: boolean
    phase_number_progress_forbidden: boolean
    max_consecutive_commits_without_blocker_reduction: number
    new_schema_requires_same_change_set_consumer: boolean
    maturity_requires_all_gates: boolean
  }
  exit_gates: Record<string, Record<string, boolean>>
  evidence_refs: string[]
  next_allowed_outcome: string
}

interface CapabilityInventory {
  schema_version: string
  freeze: string
  p30_creation: string
  canonical_public_entrypoints: Array<{
    profile: string
    owner: string
    path: string
    export: string
  }>
  opt_in_activation_registry: Array<{
    milestone: string
    activation: string
    path: string
    export: string
  }>
  entries: Array<{
    milestone: string
    capability: string
    classification: "canonical" | "opt_in" | "compatibility" | "obsolete"
    target_role: string
  }>
  summary: Record<"canonical" | "opt_in" | "compatibility" | "obsolete" | "total", number>
}

const manifestPath = process.env.RD_REPLAY_MATURITY_GATE_PATH || "docs/research/reliability/rd-replay-maturity-gate.json"
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as GateManifest
const inventoryPath = process.env.RD_REPLAY_CAPABILITY_INVENTORY_PATH
  || "docs/research/reliability/rd-replay-capability-inventory.json"
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as CapabilityInventory
const issues: string[] = []

const expectedCapabilityMilestones = Array.from({ length: 29 }, (_, index) => `M4-P${index + 1}`)
const expectedCanonicalEntrypoints = [
  { profile: "single-trial", owner: "runner", path: "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.ts", export: "runReplayTrial" },
  { profile: "independent-lane-batch", owner: "runner", path: "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-independent-lane-batch-runner.ts", export: "runReplayIndependentLaneBatch" },
  { profile: "integrated-portfolio", owner: "runner", path: "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-integrated-portfolio-runner.ts", export: "runReplayIntegratedPortfolio" },
  { profile: "terminal-aware-bounded-cycle", owner: "runner", path: "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-portfolio-protective-terminal-cycle-sequence-runner.ts", export: "runReplayPortfolioProtectiveTerminalCycleSequence" },
]
if (inventory.schema_version !== "trade.rd-replay-capability-inventory.v1"
    || inventory.freeze !== "M4-P29" || inventory.p30_creation !== "forbidden") {
  issues.push("Replay capability inventory must remain frozen at M4-P29 with P30 forbidden")
}
if (JSON.stringify(inventory.canonical_public_entrypoints) !== JSON.stringify(expectedCanonicalEntrypoints)) {
  issues.push("Replay canonical public entrypoints do not match the frozen four-profile surface")
} else {
  for (const entrypoint of inventory.canonical_public_entrypoints) {
    if (!existsSync(entrypoint.path)
        || !readFileSync(entrypoint.path, "utf8").includes(`export function ${entrypoint.export}`)) {
      issues.push(`Replay canonical public entrypoint is not exported by its owner: ${entrypoint.profile}`)
    }
  }
}
if (canonicalArray(inventory.entries.map((entry) => entry.milestone))
    !== canonicalArray(expectedCapabilityMilestones)
    || new Set(inventory.entries.map((entry) => entry.milestone)).size !== 29
    || new Set(inventory.entries.map((entry) => entry.capability)).size !== 29
    || inventory.entries.some((entry) => !entry.capability || !entry.target_role)) {
  issues.push("Replay capability inventory must classify each P1-P29 capability exactly once")
}
const classificationCounts = { canonical: 0, opt_in: 0, compatibility: 0, obsolete: 0 }
for (const entry of inventory.entries) {
  if (!(entry.classification in classificationCounts)) {
    issues.push(`unsupported Replay capability classification: ${entry.classification}`)
    continue
  }
  classificationCounts[entry.classification] += 1
}
const optInMilestones = inventory.entries
  .filter((entry) => entry.classification === "opt_in")
  .map((entry) => entry.milestone)
if (canonicalArray(inventory.opt_in_activation_registry.map((entry) => entry.milestone))
    !== canonicalArray(optInMilestones)
    || new Set(inventory.opt_in_activation_registry.map((entry) => entry.milestone)).size
      !== inventory.opt_in_activation_registry.length) {
  issues.push("Replay opt-in activation registry must cover every opt-in capability exactly once")
}
for (const activation of inventory.opt_in_activation_registry) {
  if (!activation.activation || !existsSync(activation.path)
      || !readFileSync(activation.path, "utf8").includes(`export function ${activation.export}`)) {
    issues.push(`Replay opt-in activation is not owned by its declared Runner export: ${activation.milestone}`)
  }
}
if (inventory.summary.total !== 29
    || Object.entries(classificationCounts).some(([key, count]) =>
      inventory.summary[key as keyof typeof classificationCounts] !== count)) {
  issues.push("Replay capability inventory summary does not match its entries")
}

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

if (manifest.schema_version !== "trade.rd-replay-maturity-gate.v2") {
  issues.push("unsupported Replay maturity gate schema")
}
if (manifest.maturity_scale !== 5 || !Number.isSafeInteger(manifest.maturity)
    || manifest.maturity < 0 || manifest.maturity > manifest.maturity_scale) {
  issues.push("Replay maturity must be an integer on the 0..5 scale")
}
if (manifest.evidence_chain_freeze !== "R4.151") {
  issues.push("Replay evidence-chain freeze must remain R4.151; M3-G1 is a bounded cutover, not R4.152+")
}
if (canonicalArray(manifest.completed_milestones) !== canonicalArray(["M3-G1", "M3-G2", "M3-G3", "M3-G4", "M3-G5", "M3-G6", "M3-G7", "M3-G8", "M4-P1", "M4-P2", "M4-P3", "M4-P4", "M4-P5", "M4-P6", "M4-P7", "M4-P8", "M4-P9", "M4-P10", "M4-P11", "M4-P12", "M4-P13", "M4-P14", "M4-P15", "M4-P16", "M4-P17", "M4-P18", "M4-P19", "M4-P20", "M4-P21", "M4-P22", "M4-P23", "M4-P24", "M4-P25", "M4-P26", "M4-P27", "M4-P28", "M4-P29"])) {
  issues.push("Replay completed milestone history is incomplete")
}
if (manifest.convergence_workstream.id !== "M4-CONVERGENCE"
    || manifest.convergence_workstream.p30_creation !== "forbidden"
    || manifest.convergence_workstream.scope !== "canonicalize-supported-capabilities-without-adding-simulator-semantics") {
  issues.push("Replay must remain on the finite M4 convergence workstream; P30 is forbidden")
}
if (!manifest.policy.zero_instance_progress_forbidden
    || !manifest.policy.phase_number_progress_forbidden
    || !manifest.policy.new_schema_requires_same_change_set_consumer
    || !manifest.policy.maturity_requires_all_gates
    || manifest.policy.max_consecutive_commits_without_blocker_reduction !== 3) {
  issues.push("Replay convergence stop policy was weakened")
}

const expectedGateNames = {
  m4: [
    "p1_through_p29_inventory_frozen",
    "canonical_public_entrypoints_declared",
    "opt_in_activation_registry_complete",
    "compatibility_consumers_isolated",
    "result_artifact_and_checkpoint_epochs_converged",
    "single_owner_certification_command",
    "canonical_and_compatibility_test_suites_separated",
    "all_supported_profiles_have_golden_resume_idempotency_and_tamper_evidence",
    "no_unclassified_replay_module_or_production_consumer",
  ],
  m5: [
    "m4_exit_complete",
    "cross_process_reproducibility_bundle",
    "historical_artifact_read_migration_certified",
    "crash_recovery_and_exactly_once_publication_certified",
    "declared_capacity_and_performance_envelope_certified",
    "fault_injection_and_corruption_recovery_certified",
    "operational_observability_and_runbook_complete",
    "release_candidate_fixture_pack_frozen",
    "independent_release_audit_passed",
  ],
} as const
const gateValues: Record<keyof typeof expectedGateNames, boolean[]> = { m4: [], m5: [] }
for (const [group, names] of Object.entries(expectedGateNames)) {
  const actual = manifest.exit_gates[group]
  if (!actual || JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify([...names].sort())) {
    issues.push(`Replay maturity gate group ${group} has an unexpected shape`)
    continue
  }
  for (const name of names) {
    if (typeof actual[name] !== "boolean") issues.push(`Replay maturity gate ${group}.${name} is not boolean`)
    else gateValues[group as keyof typeof expectedGateNames].push(actual[name])
  }
}
const m4Complete = gateValues.m4.length === expectedGateNames.m4.length && gateValues.m4.every(Boolean)
if (manifest.exit_gates.m5?.m4_exit_complete !== m4Complete) {
  issues.push("Replay M5 gate must reflect the complete M4 exit atomically")
}
const m5Complete = gateValues.m5.length === expectedGateNames.m5.length && gateValues.m5.every(Boolean)
const expectedMaturity = m5Complete ? 5 : m4Complete ? 4 : 3
const expectedStatus = m5Complete ? "complete" : m4Complete ? "m4_complete" : "in_progress"
if (manifest.maturity !== expectedMaturity) {
  issues.push(`Replay maturity must be ${expectedMaturity} for the current finite exit-gate state`)
}
if (manifest.convergence_workstream.status !== expectedStatus) {
  issues.push(`Replay convergence workstream status must be ${expectedStatus}`)
}
if ((m4Complete || m5Complete) && manifest.evidence_refs.length === 0) {
  issues.push("completed Replay exit gates require durable test or artifact evidence refs")
}
const expectedNextOutcome = m5Complete
  ? "maintenance-only-new-capability-requires-explicit-reopen-decision"
  : m4Complete
    ? "m5-release-certification-only-no-new-simulator-capability"
    : "m4-convergence-only-p30-and-new-simulator-capabilities-forbidden"
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
