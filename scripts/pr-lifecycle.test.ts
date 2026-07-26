import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  gateStatusForLiveIdentity,
  isCodexFindingRoot,
  markerBody,
  parseMarker,
  requireComplete,
  validateClaimTag,
  validateReviewTag,
  verifyReceipt,
  type AnnotatedTag,
  type Claim,
  type IssueComment,
  type PullRequestSnapshot,
  type ReviewCycle,
  type ReviewThread,
} from "./pr-lifecycle"

const head = "a".repeat(40)
const base = "b".repeat(40)
const fix = "c".repeat(40)
const claimTagSha = "d".repeat(40)
const reviewTagSha = "e".repeat(40)

function comment(id: number, body: string, overrides: Partial<IssueComment> = {}): IssueComment {
  return {
    id,
    nodeId: `node-${id}`,
    actor: "qOeOp",
    association: "OWNER",
    body,
    createdAt: "2026-07-26T00:01:00Z",
    minimized: false,
    reactions: [],
    ...overrides,
  }
}

function triggerComment(id = 10): IssueComment {
  return comment(id, [
    "@codex review",
    markerBody("pr-lifecycle-review:v2", { review_tag_sha: reviewTagSha }),
  ].join("\n"), {
    reactions: [{
      actor: "chatgpt-codex-connector[bot]",
      content: "THUMBS_UP",
      createdAt: "2026-07-26T00:02:00Z",
    }],
  })
}

const claim: Claim = {
  tagSha: claimTagSha,
  actor: "qOeOp",
  mission: "mission-a",
  initialHead: fix,
}

const cycle: ReviewCycle = {
  tagSha: reviewTagSha,
  claimTagSha,
  actor: "qOeOp",
  mission: "mission-a",
  headSha: head,
  baseRef: "main",
  baseSha: base,
}

function snapshot(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return {
    repository: "qOeOp/trade",
    number: 100,
    open: true,
    draft: false,
    merged: false,
    headSha: head,
    headRepository: "qOeOp/trade",
    baseRef: "main",
    baseSha: base,
    commits: [fix, head],
    comments: [triggerComment()],
    rootReactions: [],
    reviews: [],
    threads: [],
    complete: true,
    ...overrides,
  }
}

function annotatedClaim(overrides: Partial<AnnotatedTag> = {}): AnnotatedTag {
  return {
    sha: claimTagSha,
    name: "codex-pr-claim/100",
    message: markerBody("pr-lifecycle-claim-tag:v1", {
      repository: "qOeOp/trade",
      pr: 100,
      mission: "mission-a",
      nonce: "unique",
      actor: "qOeOp",
      initial_head: fix,
    }),
    objectSha: fix,
    objectType: "commit",
    ...overrides,
  }
}

function annotatedReview(overrides: Partial<AnnotatedTag> = {}): AnnotatedTag {
  return {
    sha: reviewTagSha,
    name: `codex-pr-review/100/${head}`,
    message: markerBody("pr-lifecycle-review-tag:v1", {
      repository: "qOeOp/trade",
      pr: 100,
      claim_tag_sha: claimTagSha,
      mission: "mission-a",
      actor: "qOeOp",
      head,
      base_ref: "main",
      base_sha: base,
    }),
    objectSha: head,
    objectType: "commit",
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
        reviewCommitSha: "f".repeat(40),
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

describe("atomic authority tags", () => {
  test("binds the claim to repository, PR, actor, mission, and initial head", () => {
    expect(validateClaimTag(annotatedClaim(), "qOeOp/trade", 100)).toEqual(claim)
    expect(() => validateClaimTag(
      annotatedClaim({ objectSha: head }),
      "qOeOp/trade",
      100,
    )).toThrow("invalid claim tag")
  })

  test("binds one review cycle to the exact claim, head, and live base", () => {
    expect(validateReviewTag(annotatedReview(), snapshot(), claim)).toEqual(cycle)
    expect(() => validateReviewTag(
      annotatedReview(),
      snapshot({ baseSha: "f".repeat(40) }),
      claim,
    )).toThrow("live PR identity")
  })

  test("deleted comments cannot promote another owner or recreate a review cycle", () => {
    expect(verifyReceipt(snapshot({ comments: [] }), claim, cycle)).toMatchObject({
      ok: false,
      reasons: [expect.stringContaining("found 0")],
    })
    expect(cycle.tagSha).toBe(reviewTagSha)
  })

  test("force-push removing the claimed initial head fails closed", () => {
    expect(verifyReceipt(snapshot({ commits: [head] }), claim, cycle).reasons).toContain(
      "claim initial head is not in the current PR lineage",
    )
  })
})

describe("exact-head receipt", () => {
  test("accepts one correlated clean response and mapped historical findings", () => {
    expect(verifyReceipt(snapshot({ threads: [findingThread()] }), claim, cycle)).toMatchObject({
      ok: true,
      receipt: {
        claimTagSha,
        reviewTagSha,
        triggerCommentId: 10,
        headSha: head,
        baseSha: base,
      },
    })
  })

  test("replays PR #14: an untriggered root thumb is not a review receipt", () => {
    const state = snapshot({
      comments: [],
      rootReactions: [{
        actor: "chatgpt-codex-connector[bot]",
        content: "+1",
        createdAt: "2026-07-26T00:02:00Z",
      }],
    })
    expect(verifyReceipt(state, claim, cycle)).toMatchObject({
      ok: false,
      reasons: [expect.stringContaining("review trigger")],
    })
  })

  test("replays PR #23: duplicate same-head triggers fail closed", () => {
    expect(verifyReceipt(
      snapshot({ comments: [triggerComment(), triggerComment(11)] }),
      claim,
      cycle,
    )).toMatchObject({
      ok: false,
      reasons: [expect.stringContaining("found 2")],
    })
  })

  test("plain or differently marked explicit triggers cannot hide beside the claimed trigger", () => {
    const plain = comment(11, "@codex review")
    const differentlyMarked = comment(12, [
      "@codex review",
      markerBody("pr-lifecycle-review:v2", { review_tag_sha: "f".repeat(40) }),
    ].join("\n"))
    for (const extra of [plain, differentlyMarked]) {
      expect(verifyReceipt(
        snapshot({ comments: [extra, triggerComment()] }),
        claim,
        cycle,
      )).toMatchObject({
        ok: false,
        reasons: [expect.stringContaining("found 2")],
      })
    }
  })

  test("a sole unstructured or minimized trigger is not an exact-head receipt", () => {
    for (const trigger of [
      comment(11, "@codex review"),
      triggerComment(12),
    ]) {
      if (trigger.id === 12) trigger.minimized = true
      expect(verifyReceipt(
        snapshot({ comments: [trigger] }),
        claim,
        cycle,
      )).toMatchObject({
        ok: false,
        reasons: [expect.stringContaining("not the claimed exact-head trigger")],
      })
    }
  })

  test("a structured trigger from an immutable old-head cycle remains historical", () => {
    const oldHead = "f".repeat(40)
    const oldTag = "1".repeat(40)
    const oldCycle: ReviewCycle = {
      ...cycle,
      tagSha: oldTag,
      headSha: oldHead,
    }
    const oldTrigger = comment(9, [
      "@codex review",
      markerBody("pr-lifecycle-review:v2", { review_tag_sha: oldTag }),
    ].join("\n"))
    expect(verifyReceipt(
      snapshot({ comments: [oldTrigger, triggerComment()], commits: [fix, oldHead, head] }),
      claim,
      cycle,
      { reviewCycles: [oldCycle, cycle] },
    ).ok).toBeTrue()
  })

  test("punctuation cannot hide an unstructured explicit trigger", () => {
    expect(verifyReceipt(
      snapshot({ comments: [comment(11, "please:(@codex review)"), triggerComment()] }),
      claim,
      cycle,
    )).toMatchObject({
      ok: false,
      reasons: [expect.stringContaining("found 2")],
    })
  })

  test("replays PR #4: a current-head finding overrides a thumb regardless of order", () => {
    const state = snapshot({
      reviews: [{
        id: 80,
        actor: "chatgpt-codex-connector",
        state: "COMMENTED",
        body: "finding before trigger",
        submittedAt: "2026-07-26T00:00:00Z",
        commitSha: head,
      }],
    })
    expect(verifyReceipt(state, claim, cycle).reasons).toContain(
      "Codex submitted a finding review for the current head",
    )
  })

  test("new head, base drift, unresolved threads, deleted triggers, and forks invalidate", () => {
    const cases: Array<[PullRequestSnapshot, ReviewCycle]> = [
      [snapshot({ headSha: "f".repeat(40) }), cycle],
      [snapshot({ baseSha: "f".repeat(40) }), cycle],
      [snapshot({ threads: [findingThread({ resolved: false })] }), cycle],
      [snapshot({ comments: [] }), cycle],
      [snapshot({ headRepository: "contributor/trade" }), cycle],
    ]
    for (const [state, receipt] of cases) {
      expect(verifyReceipt(state, claim, receipt).ok).toBeFalse()
    }
  })

  test("any automatic-review root reaction blocks explicit-trigger reuse", () => {
    const state = snapshot({
      rootReactions: [{
        actor: "chatgpt-codex-connector[bot]",
        content: "THUMBS_UP",
        createdAt: "2026-07-25T00:00:00Z",
      }],
    })
    expect(verifyReceipt(state, claim, cycle).reasons).toContain(
      "uncorrelated Codex root reaction exists",
    )
  })

  test("incomplete provider data blocks both verification and mutation", () => {
    const incomplete = snapshot({ complete: false })
    expect(verifyReceipt(incomplete, claim, cycle).ok).toBeFalse()
    expect(() => requireComplete(incomplete)).toThrow("incomplete")
  })

  test("unmapped historical findings fail closed", () => {
    const unmapped = snapshot({ threads: [findingThread()], commits: [head] })
    const result = verifyReceipt(unmapped, { ...claim, initialHead: head }, cycle)
    expect(result.ok).toBeFalse()
    expect(result.reasons).toEqual([
      expect.stringContaining("lacks an exact fix/disposition receipt"),
    ])
  })

  test("human review threads are outside the Codex disposition protocol", () => {
    const humanThread = findingThread()
    humanThread.comments[0]!.actor = "human-reviewer"
    expect(isCodexFindingRoot(humanThread, 50)).toBeFalse()
    expect(verifyReceipt(snapshot({ threads: [humanThread] }), claim, cycle).ok).toBeTrue()
  })
})

describe("gate status publication", () => {
  const identity = { headSha: head, baseRef: "main", baseSha: base }

  test("publishes success only to the verified live identity", () => {
    expect(gateStatusForLiveIdentity(identity, identity, "success")).toEqual({
      sha: head,
      state: "success",
      identityChanged: false,
    })
  })

  test("turns head or base races into failure on the newly observed live head", () => {
    const newHead = "f".repeat(40)
    expect(gateStatusForLiveIdentity(identity, {
      ...identity,
      headSha: newHead,
    }, "success")).toEqual({
      sha: newHead,
      state: "failure",
      identityChanged: true,
    })
    for (const live of [
      { ...identity, baseRef: "release" },
      { ...identity, baseSha: "f".repeat(40) },
    ]) {
      expect(gateStatusForLiveIdentity(identity, live, "success")).toEqual({
        sha: head,
        state: "failure",
        identityChanged: true,
      })
    }
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
    const body = markerBody("pr-lifecycle-claim-tag:v1", { mission: "m", actor: "a" })
    expect(parseMarker(body, "pr-lifecycle-claim-tag:v1")).toEqual({ mission: "m", actor: "a" })
    expect(parseMarker(
      "<!-- pr-lifecycle-claim-tag:v1 nope -->",
      "pr-lifecycle-claim-tag:v1",
    )).toBeNull()
  })
})
