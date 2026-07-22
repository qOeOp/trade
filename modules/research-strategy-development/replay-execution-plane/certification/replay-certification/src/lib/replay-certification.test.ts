import { describe, expect, test } from "bun:test"
import {
  assertReplayCertificationManifest,
  assertReplayProfileEvidenceManifest,
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
    bundle.profiles[0]!.entrypoint_source_sha256 = "0".repeat(64)
    expect(() => assertReplayCrossProcessReproducibilityBundle(
      bundle,
      loadReplayProfileEvidenceManifest(repoRoot),
      repoRoot,
    )).toThrow("entrypoint source drifted")
  })

  test("freezes the read-only P10/P11/P13 historical Artifact migration", () => {
    const registry = loadReplayHistoricalArtifactMigrationRegistry(repoRoot)
    expect(() => assertReplayHistoricalArtifactMigrationRegistry(registry, repoRoot)).not.toThrow()
    expect(registry.historical_artifacts.map((entry) => entry.milestone)).toEqual([
      "M4-P10", "M4-P11", "M4-P13",
    ])
  })

  test("rejects historical Artifact reader drift", () => {
    const registry = structuredClone(loadReplayHistoricalArtifactMigrationRegistry(repoRoot))
    registry.reader_source_sha256 = "0".repeat(64)
    expect(() => assertReplayHistoricalArtifactMigrationRegistry(registry, repoRoot))
      .toThrow("reader source drifted")
  })
})
