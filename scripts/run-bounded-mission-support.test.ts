import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const skillPath = resolve(
  import.meta.dir,
  "../.agents/skills/run-bounded-mission/SKILL.md",
)
const supportPath = resolve(
  import.meta.dir,
  "../.agents/skills/run-bounded-mission/references/support-lanes.md",
)
const skill = readFileSync(skillPath, "utf8")
const support = readFileSync(supportPath, "utf8")

test("support service details remain progressively loaded under main-agent authority", () => {
  expect(skill).toContain(
    "[read-only support service levels](references/support-lanes.md)",
  )
  expect(skill).toContain(
    "Fast, standard, and high-assurance are service levels",
  )
  expect(skill).toContain(
    "The main agent owns the Frame, Plan admission, candidate, evidence judgment, effects, and final route.",
  )
  expect(skill.split("\n").length).toBeLessThan(500)

  expect(support).toContain(
    "The packet is evidence, not deliberation.",
  )
  expect(support).toContain(
    "cannot freeze Frame, admit Plan, select or modify the",
  )
  expect(support).toContain(
    "judge acceptance, or sign Finalize",
  )

  expect(`${skill}\n${support}`).not.toMatch(/\b(?:gpt|claude|gemini)-[a-z0-9.-]+\b/i)
  expect(`${skill}\n${support}`).not.toMatch(
    /\b(?:always|exactly|reserve)\s+\d+\s+(?:agents?|lanes?|threads?|slots?)\b/i,
  )
})

test("fast admission and dispatch packets are observable and bounded", () => {
  for (const requirement of [
    "one narrow, unambiguous decision question",
    "authority is read-only",
    "every input or source is named",
    "compact, bounded, and directly checkable",
    "one short branch Stop is enough",
    "change exactly one identified main-agent decision",
  ]) {
    expect(support).toContain(requirement)
  }

  for (const semantic of [
    "one decision question",
    "bounded scope",
    "read-only authority",
    "exact inputs or",
    "compact expected return",
    "cheap validation method",
    "one branch Stop",
    "observable",
    "escalation conditions",
  ]) {
    expect(support).toContain(semantic)
  }

  expect(support).toContain("do not\nrequire a universal serialized record")
  expect(support).toContain("without imposing a shared status enum or schema")
  expect(support).toContain("Low invocation strength never means a lower evidence-quality bar.")
})

test("escalation and parallelism preserve the mission boundary", () => {
  expect(support).toMatch(
    /Do not\s+retry fast, append protective fast queries, or generate sibling lanes/,
  )
  expect(support).toContain(
    "Promote that same decision question once to `standard`",
  )
  expect(support).toContain(
    "Preserve Origin, Frame, Authority, and consumed Stop",
  )
  expect(support).toContain(
    "do not launch an evaluator until an admitted Plan and candidate exist",
  )
  expect(support).toContain(
    "Launch lanes concurrently only when their questions, required inputs, and outputs are mutually",
  )
  expect(support).toContain(
    "Keep a dependency sequential.",
  )
  expect(support).toContain(
    "The main agent is the only integrator.",
  )
})

test("the fixed replay matrix covers admission, refusal, escalation, and authority", () => {
  const actual = new Map<string, string>()
  for (const line of support.split("\n")) {
    const match = line.match(/^\| (S\d) \| .+ \| `([^`]+)` \|$/)
    if (match) actual.set(match[1], match[2])
  }

  expect(actual).toEqual(new Map([
    ["S1", "fast-parallel"],
    ["S2", "fast-one-packet"],
    ["S3", "sequential-not-parallel"],
    ["S4", "refuse-fast"],
    ["S5", "standard-once-no-fast-retry"],
    ["S6", "no-support"],
    ["S7", "evidence-only-reject-authority"],
    ["S8", "isolated-high-assurance-evaluator"],
  ]))
})

test("task dispatch and independent reviewer contracts stay separate", () => {
  expect(support).not.toContain("create_thread")
  expect(support).not.toContain("Create this task?")
  expect(support).not.toContain("review_status:")
  expect(support).toContain(
    "final acceptance and candidate-controlled oracles remain high-assurance",
  )
  expect(support).toContain(
    "directly serves as an acceptance oracle or trust boundary",
  )
  expect(support).toContain(
    "Do not hard-code model names, promise unsupported",
  )
})
