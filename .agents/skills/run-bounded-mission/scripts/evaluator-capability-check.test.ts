import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { evaluateCapability } from "./evaluator-capability-check"

const candidateCommit = "1".repeat(40)
const instructionCommit = "2".repeat(40)
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("mission evaluator capability preflight", () => {
  test("accepts a complete host API fixture with enforced isolation", () => {
    const evidence = positiveFixture()
    const decision = evaluateCapability(evidence, bytes(evidence))

    expect(decision).toMatchObject({
      status: "supported",
      dispatch_allowed: true,
      candidate_commit: candidateCommit,
      instruction_commit: instructionCommit,
      reasons: [],
    })
  })

  test("rejects workspace-write authority", () => {
    const evidence = positiveFixture()
    evidence.authority.filesystem = "workspace-write"

    expect(evaluateCapability(evidence, bytes(evidence))).toMatchObject({
      status: "unsupported",
      dispatch_allowed: false,
      reasons: ["runtime authority is not read-only"],
    })
  })

  test("rejects a shared candidate or candidate-controlled policy", () => {
    const shared = positiveFixture()
    shared.candidate.access = "shared-workspace"
    expect(evaluateCapability(shared, bytes(shared)).reasons).toContain(
      "candidate is not isolated as evidence-only",
    )

    const candidateControlled = positiveFixture()
    candidateControlled.candidate.instruction_commit = candidateCommit
    expect(evaluateCapability(candidateControlled, bytes(candidateControlled)).reasons).toContain(
      "reviewer instructions are candidate-controlled",
    )
  })

  test("rejects delegation and lateral communication", () => {
    const delegated = positiveFixture()
    delegated.authority.delegation = "available"
    expect(evaluateCapability(delegated, bytes(delegated)).reasons).toContain(
      "delegation is available or unverified",
    )

    const lateral = positiveFixture()
    lateral.authority.lateral_communication = "available"
    expect(evaluateCapability(lateral, bytes(lateral)).reasons).toContain(
      "lateral communication is available or unverified",
    )
  })

  test("rejects prompt, role config, incomplete tools, and write-capable tools", () => {
    for (const kind of ["prompt", "role-config", "caller-assertion"]) {
      const declared = positiveFixture()
      declared.source.kind = kind
      expect(evaluateCapability(declared, bytes(declared)).dispatch_allowed).toBe(false)
    }

    const incomplete = positiveFixture()
    incomplete.tool_surface.complete = false
    expect(evaluateCapability(incomplete, bytes(incomplete)).dispatch_allowed).toBe(false)

    const writeTool = positiveFixture()
    writeTool.tool_surface.tools.push({ name: "apply_patch", effect: "workspace-write" })
    expect(evaluateCapability(writeTool, bytes(writeTool)).dispatch_allowed).toBe(false)
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

  test("the CLI permits only a supported observation", () => {
    expect(runCli(positiveFixture()).exitCode).toBe(0)

    const shared = positiveFixture()
    shared.candidate.access = "shared-workspace"
    const rejected = runCli(shared)
    expect(rejected.exitCode).toBe(1)
    expect(JSON.parse(rejected.stdout?.toString() ?? "")).toMatchObject({
      status: "unsupported",
      dispatch_allowed: false,
    })
  })
})

interface Fixture {
  schema_version: string
  source: { kind: string; locator: string }
  candidate: {
    candidate_commit: string
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
    source: {
      kind: "host-capability-api",
      locator: "fixture://host-observation/isolated-evaluator",
    },
    candidate: {
      candidate_commit: candidateCommit,
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

function runCli(value: unknown): ReturnType<typeof Bun.spawnSync> {
  const root = mkdtempSync(`${tmpdir()}/mission-evaluator-capability-`)
  temporaryRoots.push(root)
  const evidence = `${root}/evidence.json`
  writeFileSync(evidence, JSON.stringify(value))

  return Bun.spawnSync([
    "bun",
    resolve(import.meta.dir, "evaluator-capability-check.ts"),
    "--evidence",
    evidence,
  ], {
    stdout: "pipe",
    stderr: "pipe",
  })
}
