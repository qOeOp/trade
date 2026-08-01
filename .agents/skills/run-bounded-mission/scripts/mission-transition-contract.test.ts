import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

type Stage = "Frame" | "Plan" | "Execute" | "Verify" | "Finalize"
type Terminal = "accepted" | "blocked" | "cancelled"
type Position = Stage | Terminal | "suspended"
type Route = "accept" | "revise" | "replan" | "reframe" | "block" | null

interface Scenario {
  name: string
  events: string[]
  expected_terminal: Terminal
  expected_mutations: number
}

interface ReplayState {
  position: Position
  route: Route
  mutations: number
  observedRoots: string[]
  failedCandidates: string[]
  admittedPaths: string[]
  readOnlyDecision: string | null
  readOnlyPending: boolean
  requiredDecision: string | null
  blockEvidence: string | null
  replanGeneration: number
  comparisonGeneration: number | null
  frameVersion: number
  planVersion: number
  suspendedEvidence: RecoveryEvidence | null
  resumeStage: Stage | null
}

interface RecoveryEvidence {
  position: Stage | "blocked"
  resumeStage: Stage | null
  frame: string
  plan: string
  originHead: string
  originBranch: string
  effectsStatus: string
  candidate: string | null
  extraCandidate: string | null
  stopPredicates: string[]
  nextOperation: string
  route: Route
  observedRoots: string[]
  failedCandidates: string[]
  admittedPaths: string[]
  readOnlyDecision: string | null
  readOnlyPending: boolean
  requiredDecision: string | null
  blockEvidence: string | null
  replanGeneration: number
  comparisonGeneration: number | null
}

interface Fixture {
  contract_version: number
  scenarios: Scenario[]
}

const skillRoot = resolve(import.meta.dir, "..")
const skill = normalized(resolve(skillRoot, "SKILL.md"))
const revisionPressure = normalized(resolve(skillRoot, "references/revision-pressure-replan.md"))
const planSlices = normalized(resolve(skillRoot, "references/plan-slices.md"))
const fixture = JSON.parse(
  readFileSync(resolve(skillRoot, "fixtures/mission-transition-contract.json"), "utf8"),
) as Fixture

describe("single-Mission transition contract", () => {
  test("states observable stage and route boundaries", () => {
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

  test("uses predicates instead of candidate lifecycle quotas", () => {
    expect(skill).toContain("Revision count is diagnostic only")
    expect(skill).toContain("same causal root")
    expect(skill).toContain("non-shrinking or growing candidate")
    expect(skill).toContain("one writable winner at a time as an integrity constraint")
    expect(skill).toContain("Only an explicit user-approved finite Stop change may continue")
    expect(revisionPressure).toContain("Repeated failure class alone is not enough")
    expect(revisionPressure).toContain("one writable winner at a time")
    expect(planSlices).toContain("smallest coherent correction for that root")
    expect(`${skill} ${revisionPressure} ${planSlices}`).not.toMatch(
      /at most two total backward routes|at most one replacement candidate|patch budget|revision budget|correction quota|backward Stop exhausted/,
    )
  })

  test("defines exact recovery and authorized cancellation boundaries", () => {
    for (const field of [
      "Current Mission evidence",
      "Frame: <current outcome",
      "Plan: <admitted owner",
      "Candidate/effects: <exact commit or complete diff locator",
      "Position: <current stage or terminal route",
      "Resume: <stage to re-enter after a named blocker is removed",
    ]) expect(skill).toContain(field)

    expect(skill).toContain("This locator is evidence, not an identity, receipt, file, ledger, or host state")
    expect(skill).toContain("exclude a different Mission or candidate")
    expect(skill).toContain("Plain cancellation ends the Mission with its existing candidate preserved")
    expect(skill).toContain("cleanup only of the exactly identified mission-owned diff")
  })

  test("replays predicate routes in isolated Git repositories", () => {
    expect(fixture.contract_version).toBe(2)
    for (const scenario of fixture.scenarios) withRepository((repository) => {
      const head = git(repository, "rev-parse", "HEAD")
      const branch = git(repository, "branch", "--show-current")
      const branches = git(repository, "for-each-ref", "--format=%(refname:short)", "refs/heads")
      const state = replay(repository, scenario.events)

      expect(state.position, scenario.name).toBe(scenario.expected_terminal)
      expect(state.mutations, scenario.name).toBe(scenario.expected_mutations)
      expect(git(repository, "rev-parse", "HEAD"), scenario.name).toBe(head)
      expect(git(repository, "branch", "--show-current"), scenario.name).toBe(branch)
      expect(git(repository, "for-each-ref", "--format=%(refname:short)", "refs/heads"), scenario.name).toBe(branches)
      expect(git(repository, "remote"), scenario.name).toBe("")

      const clean = scenario.expected_mutations === 0 || scenario.name === "user-override-discard"
      expect(git(repository, "status", "--porcelain") === "", scenario.name).toBe(clean)
    })
  })

  test("routes coherent findings by Frame, Plan, then local precedence", () => {
    withRepository((repository) => {
      expect(replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready",
        "finding:scope+design+local:root-a", "reframe",
      ]).position).toBe("Frame")
      expect(replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "finding:design", "replan",
      ]).position).toBe("Plan")
      expect(replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "finding:local:root-a", "revise",
      ]).position).toBe("Execute")
      expect(() => replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "finding:design",
        "require:publish", "unavailable:capability:provider",
      ])).toThrow("higher-boundary route cannot be overwritten")
      expect(() => replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "finding:scope",
        "finding:local:root-a",
      ])).toThrow("requires Execute or Verify")
      expect(() => replay(repository, ["finding:design", "replan"]))
        .toThrow("requires Execute or Verify")
      expect(replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "verify-pass", "accept",
      ]).position).toBe("accepted")
      expect(() => replay(repository, ["accept"])).toThrow("accept requires Finalize")
    })
  })

  test("gates read-only dependencies and evidence-bearing blocks", () => {
    withRepository((repository) => {
      expect(() => replay(repository, [
        "readonly:frame-premise", "readonly-exhausted", "frame-complete",
      ])).toThrow("requires recovery or escalation")
      expect(() => replay(repository, [
        "readonly:frame-premise", "readonly-exhausted", "require:frame",
        "unavailable:evidence:provider", "blocked",
      ])).toThrow("requires recovery or escalation before blocking")
      expect(replay(repository, [
        "readonly:frame-premise", "readonly-exhausted", "recovery-gate", "frame-complete",
      ]).position).toBe("Plan")
      expect(replay(repository, [
        "readonly:frame-premise", "readonly-exhausted", "recovery-gate",
        "require:frame", "unavailable:evidence:new-provider-observation", "blocked",
      ]).position).toBe("blocked")
      expect(replay(repository, ["readonly-exhausted", "frame-complete"]).position).toBe("Plan")
      expect(() => replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "finding:local:root-a",
        "unavailable-hint", "blocked",
      ])).toThrow("blocked requires observed evidence")
      expect(() => replay(repository, ["unavailable:evidence:provider"]))
        .toThrow("requires a required decision")
      expect(replay(repository, [
        "require:publish", "unavailable:capability:host-preflight", "blocked",
      ]).position).toBe("blocked")
      expect(replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "require:publish",
        "unavailable:capability:host-preflight", "blocked",
        "resume-blocker-changed:host-supported", "verify-pass", "accept",
      ]).position).toBe("accepted")
      expect(() => replay(repository, [
        "require:publish", "unavailable:capability:host-preflight", "blocked",
        "resume-blocker-changed:host-preflight",
      ])).toThrow("must change the named blocker source")
      expect(() => replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "require:acceptance",
        "unsatisfiable:oracle", "blocked", "resume-blocker-removed", "verify-pass", "accept",
      ])).toThrow("resume requires changed blocker evidence")
      expect(replay(repository, [
        "require:acceptance", "unsatisfiable:oracle", "blocked",
        "reframe-blocked:new-acceptance",
      ]).position).toBe("Frame")
      expect(() => replay(repository, ["frame-complete", "replan-compared"]))
        .toThrow("requires an actually taken structural replan")
      expect(() => replay(repository, ["frame-complete", "no-viable:comparison"]))
        .toThrow("requires the current replan comparison")
      expect(() => replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "finding:design", "replan",
        "replan-compared", "plan-admitted", "finding:scope", "reframe",
        "frame-complete", "no-viable:stale-comparison",
      ])).toThrow("requires the current replan comparison")
      expect(() => replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "finding:design", "replan",
        "replan-compared", "plan-admitted", "candidate-ready", "finding:design", "replan",
        "no-viable:stale-generation",
      ])).toThrow("requires the current replan comparison")
      expect(replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "finding:design", "replan",
        "replan-compared", "no-viable:comparison", "blocked",
      ]).position).toBe("blocked")
      expect(() => replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "finding:design", "replan",
        "replan-compared", "no-viable:comparison", "blocked",
        "resume-blocker-changed:new-path",
      ])).toThrow("has no Resume under the unchanged Frame")
      expect(replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "finding:design", "replan",
        "replan-compared", "no-viable:comparison", "blocked",
        "new-plan-path:new-owner-evidence",
      ]).position).toBe("Plan")
    })
  })

  test("rejects drift and unchanged failed-candidate retries", () => {
    withRepository((repository) => {
      expect(() => replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "context-lost",
        "inject-drift", "recover-exact",
      ])).toThrow("recovery evidence does not match")
      expect(() => replay(repository, [
        "frame-complete", "plan-admitted", "candidate-ready", "finding:local:root-a",
        "revise", "retry-unchanged",
      ])).toThrow("unchanged failed candidate")
    })
  })

  test("does not substitute net size diagnostics for behavior predicates", () => {
    withRepository((repository) => {
      expect(replay(repository, [
        "frame-complete", "plan-admitted", "necessary-net-positive", "verify-pass", "accept",
      ]).position).toBe("accepted")
      expect(git(repository, "diff", "--numstat").split("\n").sort()).toEqual([
        "2\t1\tconsumer.test.ts",
        "3\t1\tconsumer.ts",
      ])
    })
    withRepository((repository) => {
      expect(replay(repository, [
        "frame-complete", "plan-admitted", "remove-regression-for-smaller-diff", "replan",
      ]).position).toBe("Plan")
      expect(git(repository, "diff", "--numstat")).toBe("0\t3\tconsumer.test.ts")
    })
  })
})

function replay(repository: string, events: string[]): ReplayState {
  const state: ReplayState = {
    position: "Frame",
    route: null,
    mutations: 0,
    observedRoots: [],
    failedCandidates: [],
    admittedPaths: [],
    readOnlyDecision: null,
    readOnlyPending: false,
    requiredDecision: null,
    blockEvidence: null,
    replanGeneration: 0,
    comparisonGeneration: null,
    frameVersion: 1,
    planVersion: 0,
    suspendedEvidence: null,
    resumeStage: null,
  }

  for (const event of events) {
    if (event === "user-override-cancel" || event === "user-override-discard") {
      requireActive(state.position, event)
      if (event.endsWith("discard")) {
        rmSync(resolve(repository, "candidate.txt"), { force: true })
        rmSync(resolve(repository, "candidate-extra.txt"), { force: true })
      }
      state.position = "cancelled"
    } else if (event === "context-lost") {
      requireRecoverable(state.position, event)
      state.suspendedEvidence = recoveryEvidence(repository, state, state.position)
      state.position = "suspended"
    } else if (event === "inject-drift") {
      if (state.position !== "suspended") throw new Error("inject-drift requires suspended evidence")
      writeFileSync(resolve(repository, "candidate.txt"), "unrecorded drift\n")
    } else if (event === "recover-exact") {
      if (state.position !== "suspended" || state.suspendedEvidence === null) {
        throw new Error("recover-exact requires suspended evidence")
      }
      const saved = state.suspendedEvidence
      if (JSON.stringify(recoveryEvidence(repository, state, saved.position)) !== JSON.stringify(saved)) {
        throw new Error("recovery evidence does not match")
      }
      state.position = saved.position
      state.resumeStage = saved.resumeStage
      state.suspendedEvidence = null
    } else if (event.startsWith("readonly:")) {
      requirePlanningStage(state.position, event)
      state.readOnlyDecision = suffix(event, "readonly:")
    } else if (event === "readonly-exhausted") {
      requirePlanningStage(state.position, event)
      state.readOnlyPending = state.readOnlyDecision !== null
    } else if (event === "recovery-gate" || event === "escalation-disposition") {
      requirePlanningStage(state.position, event)
      if (!state.readOnlyPending) throw new Error(`${event} requires unavailable dependent evidence`)
      state.readOnlyDecision = null
      state.readOnlyPending = false
      state.requiredDecision = null
    } else if (event === "frame-complete") {
      requireStage(state.position, "Frame", event)
      requireReadOnlyDisposition(state, event)
      state.position = "Plan"
    } else if (event === "plan-admitted") {
      requireStage(state.position, "Plan", event)
      requireReadOnlyDisposition(state, event)
      state.planVersion += 1
      state.comparisonGeneration = null
      state.admittedPaths = ["candidate.txt"]
      state.position = "Execute"
    } else if (event === "candidate-ready" || event === "candidate-ready-unchanged") {
      requireStage(state.position, "Execute", event)
      state.mutations += 1
      if (event === "candidate-ready") {
        writeFileSync(resolve(repository, "candidate.txt"), `candidate-${state.mutations}\n`)
      } else if (!existsSync(resolve(repository, "candidate.txt"))) {
        throw new Error("unchanged candidate requires an existing candidate")
      }
      rmSync(resolve(repository, "candidate-extra.txt"), { force: true })
      state.position = "Verify"
      state.route = null
    } else if (event === "necessary-net-positive") {
      requireStage(state.position, "Execute", event)
      state.mutations += 1
      writeFileSync(resolve(repository, "consumer.ts"), [
        "export function behavior(input: string): string {",
        "  return input === \"new\" ? \"supported\" : \"required\"",
        "}",
        "",
      ].join("\n"))
      writeFileSync(resolve(repository, "consumer.test.ts"), [
        "import { expect, test } from \"bun:test\"",
        "import { behavior } from \"./consumer\"",
        "test(\"existing behavior\", () => expect(behavior(\"old\")).toBe(\"required\"))",
        "test(\"necessary behavior\", () => expect(behavior(\"new\")).toBe(\"supported\"))",
        "",
      ].join("\n"))
      execFileSync("bun", ["test", "./consumer.test.ts"], { cwd: repository, stdio: "pipe" })
      state.admittedPaths = ["consumer.ts", "consumer.test.ts"]
      state.position = "Verify"
    } else if (event === "remove-regression-for-smaller-diff") {
      requireStage(state.position, "Execute", event)
      state.mutations += 1
      rmSync(resolve(repository, "consumer.test.ts"))
      state.position = "Finalize"
      state.route = "replan"
    } else if (event === "candidate-adds-extra-path") {
      requireStage(state.position, "Verify", event)
      writeFileSync(resolve(repository, "candidate-extra.txt"), "unadmitted boundary\n")
    } else if (event.startsWith("finding:")) {
      requireFindingStage(state.position, event)
      routeFinding(repository, state, suffix(event, "finding:").split("+"))
    } else if (event === "verify-pass") {
      requireStage(state.position, "Verify", event)
      const observedPaths = [...new Set([
        ...git(repository, "diff", "--name-only").split("\n"),
        ...git(repository, "ls-files", "--others", "--exclude-standard").split("\n"),
      ].filter(Boolean))]
      state.position = "Finalize"
      state.route = observedPaths.some((path) => !state.admittedPaths.includes(path))
        ? "replan"
        : "accept"
    } else if (event === "accept" || event === "revise" || event === "replan" || event === "reframe") {
      requireStage(state.position, "Finalize", event)
      if (state.route !== event) throw new Error(`${event} has the wrong evidence route`)
      if (event === "accept") state.position = "accepted"
      if (event === "revise") state.position = "Execute"
      if (event === "replan") {
        state.position = "Plan"
        state.replanGeneration += 1
        state.comparisonGeneration = null
      }
      if (event === "reframe") {
        state.position = "Frame"
        state.frameVersion += 1
        state.comparisonGeneration = null
      }
      state.route = null
    } else if (event === "retry-unchanged") {
      requireStage(state.position, "Execute", event)
      if (state.failedCandidates.includes(candidateFingerprint(repository))) {
        throw new Error("unchanged failed candidate cannot be retried")
      }
    } else if (event.startsWith("require:")) {
      requireActive(state.position, event)
      state.requiredDecision = suffix(event, "require:")
    } else if (event === "unavailable-hint") {
      requireActive(state.position, event)
    } else if (event.startsWith("unavailable:")) {
      const unavailable = event.split(":")
      if (!["authority", "evidence", "capability"].includes(unavailable[1] ?? "")) {
        throw new Error("unavailable evidence requires authority, evidence, or capability")
      }
      const source = unavailable[2]
      if (state.requiredDecision === null) throw new Error("blocking evidence requires a required decision")
      if (!source) throw new Error("blocking evidence requires observed provenance")
      enterBlockRoute(state, `temporary|${state.requiredDecision}|${source}`, true)
    } else if (event.startsWith("unsatisfiable:")) {
      if (state.requiredDecision === null) throw new Error("blocking evidence requires a required decision")
      enterBlockRoute(state, `acceptance|${state.requiredDecision}|${suffix(event, "unsatisfiable:")}`, false)
    } else if (event === "replan-compared") {
      requireStage(state.position, "Plan", event)
      if (state.replanGeneration === 0) {
        throw new Error("comparison requires an actually taken structural replan")
      }
      state.comparisonGeneration = state.replanGeneration
    } else if (event.startsWith("no-viable:")) {
      requireStage(state.position, "Plan", event)
      if (state.comparisonGeneration !== state.replanGeneration) {
        throw new Error("no viable route requires the current replan comparison")
      }
      enterBlockRoute(state, `no-viable|replan|${suffix(event, "no-viable:")}`, false)
    } else if (event === "blocked") {
      requireStage(state.position, "Finalize", event)
      if (state.route !== "block" || state.blockEvidence === null) {
        throw new Error("blocked requires observed evidence")
      }
      state.position = "blocked"
    } else if (event === "resume-blocker-removed") {
      throw new Error("resume requires changed blocker evidence")
    } else if (event.startsWith("resume-blocker-changed:")) {
      if (state.position !== "blocked" || state.resumeStage === null
        || !state.blockEvidence?.startsWith("temporary|")) {
        throw new Error("this blocker has no Resume under the unchanged Frame")
      }
      const changedSource = suffix(event, "resume-blocker-changed:")
      if (changedSource === state.blockEvidence.split("|")[2]) {
        throw new Error("resume evidence must change the named blocker source")
      }
      state.position = state.resumeStage
      clearBlock(state)
    } else if (event.startsWith("reframe-blocked:")) {
      if (state.position !== "blocked" || !state.blockEvidence?.startsWith("acceptance|")) {
        throw new Error("reframe-blocked requires unsatisfiable acceptance evidence")
      }
      suffix(event, "reframe-blocked:")
      state.position = "Frame"
      state.frameVersion += 1
      state.comparisonGeneration = null
      clearBlock(state)
    } else if (event.startsWith("new-plan-path:")) {
      if (state.position !== "blocked" || !state.blockEvidence?.startsWith("no-viable|")) {
        throw new Error("new-plan-path requires completed no-viable evidence")
      }
      suffix(event, "new-plan-path:")
      state.position = "Plan"
      state.comparisonGeneration = null
      clearBlock(state)
    } else {
      throw new Error(`unknown event: ${event}`)
    }
  }
  return state
}

function routeFinding(repository: string, state: ReplayState, signals: string[]): void {
  const local = signals.find((signal) => signal.startsWith("local:"))
  let structuralPressure = false
  if (local) {
    const root = suffix(local, "local:")
    const fingerprint = candidateFingerprint(repository)
    structuralPressure = state.observedRoots.includes(root)
      || state.failedCandidates.includes(fingerprint)
    if (!state.observedRoots.includes(root)) state.observedRoots.push(root)
    if (!state.failedCandidates.includes(fingerprint)) state.failedCandidates.push(fingerprint)
  }
  state.position = "Finalize"
  state.route = signals.includes("scope")
    ? "reframe"
    : signals.includes("design") || structuralPressure
      ? "replan"
      : "revise"
}

function enterBlockRoute(state: ReplayState, evidence: string, resumable: boolean): void {
  requireActive(state.position, "blocking evidence")
  if (state.readOnlyPending) {
    throw new Error("dependent read-only evidence requires recovery or escalation before blocking")
  }
  if (state.position === "Finalize" && state.route !== null) {
    throw new Error("a higher-boundary route cannot be overwritten")
  }
  state.resumeStage = resumable ? (state.position === "Finalize" ? "Frame" : state.position) : null
  state.position = "Finalize"
  state.route = "block"
  state.blockEvidence = evidence
}

function clearBlock(state: ReplayState): void {
  state.resumeStage = null
  state.requiredDecision = null
  state.blockEvidence = null
  state.route = null
}

function recoveryEvidence(
  repository: string,
  state: ReplayState,
  position: Stage | "blocked" = state.position as Stage | "blocked",
): RecoveryEvidence {
  return {
    position,
    resumeStage: state.resumeStage,
    frame: `frame-${state.frameVersion}`,
    plan: `plan-${state.planVersion}`,
    originHead: git(repository, "rev-parse", "HEAD"),
    originBranch: git(repository, "branch", "--show-current"),
    effectsStatus: git(repository, "status", "--porcelain"),
    candidate: file(repository, "candidate.txt"),
    extraCandidate: file(repository, "candidate-extra.txt"),
    stopPredicates: ["Frame or Plan invalid", "same causal root", "candidate non-convergence", "required fact unavailable"],
    nextOperation: position !== "blocked"
      ? state.route ?? `continue ${position}`
      : state.resumeStage !== null
        ? "observe changed blocker evidence and resume at the recorded stage"
        : state.blockEvidence?.startsWith("acceptance|")
          ? "reframe with new acceptance evidence"
          : "return to Plan with a new credible path",
    route: state.route,
    observedRoots: [...state.observedRoots],
    failedCandidates: [...state.failedCandidates],
    admittedPaths: [...state.admittedPaths],
    readOnlyDecision: state.readOnlyDecision,
    readOnlyPending: state.readOnlyPending,
    requiredDecision: state.requiredDecision,
    blockEvidence: state.blockEvidence,
    replanGeneration: state.replanGeneration,
    comparisonGeneration: state.comparisonGeneration,
  }
}

function candidateFingerprint(repository: string): string {
  return `${file(repository, "candidate.txt")}|${file(repository, "candidate-extra.txt")}`
}

function file(repository: string, path: string): string | null {
  const fullPath = resolve(repository, path)
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : null
}

function suffix(event: string, prefix: string): string {
  const value = event.slice(prefix.length)
  if (value === "") throw new Error(`${prefix} requires a value`)
  return value
}

function requireStage(position: Position, expected: Stage, event: string): asserts position is Stage {
  if (position !== expected) throw new Error(`${event} requires ${expected}`)
}

function requireActive(position: Position, event: string): asserts position is Stage {
  if (!["Frame", "Plan", "Execute", "Verify", "Finalize"].includes(position)) {
    throw new Error(`${event} requires an active stage`)
  }
}

function requireFindingStage(position: Position, event: string): asserts position is "Execute" | "Verify" {
  if (position !== "Execute" && position !== "Verify") {
    throw new Error(`${event} requires Execute or Verify`)
  }
}

function requirePlanningStage(position: Position, event: string): asserts position is "Frame" | "Plan" {
  if (position !== "Frame" && position !== "Plan") throw new Error(`${event} requires Frame or Plan`)
}

function requireReadOnlyDisposition(state: ReplayState, event: string): void {
  if (state.readOnlyPending) throw new Error(`${event} requires recovery or escalation`)
}

function requireRecoverable(position: Position, event: string): asserts position is Stage | "blocked" {
  if (position !== "blocked" && !["Frame", "Plan", "Execute", "Verify", "Finalize"].includes(position)) {
    throw new Error(`${event} requires an active or blocked stage`)
  }
}

function withRepository(run: (repository: string) => void): void {
  const repository = mkdtempSync(resolve(tmpdir(), "rbm-transition-"))
  try {
    git(repository, "init", "-b", "main")
    git(repository, "config", "user.name", "RBM Test")
    git(repository, "config", "user.email", "rbm-test@example.invalid")
    writeFileSync(resolve(repository, "baseline.txt"), "baseline\n")
    writeFileSync(resolve(repository, "consumer.ts"), "export function behavior(): string { return \"required\" }\n")
    writeFileSync(resolve(repository, "consumer.test.ts"), [
      "import { expect, test } from \"bun:test\"",
      "import { behavior } from \"./consumer\"",
      "test(\"required behavior\", () => expect(behavior()).toBe(\"required\"))",
      "",
    ].join("\n"))
    git(repository, "add", ".")
    git(repository, "commit", "-m", "baseline")
    run(repository)
  } finally {
    rmSync(repository, { recursive: true, force: true })
  }
}

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trimEnd()
}

function normalized(path: string): string {
  return readFileSync(path, "utf8").replace(/\s+/g, " ")
}
