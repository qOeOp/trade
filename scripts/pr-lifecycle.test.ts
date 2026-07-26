import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  activeClaimEpoch,
  markerBody,
  parseMarker,
  stableClaim,
  verifyReceipt,
  type IssueComment,
  type PullRequestSnapshot,
  type ReviewThread,
} from "./pr-lifecycle"

const head = "a".repeat(40)
const base = "b".repeat(40)
const fix = "c".repeat(40)
const claimCreatedAt = "2026-07-26T00:00:00Z"
const triggerCreatedAt = "2026-07-26T00:01:00Z"

function comment(
  id: number,
  body: string,
  overrides: Partial<IssueComment> = {},
): IssueComment {
  return {
    id,
    nodeId: `node-${id}`,
    actor: "qOeOp",
    association: "OWNER",
    body,
    createdAt: claimCreatedAt,
    minimized: false,
    reactions: [],
    ...overrides,
  }
}

function claimComment(id = 1, mission = "mission-a", createdAt = claimCreatedAt): IssueComment {
  return comment(id, markerBody("pr-lifecycle-claim:v1", {
    mission,
    actor: "qOeOp",
  }), { createdAt })
}

function triggerComment(id = 10): IssueComment {
  return comment(id, [
    "@codex review",
    markerBody("pr-lifecycle-review:v1", {
      claim_id: 1,
      mission: "mission-a",
      head,
      base_ref: "main",
      base_sha: base,
    }),
  ].join("\n"), {
    createdAt: triggerCreatedAt,
    reactions: [{
      actor: "chatgpt-codex-connector[bot]",
      content: "+1",
      createdAt: "2026-07-26T00:02:00Z",
    }],
  })
}

function snapshot(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return {
    repository: "qOeOp/trade",
    defaultBranch: "main",
    number: 100,
    open: true,
    draft: false,
    merged: false,
    headSha: head,
    headRepository: "qOeOp/trade",
    baseRef: "main",
    baseSha: base,
    commits: [fix, head],
    comments: [claimComment(), triggerComment()],
    rootReactions: [],
    reviews: [],
    threads: [],
    complete: true,
    ...overrides,
  }
}

function findingThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "thread-1",
    resolved: true,
    outdated: true,
    comments: [
      {
        id: 50,
        actor: "chatgpt-codex-connector",
        body: "finding",
        createdAt: "2026-07-26T00:00:30Z",
        outdated: true,
        reviewCommitSha: "d".repeat(40),
      },
      {
        id: 51,
        actor: "qOeOp",
        body: markerBody("pr-lifecycle-finding:v1", {
          thread_id: "thread-1",
          finding_comment_id: 50,
          disposition: "fixed",
          fix_sha: fix,
          reason: "covered by the regression",
        }),
        createdAt: "2026-07-26T00:00:40Z",
        outdated: true,
        reviewCommitSha: null,
      },
    ],
    ...overrides,
  }
}

describe("claim election", () => {
  test("uses immutable provider order and a stable post-cutoff snapshot", () => {
    const first = snapshot({
      comments: [
        claimComment(2, "later", "2026-07-26T00:00:01Z"),
        claimComment(1, "winner", "2026-07-26T00:00:00Z"),
      ],
    })
    const second = structuredClone(first)

    expect(stableClaim(first, second, Date.parse("2026-07-26T00:00:31Z"))).toMatchObject({
      id: 1,
      mission: "winner",
    })
  })

  test("rejects divergent claim snapshots and pre-cutoff reads", () => {
    const first = snapshot({ comments: [claimComment()] })
    const changed = snapshot({ comments: [claimComment(), claimComment(2, "late")] })

    expect(stableClaim(first, changed, Date.parse("2026-07-26T00:01:00Z"))).toBeNull()
    expect(stableClaim(first, first, Date.parse("2026-07-26T00:00:29Z"))).toBeNull()
  })

  test("starts a new epoch only after an explicit authorized takeover", () => {
    const takeover = comment(2, markerBody("pr-lifecycle-takeover:v1", {
      claim_id: 1,
      authority: "user explicitly reassigned this PR",
      actor: "qOeOp",
    }), { createdAt: "2026-07-26T00:02:00Z" })
    const next = claimComment(3, "mission-b", "2026-07-26T00:02:01Z")

    expect(activeClaimEpoch(snapshot({ comments: [claimComment(), takeover, next] }))).toEqual([
      expect.objectContaining({ id: 3, mission: "mission-b" }),
    ])
  })
})

describe("exact-head receipt", () => {
  test("accepts one correlated clean response and mapped historical findings", () => {
    const state = snapshot({ threads: [findingThread()] })
    const claim = activeClaimEpoch(state)[0]!

    expect(verifyReceipt(state, claim)).toMatchObject({
      ok: true,
      receipt: {
        triggerCommentId: 10,
        headSha: head,
        baseSha: base,
      },
    })
  })

  test("replays PR #14: an untriggered root thumb is not a review receipt", () => {
    const state = snapshot({
      comments: [claimComment()],
      rootReactions: [{
        actor: "chatgpt-codex-connector[bot]",
        content: "+1",
        createdAt: "2026-07-26T00:02:00Z",
      }],
    })

    expect(verifyReceipt(state, activeClaimEpoch(state)[0]!)).toMatchObject({
      ok: false,
      reasons: [expect.stringContaining("review trigger")],
    })
  })

  test("replays PR #23: duplicate same-head triggers fail closed", () => {
    const duplicate = triggerComment(11)
    const state = snapshot({ comments: [claimComment(), triggerComment(), duplicate] })

    expect(verifyReceipt(state, activeClaimEpoch(state)[0]!)).toMatchObject({
      ok: false,
      reasons: [expect.stringContaining("found 2")],
    })
  })

  test("replays PR #4: a later finding review overrides an earlier thumb", () => {
    const state = snapshot({
      reviews: [{
        id: 80,
        actor: "chatgpt-codex-connector",
        state: "COMMENTED",
        body: "findings",
        submittedAt: "2026-07-26T00:03:00Z",
        commitSha: head,
      }],
      threads: [findingThread({
        resolved: false,
        outdated: false,
        comments: [{
          id: 81,
          actor: "chatgpt-codex-connector",
          body: "late finding",
          createdAt: "2026-07-26T00:03:00Z",
          outdated: false,
          reviewCommitSha: head,
        }],
      })],
    })

    const result = verifyReceipt(state, activeClaimEpoch(state)[0]!)
    expect(result.ok).toBeFalse()
    expect(result.reasons).toContain("Codex submitted a finding review for the current head")
  })

  test("new head, base drift, unresolved threads, deleted triggers, and forks invalidate evidence", () => {
    const cases = [
      snapshot({ headSha: "e".repeat(40) }),
      snapshot({ baseSha: "f".repeat(40) }),
      snapshot({ threads: [findingThread({ resolved: false })] }),
      snapshot({ comments: [claimComment()] }),
      snapshot({ headRepository: "contributor/trade" }),
    ]

    for (const state of cases) {
      expect(verifyReceipt(state, activeClaimEpoch(state)[0]!).ok).toBeFalse()
    }
  })

  test("an automatic-review root reaction cannot reuse the explicit trigger", () => {
    const state = snapshot({
      rootReactions: [{
        actor: "chatgpt-codex-connector[bot]",
        content: "+1",
        createdAt: "2026-07-26T00:03:00Z",
      }],
    })

    expect(verifyReceipt(state, activeClaimEpoch(state)[0]!)).toMatchObject({
      ok: false,
      reasons: [expect.stringContaining("root reaction")],
    })
  })

  test("incomplete pagination, minimized claims, dismissed reviews, and unmapped fixes fail closed", () => {
    const incomplete = snapshot({ complete: false })
    expect(verifyReceipt(incomplete, activeClaimEpoch(incomplete)[0]!).ok).toBeFalse()

    const minimized = snapshot({ comments: [claimComment(1, "mission-a", claimCreatedAt), triggerComment()] })
    minimized.comments[0]!.minimized = true
    expect(activeClaimEpoch(minimized)).toEqual([])

    const dismissed = snapshot({
      reviews: [{
        id: 90,
        actor: "chatgpt-codex-connector",
        state: "DISMISSED",
        body: "",
        submittedAt: "2026-07-26T00:03:00Z",
        commitSha: head,
      }],
    })
    expect(verifyReceipt(dismissed, activeClaimEpoch(dismissed)[0]!).ok).toBeFalse()

    const unmapped = snapshot({ threads: [findingThread()] })
    unmapped.commits = [head]
    expect(verifyReceipt(unmapped, activeClaimEpoch(unmapped)[0]!).ok).toBeFalse()
  })
})

describe("base-owned workflow", () => {
  test("executes the default-branch SHA and binds it to the live base", () => {
    const workflow = readFileSync(
      join(import.meta.dir, "..", ".github", "workflows", "pr-lifecycle-gate.yml"),
      "utf8",
    )

    expect(workflow).toContain("ref: ${{ github.sha }}")
    expect(workflow).not.toContain("ref: ${{ inputs.expected_base_sha }}")
    expect(workflow).toContain('--trusted-workflow-sha "$GITHUB_SHA"')
  })
})

describe("markers", () => {
  test("round trips structured payloads and rejects malformed JSON", () => {
    const body = markerBody("pr-lifecycle-claim:v1", { mission: "m", actor: "a" })
    expect(parseMarker(body, "pr-lifecycle-claim:v1")).toEqual({ mission: "m", actor: "a" })
    expect(parseMarker("<!-- pr-lifecycle-claim:v1 nope -->", "pr-lifecycle-claim:v1")).toBeNull()
  })
})
