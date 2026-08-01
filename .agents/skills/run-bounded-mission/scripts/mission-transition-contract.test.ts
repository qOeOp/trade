import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

type Stage = "Frame" | "Plan" | "Execute" | "Verify" | "Finalize"
type Terminal = "accepted" | "blocked" | "cancelled"
type Position = Stage | Terminal | "suspended"
type Verification = "pass" | "local-failure" | "design-failure" | "gate-unavailable" | "scope-expansion" | "ambiguity-exhausted" | null

interface Scenario {
  name: string
  events: string[]
  expected_terminal: Terminal
  expected_mutations: number
}

interface Fixture {
  contract_version: number
  scenarios: Scenario[]
}

interface PlanAdmission {
  inventoryComplete: boolean
  bindingsAdmissible: boolean
  actionBindings: string[]
  preVerifyGates: string[]
}

interface ReplayState {
  position: Position
  verification: Verification
  admittedPlan: PlanAdmission | null
  candidateReady: boolean
  backwardRoutes: number
  evidenceAttempts: number
  mutations: number
  suspendedEvidence: RecoveryEvidence | null
  blockedResumeStage: Stage | null
}

interface RecoveryEvidence {
  position: Stage | "blocked"
  blockedResumeStage: Stage | null
  planAdmission: PlanAdmission | null
  candidateReady: boolean
  head: string
  branch: string
  status: string
  candidate: string | null
}

const skillRoot = resolve(import.meta.dir, "..")
const skill = normalized(resolve(skillRoot, "SKILL.md"))
const planner = normalized(resolve(skillRoot, "../../../.codex/agents/mission-planner.toml"))
const ambiguity = normalized(resolve(skillRoot, "references/plan-ambiguity.md"))
const revisionPressure = normalized(resolve(skillRoot, "references/revision-pressure-replan.md"))
const admissiblePlan: PlanAdmission = {
  inventoryComplete: true,
  bindingsAdmissible: true,
  actionBindings: [
    "main creates and packages the candidate with workspace-write authority and repository context",
    "main dispatches read-only exact-candidate inspection after Execute and owns the failure route",
  ],
  preVerifyGates: ["main validates evaluator capability, isolation, and same-exact-candidate binding"],
}
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
    expect(skill).toContain("cancellation override may instead terminate directly")
  })

  test("bounds investigation, retry, revision pressure, and Stop recovery", () => {
    expect(skill).toContain("same unresolved Frame, Plan, or Verify question")
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
      "complete required-action inventory and each admitted binding or later-stage gate",
      "Candidate/effects: <exact commit or complete diff locator",
      "Evidence: <decisive checks",
      "Position: <current stage or terminal route",
      "Resume: <stage to re-enter after a named blocker is removed",
    ]) expect(skill).toContain(field)

    expect(skill).toContain("This locator is evidence, not an identity, receipt, file, ledger, or host state")
    expect(skill).toContain("complete admitted Plan including its action inventory, bindings, and later-stage gates")
    expect(skill).toContain("Do not assume that prior Plan admission still holds")
    expect(skill).toContain("exclude a different Mission, Plan admission, or candidate")
    expect(skill).toContain("explicit `Resume` stage")
    expect(skill).toContain("without resetting Stop")
    expect(skill).toContain("this locator does not replace it")
  })

  test("keeps cancellation preservation and authorized discard distinct", () => {
    expect(skill).toContain("Plain cancellation ends the Mission with its existing candidate preserved")
    expect(skill).toContain("explicitly requests discard or revert")
    expect(skill).toContain("cleanup only of the exactly identified mission-owned diff")
  })

  test("admits complete executable actions without requiring a candidate during Plan", () => {
    expect(skill).toContain("independently derives the complete required-action inventory")
    expect(skill).toContain("implementation, verification, delivery, and support needs")
    expect(skill).toContain("An omitted required action makes the inventory incomplete")
    expect(skill).toContain("proposed bindings do not prove completeness")
    expect(skill).toContain("Do not require a candidate locator or completed-candidate fact during Plan")
    expect(skill).toContain("The main agent owns candidate creation, copying, packaging, and evaluator dispatch")
    expect(skill).toContain("After Execute and before Verify launch")
    expect(skill).toContain("every admitted pre-Verify gate has passed")
    expect(skill).toContain("enter Finalize, and route `blocked`")
    expect(planner).toContain("This proposal does not prove inventory completeness, binding admissibility, or live capability")
    expect(planner).toContain("do not require a candidate locator during Plan")
  })

  test("requires inventory completeness and admissible bindings independently", () => {
    for (const admission of [
      { ...admissiblePlan, inventoryComplete: false },
      { ...admissiblePlan, bindingsAdmissible: false },
    ]) {
      const repository = createTemporaryRepository()
      try {
        const state = replay(repository, ["frame-complete", "plan-admitted"], admission)
        expect(state.position).toBe("Plan")
        expect(state.mutations).toBe(0)
      } finally {
        rmSync(repository, { recursive: true, force: true })
      }
    }
  })

  test("recovers an admitted Plan before candidate mutation only from exact admission evidence", () => {
    const events = [
      "frame-complete",
      "plan-admitted",
      "context-lost",
      "recover-exact",
      "candidate-ready",
      "pre-verify-gates-pass",
      "verify-pass",
      "accept",
    ]

    const recoveredPlans: Array<PlanAdmission | null> = [
      null,
      { ...admissiblePlan, actionBindings: ["evaluator creates the candidate", ...admissiblePlan.actionBindings.slice(1)] },
      { ...admissiblePlan, preVerifyGates: ["main trusts the evaluator label without capability evidence"] },
    ]
    for (const recoveredPlan of recoveredPlans) {
      const repository = createTemporaryRepository()
      try {
        expect(() => replay(repository, events, admissiblePlan, recoveredPlan)).toThrow(
          "recovery evidence does not match the candidate",
        )
        expect(git(repository, "status", "--porcelain")).toBe("")
      } finally {
        rmSync(repository, { recursive: true, force: true })
      }
    }

    const repository = createTemporaryRepository()
    try {
      const state = replay(repository, events, admissiblePlan, admissiblePlan)
      expect(state.position).toBe("accepted")
      expect(state.mutations).toBe(1)
    } finally {
      rmSync(repository, { recursive: true, force: true })
    }
  })

  test("requires admitted pre-Verify gates and routes an unavailable gate through Finalize", () => {
    const repository = createTemporaryRepository()
    try {
      const waiting = replay(repository, ["frame-complete", "plan-admitted", "candidate-ready"], admissiblePlan)
      expect(waiting.position).toBe("Execute")
    } finally {
      rmSync(repository, { recursive: true, force: true })
    }

    const unavailableRepository = createTemporaryRepository()
    try {
      const resumed = replay(unavailableRepository, [
        "frame-complete",
        "plan-admitted",
        "candidate-ready",
        "pre-verify-gates-unavailable",
        "blocked",
        "context-lost",
        "recover-exact",
        "resume-blocker-removed",
        "pre-verify-gates-pass",
        "verify-pass",
        "accept",
      ], admissiblePlan)
      expect(resumed.position).toBe("accepted")
      expect(resumed.mutations).toBe(1)
    } finally {
      rmSync(unavailableRepository, { recursive: true, force: true })
    }
  })

  test("does not recover a failed candidate as ready after revise", () => {
    const beforeReplacement = [
      "frame-complete",
      "plan-admitted",
      "candidate-ready",
      "pre-verify-gates-pass",
      "verify-fail-local",
      "revise",
      "context-lost",
      "recover-exact",
    ]

    const repository = createTemporaryRepository()
    try {
      const recovered = replay(repository, beforeReplacement, admissiblePlan)
      expect(recovered.position).toBe("Execute")
      expect(recovered.candidateReady).toBe(false)
      expect(recovered.mutations).toBe(1)
      expect(() => replay(repository, [
        ...beforeReplacement,
        "pre-verify-gates-pass",
      ], admissiblePlan)).toThrow("pre-Verify gates require a complete candidate")
      expect(readFileSync(resolve(repository, "candidate.txt"), "utf8")).toBe("candidate-1\n")
      const replaced = replay(repository, [
        ...beforeReplacement,
        "candidate-ready",
        "pre-verify-gates-pass",
        "verify-pass",
        "accept",
      ], admissiblePlan)
      expect(replaced.position).toBe("accepted")
      expect(replaced.mutations).toBe(2)
      expect(readFileSync(resolve(repository, "candidate.txt"), "utf8")).toBe("candidate-2\n")
    } finally {
      rmSync(repository, { recursive: true, force: true })
    }
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
      "frame-ambiguity-blocked",
      "blocked-context-recovery",
      "user-override-before-mutation",
      "user-override-discard",
    ])

    for (const scenario of fixture.scenarios) {
      const repository = createTemporaryRepository()
      try {
        const initialHead = git(repository, "rev-parse", "HEAD")
        const initialBranch = git(repository, "branch", "--show-current")
        const initialBranches = git(repository, "for-each-ref", "--format=%(refname:short)", "refs/heads")
        const events = scenario.events.flatMap((event) =>
          event === "candidate-ready" ? [event, "pre-verify-gates-pass"] : [event])
        const state = replay(repository, events, admissiblePlan)

        expect(state.position, scenario.name).toBe(scenario.expected_terminal)
        expect(state.mutations, scenario.name).toBe(scenario.expected_mutations)
        expect(git(repository, "rev-parse", "HEAD"), scenario.name).toBe(initialHead)
        expect(git(repository, "branch", "--show-current"), scenario.name).toBe(initialBranch)

        if (scenario.expected_mutations > 0 && scenario.name !== "user-override-discard") {
          expect(git(repository, "status", "--porcelain"), scenario.name).not.toBe("")
        }

        if (scenario.name === "user-override-before-mutation" || scenario.name === "user-override-discard") {
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
      expect(() => replay(repository, ["accept"], admissiblePlan)).toThrow("accept requires Finalize")
      expect(() => replay(repository, [
        "frame-complete",
        "plan-admitted",
        "candidate-ready",
        "pre-verify-gates-pass",
        "verify-fail-design",
        "replan",
        "plan-admitted",
        "candidate-ready",
        "pre-verify-gates-pass",
        "verify-fail-local",
        "revise",
        "scope-expanded",
        "reframe",
      ], admissiblePlan)).toThrow("backward Stop exhausted")
    } finally {
      rmSync(repository, { recursive: true, force: true })
    }
  })
})

function replay(
  repository: string,
  events: string[],
  planAdmission: PlanAdmission,
  recoveredPlanAdmission: PlanAdmission | null = planAdmission,
): ReplayState {
  const state: ReplayState = {
    position: "Frame",
    verification: null,
    admittedPlan: null,
    candidateReady: false,
    backwardRoutes: 0,
    evidenceAttempts: 0,
    mutations: 0,
    suspendedEvidence: null,
    blockedResumeStage: null,
  }

  for (const event of events) {
    if (event === "user-override-cancel") {
      requireActive(state.position, event)
      state.position = "cancelled"
      continue
    }
    if (event === "user-override-discard") {
      requireActive(state.position, event)
      rmSync(resolve(repository, "candidate.txt"), { force: true })
      state.position = "cancelled"
      continue
    }
    if (event === "context-lost") {
      requireRecoverable(state.position, event)
      state.suspendedEvidence = recoveryEvidence(
        repository,
        state.position,
        state.blockedResumeStage,
        state.admittedPlan,
        state.candidateReady,
      )
      state.position = "suspended"
      continue
    }
    if (event === "recover-exact") {
      if (state.position !== "suspended" || state.suspendedEvidence === null) {
        throw new Error("recover-exact requires suspended evidence")
      }
      if (JSON.stringify(recoveryEvidence(
        repository,
        state.suspendedEvidence.position,
        state.suspendedEvidence.blockedResumeStage,
        state.suspendedEvidence.planAdmission === null ? null : recoveredPlanAdmission,
        state.suspendedEvidence.candidateReady,
      )) !== JSON.stringify(state.suspendedEvidence)) {
        throw new Error("recovery evidence does not match the candidate")
      }
      state.position = state.suspendedEvidence.position
      state.blockedResumeStage = state.suspendedEvidence.blockedResumeStage
      state.admittedPlan = state.suspendedEvidence.planAdmission === null
        ? null
        : structuredClone(state.suspendedEvidence.planAdmission)
      state.candidateReady = state.suspendedEvidence.candidateReady
      state.suspendedEvidence = null
      continue
    }
    if (event === "frame-ambiguity") {
      requireStage(state.position, "Frame", event)
      continue
    }
    if (event === "evidence-attempt") {
      requireStage(state.position, "Frame", event)
      state.evidenceAttempts += 1
      if (state.evidenceAttempts > 2) throw new Error("evidence Stop exhausted")
      continue
    }
    if (event === "evidence-exhausted") {
      requireStage(state.position, "Frame", event)
      if (state.evidenceAttempts !== 2) throw new Error("evidence-exhausted requires two attempts")
      state.position = "Finalize"
      state.verification = "ambiguity-exhausted"
      continue
    }
    if (event === "frame-complete") {
      requireStage(state.position, "Frame", event)
      state.position = "Plan"
      continue
    }
    if (event === "plan-admitted") {
      requireStage(state.position, "Plan", event)
      if (!planAdmission.inventoryComplete || !planAdmission.bindingsAdmissible) continue
      state.admittedPlan = structuredClone(planAdmission)
      state.candidateReady = false
      state.position = "Execute"
      continue
    }
    if (event === "candidate-ready") {
      requireStage(state.position, "Execute", event)
      state.mutations += 1
      writeFileSync(resolve(repository, "candidate.txt"), `candidate-${state.mutations}\n`)
      state.candidateReady = true
      state.verification = null
      if (state.admittedPlan?.preVerifyGates.length === 0) state.position = "Verify"
      continue
    }
    if (event === "pre-verify-gates-pass") {
      requireStage(state.position, "Execute", event)
      if (!state.candidateReady) throw new Error("pre-Verify gates require a complete candidate")
      state.position = "Verify"
      continue
    }
    if (event === "pre-verify-gates-unavailable") {
      requireStage(state.position, "Execute", event)
      if (!state.candidateReady) throw new Error("pre-Verify gates require a complete candidate")
      state.position = "Finalize"
      state.verification = "gate-unavailable"
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
      if (event === "replan") state.admittedPlan = null
      state.candidateReady = false
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
      state.admittedPlan = null
      state.candidateReady = false
      state.verification = null
      continue
    }
    if (event === "blocked") {
      requireStage(state.position, "Finalize", event)
      if (state.verification === "pass") throw new Error("blocked cannot replace accept")
      state.blockedResumeStage = resumableStage(state.verification)
      state.position = "blocked"
      continue
    }
    if (event === "resume-blocker-removed") {
      if (state.position !== "blocked" || state.blockedResumeStage === null) {
        throw new Error("resume requires an explicit blocked stage")
      }
      state.position = state.blockedResumeStage
      state.blockedResumeStage = null
      state.verification = null
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

function requireRecoverable(position: Position, event: string): asserts position is Stage | "blocked" {
  if (position !== "blocked" && !["Frame", "Plan", "Execute", "Verify", "Finalize"].includes(position)) {
    throw new Error(`${event} requires an active or blocked stage`)
  }
}

function createTemporaryRepository(): string {
  const repository = mkdtempSync(resolve(tmpdir(), "rbm-transition-"))
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

function recoveryEvidence(
  repository: string,
  position: Stage | "blocked",
  blockedResumeStage: Stage | null,
  planAdmission: PlanAdmission | null,
  candidateReady: boolean,
): RecoveryEvidence {
  const candidatePath = resolve(repository, "candidate.txt")
  return {
    position,
    blockedResumeStage,
    planAdmission: planAdmission === null ? null : structuredClone(planAdmission),
    candidateReady,
    head: git(repository, "rev-parse", "HEAD"),
    branch: git(repository, "branch", "--show-current"),
    status: git(repository, "status", "--porcelain"),
    candidate: existsSync(candidatePath) ? readFileSync(candidatePath, "utf8") : null,
  }
}

function resumableStage(verification: Verification): Stage {
  if (verification === "design-failure") return "Plan"
  if (verification === "local-failure") return "Execute"
  if (verification === "gate-unavailable") return "Execute"
  if (verification === "scope-expansion" || verification === "ambiguity-exhausted") return "Frame"
  throw new Error("blocked requires a resumable failure")
}

function normalized(path: string): string {
  return readFileSync(path, "utf8").replace(/\s+/g, " ")
}
