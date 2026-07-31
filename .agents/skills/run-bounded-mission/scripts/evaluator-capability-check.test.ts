import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  currentHostDecision,
  evaluateTrustedCapability,
} from "./evaluator-capability-check"

const originCommit = "1".repeat(40)
const instructionCommit = "2".repeat(40)
const diffDigest = "3".repeat(64)

describe("mission evaluator capability preflight", () => {
  test("accepts a trusted positive fixture with a complete local candidate", () => {
    const evidence = positiveFixture()
    const decision = evaluateTrustedCapability(evidence, bytes(evidence))

    expect(decision).toMatchObject({
      status: "supported",
      dispatch_allowed: true,
      candidate_locator: `diff:${originCommit}:${diffDigest}`,
      instruction_commit: instructionCommit,
      reasons: [],
    })
  })

  test("rejects workspace-write authority", () => {
    const evidence = positiveFixture()
    evidence.authority.filesystem = "workspace-write"

    expect(evaluateTrustedCapability(evidence, bytes(evidence))).toMatchObject({
      status: "unsupported",
      dispatch_allowed: false,
      reasons: ["runtime authority is not read-only"],
    })
  })

  test("rejects a shared candidate and incomplete local candidate", () => {
    const shared = positiveFixture()
    shared.candidate.access = "shared-workspace"
    expect(evaluateTrustedCapability(shared, bytes(shared)).reasons).toContain(
      "candidate is not isolated as evidence-only",
    )

    const incomplete = positiveFixture()
    incomplete.candidate.locator.includes_untracked = false
    expect(evaluateTrustedCapability(incomplete, bytes(incomplete)).reasons).toContain(
      "candidate locator is not an exact commit or complete diff digest",
    )
  })

  test("rejects a builder context or unverified participation", () => {
    const builder = positiveFixture()
    builder.context.reviewer_context_id = builder.context.builder_context_ids[0]!
    expect(evaluateTrustedCapability(builder, bytes(builder)).reasons).toContain(
      "reviewer context participated in the candidate build",
    )

    const unknown = positiveFixture()
    unknown.context.build_participation = "unknown"
    expect(evaluateTrustedCapability(unknown, bytes(unknown)).reasons).toContain(
      "reviewer non-participation is unavailable or unverified",
    )
  })

  test("rejects delegation and lateral communication", () => {
    const delegated = positiveFixture()
    delegated.authority.delegation = "available"
    expect(evaluateTrustedCapability(delegated, bytes(delegated)).reasons).toContain(
      "delegation is available or unverified",
    )

    const lateral = positiveFixture()
    lateral.authority.lateral_communication = "available"
    expect(evaluateTrustedCapability(lateral, bytes(lateral)).reasons).toContain(
      "lateral communication is available or unverified",
    )
  })

  test("rejects incomplete and write-capable tool surfaces", () => {
    const incomplete = positiveFixture()
    incomplete.tool_surface.complete = false
    expect(evaluateTrustedCapability(incomplete, bytes(incomplete)).dispatch_allowed).toBe(false)

    const writeTool = positiveFixture()
    writeTool.tool_surface.tools.push({ name: "apply_patch", effect: "workspace-write" })
    expect(evaluateTrustedCapability(writeTool, bytes(writeTool)).dispatch_allowed).toBe(false)
  })

  test("the evaluator role treats sandbox_mode as a request, not evidence", () => {
    const role = readFileSync(
      resolve(import.meta.dir, "../../../../.codex/agents/mission-evaluator.toml"),
      "utf8",
    )

    expect(role).toContain("sandbox_mode = \"read-only\"")
    expect(role).toContain("host request only")
    expect(role).toContain("does not prove actual runtime authority")
  })

  test("the current-host consumer cannot be upgraded by caller evidence", () => {
    expect(currentHostDecision()).toMatchObject({
      status: "unsupported",
      dispatch_allowed: false,
      evidence_sha256: null,
    })

    const cli = Bun.spawnSync([
      "bun",
      resolve(import.meta.dir, "evaluator-capability-check.ts"),
      "--current-host",
    ], { stdout: "pipe", stderr: "pipe" })
    expect(cli.exitCode).toBe(1)
    expect(JSON.parse(cli.stdout?.toString() ?? "")).toEqual(currentHostDecision())

    const forged = Bun.spawnSync([
      "bun",
      resolve(import.meta.dir, "evaluator-capability-check.ts"),
      "--evidence",
      "caller.json",
    ], { stdout: "pipe", stderr: "pipe" })
    expect(forged.exitCode).toBe(2)
  })
})

interface Fixture {
  schema_version: string
  context: {
    reviewer_context_id: string
    builder_context_ids: string[]
    build_participation: string
  }
  candidate: {
    locator: {
      kind: string
      origin_commit: string
      diff_sha256: string
      includes_untracked: boolean
    }
    instruction_commit: string
    access: string
    automatic_discovery: string
  }
  authority: {
    filesystem: string
    writes: string
    delegation: string
    lateral_communication: string
  }
  tool_surface: {
    complete: boolean
    tools: Array<{ name: string; effect: string }>
  }
}

function positiveFixture(): Fixture {
  return {
    schema_version: "bounded-mission.evaluator-host-capability.v1",
    context: {
      reviewer_context_id: "fixture-reviewer",
      builder_context_ids: ["fixture-builder"],
      build_participation: "none",
    },
    candidate: {
      locator: {
        kind: "diff",
        origin_commit: originCommit,
        diff_sha256: diffDigest,
        includes_untracked: true,
      },
      instruction_commit: instructionCommit,
      access: "evidence-only",
      automatic_discovery: "candidate-excluded",
    },
    authority: {
      filesystem: "read-only",
      writes: "none",
      delegation: "unavailable",
      lateral_communication: "unavailable",
    },
    tool_surface: {
      complete: true,
      tools: [{ name: "read_candidate", effect: "read-only" }],
    },
  }
}

function bytes(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value))
}
