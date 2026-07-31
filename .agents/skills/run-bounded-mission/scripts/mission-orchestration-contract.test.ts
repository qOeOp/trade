import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const skillRoot = resolve(import.meta.dir, "..")
const skill = normalized(resolve(skillRoot, "SKILL.md"))
const dispatch = normalized(resolve(skillRoot, "references/task-dispatch.md"))
const refactor = normalized(resolve(skillRoot, "references/refactor-mission-proposal.md"))
const fixtures = JSON.parse(
  readFileSync(resolve(skillRoot, "fixtures/mission-orchestration-contract.json"), "utf8"),
) as Array<{ name: string; disposition: string }>

describe("session-only Mission orchestration contract", () => {
  test("covers every required name and disposition", () => {
    expect(fixtures).toHaveLength(16)
    expect(new Set(fixtures.map(({ name }) => name)).size).toBe(fixtures.length)
    expect(Object.fromEntries(fixtures.map(({ name, disposition }) => [name, disposition]))).toEqual({
      "direct-no-mission": "handle-directly",
      single: "execute-in-current-session",
      "parallel-wave": "dispatch-mutually-independent-ready-wave",
      "serial-dependency": "serialize-direct-after-edge",
      "write-conflict": "return-to-plan-and-serialize",
      "deferred-downstream": "defer-until-predecessors-integrate",
      "base-drift": "revalidate-from-observed-canonical-tip",
      "blocked-descendants": "freeze-descendants-continue-independent",
      "covered-leaf-no-task-no-pr": "keep-as-internal-subtask",
      "queued-identity": "fail-close-wait-and-send",
      "host-unavailable": "preserve-undispatched-manual-packet",
      "compaction-resume": "reconstruct-from-exact-host-and-git-facts",
      "compaction-lost-identity": "fail-close-next-operation",
      "user-override": "freeze-undispatched-and-merge-release",
      "no-refactor": "return-without-proposal",
      "refactor-proposal": "request-user-approval-for-new-mission",
    })
  })

  test("admits only independent Missions and keeps covered work internal", () => {
    for (const field of [
      "Outcome valuable to a named real consumer",
      "Acceptance that can independently falsify its result",
      "independent owner, write surface, and delivery boundary",
      "independently accepted, blocked, or cancelled",
    ]) expect(dispatch).toContain(field)

    expect(dispatch).toContain("coupled producer/consumer")
    expect(dispatch).toContain("internal subtasks")
    expect(dispatch).toContain("no separate child task or pull request")
    expect(dispatch).toContain("With zero independent Missions, handle the request directly")
    expect(dispatch).toContain("With one, execute it in the current session")
  })

  test("keeps the graph session-only and releases merges serially", () => {
    for (const field of [
      "stable session label",
      "Outcome and real consumer",
      "Scope and non-goals",
      "falsifiable Acceptance",
      "owner and write surface",
      "listing only direct predecessors",
      "Authority and external effects",
      "source ref and observed exact tip",
      "host identity and next gate",
    ]) expect(dispatch).toContain(field)

    expect(dispatch).toContain("Only a ready wave with mutually independent")
    expect(dispatch).toContain("releases at most one exact candidate head for merge")
    expect(dispatch).toContain("Every other open pull request then has base drift")
    expect(dispatch).toContain("A dependent child may be created only from the newly observed tip")
    expect(dispatch).not.toContain(
      "do not create a dependency graph, pre-create downstream work, order tasks automatically, or wait on a child",
    )
  })

  test("fails closed across blocked work, identity loss, and host failure", () => {
    expect(dispatch).toContain("If a child blocks, freeze its descendants")
    expect(dispatch).toContain("independent nodes may continue only when")
    expect(dispatch).toContain("Unknown shared write surface returns")
    expect(dispatch).toContain("user override freezes undispatched nodes")
    expect(dispatch).toContain("reconstruct only from exact thread, host, pull-request head")
    expect(dispatch).toContain("If an identity cannot be recovered exactly, fail closed")
    expect(dispatch).toContain("queued `clientThreadId` is not a task identity")
    expect(dispatch).toContain("hide it in a subagent")
    expect(dispatch).toContain("never authorizes an automatic retry, replacement, or host transfer")
  })

  test("requires integrated structural evidence before a new refactor proposal", () => {
    expect(skill).toContain("integrated into the current canonical source tip")
    expect(skill).toContain("Acceptance count alone is investigation eligibility")
    expect(refactor).toContain("establish investigation eligibility only")
    expect(refactor).toContain("no-change counterfactual")
    expect(refactor).toContain("quantitative structural target")
    expect(refactor).toContain("Mission count")
    expect(refactor).toContain("Prefer deletion, migration, and owner convergence")
    expect(refactor).toContain("preservation of every bound consumer behavior")
    expect(refactor).toContain("unknown future outcomes are not pre-authorized")
  })

  test("preserves explicit dispatch and child ownership boundaries", () => {
    expect(dispatch).toContain("user's explicit request or approval")
    expect(dispatch).toContain("one native create attempt")
    expect(dispatch).toContain("Origin must equal that tip")
    expect(dispatch).toContain("one managed worktree, one eventual branch, and at most one pull request")
    expect(dispatch).toContain("Do not serialize the outcome in the current worktree")
  })
})

function normalized(path: string): string {
  return readFileSync(path, "utf8").replace(/\s+/g, " ")
}
