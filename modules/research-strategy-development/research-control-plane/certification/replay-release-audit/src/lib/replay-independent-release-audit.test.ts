import { describe, expect, test } from "bun:test"
import {
  assertReplayIndependentReleaseAuditManifest,
  assertReplayIndependentReleaseAuditReceipt,
  findReplayReleaseAuditRepoRoot,
  loadReplayIndependentReleaseAuditManifest,
  loadReplayIndependentReleaseAuditReceipt,
  loadReplayMaturityForIndependentAudit,
} from "./replay-independent-release-audit"

describe("Replay independent release audit", () => {
  const repoRoot = findReplayReleaseAuditRepoRoot()

  test("validates the durable receipt from the independent dynamic M5 audit", () => {
    const manifest = loadReplayIndependentReleaseAuditManifest(repoRoot)
    expect(() => assertReplayIndependentReleaseAuditManifest(
      manifest,
      loadReplayMaturityForIndependentAudit(repoRoot),
      repoRoot,
    )).not.toThrow()
    const receipt = loadReplayIndependentReleaseAuditReceipt(repoRoot)
    expect(() => assertReplayIndependentReleaseAuditReceipt(receipt, manifest)).not.toThrow()
    expect(receipt.verdict).toBe("passed-within-declared-evidence-envelope")
    expect(receipt.negative_challenges).toEqual([
      { challenge: "component-content-tamper", outcome: "rejected" },
      { challenge: "component-authority-tamper", outcome: "rejected" },
      { challenge: "release-verdict-overclaim", outcome: "rejected" },
    ])
    expect(receipt.commands.map((command) => command.role)).toEqual([
      "subject-full-certification",
      "repository-audit-prerequisite-check",
    ])
    expect(new Set(receipt.commands.map((command) => command.process_id)).size).toBe(2)
    expect(receipt.commands.every((command) => command.exit_code === 0)).toBe(true)
    expect(receipt.receipt_sha256).toHaveLength(64)
  })

  test("rejects auditor capture, subject drift, and an incomplete M5 state", () => {
    const maturity = loadReplayMaturityForIndependentAudit(repoRoot)
    const captured = structuredClone(loadReplayIndependentReleaseAuditManifest(repoRoot))
    captured.owner = captured.subject.owner
    expect(() => assertReplayIndependentReleaseAuditManifest(captured, maturity, repoRoot))
      .toThrow("unsupported Replay independent release audit manifest")

    const drifted = structuredClone(loadReplayIndependentReleaseAuditManifest(repoRoot))
    drifted.subject.fixture_pack_content_sha256 = "0".repeat(64)
    expect(() => assertReplayIndependentReleaseAuditManifest(drifted, maturity, repoRoot))
      .toThrow("subject fixture-pack content drifted")

    const incomplete = structuredClone(maturity)
    incomplete.exit_gates.m5!.release_candidate_fixture_pack_frozen = false
    expect(() => assertReplayIndependentReleaseAuditManifest(
      loadReplayIndependentReleaseAuditManifest(repoRoot),
      incomplete,
      repoRoot,
    )).toThrow("prerequisite gate is not closed")

    const receiptTamper = structuredClone(loadReplayIndependentReleaseAuditReceipt(repoRoot))
    receiptTamper.verdict = "unbounded-production-release" as never
    expect(() => assertReplayIndependentReleaseAuditReceipt(
      receiptTamper,
      loadReplayIndependentReleaseAuditManifest(repoRoot),
    )).toThrow("unsupported Replay independent release audit receipt")
  })
})
