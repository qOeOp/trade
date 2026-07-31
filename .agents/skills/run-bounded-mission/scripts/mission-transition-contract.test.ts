import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

type Stage = "Frame" | "Plan" | "Execute" | "Verify" | "Finalize"
type Terminal = "accepted" | "blocked" | "cancelled"
type Position = Stage | Terminal | "suspended"
type Verification = "pass" | "local-failure" | "design-failure" | "scope-expansion" | null

interface Scenario {
  name: string
  events: string[]
  expected_terminal: Terminal
  expected_mutations: number
}

interface Fixture {
  contract_version: number
  parent_chain_evidence: {
    name: string
    source: string
    proves: string[]
    does_not_prove: string[]
  }
  scenarios: Scenario[]
}

interface ReplayState {
  position: Position
  verification: Verification
  backwardRoutes: number
  mutations: number
  suspendedEvidence: RecoveryEvidence | null
}

interface RecoveryEvidence {
  stage: Stage
  head: string
  branch: string
  status: string
  candidate: string | null
}

const skillRoot = resolve(import.meta.dir, "..")
const skill = normalized(resolve(skillRoot, "SKILL.md"))
const ambiguity = normalized(resolve(skillRoot, "references/plan-ambiguity.md"))
const revisionPressure = normalized(resolve(skillRoot, "references/revision-pressure-replan.md"))
const fixture = JSON.parse(
  readFileSync(resolve(skillRoot, "fixtures/mission-transition-contract.json"), "utf8"),
) as Fixture

describe("single-Mission transition contract", () => {
  test("states observable forward and backward boundaries without durable state", () => {
    for (const transition of [
      "Frame → Plan",
      "Plan → Execute",
      "Execute → Verify",
      "Verify → Finalize",
      "Finalize → accept",
    ]) expect(skill).toContain(transition)

    expect(skill).toContain("reasoning position in this conversation, not durable workflow state")
    expect(skill).toContain("`revise` returns to Execute")
    expect(skill).toContain("`replan` returns to Plan")
    expect(skill).toContain("`reframe` returns to Frame")
    expect(skill).toContain("`blocked` ends the current run")
    expect(skill).toContain("Scope expansion always requires `reframe`")
  })

  test("bounds investigation, retry, revision pressure, and Stop recovery", () => {
    expect(skill).toContain("at most two distinct evidence attempts")
    expect(skill).toContain("at most two total backward routes")
    expect(skill).toContain("no repeat of an unchanged failed investigation")
    expect(skill).toContain("at most one replacement candidate for each admitted replan")
    expect(skill).toContain("does not reset consumed Stop")
    expect(skill).toContain("Only an explicit user-approved finite Stop change may continue")
    expect(ambiguity).toContain("Repeating the same search, command, request, or argument")
    expect(revisionPressure).toContain("same material failure recurs after one correction")
    expect(revisionPressure).toContain("One replan admits at most one replacement candidate")
  })

  test("defines a minimal evidence locator and fail-closed recovery", () => {
    for (const field of [
      "Current Mission evidence",
      "Frame: <current outcome",
      "Plan: <admitted owner",
      "Candidate/effects: <exact commit or complete diff locator",
      "Evidence: <decisive checks",
      "Position: <current stage or terminal route",
    ]) expect(skill).toContain(field)

    expect(skill).toContain("This locator is evidence, not an identity, receipt, file, ledger, or host state")
    expect(skill).toContain("exclude a different Mission or candidate")
    expect(skill).toContain("without resetting Stop")
    expect(skill).toContain("this locator does not replace it")
  })

  test("retains the parent override evidence without overstating recovery proof", () => {
    expect(fixture.parent_chain_evidence).toEqual({
      name: "rbm-03-user-override-before-mutation",
      source: "supplied parent-chain observation",
      proves: [
        "the override stopped the prior Mission before mutation",
        "the worktree remained clean",
        "no branch, commit, or pull request was created",
      ],
      does_not_prove: ["context-compaction recovery", "later-turn recovery"],
    })
  })

  test("replays every required route in isolated temporary Git repositories", () => {
    expect(fixture.contract_version).toBe(1)
    expect(fixture.scenarios.map(({ name }) => name)).toEqual([
      "normal-accept",
      "verify-revise-accept",
      "verify-replan-accept",
      "scope-expansion-reframe",
      "continuous-nonconvergence-blocked",
      "context-recovery",
      "user-override-before-mutation",
    ])

    for (const scenario of fixture.scenarios) {
      const repository = createTemporaryRepository()
      try {
        const initialHead = git(repository, "rev-parse", "HEAD")
        const initialBranch = git(repository, "branch", "--show-current")
        const initialBranches = git(repository, "for-each-ref", "--format=%(refname:short)", "refs/heads")
        const state = replay(repository, scenario.events)

        expect(state.position, scenario.name).toBe(scenario.expected_terminal)
        expect(state.mutations, scenario.name).toBe(scenario.expected_mutations)
        expect(git(repository, "rev-parse", "HEAD"), scenario.name).toBe(initialHead)
        expect(git(repository, "branch", "--show-current"), scenario.name).toBe(initialBranch)

        if (scenario.expected_mutations > 0) {
          expect(git(repository, "status", "--porcelain"), scenario.name).not.toBe("")
        }

        if (scenario.name === "user-override-before-mutation") {
          expect(git(repository, "status", "--porcelain")).toBe("")
          expect(git(repository, "for-each-ref", "--format=%(refname:short)", "refs/heads")).toBe(initialBranches)
          expect(git(repository, "remote")).toBe("")
        }
      } finally {
        rmSync(repository, { recursive: true, force: true })
      }
    }
  })

  test("rejects illegal shortcuts and a third backward route", () => {
    const repository = createTemporaryRepository()
    try {
      expect(() => replay(repository, ["accept"])).toThrow("accept requires Finalize")
      expect(() => replay(repository, [
        "frame-complete",
        "plan-admitted",
        "candidate-ready",
        "verify-fail-design",
        "replan",
        "plan-admitted",
        "candidate-ready",
        "verify-fail-local",
        "revise",
        "scope-expanded",
        "reframe",
      ])).toThrow("backward Stop exhausted")
    } finally {
      rmSync(repository, { recursive: true, force: true })
    }
  })
})

function replay(repository: string, events: string[]): ReplayState {
  const state: ReplayState = {
    position: "Frame",
    verification: null,
    backwardRoutes: 0,
    mutations: 0,
    suspendedEvidence: null,
  }

  for (const event of events) {
    if (event === "user-override-cancel") {
      requireActive(state.position, event)
      state.position = "cancelled"
      continue
    }
    if (event === "context-lost") {
      requireActive(state.position, event)
      state.suspendedEvidence = recoveryEvidence(repository, state.position)
      state.position = "suspended"
      continue
    }
    if (event === "recover-exact") {
      if (state.position !== "suspended" || state.suspendedEvidence === null) {
        throw new Error("recover-exact requires suspended evidence")
      }
      if (JSON.stringify(recoveryEvidence(repository, state.suspendedEvidence.stage)) !== JSON.stringify(state.suspendedEvidence)) {
        throw new Error("recovery evidence does not match the candidate")
      }
      state.position = state.suspendedEvidence.stage
      state.suspendedEvidence = null
      continue
    }
    if (event === "frame-complete") {
      requireStage(state.position, "Frame", event)
      state.position = "Plan"
      continue
    }
    if (event === "plan-admitted") {
      requireStage(state.position, "Plan", event)
      state.position = "Execute"
      continue
    }
    if (event === "candidate-ready") {
      requireStage(state.position, "Execute", event)
      state.mutations += 1
      writeFileSync(resolve(repository, "candidate.txt"), `candidate-${state.mutations}\n`)
      state.position = "Verify"
      state.verification = null
      continue
    }
    if (event === "verify-pass") {
      requireStage(state.position, "Verify", event)
      state.position = "Finalize"
      state.verification = "pass"
      continue
    }
    if (event === "verify-fail-local" || event === "verify-fail-design") {
      requireStage(state.position, "Verify", event)
      state.position = "Finalize"
      state.verification = event === "verify-fail-local" ? "local-failure" : "design-failure"
      continue
    }
    if (event === "accept") {
      requireStage(state.position, "Finalize", event)
      if (state.verification !== "pass") throw new Error("accept requires passing evidence")
      state.position = "accepted"
      continue
    }
    if (event === "revise" || event === "replan") {
      requireStage(state.position, "Finalize", event)
      const expected = event === "revise" ? "local-failure" : "design-failure"
      if (state.verification !== expected) throw new Error(`${event} has the wrong failure class`)
      consumeBackwardRoute(state)
      state.position = event === "revise" ? "Execute" : "Plan"
      continue
    }
    if (event === "scope-expanded") {
      requireActive(state.position, event)
      state.position = "Finalize"
      state.verification = "scope-expansion"
      continue
    }
    if (event === "reframe") {
      requireStage(state.position, "Finalize", event)
      if (state.verification !== "scope-expansion") {
        throw new Error("reframe requires a material Frame change")
      }
      consumeBackwardRoute(state)
      state.position = "Frame"
      state.verification = null
      continue
    }
    if (event === "blocked") {
      requireStage(state.position, "Finalize", event)
      if (state.verification === "pass") throw new Error("blocked cannot replace accept")
      state.position = "blocked"
      continue
    }
    throw new Error(`unknown event: ${event}`)
  }

  return state
}

function consumeBackwardRoute(state: ReplayState): void {
  state.backwardRoutes += 1
  if (state.backwardRoutes > 2) throw new Error("backward Stop exhausted")
}

function requireStage(position: Position, expected: Stage, event: string): asserts position is Stage {
  if (position !== expected) throw new Error(`${event} requires ${expected}`)
}

function requireActive(position: Position, event: string): asserts position is Stage {
  if (!["Frame", "Plan", "Execute", "Verify", "Finalize"].includes(position)) {
    throw new Error(`${event} requires an active stage`)
  }
}

function createTemporaryRepository(): string {
  const repository = mkdtempSync("/tmp/rbm-transition-")
  git(repository, "init", "-b", "main")
  git(repository, "config", "user.name", "RBM Test")
  git(repository, "config", "user.email", "rbm-test@example.invalid")
  writeFileSync(resolve(repository, "baseline.txt"), "baseline\n")
  git(repository, "add", "baseline.txt")
  git(repository, "commit", "-m", "baseline")
  return repository
}

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim()
}

function recoveryEvidence(repository: string, stage: Stage): RecoveryEvidence {
  const candidatePath = resolve(repository, "candidate.txt")
  return {
    stage,
    head: git(repository, "rev-parse", "HEAD"),
    branch: git(repository, "branch", "--show-current"),
    status: git(repository, "status", "--porcelain"),
    candidate: existsSync(candidatePath) ? readFileSync(candidatePath, "utf8") : null,
  }
}

function normalized(path: string): string {
  return readFileSync(path, "utf8").replace(/\s+/g, " ")
}
