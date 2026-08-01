import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

type Stage = "Frame" | "Plan" | "Execute" | "Verify" | "Finalize"
type Terminal = "accepted" | "blocked" | "cancelled"
type Position = Stage | Terminal | "suspended"
type Verification =
  | "pass"
  | "local-failure"
  | "design-failure"
  | "scope-expansion"
  | "stop-enlargement"
  | "replacement-material"
  | "ambiguity-exhausted"
  | null

interface ExpectedStop {
  used: number
  absolute: number
  enlargement_used: boolean
  replacement_candidates: number
  review_attempts: number
}

interface Scenario {
  name: string
  events: string[]
  expected_terminal: Terminal
  expected_mutations: number
  expected_stop: ExpectedStop
  expected_generation?: number
  expected_moves?: number
}

interface Fixture {
  contract_version: number
  scenarios: Scenario[]
}

interface ReplayState {
  position: Position
  verification: Verification
  stop: StopState
  evidenceAttempts: number
  mutations: number
  missionGeneration: number
  moves: number
  suspendedEvidence: RecoveryEvidence | null
  blockedResumeStage: Stage | null
}

interface StopState {
  used: number
  absolute: number
  enlargementUsed: boolean
  replacement: ReplacementFreeze | null
}

interface ReplacementFreeze {
  owner: "run-bounded-mission"
  boundary: "transition-and-revision-pressure"
  maxCandidates: 1
  candidates: number
  maxReviewAttempts: 1
  reviewAttempts: number
  status: "pending" | "active" | "closed"
}

interface RecoveryEvidence {
  position: Stage | "blocked"
  blockedResumeStage: Stage | null
  verification: Verification
  stop: StopState
  missionGeneration: number
  moves: number
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
    expect(skill).toContain("cancellation override may instead terminate directly")
  })

  test("bounds investigation, retry, revision pressure, and Stop recovery", () => {
    expect(skill).toContain("same unresolved Frame, Plan, or Verify question")
    expect(skill).toContain("at most two total backward routes")
    expect(skill).toContain("no repeat of an unchanged failed investigation")
    expect(skill).toContain("at most one replacement candidate for each admitted replan")
    expect(skill).toContain("absolute cumulative ceiling for the whole Mission")
    expect(skill).toContain("only post-exhaustion enlargement")
    expect(skill).toContain("Do not request or suggest a second enlargement")
    expect(ambiguity).toContain("Repeating the same search, command, request, or argument")
    expect(revisionPressure).toContain("same material failure recurs after one correction")
    expect(revisionPressure).toContain("One replan admits at most one replacement candidate")
    expect(revisionPressure).toContain("route terminal `blocked` with no Resume stage")
  })

  test("defines a minimal evidence locator and fail-closed recovery", () => {
    for (const field of [
      "Current Mission evidence",
      "Frame: <current outcome",
      "Plan: <admitted owner",
      "Candidate/effects: <exact commit or complete diff locator",
      "Evidence: <decisive checks",
      "Position: <current stage or terminal route",
      "Resume: <stage to re-enter after a named blocker is removed",
    ]) expect(skill).toContain(field)

    expect(skill).toContain("This locator is evidence, not an identity, receipt, file, ledger, or host state")
    expect(skill).toContain("exclude a different Mission or candidate")
    expect(skill).toContain("explicit `Resume` stage")
    expect(skill).toContain("without resetting Stop")
    expect(skill).toContain("this locator does not replace it")
  })

  test("keeps cancellation preservation and authorized discard distinct", () => {
    expect(skill).toContain("Plain cancellation ends the Mission with its existing candidate preserved")
    expect(skill).toContain("explicitly requests discard or revert")
    expect(skill).toContain("cleanup only of the exactly identified mission-owned diff")
  })

  test("replays every required route in isolated temporary Git repositories", () => {
    expect(fixture.contract_version).toBe(2)
    expect(fixture.scenarios.map(({ name }) => name)).toEqual([
      "normal-accept",
      "default-stop-exhausted-accept",
      "first-enlargement-replacement-accept",
      "replacement-material-terminal",
      "same-outcome-moves-do-not-reset",
      "predeclared-larger-envelope",
      "materially-new-frame",
      "independent-new-outcome",
      "scope-expansion-reframe",
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
        const state = replay(repository, scenario.events)

        expect(state.position, scenario.name).toBe(scenario.expected_terminal)
        expect(state.mutations, scenario.name).toBe(scenario.expected_mutations)
        expect(stopEvidence(state.stop), scenario.name).toEqual(scenario.expected_stop)
        expect(state.missionGeneration, scenario.name).toBe(scenario.expected_generation ?? 1)
        expect(state.moves, scenario.name).toBe(scenario.expected_moves ?? 0)
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

  test("distinguishes wording, reachable routes, actual triggers, and stable closure", () => {
    const repository = createTemporaryRepository()
    try {
      expect(() => replay(repository, ["accept"])).toThrow("accept requires Finalize")
      const exhausted = replay(repository, [
        "frame-complete",
        "plan-admitted",
        "candidate-ready",
        "verify-fail-local",
        "revise",
        "candidate-ready",
        "verify-fail-design",
        "replan",
        "plan-admitted",
        "candidate-ready",
        "verify-fail-design",
      ])
      expect(finalizeRoutes(exhausted)).toEqual(["approve-absolute-stop-3", "blocked"])

      const approved = replay(repository, [
        "frame-complete",
        "plan-admitted",
        "candidate-ready",
        "verify-fail-local",
        "revise",
        "candidate-ready",
        "verify-fail-design",
        "replan",
        "plan-admitted",
        "candidate-ready",
        "verify-fail-design",
        "approve-absolute-stop-3",
      ])
      expect(approved.stop).toEqual({
        used: 2,
        absolute: 3,
        enlargementUsed: true,
        replacement: {
          owner: "run-bounded-mission",
          boundary: "transition-and-revision-pressure",
          maxCandidates: 1,
          candidates: 0,
          maxReviewAttempts: 1,
          reviewAttempts: 0,
          status: "pending",
        },
      })

      expect(() => replay(repository, [
        "frame-complete",
        "plan-admitted",
        "candidate-ready",
        "verify-fail-local",
        "revise",
        "candidate-ready",
        "verify-fail-design",
        "replan",
        "plan-admitted",
        "candidate-ready",
        "verify-fail-design",
        "approve-absolute-stop-3",
        "reframe",
        "frame-complete",
        "plan-admitted-replacement",
        "candidate-ready",
        "replacement-review-material",
        "approve-absolute-stop-4",
      ])).toThrow("post-exhaustion enlargement already consumed")

      const terminal = replay(repository, [
        "frame-complete",
        "plan-admitted",
        "candidate-ready",
        "verify-fail-local",
        "revise",
        "candidate-ready",
        "verify-fail-design",
        "replan",
        "plan-admitted",
        "candidate-ready",
        "verify-fail-design",
        "approve-absolute-stop-3",
        "reframe",
        "frame-complete",
        "plan-admitted-replacement",
        "candidate-ready",
        "replacement-review-material",
      ])
      expect(finalizeRoutes(terminal)).toEqual(["blocked"])
      expect(() => replay(repository, [
        "frame-complete",
        "plan-admitted",
        "candidate-ready",
        "verify-fail-local",
        "revise",
        "candidate-ready",
        "verify-fail-design",
        "replan",
        "plan-admitted",
        "candidate-ready",
        "verify-fail-design",
        "approve-absolute-stop-3",
        "reframe",
        "frame-complete",
        "plan-admitted-replacement",
        "candidate-ready",
        "replacement-review-material",
        "blocked",
        "resume-blocker-removed",
      ])).toThrow("resume requires an explicit blocked stage")
    } finally {
      rmSync(repository, { recursive: true, force: true })
    }
  })
})

function replay(repository: string, events: string[]): ReplayState {
  const state: ReplayState = {
    position: "Frame",
    verification: null,
    stop: initialStop(),
    evidenceAttempts: 0,
    mutations: 0,
    missionGeneration: 1,
    moves: 0,
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
      state.suspendedEvidence = recoveryEvidence(repository, state)
      state.position = "suspended"
      state.verification = null
      state.stop = initialStop()
      state.missionGeneration = 0
      state.moves = 0
      continue
    }
    if (event === "recover-exact") {
      if (state.position !== "suspended" || state.suspendedEvidence === null) {
        throw new Error("recover-exact requires suspended evidence")
      }
      const currentRepository = repositoryEvidence(repository)
      const expectedRepository = {
        head: state.suspendedEvidence.head,
        branch: state.suspendedEvidence.branch,
        status: state.suspendedEvidence.status,
        candidate: state.suspendedEvidence.candidate,
      }
      if (JSON.stringify(currentRepository) !== JSON.stringify(expectedRepository)) {
        throw new Error("recovery evidence does not match the candidate")
      }
      state.position = state.suspendedEvidence.position
      state.blockedResumeStage = state.suspendedEvidence.blockedResumeStage
      state.verification = state.suspendedEvidence.verification
      state.stop = cloneStop(state.suspendedEvidence.stop)
      state.missionGeneration = state.suspendedEvidence.missionGeneration
      state.moves = state.suspendedEvidence.moves
      state.suspendedEvidence = null
      continue
    }
    if (event === "same-outcome-turn-task-branch-checkout-rename") {
      requireRecoverable(state.position, event)
      const branch = git(repository, "branch", "--show-current")
      const head = git(repository, "rev-parse", "HEAD")
      const temporaryBranch = `same-outcome-${state.moves + 1}`
      git(repository, "switch", "-c", temporaryBranch)
      git(repository, "switch", branch)
      git(repository, "branch", "-D", temporaryBranch)
      if (git(repository, "rev-parse", "HEAD") !== head) throw new Error("same-outcome move changed head")
      state.moves += 1
      continue
    }
    if (event === "predeclare-absolute-stop-4") {
      requireStage(state.position, "Frame", event)
      if (state.stop.used !== 0 || state.stop.enlargementUsed) throw new Error("initial Stop is already active")
      state.stop.absolute = 4
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
      if (state.stop.replacement?.status === "pending") {
        throw new Error("post-exhaustion enlargement requires replacement Plan")
      }
      state.position = "Execute"
      continue
    }
    if (event === "plan-admitted-replacement") {
      requireStage(state.position, "Plan", event)
      if (state.stop.replacement?.status !== "pending") {
        throw new Error("replacement Plan requires the frozen enlargement route")
      }
      state.stop.replacement.status = "active"
      state.position = "Execute"
      continue
    }
    if (event === "candidate-ready") {
      requireStage(state.position, "Execute", event)
      if (state.stop.replacement?.status === "active") {
        state.stop.replacement.candidates += 1
        if (state.stop.replacement.candidates > state.stop.replacement.maxCandidates) {
          throw new Error("replacement candidate limit exhausted")
        }
      }
      state.mutations += 1
      writeFileSync(resolve(repository, "candidate.txt"), `candidate-${state.mutations}\n`)
      state.position = "Verify"
      state.verification = null
      continue
    }
    if (event === "verify-pass") {
      requireStage(state.position, "Verify", event)
      if (state.stop.replacement?.status === "active") {
        throw new Error("replacement requires its frozen review attempt")
      }
      state.position = "Finalize"
      state.verification = "pass"
      continue
    }
    if (event === "verify-fail-local" || event === "verify-fail-design") {
      requireStage(state.position, "Verify", event)
      if (state.stop.replacement?.status === "active") {
        throw new Error("replacement requires its frozen review attempt")
      }
      state.position = "Finalize"
      state.verification = event === "verify-fail-local" ? "local-failure" : "design-failure"
      continue
    }
    if (event === "replacement-review-pass" || event === "replacement-review-material") {
      requireStage(state.position, "Verify", event)
      const replacement = state.stop.replacement
      if (replacement?.status !== "active" || replacement.candidates !== 1) {
        throw new Error("replacement review requires the frozen candidate")
      }
      replacement.reviewAttempts += 1
      if (replacement.reviewAttempts > replacement.maxReviewAttempts) {
        throw new Error("replacement review limit exhausted")
      }
      replacement.status = "closed"
      state.position = "Finalize"
      state.verification = event === "replacement-review-pass" ? "pass" : "replacement-material"
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
    if (event === "approve-absolute-stop-3" || event === "approve-absolute-stop-4") {
      requireStage(state.position, "Finalize", event)
      if (state.stop.enlargementUsed) throw new Error("post-exhaustion enlargement already consumed")
      if (state.verification !== "design-failure" || state.stop.used !== state.stop.absolute) {
        throw new Error("Stop enlargement requires first exhaustion")
      }
      const proposedAbsolute = Number(event.at(-1))
      if (proposedAbsolute <= state.stop.absolute) throw new Error("Stop enlargement must be absolute")
      state.stop.absolute = proposedAbsolute
      state.stop.enlargementUsed = true
      state.stop.replacement = {
        owner: "run-bounded-mission",
        boundary: "transition-and-revision-pressure",
        maxCandidates: 1,
        candidates: 0,
        maxReviewAttempts: 1,
        reviewAttempts: 0,
        status: "pending",
      }
      state.verification = "stop-enlargement"
      continue
    }
    if (event === "reframe") {
      requireStage(state.position, "Finalize", event)
      if (state.verification !== "scope-expansion" && state.verification !== "stop-enlargement") {
        throw new Error("reframe requires a material Frame change")
      }
      consumeBackwardRoute(state)
      state.position = "Frame"
      state.verification = null
      continue
    }
    if (event === "user-authorized-material-new-frame" || event === "user-authorized-independent-outcome") {
      requireStage(state.position, "Finalize", event)
      state.stop = initialStop()
      state.evidenceAttempts = 0
      state.missionGeneration += 1
      state.position = "Frame"
      state.verification = null
      state.blockedResumeStage = null
      continue
    }
    if (event === "blocked") {
      requireStage(state.position, "Finalize", event)
      if (state.verification === "pass") throw new Error("blocked cannot replace accept")
      state.blockedResumeStage = state.verification === "replacement-material"
        ? null
        : resumableStage(state.verification)
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
  state.stop.used += 1
  if (state.stop.used > state.stop.absolute) throw new Error("absolute backward Stop exhausted")
}

function initialStop(): StopState {
  return { used: 0, absolute: 2, enlargementUsed: false, replacement: null }
}

function cloneStop(stop: StopState): StopState {
  return {
    ...stop,
    replacement: stop.replacement === null ? null : { ...stop.replacement },
  }
}

function stopEvidence(stop: StopState): ExpectedStop {
  return {
    used: stop.used,
    absolute: stop.absolute,
    enlargement_used: stop.enlargementUsed,
    replacement_candidates: stop.replacement?.candidates ?? 0,
    review_attempts: stop.replacement?.reviewAttempts ?? 0,
  }
}

function finalizeRoutes(state: ReplayState): string[] {
  if (state.position !== "Finalize") return []
  if (state.verification === "replacement-material") return ["blocked"]
  if (state.verification === "design-failure" && state.stop.used === state.stop.absolute) {
    if (state.stop.enlargementUsed) return ["blocked"]
    return [`approve-absolute-stop-${state.stop.absolute + 1}`, "blocked"]
  }
  if (state.verification === "local-failure") return ["revise", "blocked"]
  if (state.verification === "design-failure") return ["replan", "blocked"]
  if (state.verification === "scope-expansion" || state.verification === "stop-enlargement") {
    return ["reframe", "blocked"]
  }
  if (state.verification === "pass") return ["accept"]
  return ["blocked"]
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

function repositoryEvidence(repository: string) {
  const candidatePath = resolve(repository, "candidate.txt")
  return {
    head: git(repository, "rev-parse", "HEAD"),
    branch: git(repository, "branch", "--show-current"),
    status: git(repository, "status", "--porcelain"),
    candidate: existsSync(candidatePath) ? readFileSync(candidatePath, "utf8") : null,
  }
}

function recoveryEvidence(repository: string, state: ReplayState): RecoveryEvidence {
  if (state.position !== "blocked" && !["Frame", "Plan", "Execute", "Verify", "Finalize"].includes(state.position)) {
    throw new Error("recovery evidence requires an active or blocked position")
  }
  return {
    position: state.position as Stage | "blocked",
    blockedResumeStage: state.blockedResumeStage,
    verification: state.verification,
    stop: cloneStop(state.stop),
    missionGeneration: state.missionGeneration,
    moves: state.moves,
    ...repositoryEvidence(repository),
  }
}

function resumableStage(verification: Verification): Stage {
  if (verification === "design-failure") return "Plan"
  if (verification === "local-failure") return "Execute"
  if (
    verification === "scope-expansion"
    || verification === "stop-enlargement"
    || verification === "ambiguity-exhausted"
  ) return "Frame"
  throw new Error("blocked requires a resumable failure")
}

function normalized(path: string): string {
  return readFileSync(path, "utf8").replace(/\s+/g, " ")
}
