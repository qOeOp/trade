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

function observation(
  createdAt: string,
  overrides: Partial<PullRequestSnapshot["headObservations"][number]> = {},
): PullRequestSnapshot["headObservations"][number] {
  return {
    id: 1,
    pullRequestNumber: 7,
    headSha: head,
    baseRef: "main",
    baseSha: base,
    createdAt,
    ...overrides,
  }
}

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
    headObservations: [observation("2026-07-27T01:01:00Z")],
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

  test("does not reuse same-head reviews or roots from an earlier base window", () => {
    const stale = snapshot()
    stale.reviews.push({
      id: 21,
      actor: "chatgpt-codex-connector",
      submittedAt: "2026-07-27T01:00:00Z",
      commitSha: head,
    })
    stale.threads.push({
      id: "T_stale_window",
      resolved: true,
      comments: [{
        id: 22,
        nodeId: "RC_22",
        actor: "chatgpt-codex-connector",
        association: "NONE",
        body: "Finding from an invalidated base window.",
        createdAt: "2026-07-27T01:00:00Z",
        includesCreatedEdit: false,
        lastEditedAt: null,
        reviewCommitSha: head,
      }],
    })
    expect(verify(stale)).toMatchObject({ ok: true, reasons: [] })

    stale.reviews[0]!.submittedAt = "2026-07-27T01:02:00Z"
    stale.threads[0]!.comments[0]!.createdAt = "2026-07-27T01:02:00Z"
    expect(verify(stale).reasons).toContain(
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

  test("requires a historical fix commit strictly between the finding and reply", () => {
    const finding = snapshot()
    finding.threads.push({
      id: "T_causal",
      resolved: true,
      comments: [{
        id: 33,
        nodeId: "RC_33",
        actor: "chatgpt-codex-connector",
        association: "NONE",
        body: "Fix this.",
        createdAt: "2026-07-27T00:05:00Z",
        includesCreatedEdit: false,
        lastEditedAt: null,
        reviewCommitSha: reviewed,
      }, {
        id: 34,
        nodeId: "RC_34",
        actor: "owner",
        association: "OWNER",
        body: `Fixed in ${head}: repaired after review`,
        createdAt: "2026-07-27T01:05:00Z",
        includesCreatedEdit: false,
        lastEditedAt: null,
        reviewCommitSha: reviewed,
      }],
    })

    finding.commitTimes[head] = "2026-07-27T00:05:00Z"
    expect(verify(finding).reasons).toContain(
      "Codex finding 33 fix commit does not postdate the finding",
    )

    finding.commitTimes[head] = "2026-07-27T01:05:00Z"
    expect(verify(finding).reasons).toContain(
      "Codex finding 33 reply does not postdate its fix commit",
    )

    delete finding.commitTimes[head]
    expect(verify(finding).reasons).toContain(
      "Codex finding 33 fix commit has no valid timestamp",
    )
  })

  test("rejects duplicate native review-comment identities across threads", () => {
    const finding = snapshot()
    const comments = [{
      id: 35,
      nodeId: "RC_35",
      actor: "chatgpt-codex-connector",
      association: "NONE",
      body: "Fix this.",
      createdAt: "2026-07-27T00:05:00Z",
      includesCreatedEdit: false,
      lastEditedAt: null,
      reviewCommitSha: reviewed,
    }, {
      id: 36,
      nodeId: "RC_36",
      actor: "owner",
      association: "OWNER",
      body: `Fixed in ${head}: repaired after review`,
      createdAt: "2026-07-27T01:05:00Z",
      includesCreatedEdit: false,
      lastEditedAt: null,
      reviewCommitSha: reviewed,
    }]
    finding.threads.push(
      { id: "T_duplicate_1", resolved: true, comments },
      {
        id: "T_duplicate_2",
        resolved: true,
        comments: comments.map((comment) => ({ ...comment })),
      },
    )

    expect(verify(finding).reasons).toEqual(expect.arrayContaining([
      "duplicate review comment ID",
      "duplicate review comment node ID",
    ]))
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
    preHead.headObservations = [observation("2026-07-27T01:06:00Z")]
    expect(verify(preHead).reasons).toContain(
      "expected one current-head explicit Codex trigger, found 0",
    )
    preHead.headObservations = []
    expect(verify(preHead).reasons).toContain(
      "no exact head/base pull_request workflow run proves the current window",
    )
  })

  test("does not reuse a trigger from before the latest matching head observation", () => {
    const reentered = snapshot()
    reentered.headObservations = [
      observation("2026-07-27T00:30:00Z"),
      observation("2026-07-27T01:06:00Z", { id: 2 }),
    ]
    expect(verify(reentered).reasons).toContain(
      "expected one current-head explicit Codex trigger, found 0",
    )
  })

  test("accepts one fresh trigger after the same head re-enters the PR", () => {
    const reentered = snapshot()
    const oldTrigger = {
      ...reentered.comments[0]!,
      id: 9,
      nodeId: "IC_9",
      createdAt: "2026-07-27T00:40:00Z",
      reactions: [],
    }
    reentered.headObservations = [
      observation("2026-07-27T00:30:00Z"),
      observation("2026-07-27T01:01:00Z", { id: 2 }),
    ]
    reentered.comments.unshift(oldTrigger)
    expect(verify(reentered)).toMatchObject({ ok: true, reasons: [] })
  })

  test("requires the latest matching head observation to strictly predate the trigger", () => {
    const simultaneous = snapshot()
    simultaneous.headObservations = [observation("2026-07-27T01:05:00Z")]
    expect(verify(simultaneous).reasons).toContain(
      "expected one current-head explicit Codex trigger, found 0",
    )
  })

  test("requires a workflow run for the exact current base identity", () => {
    const wrongBase = snapshot()
    wrongBase.headObservations = [
      observation("2026-07-27T01:04:00Z", { baseSha: "d".repeat(40) }),
    ]
    expect(verify(wrongBase).reasons).toContain(
      "no exact head/base pull_request workflow run proves the current window",
    )

    wrongBase.headObservations.push(
      observation("2026-07-27T01:01:00Z", { id: 2 }),
    )
    expect(verify(wrongBase)).toMatchObject({ ok: true, reasons: [] })
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
    expect(workflow).toContain("  actions: read")
    expect(workflow).toContain("--allow-draft")
    expect(workflow).toContain("if: ${{ always() }}")
    expect(workflow.slice(final)).not.toContain("gh api", "after the final status call")
    expect(checker).toContain("maxBuffer: GH_MAX_BUFFER_BYTES")
    expect(checker).toContain("const GH_MAX_BUFFER_BYTES = 64 * 1024 * 1024")
  })
})
