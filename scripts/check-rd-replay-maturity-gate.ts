#!/usr/bin/env bun

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs"
import { isAbsolute, normalize } from "node:path"
import {
  assertReplayModuleConsumerClosureManifest,
  loadReplayModuleConsumerClosureManifest,
} from "../modules/research-strategy-development/replay-execution-plane/certification/replay-certification/src/lib/replay-module-consumer-closure"
import {
  assertReplayCrossProcessReproducibilityBundle,
  loadReplayCrossProcessReproducibilityBundle,
} from "../modules/research-strategy-development/replay-execution-plane/certification/replay-certification/src/lib/replay-cross-process-reproducibility"
import {
  assertHistoricalArtifactReadMigrationFixturePack,
  loadHistoricalArtifactReadMigrationFixturePack,
} from "../modules/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification/src/lib/historical-artifact-read-migration"
import {
  assertReplayHistoricalArtifactMigrationRegistry,
  loadReplayHistoricalArtifactMigrationRegistry,
} from "../modules/research-strategy-development/replay-execution-plane/certification/replay-certification/src/lib/replay-historical-artifact-migration"
import {
  assertReplayPublicationCrashRecoveryBundle,
  loadReplayPublicationCrashRecoveryBundle,
} from "../modules/research-strategy-development/replay-execution-plane/certification/replay-certification/src/lib/replay-publication-crash-recovery"
import {
  assertReplayCapacityPerformanceEnvelope,
  loadReplayCapacityPerformanceEnvelope,
} from "../modules/research-strategy-development/replay-execution-plane/certification/replay-certification/src/lib/replay-capacity-performance-envelope"
import {
  assertReplayFaultCorruptionRecoveryBundle,
  loadReplayFaultCorruptionRecoveryBundle,
} from "../modules/research-strategy-development/replay-execution-plane/certification/replay-certification/src/lib/replay-fault-corruption-recovery"
import {
  assertReplayOperationalReadinessRegistry,
  loadReplayOperationalReadinessRegistry,
} from "../modules/research-strategy-development/replay-execution-plane/certification/replay-certification/src/lib/replay-operational-readiness"
import {
  assertReplayReleaseCandidateFixturePack,
  loadReplayReleaseCandidateFixturePack,
} from "../modules/research-strategy-development/replay-execution-plane/certification/replay-certification/src/lib/replay-release-candidate-fixture-pack"
import {
  assertReplayIndependentReleaseAuditManifest,
  assertReplayIndependentReleaseAuditReceipt,
  loadReplayIndependentReleaseAuditManifest,
  loadReplayIndependentReleaseAuditReceipt,
} from "../modules/research-strategy-development/research-control-plane/certification/replay-release-audit/src/lib/replay-independent-release-audit"

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

interface ReplayCertificationRegistry {
  schema_version: string
  owner: string
  execution_policy: string
  suites: Array<{
    classification: "canonical" | "compatibility"
    package_path: string
    package_name: string
  }>
}

type ReplayProfileEvidenceDimension = "golden" | "resume" | "idempotency" | "tamper"
type ReplayProfileEvidenceKind = "test" | "delegated-child-trial-test" | "explicit-not-supported"

interface ReplayProfileEvidenceRegistry {
  schema_version: string
  owner: string
  required_dimensions: ReplayProfileEvidenceDimension[]
  profiles: Array<{
    profile: string
    entrypoint_path: string
    entrypoint_export: string
    checkpoint_mode: string
    evidence: Record<ReplayProfileEvidenceDimension, {
      kind: ReplayProfileEvidenceKind
      path?: string
      test_name?: string
    }>
  }>
}

const manifestPath = process.env.RD_REPLAY_MATURITY_GATE_PATH || "docs/research/reliability/rd-replay-maturity-gate.json"
const auditPrerequisitesOnly = process.argv.includes("--audit-prerequisites")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as GateManifest
const inventoryPath = process.env.RD_REPLAY_CAPABILITY_INVENTORY_PATH
  || "docs/research/reliability/rd-replay-capability-inventory.json"
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as CapabilityInventory
const epochRegistryPath = process.env.RD_REPLAY_EVIDENCE_EPOCH_REGISTRY_PATH
  || "docs/research/reliability/rd-replay-evidence-epoch-registry.json"
const epochRegistry = JSON.parse(readFileSync(epochRegistryPath, "utf8")) as EvidenceEpochRegistry
const certificationOwner =
  "modules/research-strategy-development/replay-execution-plane/certification/replay-certification"
const certificationRegistryPath = process.env.RD_REPLAY_CERTIFICATION_REGISTRY_PATH
  || `${certificationOwner}/replay-certification-suites.json`
const certificationRegistry = JSON.parse(
  readFileSync(certificationRegistryPath, "utf8"),
) as ReplayCertificationRegistry
const profileEvidenceRegistryPath = process.env.RD_REPLAY_PROFILE_EVIDENCE_REGISTRY_PATH
  || `${certificationOwner}/replay-profile-evidence.json`
const profileEvidenceRegistry = JSON.parse(
  readFileSync(profileEvidenceRegistryPath, "utf8"),
) as ReplayProfileEvidenceRegistry
const moduleConsumerClosurePath = process.env.RD_REPLAY_MODULE_CONSUMER_CLOSURE_PATH
  || `${certificationOwner}/replay-module-consumer-closure.json`
const crossProcessReproducibilityPath = process.env.RD_REPLAY_CROSS_PROCESS_REPRODUCIBILITY_PATH
  || `${certificationOwner}/replay-cross-process-reproducibility-bundle.json`
const historicalArtifactReadMigrationPath =
  process.env.RD_REPLAY_HISTORICAL_ARTIFACT_READ_MIGRATION_PATH
  || "modules/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification/fixtures/historical-artifact-read-migration-v1.json"
const historicalArtifactMigrationRegistryPath =
  process.env.RD_REPLAY_HISTORICAL_ARTIFACT_MIGRATION_REGISTRY_PATH
  || `${certificationOwner}/replay-historical-artifact-migration.json`
const publicationCrashRecoveryBundlePath =
  process.env.RD_REPLAY_PUBLICATION_CRASH_RECOVERY_BUNDLE_PATH
  || `${certificationOwner}/replay-publication-crash-recovery-bundle.json`
const capacityPerformanceEnvelopePath =
  process.env.RD_REPLAY_CAPACITY_PERFORMANCE_ENVELOPE_PATH
  || `${certificationOwner}/replay-capacity-performance-envelope.json`
const faultCorruptionRecoveryBundlePath =
  process.env.RD_REPLAY_FAULT_CORRUPTION_RECOVERY_BUNDLE_PATH
  || `${certificationOwner}/replay-fault-corruption-recovery-bundle.json`
const operationalReadinessRegistryPath =
  process.env.RD_REPLAY_OPERATIONAL_READINESS_REGISTRY_PATH
  || `${certificationOwner}/replay-operational-readiness.json`
const releaseCandidateFixturePackPath =
  process.env.RD_REPLAY_RELEASE_CANDIDATE_FIXTURE_PACK_PATH
  || `${certificationOwner}/replay-release-candidate-fixture-pack.json`
const independentReleaseAuditPath =
  process.env.RD_REPLAY_INDEPENDENT_RELEASE_AUDIT_PATH
  || "modules/research-strategy-development/research-control-plane/certification/replay-release-audit/replay-independent-release-audit.json"
const independentReleaseAuditReceiptPath =
  process.env.RD_REPLAY_INDEPENDENT_RELEASE_AUDIT_RECEIPT_PATH
  || "modules/research-strategy-development/research-control-plane/certification/replay-release-audit/replay-independent-release-audit-receipt.json"
const issues: string[] = []
const certificationCommandIssues: string[] = []
const testSeparationIssues: string[] = []
const profileEvidenceIssues: string[] = []
const moduleConsumerClosureIssues: string[] = []
const crossProcessReproducibilityIssues: string[] = []
const historicalArtifactReadMigrationIssues: string[] = []
const publicationCrashRecoveryIssues: string[] = []
const capacityPerformanceEnvelopeIssues: string[] = []
const faultCorruptionRecoveryIssues: string[] = []
const operationalReadinessIssues: string[] = []
const releaseCandidateFixturePackIssues: string[] = []
const independentReleaseAuditIssues: string[] = []

try {
  const moduleConsumerClosure = loadReplayModuleConsumerClosureManifest(
    process.cwd(),
    moduleConsumerClosurePath,
  )
  assertReplayModuleConsumerClosureManifest(moduleConsumerClosure, process.cwd())
} catch (error) {
  moduleConsumerClosureIssues.push(error instanceof Error ? error.message : String(error))
}
try {
  const bundle = loadReplayCrossProcessReproducibilityBundle(
    process.cwd(),
    crossProcessReproducibilityPath,
  )
  assertReplayCrossProcessReproducibilityBundle(bundle, profileEvidenceRegistry, process.cwd())
} catch (error) {
  crossProcessReproducibilityIssues.push(error instanceof Error ? error.message : String(error))
}
try {
  const fixturePack = loadHistoricalArtifactReadMigrationFixturePack(
    historicalArtifactReadMigrationPath,
  )
  assertHistoricalArtifactReadMigrationFixturePack(fixturePack)
  const registry = loadReplayHistoricalArtifactMigrationRegistry(
    process.cwd(),
    historicalArtifactMigrationRegistryPath,
  )
  assertReplayHistoricalArtifactMigrationRegistry(registry, process.cwd())
} catch (error) {
  historicalArtifactReadMigrationIssues.push(error instanceof Error ? error.message : String(error))
}
try {
  const bundle = loadReplayPublicationCrashRecoveryBundle(
    process.cwd(),
    publicationCrashRecoveryBundlePath,
  )
  assertReplayPublicationCrashRecoveryBundle(bundle, profileEvidenceRegistry, process.cwd())
} catch (error) {
  publicationCrashRecoveryIssues.push(error instanceof Error ? error.message : String(error))
}
try {
  const envelope = loadReplayCapacityPerformanceEnvelope(
    process.cwd(),
    capacityPerformanceEnvelopePath,
  )
  assertReplayCapacityPerformanceEnvelope(envelope, profileEvidenceRegistry, process.cwd())
} catch (error) {
  capacityPerformanceEnvelopeIssues.push(error instanceof Error ? error.message : String(error))
}
try {
  const bundle = loadReplayFaultCorruptionRecoveryBundle(
    process.cwd(),
    faultCorruptionRecoveryBundlePath,
  )
  assertReplayFaultCorruptionRecoveryBundle(bundle, profileEvidenceRegistry, process.cwd())
} catch (error) {
  faultCorruptionRecoveryIssues.push(error instanceof Error ? error.message : String(error))
}
try {
  const registry = loadReplayOperationalReadinessRegistry(
    process.cwd(),
    operationalReadinessRegistryPath,
  )
  assertReplayOperationalReadinessRegistry(registry, profileEvidenceRegistry, process.cwd())
} catch (error) {
  operationalReadinessIssues.push(error instanceof Error ? error.message : String(error))
}
try {
  const pack = loadReplayReleaseCandidateFixturePack(
    process.cwd(),
    releaseCandidateFixturePackPath,
  )
  assertReplayReleaseCandidateFixturePack(pack, profileEvidenceRegistry, process.cwd())
} catch (error) {
  releaseCandidateFixturePackIssues.push(error instanceof Error ? error.message : String(error))
}
try {
  const audit = loadReplayIndependentReleaseAuditManifest(
    process.cwd(),
    independentReleaseAuditPath,
  )
  assertReplayIndependentReleaseAuditManifest(audit, manifest, process.cwd())
  if (!auditPrerequisitesOnly) {
    const receipt = loadReplayIndependentReleaseAuditReceipt(
      process.cwd(),
      independentReleaseAuditReceiptPath,
    )
    assertReplayIndependentReleaseAuditReceipt(receipt, audit)
  }
} catch (error) {
  independentReleaseAuditIssues.push(error instanceof Error ? error.message : String(error))
}

const expectedCapabilityMilestones = Array.from({ length: 29 }, (_, index) => `M4-P${index + 1}`)
const expectedCanonicalEntrypoints = [
  { profile: "single-trial", owner: "runner", path: "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.ts", export: "runReplayTrial" },
  { profile: "independent-lane-batch", owner: "runner", path: "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-independent-lane-batch-runner.ts", export: "runReplayIndependentLaneBatch" },
  { profile: "integrated-portfolio", owner: "runner", path: "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-integrated-portfolio-runner.ts", export: "runReplayIntegratedPortfolio" },
  { profile: "terminal-aware-bounded-cycle", owner: "runner", path: "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-portfolio-protective-terminal-cycle-sequence-runner.ts", export: "runReplayPortfolioProtectiveTerminalCycleSequence" },
]
const expectedGenericEpochs = [
  { kind: "result", schema_version: "trade.rd-replay-result.v53", path: "modules/research-strategy-development/replay-execution-plane/contracts/src/lib/replay-contracts.ts", export: "REPLAY_RESULT_SCHEMA_VERSION" },
  { kind: "artifact_manifest", schema_version: "trade.rd-replay-artifact-manifest.v55", path: "modules/research-strategy-development/replay-execution-plane/contracts/src/lib/replay-contracts.ts", export: "REPLAY_ARTIFACT_SCHEMA_VERSION" },
  { kind: "engine_checkpoint", schema_version: "trade.rd-replay-engine-checkpoint.v32", path: "modules/research-strategy-development/replay-execution-plane/engine/src/lib/replay-reference-engine.ts", export: "REPLAY_ENGINE_CHECKPOINT_SCHEMA_VERSION" },
  { kind: "diagnostic_checkpoint_commit", schema_version: "trade.rd-replay-diagnostic-checkpoint-commit.v2", path: "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.ts", export: "REPLAY_DIAGNOSTIC_CHECKPOINT_COMMIT_SCHEMA_VERSION" },
  { kind: "terminal_checkpoint", schema_version: "trade.rd-replay-terminal-checkpoint.v1", path: "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.ts", export: "REPLAY_TERMINAL_CHECKPOINT_SCHEMA_VERSION" },
  { kind: "run_outcome", schema_version: "trade.rd-replay-run-outcome.v35", path: "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-trial-runner.ts", export: "REPLAY_RUN_OUTCOME_SCHEMA_VERSION" },
]
const expectedProfileEpochs = [
  { profile: "single-trial", result_schema_version: "trade.rd-replay-result.v53", artifact_schema_version: "trade.rd-replay-artifact-manifest.v55", checkpoint_mode: "resumable-engine-checkpoint-v32" },
  { profile: "independent-lane-batch", result_schema_version: "trade.rd-replay-independent-lane-batch-result.v1", artifact_schema_version: "child-trial-artifact-manifests-v55", checkpoint_mode: "child-trial-engine-checkpoints-v32-only" },
  { profile: "integrated-portfolio", result_schema_version: "trade.rd-replay-integrated-portfolio-result.v1", artifact_schema_version: "trade.rd-replay-integrated-portfolio-artifact-manifest.v1", checkpoint_mode: "not-supported-no-checkpoint-writer" },
  { profile: "terminal-aware-bounded-cycle", result_schema_version: "trade.rd-replay-portfolio-protective-terminal-cycle-sequence-result.v1", artifact_schema_version: "trade.rd-replay-portfolio-protective-terminal-cycle-sequence-artifact-manifest.v1", checkpoint_mode: "not-supported-no-checkpoint-writer" },
]
if (inventory.schema_version !== "trade.rd-replay-capability-inventory.v1"
    || inventory.freeze !== "M4-P29" || inventory.p30_creation !== "forbidden") {
  issues.push("Replay capability inventory must remain frozen at M4-P29 with P30 forbidden")
}
if (epochRegistry.schema_version !== "trade.rd-replay-evidence-epoch-registry.v1"
    || epochRegistry.freeze !== "M4-CONVERGENCE"
    || epochRegistry.writer_policy.one_current_generic_epoch_per_kind !== true
    || epochRegistry.writer_policy.historical_generic_epoch_writes !== "forbidden"
    || epochRegistry.writer_policy.profile_specific_result_and_manifest
      !== "subordinate_evidence_not_competing_generic_epoch"
    || epochRegistry.writer_policy.checkpoint_absence
      !== "must_be_explicit_not_supported_never_invented_for_gate_completion") {
  issues.push("Replay evidence epoch registry policy is not frozen")
}
if (JSON.stringify(epochRegistry.generic_epochs) !== JSON.stringify(expectedGenericEpochs)) {
  issues.push("Replay generic Result/Artifact/Checkpoint epochs do not match the frozen writer set")
} else {
  for (const epoch of epochRegistry.generic_epochs) {
    if (!existsSync(epoch.path)
        || !readFileSync(epoch.path, "utf8").includes(
          `export const ${epoch.export} = "${epoch.schema_version}" as const`,
        )) {
      issues.push(`Replay generic evidence epoch is not exported by its declared owner: ${epoch.kind}`)
    }
  }
}
if (JSON.stringify(epochRegistry.profile_epochs) !== JSON.stringify(expectedProfileEpochs)) {
  issues.push("Replay public profile evidence epochs or checkpoint modes are not converged")
}
const requiredProfileEvidenceDimensions: ReplayProfileEvidenceDimension[] = [
  "golden", "resume", "idempotency", "tamper",
]
if (profileEvidenceRegistry.schema_version !== "trade.rd-replay-profile-evidence.v1"
    || profileEvidenceRegistry.owner !== certificationOwner
    || JSON.stringify(profileEvidenceRegistry.required_dimensions)
      !== JSON.stringify(requiredProfileEvidenceDimensions)) {
  profileEvidenceIssues.push("Replay profile evidence registry policy is not frozen")
}
if (canonicalArray(profileEvidenceRegistry.profiles.map((entry) => entry.profile))
    !== canonicalArray(expectedCanonicalEntrypoints.map((entry) => entry.profile))
    || new Set(profileEvidenceRegistry.profiles.map((entry) => entry.profile)).size
      !== profileEvidenceRegistry.profiles.length) {
  profileEvidenceIssues.push("Replay profile evidence registry must cover each public profile exactly once")
}
for (const entry of profileEvidenceRegistry.profiles) {
  const entrypoint = expectedCanonicalEntrypoints.find((candidate) => candidate.profile === entry.profile)
  const epoch = expectedProfileEpochs.find((candidate) => candidate.profile === entry.profile)
  if (!entrypoint || !epoch || entry.entrypoint_path !== entrypoint.path
      || entry.entrypoint_export !== entrypoint.export || entry.checkpoint_mode !== epoch.checkpoint_mode) {
    profileEvidenceIssues.push(`Replay profile evidence authority or checkpoint mode drifted: ${entry.profile}`)
    continue
  }
  if (JSON.stringify(Object.keys(entry.evidence).sort())
      !== JSON.stringify([...requiredProfileEvidenceDimensions].sort())) {
    profileEvidenceIssues.push(`Replay profile evidence dimensions are incomplete: ${entry.profile}`)
    continue
  }
  for (const dimension of requiredProfileEvidenceDimensions) {
    const evidence = entry.evidence[dimension]
    if (evidence.kind === "explicit-not-supported") {
      if (dimension !== "resume" || entry.checkpoint_mode !== "not-supported-no-checkpoint-writer"
          || evidence.path !== undefined || evidence.test_name !== undefined) {
        profileEvidenceIssues.push(`Replay explicit unsupported evidence is invalid: ${entry.profile}.${dimension}`)
      }
      continue
    }
    if ((evidence.kind !== "test" && evidence.kind !== "delegated-child-trial-test")
        || !evidence.path?.endsWith(".test.ts") || !evidence.test_name || !existsSync(evidence.path)
        || !readFileSync(evidence.path, "utf8").includes(`test(${JSON.stringify(evidence.test_name)}`)) {
      profileEvidenceIssues.push(`Replay profile test evidence is missing: ${entry.profile}.${dimension}`)
      continue
    }
    if (evidence.kind === "delegated-child-trial-test"
        && (dimension !== "resume" || entry.checkpoint_mode !== "child-trial-engine-checkpoints-v32-only")) {
      profileEvidenceIssues.push(`Replay delegated resume evidence is invalid: ${entry.profile}`)
    }
  }
  const resumeKind = entry.evidence.resume.kind
  if ((entry.checkpoint_mode === "resumable-engine-checkpoint-v32" && resumeKind !== "test")
      || (entry.checkpoint_mode === "child-trial-engine-checkpoints-v32-only"
        && resumeKind !== "delegated-child-trial-test")
      || (entry.checkpoint_mode === "not-supported-no-checkpoint-writer"
        && resumeKind !== "explicit-not-supported")) {
    profileEvidenceIssues.push(`Replay resume evidence does not match checkpoint mode: ${entry.profile}`)
  }
}
const genericEpochPatterns = expectedGenericEpochs.map((epoch) => ({
  kind: epoch.kind,
  expected: epoch.schema_version,
  pattern: new RegExp(`${escapeRegExp(epoch.schema_version.replace(/v\d+$/, "v"))}\\d+`, "g"),
}))
const replaySourceRoot = "modules/research-strategy-development/replay-execution-plane"
const productionReplaySources = collectTypeScriptSources(replaySourceRoot)
  .filter((path) => !path.endsWith(".test.ts"))
for (const epoch of genericEpochPatterns) {
  const observed = new Set<string>()
  for (const path of productionReplaySources) {
    for (const match of readFileSync(path, "utf8").matchAll(epoch.pattern)) observed.add(match[0])
  }
  if (JSON.stringify([...observed].sort()) !== JSON.stringify([epoch.expected])) {
    issues.push(`Replay ${epoch.kind} production writers expose non-current generic epochs: ${[...observed].sort().join(",")}`)
  }
}
if (certificationRegistry.schema_version !== "trade.rd-replay-certification-suites.v1"
    || certificationRegistry.owner !== certificationOwner
    || certificationRegistry.execution_policy !== "sorted-sequential-fail-fast-package-check") {
  certificationCommandIssues.push("Replay certification registry policy is not frozen")
}
const certificationPackagePaths = certificationRegistry.suites.map((suite) => suite.package_path)
if (new Set(certificationPackagePaths).size !== certificationPackagePaths.length) {
  certificationCommandIssues.push("Replay certification registry contains duplicate package owners")
}
const replayPackageRoots = collectPackageRoots(replaySourceRoot)
const expectedCertifiedPackageRoots = replayPackageRoots.filter((path) => path !== certificationOwner)
if (canonicalArray(certificationPackagePaths) !== canonicalArray(expectedCertifiedPackageRoots)) {
  certificationCommandIssues.push("Replay certification registry must classify every Plane package exactly once")
}
const certifyOwners: string[] = []
for (const packageRoot of replayPackageRoots) {
  const packageJson = JSON.parse(readFileSync(`${packageRoot}/package.json`, "utf8")) as {
    name?: string
    scripts?: Record<string, string>
  }
  const suite = certificationRegistry.suites.find((entry) => entry.package_path === packageRoot)
  if (packageRoot !== certificationOwner
      && (!suite || suite.package_name !== packageJson.name || !packageJson.scripts?.check)) {
    certificationCommandIssues.push(`Replay certification suite owner is invalid: ${packageRoot}`)
  }
  if (packageJson.scripts?.certify) certifyOwners.push(packageRoot)
}
const certificationOwnerPackage = JSON.parse(
  readFileSync(`${certificationOwner}/package.json`, "utf8"),
) as { scripts?: Record<string, string> }
if (JSON.stringify(certifyOwners) !== JSON.stringify([certificationOwner])
    || certificationOwnerPackage.scripts?.certify !== "bun src/scripts/main.ts --suite all"
    || !existsSync(`${certificationOwner}/src/scripts/main.ts`)) {
  certificationCommandIssues.push("Replay Plane must expose exactly one fail-closed certification command owner")
}
for (const suite of certificationRegistry.suites) {
  const compatibilityPath = suite.package_path.includes("/compatibility/")
    || suite.package_path.includes("/certification/legacy-")
  if ((suite.classification === "compatibility") !== compatibilityPath) {
    certificationCommandIssues.push(`Replay certification classification/path mismatch: ${suite.package_path}`)
  }
}
const canonicalTestSources = certificationRegistry.suites
  .filter((suite) => suite.classification === "canonical")
  .flatMap((suite) => collectTypeScriptSources(suite.package_path))
  .filter((path) => path.endsWith(".test.ts"))
for (const path of canonicalTestSources) {
  const source = readFileSync(path, "utf8")
  if (source.includes("/compatibility/") || source.includes("legacy-portfolio-cycle")) {
    testSeparationIssues.push(`canonical Replay test imports compatibility evidence: ${path}`)
  }
}
const legacyCycleCertificationTest =
  "modules/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification/src/lib/legacy-portfolio-cycle-certification.test.ts"
const legacyCycleCertificationSource = existsSync(legacyCycleCertificationTest)
  ? readFileSync(legacyCycleCertificationTest, "utf8")
  : ""
for (const expectedConsumer of [
  "runReplayPortfolioReallocation",
  "runReplayTwoCyclePortfolio",
  "runReplayPortfolioCycleSequenceAccounting",
]) {
  if (!legacyCycleCertificationSource.includes(expectedConsumer)) {
    testSeparationIssues.push(`legacy portfolio cycle certification does not cover ${expectedConsumer}`)
  }
}
if (!legacyCycleCertificationSource.includes("compatibility/legacy-portfolio-cycle")) {
  testSeparationIssues.push("legacy portfolio cycle certification does not own the compatibility import boundary")
}
issues.push(
  ...certificationCommandIssues,
  ...testSeparationIssues,
  ...profileEvidenceIssues,
  ...moduleConsumerClosureIssues,
  ...crossProcessReproducibilityIssues,
  ...historicalArtifactReadMigrationIssues,
  ...publicationCrashRecoveryIssues,
  ...capacityPerformanceEnvelopeIssues,
  ...faultCorruptionRecoveryIssues,
  ...operationalReadinessIssues,
  ...releaseCandidateFixturePackIssues,
  ...independentReleaseAuditIssues,
)
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
const compatibilityMilestones = inventory.entries
  .filter((entry) => entry.classification === "compatibility")
  .map((entry) => entry.milestone)
const compatibilityRoot = "modules/research-strategy-development/replay-execution-plane/compatibility/legacy-portfolio-cycle/"
if (canonicalArray(inventory.compatibility_consumer_registry.map((entry) => entry.milestone))
    !== canonicalArray(compatibilityMilestones)
    || new Set(inventory.compatibility_consumer_registry.map((entry) => entry.milestone)).size
      !== inventory.compatibility_consumer_registry.length) {
  issues.push("Replay compatibility consumer registry must cover each compatibility capability exactly once")
}
for (const consumer of inventory.compatibility_consumer_registry) {
  if (consumer.owner !== "legacy-portfolio-cycle" || !consumer.path.startsWith(compatibilityRoot)
      || !existsSync(consumer.path)
      || !readFileSync(consumer.path, "utf8").includes(`export function ${consumer.export}`)) {
    issues.push(`Replay compatibility consumer is not isolated under its declared owner: ${consumer.milestone}`)
  }
}
for (const formerPath of [
  "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-portfolio-reallocation-runner.ts",
  "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-two-cycle-portfolio-runner.ts",
  "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-portfolio-cycle-sequence-accounting-runner.ts",
  "modules/research-strategy-development/replay-execution-plane/accounting/src/lib/replay-portfolio-cycle-sequence-accounting.ts",
]) {
  if (existsSync(formerPath)) issues.push(`Replay compatibility consumer remains in a canonical owner: ${formerPath}`)
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
  const pendingAuditReceipt = auditPrerequisitesOnly
    && normalized === normalize(independentReleaseAuditReceiptPath).replace(/\\/g, "/")
  if ((!existsSync(normalized) || !lstatSync(normalized).isFile()) && !pendingAuditReceipt) {
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
if (manifest.exit_gates.m4?.single_owner_certification_command
    !== (certificationCommandIssues.length === 0)) {
  issues.push("Replay single-owner certification gate does not match executable registry evidence")
}
if (manifest.exit_gates.m4?.canonical_and_compatibility_test_suites_separated
    !== (testSeparationIssues.length === 0)) {
  issues.push("Replay canonical/compatibility test separation gate does not match source evidence")
}
if (manifest.exit_gates.m4?.all_supported_profiles_have_golden_resume_idempotency_and_tamper_evidence
    !== (profileEvidenceIssues.length === 0)) {
  issues.push("Replay public-profile evidence gate does not match the certified evidence registry")
}
if (manifest.exit_gates.m4?.no_unclassified_replay_module_or_production_consumer
    !== (moduleConsumerClosureIssues.length === 0)) {
  issues.push("Replay module/production-consumer gate does not match the certified closure registry")
}
if (manifest.exit_gates.m5?.cross_process_reproducibility_bundle
    !== (crossProcessReproducibilityIssues.length === 0)) {
  issues.push("Replay cross-process reproducibility gate does not match the certified bundle")
}
if (manifest.exit_gates.m5?.historical_artifact_read_migration_certified
    !== (historicalArtifactReadMigrationIssues.length === 0)) {
  issues.push("Replay historical Artifact read migration gate does not match the certified fixture pack")
}
if (manifest.exit_gates.m5?.crash_recovery_and_exactly_once_publication_certified
    !== (publicationCrashRecoveryIssues.length === 0)) {
  issues.push("Replay crash recovery/exactly-once publication gate does not match the certified bundle")
}
if (manifest.exit_gates.m5?.declared_capacity_and_performance_envelope_certified
    !== (capacityPerformanceEnvelopeIssues.length === 0)) {
  issues.push("Replay capacity/performance gate does not match the certified envelope")
}
if (manifest.exit_gates.m5?.fault_injection_and_corruption_recovery_certified
    !== (faultCorruptionRecoveryIssues.length === 0)) {
  issues.push("Replay fault/corruption recovery gate does not match the certified bundle")
}
if (manifest.exit_gates.m5?.operational_observability_and_runbook_complete
    !== (operationalReadinessIssues.length === 0)) {
  issues.push("Replay operational observability/runbook gate does not match the certified registry")
}
if (manifest.exit_gates.m5?.release_candidate_fixture_pack_frozen
    !== (releaseCandidateFixturePackIssues.length === 0)) {
  issues.push("Replay release candidate fixture-pack gate does not match the frozen evidence closure")
}
if (manifest.exit_gates.m5?.independent_release_audit_passed
    !== (independentReleaseAuditIssues.length === 0)) {
  issues.push("Replay independent release-audit gate does not match the external auditor evidence")
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

function collectTypeScriptSources(root: string): string[] {
  const sources: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = `${root}/${entry.name}`
    if (entry.isDirectory()) sources.push(...collectTypeScriptSources(path))
    else if (entry.isFile() && path.endsWith(".ts")) sources.push(path)
  }
  return sources
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

if (issues.length > 0) {
  console.error(`RD Replay maturity gate violations:\n${issues.join("\n")}`)
  process.exit(1)
}
