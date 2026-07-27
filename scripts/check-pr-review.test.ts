import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import {
  requireOutcome,
  reviewTriggerBody,
  verifySnapshot,
  type PullRequestSnapshot,
} from "./check-pr-review"

const base = "a".repeat(40)
const reviewed = "b".repeat(40)
const head = "c".repeat(40)

function snapshot(): PullRequestSnapshot {
  const trigger = reviewTriggerBody(head, "main", base)
  return {
    repository: "owner/repo",
    number: 7,
    body: "## Outcome\n\nShip the verified behavior.\n\n## Evidence\n\nChecks pass.",
    open: true,
    merged: false,
    draft: false,
    headSha: head,
    headObservations: ["2026-07-27T01:01:00Z"],
    headRepository: "owner/repo",
    baseRef: "main",
    baseSha: base,
    commits: [reviewed, head],
    commitParents: { [reviewed]: [base], [head]: [reviewed] },
    commitTimes: {
      [reviewed]: "2026-07-27T00:00:00Z",
      [head]: "2026-07-27T01:00:00Z",
    },
    comments: [{
      id: 10,
      nodeId: "IC_10",
      actor: "owner",
      association: "OWNER",
      body: trigger,
      createdAt: "2026-07-27T01:05:00Z",
      includesCreatedEdit: false,
      lastEditedAt: null,
      minimized: false,
      reactions: [{
        id: "R_1",
        content: "THUMBS_UP",
        createdAt: "2026-07-27T01:06:00Z",
        actor: "chatgpt-codex-connector",
      }],
    }],
    reviews: [],
    threads: [],
    complete: true,
  }
}

function verify(value: PullRequestSnapshot) {
  return verifySnapshot(value, { head, baseRef: "main", baseSha: base })
}

describe("Outcome capability boundary", () => {
  test("accepts only a non-empty first column-0 Outcome section", () => {
    expect(requireOutcome("## Outcome\n\nDone.\n\n## Evidence\n\nPass.")).toBe("Done.")
  })

  test.each([
    "- item\n  ## Outcome\n\nNested.",
    "> ## Outcome\n\nQuoted.",
    " ## Outcome\n\nIndented.",
    "```\n## Outcome\nNested.\n```",
    "<!--\n## Outcome\n-->\nNested.",
    "Intro\n\n## Outcome\nLate.",
  ])("rejects a non-capable nested or late heading: %s", (body) => {
    expect(() => requireOutcome(body)).toThrow("first non-empty")
  })

  test("rejects duplicate column-0 Outcome headings", () => {
    expect(() => requireOutcome("## Outcome\nOne.\n## Outcome\nTwo.")).toThrow("exactly one")
  })
})

describe("native review evidence", () => {
  test("accepts one exact trigger and one clean Codex reaction", () => {
    expect(verify(snapshot())).toMatchObject({ ok: true, reasons: [] })
  })

  test("rejects duplicate and identity-free current-head triggers", () => {
    const duplicate = snapshot()
    duplicate.comments.push({
      ...duplicate.comments[0]!,
      id: 11,
      nodeId: "IC_11",
      body: "@codex review",
    })
    expect(verify(duplicate).reasons).toContain(
      "expected one current-head explicit Codex trigger, found 2",
    )
  })

  test("rejects edited exact trigger text and a missing trigger", () => {
    const edited = snapshot()
    edited.comments[0]!.body += "\nextra"
    expect(verify(edited).reasons).toContain(
      "current Codex trigger is not the exact visible writer trigger",
    )
    const missing = snapshot()
    missing.comments = []
    expect(verify(missing).ok).toBeFalse()
  })

  test("does not let a clean reaction override a current-head finding review", () => {
    const finding = snapshot()
    finding.reviews.push({
      id: 20,
      actor: "chatgpt-codex-connector",
      submittedAt: "2026-07-27T01:06:00Z",
      commitSha: head,
    })
    expect(verify(finding).reasons).toContain(
      "current head has a Codex finding review instead of a clean result",
    )
  })

  test("requires one strict-descendant reply and resolution for historical findings", () => {
    const finding = snapshot()
    finding.threads.push({
      id: "T_1",
      resolved: false,
      comments: [{
        id: 30,
        nodeId: "RC_30",
        actor: "chatgpt-codex-connector",
        association: "NONE",
        body: "Fix this.",
        createdAt: "2026-07-27T00:05:00Z",
        includesCreatedEdit: false,
        lastEditedAt: null,
        reviewCommitSha: reviewed,
      }],
    })
    expect(verify(finding).reasons).toEqual(expect.arrayContaining([
      "Codex finding 30 is unresolved",
      "Codex finding 30 needs exactly one native Fixed in reply",
    ]))

    finding.threads[0]!.resolved = true
    finding.threads[0]!.comments.push({
      id: 31,
      nodeId: "RC_31",
      actor: "owner",
      association: "OWNER",
      body: `Fixed in ${head}: revalidated the exact provider snapshot`,
      createdAt: "2026-07-27T01:05:00Z",
      includesCreatedEdit: false,
      lastEditedAt: null,
      reviewCommitSha: reviewed,
    })
    expect(verify(finding).ok).toBeTrue()

    finding.threads[0]!.comments.push({
      ...finding.threads[0]!.comments[1]!,
      id: 32,
      nodeId: "RC_32",
    })
    expect(verify(finding).reasons).toContain(
      "Codex finding 30 needs exactly one native Fixed in reply",
    )
  })

  test("fails closed on drift and incomplete provider evidence", () => {
    const changed = snapshot()
    changed.baseSha = "d".repeat(40)
    changed.complete = false
    expect(verify(changed).reasons).toEqual(expect.arrayContaining([
      "provider snapshot is incomplete",
      "live base changed",
    ]))
  })

  test("rejects edited trigger and disposition evidence", () => {
    const editedTrigger = snapshot()
    editedTrigger.comments[0]!.includesCreatedEdit = true
    editedTrigger.comments[0]!.lastEditedAt = "2026-07-27T01:07:00Z"
    expect(verify(editedTrigger).reasons).toContain(
      "current Codex trigger is not the exact visible writer trigger",
    )

    const editedReply = snapshot()
    editedReply.threads.push({
      id: "T_edited",
      resolved: true,
      comments: [{
        id: 40,
        nodeId: "RC_40",
        actor: "chatgpt-codex-connector",
        association: "NONE",
        body: "Fix this.",
        createdAt: "2026-07-27T00:05:00Z",
        includesCreatedEdit: false,
        lastEditedAt: null,
        reviewCommitSha: reviewed,
      }, {
        id: 41,
        nodeId: "RC_41",
        actor: "owner",
        association: "OWNER",
        body: `Fixed in ${head}: repaired after review`,
        createdAt: "2026-07-27T01:05:00Z",
        includesCreatedEdit: true,
        lastEditedAt: "2026-07-27T01:06:00Z",
        reviewCommitSha: reviewed,
      }],
    })
    expect(verify(editedReply).reasons).toContain(
      "Codex finding 40 has an invalid disposition reply",
    )
  })

  test("requires a pull_request run that predates the trigger", () => {
    const preHead = snapshot()
    preHead.headObservations = ["2026-07-27T01:06:00Z"]
    expect(verify(preHead).reasons).toContain(
      "expected one current-head explicit Codex trigger, found 0",
    )
    preHead.headObservations = []
    expect(verify(preHead).reasons).toContain(
      "no pull_request workflow run proves when the head entered this PR",
    )
  })
})

describe("base-owned gate wiring", () => {
  test("keeps the checker read-only and publishes status around verification", () => {
    const checker = readFileSync("scripts/check-pr-review.ts", "utf8")
    expect(checker).not.toContain("\"--method\"")
    expect(checker).not.toContain("codex-pr-review/")
    expect(checker).not.toContain("codex-pr-review-seal/")
    expect(checker).not.toContain("codex-pr-finding-seal/")

    const workflow = readFileSync(".github/workflows/pr-lifecycle-gate.yml", "utf8")
    const pending = workflow.indexOf("-f state=pending")
    const checkout = workflow.indexOf("actions/checkout@")
    const verify = workflow.indexOf("bun scripts/check-pr-review.ts")
    const final = workflow.indexOf("-f state=\"$state\"")
    expect(pending).toBeGreaterThan(0)
    expect(checkout).toBeGreaterThan(pending)
    expect(verify).toBeGreaterThan(pending)
    expect(final).toBeGreaterThan(verify)
    expect(workflow).toContain("if: ${{ always() }}")
    expect(workflow.slice(final)).not.toContain("gh api", "after the final status call")
  })
})
