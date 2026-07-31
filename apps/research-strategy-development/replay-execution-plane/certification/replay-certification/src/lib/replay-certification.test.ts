import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertReplayCertificationManifest,
  assertReplayProfileEvidenceManifest,
  assertReplayRunnerCertificationScripts,
  replayCertificationCommand,
  discoverReplayPackageRoots,
  findReplayCertificationRepoRoot,
  loadReplayCertificationManifest,
  loadReplayProfileEvidenceManifest,
} from "./replay-certification"
import {
  assertReplayModuleConsumerClosureManifest,
  discoverReplayModuleConsumerClosure,
  loadReplayModuleConsumerClosureManifest,
} from "./replay-module-consumer-closure"
import {
  assertReplayCrossProcessReproducibilityBundle,
  loadReplayCrossProcessReproducibilityBundle,
  runReplayCrossProcessReproducibilityBundle,
} from "./replay-cross-process-reproducibility"
import {
  assertReplayHistoricalArtifactMigrationRegistry,
  loadReplayHistoricalArtifactMigrationRegistry,
} from "./replay-historical-artifact-migration"
import {
  assertReplayPublicationCrashRecoveryBundle,
  loadReplayPublicationCrashRecoveryBundle,
  runReplayPublicationCrashRecoveryProbe,
} from "./replay-publication-crash-recovery"
import {
  assertReplayCapacityPerformanceEnvelope,
  loadReplayCapacityPerformanceEnvelope,
  runReplayCapacityPerformanceProbe,
} from "./replay-capacity-performance-envelope"
import {
  assertReplayFaultCorruptionRecoveryBundle,
  loadReplayFaultCorruptionRecoveryBundle,
  runReplayFaultCorruptionRecoveryProbe,
} from "./replay-fault-corruption-recovery"
import {
  assertReplayOperationalReadinessRegistry,
  loadReplayOperationalReadinessRegistry,
} from "./replay-operational-readiness"
import {
  assertReplayReleaseCandidateFixturePack,
  loadReplayReleaseCandidateFixturePack,
  runReplayReleaseCandidateFixtureProbe,
} from "./replay-release-candidate-fixture-pack"

describe("Replay certification owner", () => {
  const repoRoot = findReplayCertificationRepoRoot()

  test("classifies every Plane package once and keeps canonical/compatibility separate", () => {
    const manifest = loadReplayCertificationManifest(repoRoot)
    expect(() => assertReplayCertificationManifest(manifest, repoRoot)).not.toThrow()
    expect(manifest.suites.filter((suite) => suite.classification === "canonical")).toHaveLength(9)
    expect(manifest.suites.filter((suite) => suite.classification === "compatibility")).toHaveLength(13)
    expect(discoverReplayPackageRoots(repoRoot)).toHaveLength(23)
  })

  test("rejects an unclassified package", () => {
    const manifest = structuredClone(loadReplayCertificationManifest(repoRoot))
    manifest.suites.pop()
    expect(() => assertReplayCertificationManifest(manifest, repoRoot))
      .toThrow("classify every Plane package exactly once")
  })

  test("full certification runs the runner semantic suite", () => {
    expect(replayCertificationCommand(
      "apps/research-strategy-development/replay-execution-plane/runner",
    )).toEqual(["bun", "run", "test:release"])
    expect(replayCertificationCommand(
      "apps/research-strategy-development/replay-execution-plane/accounting",
    )).toEqual(["bun", "run", "check"])
    const runnerPackage = JSON.parse(readFileSync(join(
      repoRoot,
      "apps/research-strategy-development/replay-execution-plane/runner/package.json",
    ), "utf8")) as { scripts: Record<string, string> }
    expect(() => assertReplayRunnerCertificationScripts(runnerPackage.scripts)).not.toThrow()
    runnerPackage.scripts["test:worker-v10"] = "bun test ./src/lib/other.test.ts"
    expect(() => assertReplayRunnerCertificationScripts(runnerPackage.scripts))
      .toThrow("Replay runner certification script drifted: test:worker-v10")
  })

  test("binds every public profile to golden, resume, idempotency and tamper evidence", () => {
    const manifest = loadReplayProfileEvidenceManifest(repoRoot)
    expect(() => assertReplayProfileEvidenceManifest(manifest, repoRoot)).not.toThrow()
    expect(manifest.profiles.map((entry) => entry.profile)).toEqual([
      "independent-lane-batch",
      "integrated-portfolio",
      "single-trial",
      "terminal-aware-bounded-cycle",
    ])
    expect(manifest.profiles.filter((entry) =>
      entry.evidence.resume.kind === "explicit-not-supported").map((entry) => entry.profile)).toEqual([
      "integrated-portfolio",
      "terminal-aware-bounded-cycle",
    ])
  })

  test("rejects unsupported checkpoint claims without the frozen checkpoint mode", () => {
    const manifest = structuredClone(loadReplayProfileEvidenceManifest(repoRoot))
    manifest.profiles[0]!.evidence.resume = { kind: "explicit-not-supported" }
    expect(() => assertReplayProfileEvidenceManifest(manifest, repoRoot))
      .toThrow("explicit unsupported evidence is invalid")
  })

  test("discovers every Replay module and production consumer edge deterministically", () => {
    const first = discoverReplayModuleConsumerClosure(repoRoot)
    const second = discoverReplayModuleConsumerClosure(repoRoot)
    expect(first).toEqual(second)
    expect(first.modules).toHaveLength(23)
    expect(new Set(first.modules.map((entry) => entry.package_path))).toHaveLength(23)
    expect(first.production_consumer_edges.length).toBeGreaterThan(0)
  }, 15_000)

  test("rejects module or production consumer closure drift", () => {
    const manifest = loadReplayModuleConsumerClosureManifest(repoRoot)
    expect(() => assertReplayModuleConsumerClosureManifest(manifest, repoRoot)).not.toThrow()
    const drifted = structuredClone(manifest)
    drifted.observed_production_consumer_edge_count -= 1
    expect(() => assertReplayModuleConsumerClosureManifest(drifted, repoRoot))
      .toThrow("classify every production consumer edge")
  }, 15_000)

  test("reproduces canonical Result and every public profile in distinct processes", async () => {
    const bundle = loadReplayCrossProcessReproducibilityBundle(repoRoot)
    const receipt = await runReplayCrossProcessReproducibilityBundle(
      bundle,
      loadReplayProfileEvidenceManifest(repoRoot),
      repoRoot,
    )
    expect(receipt.bundle_sha256).toBe(bundle.bundle_sha256)
    expect(receipt.canonical_result.member_process_ids[0])
      .not.toBe(receipt.canonical_result.member_process_ids[1])
    expect(receipt.canonical_result.input_hash)
      .toBe(bundle.canonical_result_probe.expected_input_hash)
    expect(receipt.canonical_result.result_hash)
      .toBe(bundle.canonical_result_probe.expected_result_hash)
    expect(receipt.profiles).toHaveLength(4)
    expect(receipt.profiles.every((entry) =>
      entry.process_ids[0] !== entry.process_ids[1]
      && entry.exit_codes.every((code) => code === 0))).toBe(true)
    expect(receipt.receipt_sha256).toHaveLength(64)
  }, 60_000)

  test("rejects reproducibility bundle tamper before process launch", () => {
    const bundle = structuredClone(loadReplayCrossProcessReproducibilityBundle(repoRoot))
    bundle.profiles[0]!.entrypoint_export = "missingReplayEntrypoint"
    expect(() => assertReplayCrossProcessReproducibilityBundle(
      bundle,
      loadReplayProfileEvidenceManifest(repoRoot),
      repoRoot,
    )).toThrow("profile authority drifted")
  })

  test("freezes the read-only P10/P11/P13 historical Artifact migration", () => {
    const registry = loadReplayHistoricalArtifactMigrationRegistry(repoRoot)
    expect(() => assertReplayHistoricalArtifactMigrationRegistry(registry, repoRoot)).not.toThrow()
    expect(registry.historical_artifacts.map((entry) => entry.milestone)).toEqual([
      "M4-P10", "M4-P11", "M4-P13",
    ])
  })

  test("rejects historical Artifact reader identity drift", () => {
    const registry = structuredClone(loadReplayHistoricalArtifactMigrationRegistry(repoRoot))
    registry.reader_export = "missingHistoricalReader"
    expect(() => assertReplayHistoricalArtifactMigrationRegistry(registry, repoRoot))
      .toThrow("reader export is missing")
  })

  test("recovers a hard-crashed payload-only publication into one authoritative manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "replay-publication-crash-recovery-"))
    try {
      const bundle = loadReplayPublicationCrashRecoveryBundle(repoRoot)
      const receipt = await runReplayPublicationCrashRecoveryProbe(
        bundle,
        loadReplayProfileEvidenceManifest(repoRoot),
        repoRoot,
        root,
      )
      expect(receipt.orphan_payload_count).toBe(3)
      expect(receipt.orphan_manifest_present).toBe(false)
      expect(receipt.recovery_process_ids[0]).not.toBe(receipt.recovery_process_ids[1])
      expect(receipt.committed_manifest_count).toBe(1)
      expect(receipt.post_recovery_idempotent_read).toBe(true)
      expect(receipt.remaining_temporary_file_count).toBe(0)
      expect(receipt.receipt_sha256).toHaveLength(64)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 15_000)

  test("rejects publication recovery scope or writer identity drift", () => {
    const bundle = structuredClone(loadReplayPublicationCrashRecoveryBundle(repoRoot))
    bundle.exactly_once_scope = "one-process-execution" as never
    expect(() => assertReplayPublicationCrashRecoveryBundle(
      bundle,
      loadReplayProfileEvidenceManifest(repoRoot),
      repoRoot,
    )).toThrow("unsupported Replay publication crash recovery bundle")

    const writerDrift = structuredClone(loadReplayPublicationCrashRecoveryBundle(repoRoot))
    writerDrift.profiles[0]!.writer_export = "missingReplayWriter"
    expect(() => assertReplayPublicationCrashRecoveryBundle(
      writerDrift,
      loadReplayProfileEvidenceManifest(repoRoot),
      repoRoot,
    )).toThrow("profile policy drifted")
  })

  test("certifies the declared capacity workload and current-host performance envelope", async () => {
    const envelope = loadReplayCapacityPerformanceEnvelope(repoRoot)
    const receipt = await runReplayCapacityPerformanceProbe(
      envelope,
      loadReplayProfileEvidenceManifest(repoRoot),
      repoRoot,
    )
    expect(receipt.profiles.map((profile) => profile.profile)).toEqual([
      "independent-lane-batch",
      "integrated-portfolio",
      "single-trial",
      "terminal-aware-bounded-cycle",
    ])
    expect(receipt.profiles.every((profile) =>
      profile.process_ids[0] !== profile.process_ids[1]
      && profile.maximum_elapsed_ms <= profile.regression_ceiling_ms)).toBe(true)
    expect(receipt.host_observation.logical_cpu_count).toBeGreaterThan(0)
    expect(receipt.receipt_sha256).toHaveLength(64)
  }, 90_000)

  test("rejects capacity, SLA, or runtime-limit overclaims", () => {
    const profileEvidence = loadReplayProfileEvidenceManifest(repoRoot)
    const capacityOverclaim = structuredClone(loadReplayCapacityPerformanceEnvelope(repoRoot))
    capacityOverclaim.profiles[0]!.certified_workload[1]!.count = 20
    expect(() => assertReplayCapacityPerformanceEnvelope(
      capacityOverclaim, profileEvidence, repoRoot,
    )).toThrow("profile overclaim or drift")

    const slaOverclaim = structuredClone(loadReplayCapacityPerformanceEnvelope(repoRoot))
    slaOverclaim.timing_policy = "portable-performance-sla" as never
    expect(() => assertReplayCapacityPerformanceEnvelope(
      slaOverclaim, profileEvidence, repoRoot,
    )).toThrow("unsupported Replay capacity/performance envelope")

    const hardLimitOverclaim = structuredClone(loadReplayCapacityPerformanceEnvelope(repoRoot))
    hardLimitOverclaim.profiles[3]!.runtime_hard_limits[0]!.maximum = 80
    expect(() => assertReplayCapacityPerformanceEnvelope(
      hardLimitOverclaim, profileEvidence, repoRoot,
    )).toThrow("profile overclaim or drift")
  })

  test("certifies fault injection, corruption detection, authority and bounded recovery", async () => {
    const bundle = loadReplayFaultCorruptionRecoveryBundle(repoRoot)
    const receipt = await runReplayFaultCorruptionRecoveryProbe(
      bundle,
      loadReplayProfileEvidenceManifest(repoRoot),
      repoRoot,
    )
    expect(receipt.cases).toHaveLength(8)
    expect(new Set(receipt.cases.map((entry) => entry.profile))).toEqual(new Set([
      "single-trial",
      "independent-lane-batch",
      "integrated-portfolio",
      "terminal-aware-bounded-cycle",
    ]))
    expect(new Set(receipt.cases.map((entry) => entry.process_id)).size).toBe(8)
    expect(receipt.cases.filter((entry) =>
      entry.recovery_class === "manifest-last-identical-retry")).toHaveLength(1)
    expect(receipt.receipt_sha256).toHaveLength(64)
  }, 120_000)

  test("rejects fault coverage, repair, or recovery overclaims", () => {
    const profileEvidence = loadReplayProfileEvidenceManifest(repoRoot)
    const missingCase = structuredClone(loadReplayFaultCorruptionRecoveryBundle(repoRoot))
    missingCase.cases.pop()
    expect(() => assertReplayFaultCorruptionRecoveryBundle(
      missingCase, profileEvidence, repoRoot,
    )).toThrow("case matrix is incomplete")

    const repairOverclaim = structuredClone(loadReplayFaultCorruptionRecoveryBundle(repoRoot))
    repairOverclaim.corruption_policy = "detect-and-automatically-repair" as never
    expect(() => assertReplayFaultCorruptionRecoveryBundle(
      repairOverclaim, profileEvidence, repoRoot,
    )).toThrow("unsupported Replay fault/corruption recovery bundle")

    const recoveryOverclaim = structuredClone(loadReplayFaultCorruptionRecoveryBundle(repoRoot))
    recoveryOverclaim.cases[2]!.recovery_class = "manifest-last-identical-retry"
    expect(() => assertReplayFaultCorruptionRecoveryBundle(
      recoveryOverclaim, profileEvidence, repoRoot,
    )).toThrow("case overclaim or drift")
  })

  test("freezes operational observability, incident triage and the operator runbook", () => {
    const registry = loadReplayOperationalReadinessRegistry(repoRoot)
    expect(() => assertReplayOperationalReadinessRegistry(
      registry,
      loadReplayProfileEvidenceManifest(repoRoot),
      repoRoot,
    )).not.toThrow()
    expect(registry.profile_observability).toHaveLength(4)
    expect(registry.incident_classes).toHaveLength(6)
    expect(registry.operator_commands).toHaveLength(4)
  })

  test("rejects telemetry, retry, partial-evidence or runbook overclaims", () => {
    const profileEvidence = loadReplayProfileEvidenceManifest(repoRoot)
    const telemetryOverclaim = structuredClone(loadReplayOperationalReadinessRegistry(repoRoot))
    telemetryOverclaim.telemetry_boundary = "central-production-observability-complete" as never
    expect(() => assertReplayOperationalReadinessRegistry(
      telemetryOverclaim, profileEvidence, repoRoot,
    )).toThrow("unsupported Replay operational readiness registry")

    const retryOverclaim = structuredClone(loadReplayOperationalReadinessRegistry(repoRoot))
    retryOverclaim.incident_classes[2]!.retry_policy = "retry-until-success"
    expect(() => assertReplayOperationalReadinessRegistry(
      retryOverclaim, profileEvidence, repoRoot,
    )).toThrow("incident triage drifted or overclaimed retry")

    const partialOverclaim = structuredClone(loadReplayOperationalReadinessRegistry(repoRoot))
    partialOverclaim.profile_observability[0]!.partial_evidence_policy = "partial-result-is-usable"
    expect(() => assertReplayOperationalReadinessRegistry(
      partialOverclaim, profileEvidence, repoRoot,
    )).toThrow("observability is incomplete or overclaimed")

    const runbookDrift = structuredClone(loadReplayOperationalReadinessRegistry(repoRoot))
    runbookDrift.runbook.required_sections.pop()
    expect(() => assertReplayOperationalReadinessRegistry(
      runbookDrift, profileEvidence, repoRoot,
    )).toThrow("runbook contract drifted")
  })

  test("freezes the release-candidate evidence closure and reruns every profile golden", async () => {
    const pack = loadReplayReleaseCandidateFixturePack(repoRoot)
    const receipt = await runReplayReleaseCandidateFixtureProbe(
      pack,
      loadReplayProfileEvidenceManifest(repoRoot),
      repoRoot,
    )
    expect(pack.components).toHaveLength(12)
    expect(receipt.profiles.map((entry) => entry.profile)).toEqual([
      "independent-lane-batch",
      "integrated-portfolio",
      "single-trial",
      "terminal-aware-bounded-cycle",
    ])
    expect(new Set(receipt.profiles.map((entry) => entry.process_id)).size).toBe(4)
    expect(receipt.component_set_hash).toHaveLength(64)
    expect(receipt.receipt_sha256).toHaveLength(64)
  }, 90_000)

  test("rejects incomplete, drifted, or release-verdict fixture packs", () => {
    const profileEvidence = loadReplayProfileEvidenceManifest(repoRoot)
    const incomplete = structuredClone(loadReplayReleaseCandidateFixturePack(repoRoot))
    incomplete.components.pop()
    expect(() => assertReplayReleaseCandidateFixturePack(
      incomplete, profileEvidence, repoRoot,
    )).toThrow("component closure is incomplete")

    const verdictOverclaim = structuredClone(loadReplayReleaseCandidateFixturePack(repoRoot))
    verdictOverclaim.verdict_policy = "fixture-pack-is-release-verdict" as never
    expect(() => assertReplayReleaseCandidateFixturePack(
      verdictOverclaim, profileEvidence, repoRoot,
    )).toThrow("unsupported Replay release candidate fixture pack")

    const authorityDrift = structuredClone(loadReplayReleaseCandidateFixturePack(repoRoot))
    authorityDrift.components[5]!.authority_hash = "0".repeat(64)
    expect(() => assertReplayReleaseCandidateFixturePack(
      authorityDrift, profileEvidence, repoRoot,
    )).toThrow("component authority hash drifted")

    const sourceDrift = structuredClone(loadReplayReleaseCandidateFixturePack(repoRoot))
    sourceDrift.profiles[0]!.golden_test_name = "missing golden assertion"
    expect(() => assertReplayReleaseCandidateFixturePack(
      sourceDrift, profileEvidence, repoRoot,
    )).toThrow("profile identity drifted")

    const assertionDrift = structuredClone(loadReplayReleaseCandidateFixturePack(repoRoot))
    Object.assign(assertionDrift.profiles[0]!, { golden_source_sha256: "0".repeat(64) })
    expect(() => assertReplayReleaseCandidateFixturePack(
      assertionDrift, profileEvidence, repoRoot,
    )).toThrow("profile source drifted")
  })
})
