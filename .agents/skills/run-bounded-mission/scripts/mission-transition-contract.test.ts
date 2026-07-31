import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { currentHostDecision } from "./evaluator-capability-check"

type Stage = "Frame" | "Plan" | "Execute" | "Verify" | "Finalize"
type Terminal = "accepted" | "blocked" | "cancelled"
type Position = Stage | Terminal | "suspended"
type Verification = "pass" | "local-failure" | "design-failure" | "scope-expansion" | "ambiguity-exhausted" | null

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

interface ReplayState {
  position: Position
  verification: Verification
  backwardRoutes: number
  evidenceAttempts: number
  mutations: number
  suspendedEvidence: RecoveryEvidence | null
  blockedResumeStage: Stage | null
}

interface RecoveryEvidence {
  position: Stage | "blocked"
  blockedResumeStage: Stage | null
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

  test("anchors complete executable-action admission predicates", () => {
    expect(skill).toContain(normalizedText(`
      - \`Plan → Execute\`: the owner, path, affected boundary, candidate shape, and verification
        route are admitted, every recorded action binding has been validated, and no
        decision-changing premise remains unresolved;
    `))
    expect(skill).toContain(normalizedText(`
      Derive the required-action inventory from the admitted implementation, verification,
      delivery, and support needs, then record every non-trivial slice and external action in the
      Plan with a named executor, the exact effect, authority for that effect, and capability
      evidence observable in the required context. Proposed bindings do not establish their own
      completeness. The main agent validates the actual bindings before admission; a role proposal
      or declared authority is not capability evidence. A missing, conflicting, or unavailable
      binding stays in Plan: select a legal executor, keep the action with the main agent when it
      can execute it, or return \`evidence_unavailable\` or \`blocked\`. Do not invent or require a
      subagent when none is available. An evaluator may only inspect the exact admitted candidate;
      it never creates, copies, writes, or packages candidate material. Evaluator dispatch is itself
      an action whose binding must include observed yes/no evidence for the required read-only,
      candidate-external, no-delegation, and no-lateral-communication capabilities and the same
      exact candidate.
    `))
    expect(planner).toContain(normalizedText(`
      For every non-trivial execution slice and external action in a
      \`ready_for_plan_admission\` result or a \`mechanism_rejected\` admission packet, propose a
      named executor, exact effect, required authority, required context, and the capability
      evidence that the main agent must observe before admission. Include implementation,
      verification, delivery, candidate packaging, and support or evaluator dispatch. The main
      agent independently derives that required-action inventory; proposed bindings do not prove
      their own completeness. Treat live capability as an unverified prerequisite unless the
      supplied packet already contains admissible evidence; never claim to have observed the host,
      thread, or executor. If the packet cannot name a legal actor with authority and observable
      capability for every action, return \`evidence_unavailable\`, or \`frame_mismatch\` when closing
      the gap would materially change the frozen Frame. Keep an executable action with the main
      agent when it can legally perform it, and do not invent or require a subagent. An evaluator
      only inspects the exact admitted candidate; bind its inspection and the dispatch preflight
      prerequisite to that same candidate, and never assign it candidate creation, copying,
      neutral-location writes, packaging, dispatch, or any other effect.
    `))
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
        const state = replay(repository, scenario.events)

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

  test("keeps Plan when main-agent action validation is false", () => {
    const state = replayState("Plan")
    const currentHost = currentHostDecision()

    expect(currentHost.dispatch_allowed).toBe(false)
    expect(() => admitPlanTransition(state, currentHost.dispatch_allowed))
      .toThrow("Plan action validation is unavailable")
    expect(state.position).toBe("Plan")
    expect(state.mutations).toBe(0)
  })
})

function replay(repository: string, events: string[]): ReplayState {
  const state = replayState("Frame")

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
      state.suspendedEvidence = recoveryEvidence(repository, state.position, state.blockedResumeStage)
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
      )) !== JSON.stringify(state.suspendedEvidence)) {
        throw new Error("recovery evidence does not match the candidate")
      }
      state.position = state.suspendedEvidence.position
      state.blockedResumeStage = state.suspendedEvidence.blockedResumeStage
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
      admitPlanTransition(state, true)
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

function admitPlanTransition(state: ReplayState, actionsValidated: boolean): void {
  requireStage(state.position, "Plan", "plan-admitted")
  if (!actionsValidated) throw new Error("Plan action validation is unavailable")
  state.position = "Execute"
}

function replayState(position: Position): ReplayState {
  return {
    position,
    verification: null,
    backwardRoutes: 0,
    evidenceAttempts: 0,
    mutations: 0,
    suspendedEvidence: null,
    blockedResumeStage: null,
  }
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
): RecoveryEvidence {
  const candidatePath = resolve(repository, "candidate.txt")
  return {
    position,
    blockedResumeStage,
    head: git(repository, "rev-parse", "HEAD"),
    branch: git(repository, "branch", "--show-current"),
    status: git(repository, "status", "--porcelain"),
    candidate: existsSync(candidatePath) ? readFileSync(candidatePath, "utf8") : null,
  }
}

function resumableStage(verification: Verification): Stage {
  if (verification === "design-failure") return "Plan"
  if (verification === "local-failure") return "Execute"
  if (verification === "scope-expansion" || verification === "ambiguity-exhausted") return "Frame"
  throw new Error("blocked requires a resumable failure")
}

function normalized(path: string): string {
  return normalizedText(readFileSync(path, "utf8"))
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}
