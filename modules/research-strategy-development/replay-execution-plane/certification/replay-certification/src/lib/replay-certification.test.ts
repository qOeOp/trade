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
})
