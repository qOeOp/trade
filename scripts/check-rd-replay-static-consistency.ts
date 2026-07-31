#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { isAbsolute, normalize } from "node:path"

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
  compatibility_consumer_registry: Array<{
    milestone: string
    owner: string
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

interface EvidenceEpochRegistry {
  schema_version: string
  freeze: string
  writer_policy: {
    one_current_generic_epoch_per_kind: boolean
    historical_generic_epoch_writes: string
    profile_specific_result_and_manifest: string
    checkpoint_absence: string
  }
  generic_epochs: Array<{
    kind: string
    schema_version: string
    path: string
    export: string
  }>
  profile_epochs: Array<{
    profile: string
    result_schema_version: string
    artifact_schema_version: string
    checkpoint_mode: string
  }>
}

interface CertificationRegistry {
  schema_version: string
  owner: string
  execution_policy: string
  suites: Array<{
    classification: "canonical" | "compatibility"
    package_path: string
    package_name: string
  }>
}

type EvidenceDimension = "golden" | "resume" | "idempotency" | "tamper"

interface ProfileRegistry {
  schema_version: string
  owner: string
  required_dimensions: EvidenceDimension[]
  profiles: Array<{
    profile: string
    entrypoint_path: string
    entrypoint_export: string
    checkpoint_mode: string
    evidence: Record<EvidenceDimension, {
      kind: "test" | "delegated-child-trial-test" | "explicit-not-supported"
      path?: string
      test_name?: string
    }>
  }>
}

interface StaticInputIdentity {
  role: string
  path: string
  kind: "content" | "existence"
  sha256?: string
  exists?: boolean
}

const staticInputsSchemaVersion = "trade.rd-replay-static-inputs.v1"
const jsonMode = process.argv.includes("--json")
const replayRoot = "modules/research-strategy-development/replay-execution-plane"
const certificationOwner = `${replayRoot}/certification/replay-certification`
const issues: string[] = []
const staticInputs = new Map<string, StaticInputIdentity>()
const inventory = readJson<CapabilityInventory>(
  process.env.RD_REPLAY_CAPABILITY_INVENTORY_PATH
    || "docs/research/reliability/rd-replay-capability-inventory.json",
)
const epochs = readJson<EvidenceEpochRegistry>(
  process.env.RD_REPLAY_EVIDENCE_EPOCH_REGISTRY_PATH
    || "docs/research/reliability/rd-replay-evidence-epoch-registry.json",
)
const certification = readJson<CertificationRegistry>(
  process.env.RD_REPLAY_CERTIFICATION_REGISTRY_PATH
    || `${certificationOwner}/replay-certification-suites.json`,
)
const profiles = readJson<ProfileRegistry>(
  process.env.RD_REPLAY_PROFILE_EVIDENCE_REGISTRY_PATH
    || `${certificationOwner}/replay-profile-evidence.json`,
)

if (inventory.schema_version !== "trade.rd-replay-capability-inventory.v1"
    || inventory.freeze !== "M4-P29" || inventory.p30_creation !== "forbidden") {
  issues.push("Replay capability inventory freeze policy changed")
}

const expectedMilestones = Array.from({ length: 29 }, (_, index) => `M4-P${index + 1}`)
if (!sameSet(inventory.entries.map((entry) => entry.milestone), expectedMilestones)
    || !unique(inventory.entries.map((entry) => entry.milestone))
    || !unique(inventory.entries.map((entry) => entry.capability))
    || inventory.entries.some((entry) => !entry.capability || !entry.target_role)) {
  issues.push("Replay capability inventory must classify P1-P29 exactly once")
}

const classificationCounts = { canonical: 0, opt_in: 0, compatibility: 0, obsolete: 0 }
for (const entry of inventory.entries) {
  if (!(entry.classification in classificationCounts)) {
    issues.push(`unsupported Replay capability classification: ${entry.classification}`)
    continue
  }
  classificationCounts[entry.classification] += 1
}
if (inventory.summary.total !== inventory.entries.length
    || Object.entries(classificationCounts).some(([classification, count]) =>
      inventory.summary[classification as keyof typeof classificationCounts] !== count)) {
  issues.push("Replay capability inventory summary does not match its entries")
}

if (!unique(inventory.canonical_public_entrypoints.map((entry) => entry.profile))
    || inventory.canonical_public_entrypoints.some((entry) => entry.owner !== "runner")) {
  issues.push("Replay canonical public entrypoints are not uniquely owned")
}
for (const entrypoint of inventory.canonical_public_entrypoints) {
  assertExport(entrypoint.path, entrypoint.export, `canonical entrypoint ${entrypoint.profile}`)
}

const optInMilestones = inventory.entries
  .filter((entry) => entry.classification === "opt_in")
  .map((entry) => entry.milestone)
if (!sameSet(inventory.opt_in_activation_registry.map((entry) => entry.milestone), optInMilestones)
    || !unique(inventory.opt_in_activation_registry.map((entry) => entry.milestone))) {
  issues.push("Replay opt-in registry must cover every opt-in capability exactly once")
}
for (const activation of inventory.opt_in_activation_registry) {
  if (!activation.activation) issues.push(`Replay opt-in activation is empty: ${activation.milestone}`)
  assertExport(activation.path, activation.export, `opt-in activation ${activation.milestone}`)
}

const compatibilityMilestones = inventory.entries
  .filter((entry) => entry.classification === "compatibility")
  .map((entry) => entry.milestone)
if (!sameSet(
  inventory.compatibility_consumer_registry.map((entry) => entry.milestone),
  compatibilityMilestones,
) || !unique(inventory.compatibility_consumer_registry.map((entry) => entry.milestone))) {
  issues.push("Replay compatibility registry must cover every compatibility capability exactly once")
}
for (const consumer of inventory.compatibility_consumer_registry) {
  if (consumer.owner !== "legacy-portfolio-cycle"
      || !consumer.path.startsWith(`${replayRoot}/compatibility/legacy-portfolio-cycle/`)) {
    issues.push(`Replay compatibility consumer is outside its owner: ${consumer.milestone}`)
  }
  assertExport(consumer.path, consumer.export, `compatibility consumer ${consumer.milestone}`)
}

if (epochs.schema_version !== "trade.rd-replay-evidence-epoch-registry.v1"
    || epochs.freeze !== "M4-CONVERGENCE"
    || epochs.writer_policy.one_current_generic_epoch_per_kind !== true
    || epochs.writer_policy.historical_generic_epoch_writes !== "forbidden"
    || epochs.writer_policy.profile_specific_result_and_manifest
      !== "subordinate_evidence_not_competing_generic_epoch"
    || epochs.writer_policy.checkpoint_absence
      !== "must_be_explicit_not_supported_never_invented_for_gate_completion") {
  issues.push("Replay evidence epoch registry policy changed")
}
if (!unique(epochs.generic_epochs.map((entry) => entry.kind))) {
  issues.push("Replay generic evidence epoch kinds must be unique")
}
for (const epoch of epochs.generic_epochs) {
  assertConstant(
    epoch.path,
    epoch.export,
    epoch.schema_version,
    `generic evidence epoch ${epoch.kind}`,
  )
}
if (!unique(epochs.profile_epochs.map((entry) => entry.profile))
    || !sameSet(
      epochs.profile_epochs.map((entry) => entry.profile),
      inventory.canonical_public_entrypoints.map((entry) => entry.profile),
    )) {
  issues.push("Replay profile epoch registry does not match the public profile surface")
}

const requiredDimensions: EvidenceDimension[] = ["golden", "resume", "idempotency", "tamper"]
if (profiles.schema_version !== "trade.rd-replay-profile-evidence.v1"
    || profiles.owner !== certificationOwner
    || JSON.stringify(profiles.required_dimensions) !== JSON.stringify(requiredDimensions)) {
  issues.push("Replay profile registry policy changed")
}
if (!unique(profiles.profiles.map((entry) => entry.profile))
    || !sameSet(
      profiles.profiles.map((entry) => entry.profile),
      inventory.canonical_public_entrypoints.map((entry) => entry.profile),
    )) {
  issues.push("Replay profile registry does not cover the public profile surface exactly once")
}
for (const profile of profiles.profiles) {
  const entrypoint = inventory.canonical_public_entrypoints.find(
    (candidate) => candidate.profile === profile.profile,
  )
  const epoch = epochs.profile_epochs.find((candidate) => candidate.profile === profile.profile)
  if (!entrypoint || !epoch
      || profile.entrypoint_path !== entrypoint.path
      || profile.entrypoint_export !== entrypoint.export
      || profile.checkpoint_mode !== epoch.checkpoint_mode) {
    issues.push(`Replay profile registry binding drifted: ${profile.profile}`)
    continue
  }
  if (!sameSet(Object.keys(profile.evidence), requiredDimensions)) {
    issues.push(`Replay profile registry dimensions are incomplete: ${profile.profile}`)
    continue
  }
  for (const dimension of requiredDimensions) {
    const evidence = profile.evidence[dimension]
    if (evidence.kind === "explicit-not-supported") {
      if (evidence.path !== undefined || evidence.test_name !== undefined) {
        issues.push(`Replay unsupported profile locator must be empty: ${profile.profile}.${dimension}`)
      }
      continue
    }
    if ((evidence.kind !== "test" && evidence.kind !== "delegated-child-trial-test")
        || !evidence.path || !evidence.test_name || !evidence.path.endsWith(".test.ts")) {
      issues.push(`Replay profile evidence locator is malformed: ${profile.profile}.${dimension}`)
      continue
    }
    assertRepoFile(evidence.path, `profile evidence locator ${profile.profile}.${dimension}`)
  }
}

if (certification.schema_version !== "trade.rd-replay-certification-suites.v1"
    || certification.owner !== certificationOwner
    || certification.execution_policy !== "sorted-sequential-fail-fast-package-check") {
  issues.push("Replay certification registry policy changed")
}
const suitePaths = certification.suites.map((suite) => suite.package_path)
if (!unique(suitePaths)) issues.push("Replay certification package owners must be unique")
const packageRoots = collectPackageRoots(replayRoot)
const expectedSuitePaths = packageRoots.filter((path) => path !== certificationOwner)
if (!sameSet(suitePaths, expectedSuitePaths)) {
  issues.push("Replay certification registry must classify every Plane package exactly once")
}
const certifyOwners: string[] = []
for (const packageRoot of packageRoots) {
  const packageJson = readJson<{ name?: string; scripts?: Record<string, string> }>(
    `${packageRoot}/package.json`,
  )
  if (packageJson.scripts?.certify) certifyOwners.push(packageRoot)
  if (packageRoot === certificationOwner) continue
  const suite = certification.suites.find((entry) => entry.package_path === packageRoot)
  if (!suite || suite.package_name !== packageJson.name || !packageJson.scripts?.check) {
    issues.push(`Replay certification package binding is invalid: ${packageRoot}`)
    continue
  }
  const compatibilityPath = packageRoot.includes("/compatibility/")
    || packageRoot.includes("/certification/legacy-")
  if ((suite.classification === "compatibility") !== compatibilityPath) {
    issues.push(`Replay certification package classification drifted: ${packageRoot}`)
  }
}
const ownerPackage = readJson<{ scripts?: Record<string, string> }>(
  `${certificationOwner}/package.json`,
)
if (JSON.stringify(certifyOwners) !== JSON.stringify([certificationOwner])
    || ownerPackage.scripts?.certify !== "bun src/scripts/main.ts --suite all") {
  issues.push("Replay certification command must have one owner")
}

finish()

function readJson<T>(path: string): T {
  const normalized = normalize(path).replace(/\\/g, "/")
  if (!path || (jsonMode && isAbsolute(path))
      || (!isAbsolute(path) && (normalized === ".." || normalized.startsWith("../")))) {
    failInput(`Replay JSON input path must be repo-relative: ${path}`)
  }
  if (!existsSync(normalized)) failInput(`Replay JSON input is missing: ${normalized}`)
  try {
    const source = readFileSync(normalized, "utf8")
    recordContentInput(normalized, "json", source)
    return JSON.parse(source) as T
  } catch (error) {
    failInput(`Replay JSON input is malformed: ${normalized}: ${String(error)}`)
  }
}

function assertRepoFile(path: string, role: string): void {
  const normalized = normalize(path).replace(/\\/g, "/")
  if (!path || isAbsolute(path) || normalized === ".." || normalized.startsWith("../")) {
    issues.push(`Replay ${role} path must be repo-relative: ${path}`)
    return
  }
  const exists = existsSync(normalized)
  recordExistenceInput(normalized, role, exists)
  if (!exists) issues.push(`Replay ${role} is missing: ${normalized}`)
}

function assertExport(path: string, name: string, role: string): void {
  assertRepoFile(path, role)
  if (!existsSync(path)) return
  const source = readFileSync(path, "utf8")
  recordContentInput(path, role, source)
  if (!source.includes(`export function ${name}`)
      && !new RegExp(`export\\s*\\{[^}]*\\b${escapeRegExp(name)}\\b[^}]*\\}\\s*from`).test(source)) {
    issues.push(`Replay ${role} export is missing: ${name}`)
  }
}

function assertConstant(path: string, name: string, value: string, role: string): void {
  assertRepoFile(path, role)
  if (!existsSync(path)) return
  const source = readFileSync(path, "utf8")
  recordContentInput(path, role, source)
  if (!source.includes(`export const ${name} = "${value}" as const`)) {
    issues.push(`Replay ${role} constant is missing: ${name}`)
  }
}

function collectPackageRoots(root: string): string[] {
  const roots: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue
    const path = `${root}/${entry.name}`
    if (entry.isDirectory()) roots.push(...collectPackageRoots(path))
    else if (entry.isFile() && entry.name === "package.json") roots.push(root)
  }
  return [...new Set(roots)].sort()
}

function sameSet(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function failInput(message: string): never {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify({
      schema_version: staticInputsSchemaVersion,
      ok: false,
      static_inputs_sha256: null,
      inputs: orderedStaticInputs(),
      issues: [message],
    })}\n`)
  }
  console.error(`RD Replay static consistency violations:\n${message}`)
  process.exit(1)
}

function recordContentInput(path: string, role: string, source: string): void {
  const normalized = normalize(path).replace(/\\/g, "/")
  if (isAbsolute(normalized)) return
  staticInputs.set(normalized, {
    role,
    path: normalized,
    kind: "content",
    sha256: sha256(source),
  })
}

function recordExistenceInput(path: string, role: string, exists: boolean): void {
  const normalized = normalize(path).replace(/\\/g, "/")
  if (isAbsolute(normalized) || staticInputs.get(normalized)?.kind === "content") return
  staticInputs.set(normalized, { role, path: normalized, kind: "existence", exists })
}

function orderedStaticInputs(): StaticInputIdentity[] {
  return [...staticInputs.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function finish(): void {
  const inputs = orderedStaticInputs()
  const staticInputsSha256 = sha256(stableJson({
    schema_version: staticInputsSchemaVersion,
    inputs,
  }))
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify({
      schema_version: staticInputsSchemaVersion,
      ok: issues.length === 0,
      static_inputs_sha256: staticInputsSha256,
      inputs,
      issues,
    })}\n`)
  }
  if (issues.length > 0) {
    console.error(`RD Replay static consistency violations:\n${issues.join("\n")}`)
    process.exit(1)
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}
