import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

type Position = "Frame" | "Plan" | "Execute" | "Verify" | "Finalize" | "accepted" | "blocked" | "cancelled"
type Failure = "local" | "design" | "scope" | "material" | "ambiguity" | null
type Pending = "reframe-replan-replacement" | "replacement-plan" | null
type Route = "accept" | "revise" | "replan" | "reframe" | "reframe-replacement" | "enlarge" | "blocked"
type Fault = "none" | "advertise-split" | "hard-coded-enlargement" | "skip-consumption"
  | "resume-frame" | "reset-on-move" | "second-enlargement"

interface State {
  position: Position
  failure: Failure
  passed: boolean
  absolute: bigint
  used: bigint
  enlarged: boolean
  attempts: Record<string, bigint>
  attemptCeilings: Record<string, bigint>
  pending: Pending
  resume: Position | null
  mutations: number
}

interface Intent {
  route: Route
  absolute?: bigint
}

interface Scenario {
  name: string
  events: string[]
  expected_terminal: Position
  expected_mutations: number
}

interface RepositoryEvidence {
  frame: string
  origin: string
  head: string
  branch: string
  status: string
  candidate: string | null
}

const root = resolve(import.meta.dir, "..")
const skill = normalized(resolve(root, "SKILL.md"))
const pressure = normalized(resolve(root, "references/revision-pressure-replan.md"))
const scenarios = (JSON.parse(
  readFileSync(resolve(root, "fixtures/mission-transition-contract.json"), "utf8"),
) as { scenarios: Scenario[] }).scenarios

describe("single-Mission transition contract", () => {
  test("keeps forward, cancellation, and one backward-decision authority", () => {
    for (const transition of ["Frame → Plan", "Plan → Execute", "Execute → Verify", "Verify → Finalize"]) {
      expect(skill).toContain(transition)
    }
    expect(skill).toContain("Plain cancellation ends the Mission with its existing candidate preserved")
    expect(skill).toContain("Use one backward-transition decision for route advertisement and work admission")
    expect(skill).toContain("apply that same decision and record its consumption before any other work")
    expect(skill).toContain("one mandatory pending `reframe → replan replacement` transition")
    expect(skill).toContain("without relying on ambient in-memory state")
    expect(pressure).toContain("main skill's single backward-transition decision exclusively owns")
    expect(pressure).toContain("Do not restate or override those decisions here")
  })

  test("retains the existing lifecycle journeys through that decision", () => {
    for (const scenario of scenarios) {
      const repository = createTemporaryRepository()
      try {
        const state = replay(repository, scenario.events)
        expect(state.position, scenario.name).toBe(scenario.expected_terminal)
        expect(state.mutations, scenario.name).toBe(scenario.expected_mutations)
        if (scenario.name === "user-override-before-mutation" || scenario.name === "user-override-discard") {
          expect(git(repository, "status", "--porcelain"), scenario.name).toBe("")
        } else if (scenario.expected_mutations > 0) {
          expect(git(repository, "status", "--porcelain"), scenario.name).not.toBe("")
        }
      } finally {
        rmSync(repository, { recursive: true, force: true })
      }
    }
  })

  test("keeps cancellation preservation, discard cleanup, and terminal scope distinct", () => {
    const cancelRepository = createTemporaryRepository()
    const discardRepository = createTemporaryRepository()
    try {
      const prefix = ["frame-complete", "plan-admitted", "candidate-ready"]
      expect(replay(cancelRepository, [...prefix, "user-override-cancel"]).position).toBe("cancelled")
      expect(git(cancelRepository, "status", "--porcelain")).not.toBe("")
      expect(replay(discardRepository, [...prefix, "user-override-discard"]).position).toBe("cancelled")
      expect(git(discardRepository, "status", "--porcelain")).toBe("")
      expect(() => replay(cancelRepository, ["user-override-cancel", "scope-expanded", "reframe"]))
        .toThrow("scope-expanded requires an active Mission")
    } finally {
      rmSync(cancelRepository, { recursive: true, force: true })
      rmSync(discardRepository, { recursive: true, force: true })
    }
  })

  test("uses complete arbitrary ceilings and makes every advertised route reachable", () => {
    for (const absolute of [1n, 2n, 4n, 17n, 9_007_199_254_740_993n]) {
      const beforeLast = atFailure("local", absolute - 1n, absolute)
      const started = begin(beforeLast, { route: "revise" })
      expect(started.used).toBe(absolute)

      const exhausted = atFailure("local", absolute, absolute)
      expect(routes(exhausted)).toEqual(["enlarge", "blocked"])
      expect(advertisedReachable(exhausted)).toBe(true)
    }

    const enlarged = begin(atFailure("design", 4n, 4n), { route: "enlarge", absolute: 5n })
    expect(enlarged).toMatchObject({ absolute: 5n, used: 4n, enlarged: true })
    expect(routes(enlarged)).toEqual(["reframe-replacement", "blocked"])
    const reframed = begin(enlarged, { route: "reframe-replacement" })
    expect(reframed).toMatchObject({ position: "Frame", used: 5n, pending: "replacement-plan" })
  })

  test("does not advertise or begin exhausted local and scope routes", () => {
    for (const [failure, ordinary] of [["local", "revise"], ["scope", "reframe"]] as const) {
      const state = atFailure(failure, 4n, 4n)
      expect(routes(state)).toEqual(["enlarge", "blocked"])
      expect(() => begin(state, { route: ordinary })).toThrow("route is not available")
    }
  })

  test("recovers attempts, budgets, and pending work from evidence alone", () => {
    const state = begin(atFailure("design", 4n, 4n), { route: "enlarge", absolute: 5n })
    state.attempts.ambiguity = 1n
    state.attemptCeilings.ambiguity = 3n
    const evidence = checkpoint(state)
    const recovered = recover(JSON.parse(JSON.stringify(evidence)) as unknown)

    expect(recovered).toEqual(state)
    expect(recovered.attempts).toEqual({ ambiguity: 1n })
    expect(recovered.attemptCeilings).toEqual({ ambiguity: 3n })
    expect(routes(recovered)).toEqual(["reframe-replacement", "blocked"])

    for (const field of [
      "absolute", "used", "enlarged", "attempts", "attemptCeilings", "pending", "resume", "mutations", "repository",
    ]) {
      const incomplete = structuredClone(evidence) as Record<string, unknown>
      delete incomplete[field]
      expect(() => recover(incomplete), field).toThrow("incomplete recovery evidence")
    }
  })

  test("binds recovery to Frame, origin, Git state, and the exact candidate", () => {
    const repository = createTemporaryRepository()
    try {
      writeFileSync(resolve(repository, "candidate.txt"), "candidate-one\n")
      const state = atFailure("design", 1n, 2n)
      const evidence = checkpoint(state, repositoryEvidence(repository))
      writeFileSync(resolve(repository, "candidate.txt"), "candidate-two\n")
      expect(() => recover(evidence, repositoryEvidence(repository))).toThrow("recovery evidence does not match")
    } finally {
      rmSync(repository, { recursive: true, force: true })
    }
  })

  test("uses each evidence question's full absolute ceiling", () => {
    const state = initial()
    state.failure = "ambiguity"
    state.attemptCeilings.ambiguity = 3n
    for (let attempt = 1n; attempt <= 3n; attempt += 1n) consumeEvidenceAttempt(state, "ambiguity")
    expect(state.attempts.ambiguity).toBe(3n)
    expect(() => consumeEvidenceAttempt(state, "ambiguity")).toThrow("evidence Stop exhausted")
  })

  test("cannot Resume around reframe or enlarge twice after a material recurrence", () => {
    const exhausted = begin(atFailure("local", 4n, 4n), { route: "blocked" })
    expect(resume(exhausted).position).toBe("Finalize")
    expect(() => candidateReady(resume(exhausted))).toThrow("candidate requires Execute")

    const enlarged = begin(atFailure("scope", 4n, 4n), { route: "enlarge", absolute: 5n })
    const resumed = resume(recover(checkpoint(begin(enlarged, { route: "blocked" }))))
    expect(resumed).toMatchObject({ position: "Finalize", pending: "reframe-replan-replacement", used: 4n })
    expect(() => admitPlan(resumed, true)).toThrow("plan admission requires Plan")

    let replacement = begin(resumed, { route: "reframe-replacement" })
    expect(replacement.used).toBe(5n)
    replacement = completeFrame(recover(checkpoint(replacement)))
    replacement = admitPlan(replacement, true)
    replacement = candidateReady(replacement)
    replacement = verify(replacement, "material")
    expect(routes(replacement)).toEqual(["blocked"])
    expect(() => begin(replacement, { route: "enlarge", absolute: 6n })).toThrow("route is not available")
    expect(() => resume(begin(replacement, { route: "blocked" }))).toThrow("blocked Mission has no Resume")
  })

  test("preserves the envelope across incidental moves and allows explicit positive controls", () => {
    const state = atFailure("design", 2n, 4n)
    const moved = continueMission(state, ["turn", "compaction", "successor", "branch", "checkout", "rename"])
    expect(stopOf(moved)).toEqual(stopOf(state))

    for (const [reason, absolute] of [["materially-changed-frame", 7n], ["independent-outcome", 3n]] as const) {
      const fresh = newEnvelope(reason, absolute)
      expect(stopOf(fresh)).toEqual({
        absolute, used: 0n, enlarged: false, attempts: {}, attemptCeilings: {}, pending: null,
      })
    }
  })

  test("kills the escaped mechanisms and adjacent mutants", () => {
    expect(approveFive("none")).toBe(true)
    expect(approveFive("hard-coded-enlargement")).toBe(false)
    expect(advertisedReachable(atFailure("local", 4n, 4n), "none")).toBe(true)
    expect(advertisedReachable(atFailure("local", 4n, 4n), "advertise-split")).toBe(false)

    const incomplete = checkpoint(initial()) as Record<string, unknown>
    delete incomplete.attempts
    expect(() => recover(incomplete)).toThrow("incomplete recovery evidence")

    expect(pendingSurvivesResume("none")).toBe(true)
    expect(pendingSurvivesResume("resume-frame")).toBe(false)
    expect(begin(atFailure("local", 0n, 2n), { route: "revise" }).used).toBe(1n)
    expect(begin(atFailure("local", 0n, 2n), { route: "revise" }, "skip-consumption").used).toBe(0n)
    expect(continueMission(atFailure("design", 2n, 4n), ["rename"]).used).toBe(2n)
    expect(continueMission(atFailure("design", 2n, 4n), ["rename"], "reset-on-move").used).toBe(0n)
    expect(secondEnlargement("none")).toBe(false)
    expect(secondEnlargement("second-enlargement")).toBe(true)
  })
})

function decision(state: State, intent?: Intent, fault: Fault = "none"): { available: Route[]; next?: State } {
  if (state.position !== "Finalize") throw new Error("backward decision requires Finalize")
  if (state.used > state.absolute) throw new Error("consumption exceeds absolute ceiling")

  let available: Route[]
  if (state.pending === "reframe-replan-replacement") available = ["reframe-replacement", "blocked"]
  else if (state.passed) available = ["accept"]
  else if (state.failure === "material" && state.enlarged) {
    available = fault === "second-enlargement" ? ["enlarge", "blocked"] : ["blocked"]
  } else if (state.used === state.absolute) {
    available = state.enlarged ? ["blocked"] : ["enlarge", "blocked"]
    if (fault === "advertise-split" && intent === undefined) {
      const ordinary = ordinaryRoute(state.failure)
      if (ordinary !== null) available = [ordinary, ...available]
    }
  } else {
    const ordinary = ordinaryRoute(state.failure)
    available = ordinary === null ? ["blocked"] : [ordinary, "blocked"]
  }

  if (intent === undefined) return { available }
  if (!available.includes(intent.route)) throw new Error(`route is not available: ${intent.route}`)
  const next = clone(state)

  if (intent.route === "accept") next.position = "accepted"
  else if (intent.route === "blocked") {
    next.position = "blocked"
    next.resume = resumeFromDecision(state)
  } else if (intent.route === "enlarge") {
    if (intent.absolute === undefined || intent.absolute <= state.absolute) {
      throw new Error("enlargement must name a larger absolute ceiling")
    }
    if (fault === "hard-coded-enlargement" && ![3n, 4n].includes(intent.absolute)) {
      throw new Error("unknown enlargement event")
    }
    next.absolute = intent.absolute
    next.enlarged = true
    next.pending = "reframe-replan-replacement"
    next.failure = null
  } else {
    if (fault !== "skip-consumption") next.used += 1n
    if (next.used > next.absolute) throw new Error("absolute backward Stop exhausted")
    next.failure = null
    if (intent.route === "revise") next.position = "Execute"
    if (intent.route === "replan") next.position = "Plan"
    if (intent.route === "reframe") next.position = "Frame"
    if (intent.route === "reframe-replacement") {
      next.position = "Frame"
      next.pending = "replacement-plan"
    }
  }
  return { available, next }
}

function routes(state: State, fault: Fault = "none"): Route[] {
  return decision(state, undefined, fault).available
}

function begin(state: State, intent: Intent, fault: Fault = "none"): State {
  const next = decision(state, intent, fault).next
  if (next === undefined) throw new Error("decision did not produce a next state")
  return next
}

function ordinaryRoute(failure: Failure): "revise" | "replan" | "reframe" | null {
  if (failure === "local") return "revise"
  if (failure === "design") return "replan"
  if (failure === "scope") return "reframe"
  return null
}

function resumeFromDecision(state: State): Position | null {
  if (state.failure === "material" && state.enlarged) return null
  if (state.pending === "reframe-replan-replacement") return "Finalize"
  if (state.used === state.absolute) return state.enlarged ? null : "Finalize"
  if (state.failure === "local") return "Execute"
  if (state.failure === "design") return "Plan"
  if (state.failure === "scope" || state.failure === "ambiguity") return "Frame"
  return null
}

function initial(absolute = 2n): State {
  if (absolute <= 0n) throw new Error("absolute ceiling must be positive")
  return {
    position: "Frame", failure: null, passed: false, absolute, used: 0n, enlarged: false,
    attempts: {}, attemptCeilings: {}, pending: null, resume: null, mutations: 0,
  }
}

function atFailure(failure: Exclude<Failure, null>, used: bigint, absolute: bigint): State {
  return { ...initial(absolute), position: "Finalize", failure, used }
}

function completeFrame(state: State): State {
  if (state.position !== "Frame") throw new Error("frame completion requires Frame")
  return { ...clone(state), position: "Plan" }
}

function admitPlan(state: State, replacement = false): State {
  if (state.position !== "Plan") throw new Error("plan admission requires Plan")
  if ((state.pending === "replacement-plan") !== replacement) throw new Error("replacement Plan mismatch")
  return { ...clone(state), position: "Execute", pending: replacement ? null : state.pending }
}

function candidateReady(state: State): State {
  if (state.position !== "Execute") throw new Error("candidate requires Execute")
  return { ...clone(state), position: "Verify", mutations: state.mutations + 1 }
}

function verify(state: State, result: "pass" | Exclude<Failure, null>): State {
  if (state.position !== "Verify") throw new Error("verification requires Verify")
  return { ...clone(state), position: "Finalize", passed: result === "pass", failure: result === "pass" ? null : result }
}

function resume(state: State, fault: Fault = "none"): State {
  if (state.position !== "blocked" || state.resume === null) throw new Error("blocked Mission has no Resume")
  const position = fault === "resume-frame" && state.pending === "reframe-replan-replacement"
    ? "Frame" : state.resume
  return { ...clone(state), position, resume: null }
}

function continueMission(state: State, moves: string[], fault: Fault = "none"): State {
  if (moves.length > 0 && fault === "reset-on-move") return initial(state.absolute)
  return clone(state)
}

function newEnvelope(reason: "materially-changed-frame" | "independent-outcome", absolute: bigint): State {
  void reason
  return initial(absolute)
}

function checkpoint(
  state: State,
  repository: RepositoryEvidence = stableRepositoryEvidence(),
): Record<string, unknown> {
  return {
    position: state.position, failure: state.failure, passed: state.passed,
    absolute: state.absolute.toString(), used: state.used.toString(), enlarged: state.enlarged,
    attempts: Object.fromEntries(Object.entries(state.attempts).map(([key, value]) => [key, value.toString()])),
    attemptCeilings: Object.fromEntries(
      Object.entries(state.attemptCeilings).map(([key, value]) => [key, value.toString()]),
    ),
    pending: state.pending, resume: state.resume, mutations: state.mutations, repository,
  }
}

function recover(
  value: unknown,
  currentRepository: RepositoryEvidence = stableRepositoryEvidence(),
): State {
  const keys = [
    "position", "failure", "passed", "absolute", "used", "enlarged", "attempts", "attemptCeilings",
    "pending", "resume", "mutations", "repository",
  ]
  if (!record(value) || !keys.every((key) => Object.hasOwn(value, key))
    || !record(value.attempts) || !record(value.attemptCeilings) || !record(value.repository)) {
    throw new Error("incomplete recovery evidence")
  }
  if (JSON.stringify(value.repository) !== JSON.stringify(currentRepository)) {
    throw new Error("recovery evidence does not match")
  }
  if (typeof value.absolute !== "string" || typeof value.used !== "string") throw new Error("invalid recovery evidence")
  const attempts: Record<string, bigint> = {}
  for (const [key, count] of Object.entries(value.attempts)) {
    if (typeof count !== "string") throw new Error("invalid recovery evidence")
    attempts[key] = BigInt(count)
  }
  const attemptCeilings: Record<string, bigint> = {}
  for (const [key, ceiling] of Object.entries(value.attemptCeilings)) {
    if (typeof ceiling !== "string") throw new Error("invalid recovery evidence")
    attemptCeilings[key] = BigInt(ceiling)
  }
  const state = {
    position: value.position, failure: value.failure, passed: value.passed,
    absolute: BigInt(value.absolute), used: BigInt(value.used), enlarged: value.enlarged,
    attempts, attemptCeilings, pending: value.pending, resume: value.resume, mutations: value.mutations,
  }
  if (!validState(state)) throw new Error("invalid recovery evidence")
  return state
}

function replay(repository: string, events: string[]): State {
  let state = initial()
  let evidence: Record<string, unknown> | null = null
  for (const event of events) {
    if (event === "frame-complete") state = completeFrame(state)
    else if (event === "plan-admitted") state = admitPlan(state)
    else if (event === "candidate-ready") {
      state = candidateReady(state)
      writeFileSync(resolve(repository, "candidate.txt"), `candidate-${state.mutations}\n`)
    }
    else if (event === "verify-pass") state = verify(state, "pass")
    else if (event === "verify-fail-local") state = verify(state, "local")
    else if (event === "verify-fail-design") state = verify(state, "design")
    else if (["revise", "replan", "reframe"].includes(event)) state = begin(state, { route: event as Route })
    else if (event === "scope-expanded") {
      requireActive(state.position, event)
      state = { ...state, position: "Finalize", failure: "scope" }
    }
    else if (event === "blocked") state = begin(state, { route: "blocked" })
    else if (event === "resume-blocker-removed") state = resume(state)
    else if (event === "context-lost") {
      evidence = checkpoint(state, repositoryEvidence(repository)); state = initial(99n)
    }
    else if (event === "recover-exact") {
      if (evidence === null) throw new Error("recover-exact requires evidence")
      state = recover(evidence, repositoryEvidence(repository)); evidence = null
    } else if (event === "frame-ambiguity") {
      state.failure = "ambiguity"
      state.attemptCeilings.ambiguity = 2n
    }
    else if (event === "evidence-attempt") {
      consumeEvidenceAttempt(state, "ambiguity")
    } else if (event === "evidence-exhausted") state.position = "Finalize"
    else if (event === "accept") state = begin(state, { route: "accept" })
    else if (event === "user-override-cancel") state.position = "cancelled"
    else if (event === "user-override-discard") {
      unlinkSync(resolve(repository, "candidate.txt"))
      state.position = "cancelled"
    }
    else throw new Error(`unknown event: ${event}`)
  }
  return state
}

function advertisedReachable(state: State, fault: Fault = "none"): boolean {
  return routes(state, fault).every((route) => {
    try {
      begin(state, route === "enlarge" ? { route, absolute: state.absolute + 1n } : { route }, fault)
      return true
    } catch { return false }
  })
}

function approveFive(fault: Fault): boolean {
  try { return begin(atFailure("design", 4n, 4n), { route: "enlarge", absolute: 5n }, fault).absolute === 5n }
  catch { return false }
}

function pendingSurvivesResume(fault: Fault): boolean {
  const enlarged = begin(atFailure("scope", 4n, 4n), { route: "enlarge", absolute: 5n })
  const state = resume(begin(enlarged, { route: "blocked" }), fault)
  return state.position === "Finalize" && state.pending === "reframe-replan-replacement"
}

function secondEnlargement(fault: Fault): boolean {
  const state = atFailure("material", 3n, 3n)
  state.enlarged = true
  try { begin(state, { route: "enlarge", absolute: 4n }, fault); return true }
  catch { return false }
}

function stopOf(
  state: State,
): Pick<State, "absolute" | "used" | "enlarged" | "attempts" | "attemptCeilings" | "pending"> {
  return {
    absolute: state.absolute, used: state.used, enlarged: state.enlarged,
    attempts: state.attempts, attemptCeilings: state.attemptCeilings, pending: state.pending,
  }
}

function clone(state: State): State {
  return { ...state, attempts: { ...state.attempts }, attemptCeilings: { ...state.attemptCeilings } }
}

function consumeEvidenceAttempt(state: State, question: string): void {
  const absolute = state.attemptCeilings[question]
  if (absolute === undefined || absolute <= 0n) throw new Error("evidence question requires an absolute ceiling")
  const used = (state.attempts[question] ?? 0n) + 1n
  if (used > absolute) throw new Error("evidence Stop exhausted")
  state.attempts[question] = used
}

function requireActive(position: Position, event: string): void {
  if (!["Frame", "Plan", "Execute", "Verify", "Finalize"].includes(position)) {
    throw new Error(`${event} requires an active Mission`)
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

function repositoryEvidence(repository: string): RepositoryEvidence {
  const candidatePath = resolve(repository, "candidate.txt")
  return {
    frame: "frozen outcome, consumer, scope, authority, acceptance, and Stop",
    origin: git(repository, "rev-list", "--max-parents=0", "HEAD"),
    head: git(repository, "rev-parse", "HEAD"),
    branch: git(repository, "branch", "--show-current"),
    status: git(repository, "status", "--porcelain"),
    candidate: existsSync(candidatePath) ? readFileSync(candidatePath, "utf8") : null,
  }
}

function stableRepositoryEvidence(): RepositoryEvidence {
  return {
    frame: "frozen-frame",
    origin: "origin-commit",
    head: "candidate-head",
    branch: "candidate-branch",
    status: "candidate-status",
    candidate: "candidate-diff",
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validState(value: unknown): value is State {
  if (!record(value) || !record(value.attempts) || !record(value.attemptCeilings)) return false
  return ["Frame", "Plan", "Execute", "Verify", "Finalize", "accepted", "blocked", "cancelled"].includes(value.position as string)
    && (value.failure === null || ["local", "design", "scope", "material", "ambiguity"].includes(value.failure as string))
    && typeof value.passed === "boolean" && typeof value.absolute === "bigint" && value.absolute > 0n
    && typeof value.used === "bigint" && value.used >= 0n && value.used <= value.absolute
    && typeof value.enlarged === "boolean"
    && validAttempts(value.attempts, value.attemptCeilings)
    && (value.pending === null || ["reframe-replan-replacement", "replacement-plan"].includes(value.pending as string))
    && (value.resume === null || ["Frame", "Plan", "Execute", "Verify", "Finalize"].includes(value.resume as string))
    && typeof value.mutations === "number"
}

function validAttempts(
  attempts: Record<string, unknown>,
  ceilings: Record<string, unknown>,
): boolean {
  return Object.entries(ceilings).every(([question, absolute]) => {
    const used = attempts[question] ?? 0n
    return typeof absolute === "bigint" && absolute > 0n
      && typeof used === "bigint" && used >= 0n && used <= absolute
  }) && Object.keys(attempts).every((question) => Object.hasOwn(ceilings, question))
}

function normalized(path: string): string {
  return readFileSync(path, "utf8").replace(/\s+/g, " ")
}
