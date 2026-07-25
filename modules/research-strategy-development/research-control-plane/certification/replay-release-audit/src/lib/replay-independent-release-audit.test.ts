import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assertReplayIndependentReleaseAuditManifest,
  assertReplayIndependentReleaseAuditReceipt,
  findReplayReleaseAuditRepoRoot,
  loadReplayIndependentReleaseAuditManifest,
  loadReplayIndependentReleaseAuditReceipt,
  loadReplayMaturityForIndependentAudit,
  runReplayIndependentAuditCommand,
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

    const auditorDrift = structuredClone(loadReplayIndependentReleaseAuditManifest(repoRoot))
    Object.assign(auditorDrift.source_bindings[0]!, { sha256: "0".repeat(64) })
    expect(() => assertReplayIndependentReleaseAuditManifest(auditorDrift, maturity, repoRoot))
      .toThrow("independent audit source drifted")

    for (const role of ["release-gate-entry", "exclusive-test-runner"]) {
      const executionDrift = structuredClone(loadReplayIndependentReleaseAuditManifest(repoRoot))
      const binding = executionDrift.source_bindings.find((item) => item.role === role)
      expect(binding).toBeDefined()
      Object.assign(binding!, { sha256: "0".repeat(64) })
      expect(() => assertReplayIndependentReleaseAuditManifest(executionDrift, maturity, repoRoot))
        .toThrow("independent audit source drifted")
    }

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

    const runtimeDrift = structuredClone(loadReplayIndependentReleaseAuditReceipt(repoRoot))
    runtimeDrift.runtime.version = "0.0.0"
    expect(() => assertReplayIndependentReleaseAuditReceipt(
      runtimeDrift,
      loadReplayIndependentReleaseAuditManifest(repoRoot),
    )).toThrow("unsupported Replay independent release audit receipt")
  })

  test("kills the complete command process group when an audit command times out", async () => {
    const probeRoot = mkdtempSync(join(tmpdir(), "replay-release-audit-timeout-probe-"))
    const descendantPidPath = join(probeRoot, "descendant.pid")
    const startedAt = Date.now()
    try {
      const command = runReplayIndependentAuditCommand({
        role: "timeout-process-tree-probe",
        cwd: ".",
        argv: [
          "bun",
          "-e",
          `Bun.spawn(["bun", "-e", ${JSON.stringify(
            `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(descendantPidPath)}, String(process.pid)); await Bun.sleep(60_000)`,
          )}], {
            stdout: "inherit",
            stderr: "inherit",
          }); await Bun.sleep(60_000)`,
        ],
        timeout_ms: 250,
      }, repoRoot)

      await expect(command).rejects.toThrow(
        "Replay independent audit command timed out: timeout-process-tree-probe",
      )
      expect(Date.now() - startedAt).toBeLessThan(2_000)
      expect(existsSync(descendantPidPath)).toBe(true)
      const descendantPid = Number(readFileSync(descendantPidPath, "utf8"))
      await expectProcessToBeGone(descendantPid)
    } finally {
      rmSync(probeRoot, { recursive: true, force: true })
    }
  })

  test("falls back to the direct child and cleans output after a process-group kill failure", async () => {
    const originalKill = process.kill
    const outputPrefix = "replay-release-audit-command-"
    const outputRootsBefore = new Set(
      readdirSync(tmpdir()).filter((name) => name.startsWith(outputPrefix)),
    )
    let directChildPid: number | undefined
    let directChildSignal: string | number | undefined
    const startedAt = Date.now()
    try {
      process.kill = ((pid, signal) => {
        if (pid >= 0) {
          directChildPid = pid
          directChildSignal = signal
          return originalKill(pid, signal)
        }
        const error = new Error("forced process-group kill failure") as NodeJS.ErrnoException
        error.code = "EPERM"
        throw error
      }) as typeof process.kill
      await expect(runReplayIndependentAuditCommand({
        role: "timeout-process-group-kill-failure-probe",
        cwd: ".",
        argv: ["bun", "-e", "await Bun.sleep(500)"],
        timeout_ms: 50,
      }, repoRoot)).rejects.toThrow(
        "Replay independent audit process-group cleanup failed: "
          + "timeout-process-group-kill-failure-probe",
      )
    } finally {
      process.kill = originalKill
    }
    expect(directChildPid).toBeGreaterThan(0)
    expect(directChildSignal).toBe("SIGKILL")
    expect(Date.now() - startedAt).toBeLessThan(250)
    await expectProcessToBeGone(directChildPid!)
    expect(readdirSync(tmpdir()).filter(
      (name) => name.startsWith(outputPrefix) && !outputRootsBefore.has(name),
    )).toEqual([])
  })
})

async function expectProcessToBeGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return
      throw error
    }
    if (process.platform === "linux") {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
        const commandEnd = stat.lastIndexOf(")")
        if (commandEnd >= 0 && stat[commandEnd + 2] === "Z") return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return
        throw error
      }
    }
    await Bun.sleep(10)
  }
  throw new Error(`timed-out Replay audit descendant is still alive: ${pid}`)
}
