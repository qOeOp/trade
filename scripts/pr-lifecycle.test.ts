import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  capabilityHash,
  gateStatusForLiveIdentity,
  isCodexFindingRoot,
  markerBody,
  parseMarker,
  requireComplete,
  requireClaimCapability,
  validateClaimTag,
  validateReviewTag,
  verifyReceipt as verifyReceiptProduction,
  type AnnotatedTag,
  type Claim,
  type IssueComment,
  type PullRequestSnapshot,
  type ReviewCycle,
  type ReviewSeal,
  type ReviewTriggerReceipt,
  type ReviewThread,
} from "./pr-lifecycle"

const head = "a".repeat(40)
const base = "b".repeat(40)
const fix = "c".repeat(40)
const claimTagSha = "d".repeat(40)
const reviewTagSha = "e".repeat(40)
const capability = "session-secret"

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
    "",
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
  capabilityHash: capabilityHash(capability),
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

const triggerReceipt: ReviewTriggerReceipt = {
  tagSha: "2".repeat(40),
  reviewTagSha,
  headSha: head,
  commentId: 10,
  commentNodeId: "node-10",
  commentCreatedAt: "2026-07-26T00:01:00Z",
}

const seal: ReviewSeal = {
  tagSha: "4".repeat(40),
  reviewTagSha,
  headSha: head,
  resultKind: "clean",
  resultActor: "chatgpt-codex-connector[bot]",
  resultId: 10,
  resultCreatedAt: "2026-07-26T00:02:00Z",
  resultState: null,
  resultBodyHash: null,
  findingRoots: [],
}

function verifyReceipt(
  state: PullRequestSnapshot,
  claimValue: Claim,
  cycleValue: ReviewCycle,
  options: {
    allowDraft?: boolean
    reviewCycles?: ReviewCycle[]
    triggerReceipts?: ReviewTriggerReceipt[]
    seals?: ReviewSeal[]
  } = {},
) {
  const receipts = options.triggerReceipts ?? [triggerReceipt]
  const currentReceipt = receipts.find(
    (receipt) => receipt.reviewTagSha === cycleValue.tagSha,
  ) ?? triggerReceipt
  return verifyReceiptProduction(state, claimValue, cycleValue, currentReceipt, {
    ...options,
    triggerReceipts: receipts,
    seals: options.seals ?? [seal],
  })
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
    message: markerBody("pr-lifecycle-claim-tag:v2", {
      repository: "qOeOp/trade",
      pr: 100,
      mission: "mission-a",
      capability_hash: capabilityHash(capability),
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

  test("requires the private capability even when two sessions share one GitHub actor", () => {
    expect(() => requireClaimCapability(claim, capability)).not.toThrow()
    expect(() => requireClaimCapability(claim, "other-session")).toThrow(
      "claim capability does not match",
    )
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
    const result = verifyReceipt(snapshot({ comments: [] }), claim, cycle)
    expect(result.ok).toBeFalse()
    expect(result.reasons.some((reason) => reason.includes("found 0"))).toBeTrue()
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
    const result = verifyReceipt(state, claim, cycle)
    expect(result.ok).toBeFalse()
    expect(result.reasons.some((reason) => reason.includes("review trigger"))).toBeTrue()
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
      "",
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
      const result = verifyReceipt(
        snapshot({ comments: [trigger] }),
        claim,
        cycle,
      )
      expect(result.ok).toBeFalse()
      expect(result.reasons.some((reason) =>
        reason.includes("not the claimed exact-head trigger")
      )).toBeTrue()
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
      "",
      markerBody("pr-lifecycle-review:v2", { review_tag_sha: oldTag }),
    ].join("\n"), {
      reactions: [{
        actor: "chatgpt-codex-connector[bot]",
        content: "THUMBS_UP",
        createdAt: "2026-07-26T00:02:00Z",
      }],
    })
    const oldReceipt: ReviewTriggerReceipt = {
      tagSha: "3".repeat(40),
      reviewTagSha: oldTag,
      headSha: oldHead,
      commentId: oldTrigger.id,
      commentNodeId: oldTrigger.nodeId,
      commentCreatedAt: oldTrigger.createdAt,
    }
    const oldSeal: ReviewSeal = {
      ...seal,
      tagSha: "5".repeat(40),
      reviewTagSha: oldTag,
      headSha: oldHead,
      resultId: oldTrigger.id,
    }
    expect(verifyReceipt(
      snapshot({ comments: [oldTrigger, triggerComment()], commits: [fix, oldHead, head] }),
      claim,
      cycle,
      {
        reviewCycles: [oldCycle, cycle],
        triggerReceipts: [oldReceipt, triggerReceipt],
        seals: [oldSeal, seal],
      },
    ).ok).toBeTrue()

    for (const poisoned of [
      {
        comments: [triggerComment()],
        seals: [oldSeal, seal],
      },
      {
        comments: [{ ...oldTrigger, body: `${oldTrigger.body}\nedited` }, triggerComment()],
        seals: [oldSeal, seal],
      },
      {
        comments: [oldTrigger, triggerComment()],
        seals: [seal],
      },
    ]) {
      expect(verifyReceipt(
        snapshot({ comments: poisoned.comments, commits: [fix, oldHead, head] }),
        claim,
        cycle,
        {
          reviewCycles: [oldCycle, cycle],
          triggerReceipts: [oldReceipt, triggerReceipt],
          seals: poisoned.seals,
        },
      ).ok).toBeFalse()
    }

    const copiedOldMarker = comment(11, oldTrigger.body)
    expect(verifyReceipt(
      snapshot({
        comments: [oldTrigger, triggerComment(), copiedOldMarker],
        commits: [fix, oldHead, head],
      }),
      claim,
      cycle,
      {
        reviewCycles: [oldCycle, cycle],
        triggerReceipts: [oldReceipt, triggerReceipt],
        seals: [oldSeal, seal],
      },
    )).toMatchObject({
      ok: false,
      reasons: [expect.stringContaining("found 2")],
    })
  })

  test("a sealed historical review remains bound to its state, body, and finding roots", () => {
    const oldHead = "f".repeat(40)
    const oldTag = "1".repeat(40)
    const oldReviewBody = "one actionable finding"
    const oldFindingBody = "the implementation can lose the seal race"
    const oldCycle: ReviewCycle = {
      ...cycle,
      tagSha: oldTag,
      headSha: oldHead,
    }
    const oldTrigger = comment(9, [
      "@codex review",
      "",
      markerBody("pr-lifecycle-review:v2", { review_tag_sha: oldTag }),
    ].join("\n"))
    const oldReceipt: ReviewTriggerReceipt = {
      tagSha: "3".repeat(40),
      reviewTagSha: oldTag,
      headSha: oldHead,
      commentId: oldTrigger.id,
      commentNodeId: oldTrigger.nodeId,
      commentCreatedAt: oldTrigger.createdAt,
    }
    const oldReview = {
      id: 90,
      actor: "chatgpt-codex-connector[bot]",
      state: "COMMENTED",
      body: oldReviewBody,
      submittedAt: "2026-07-26T00:02:00Z",
      commitSha: oldHead,
    }
    const oldFinding = findingThread({
      id: "thread-old",
      comments: [
        {
          id: 60,
          actor: "chatgpt-codex-connector[bot]",
          body: oldFindingBody,
          createdAt: "2026-07-26T00:02:01Z",
          outdated: true,
          reviewCommitSha: oldHead,
        },
        {
          id: 61,
          actor: "qOeOp",
          body: markerBody("pr-lifecycle-finding:v1", {
            thread_id: "thread-old",
            finding_comment_id: 60,
            disposition: "fixed",
            fix_sha: head,
            reason: "fixed on the current head",
          }),
          createdAt: "2026-07-26T00:03:00Z",
          outdated: false,
          reviewCommitSha: null,
        },
      ],
    })
    const oldSeal: ReviewSeal = {
      tagSha: "5".repeat(40),
      reviewTagSha: oldTag,
      headSha: oldHead,
      resultKind: "review",
      resultActor: oldReview.actor,
      resultId: oldReview.id,
      resultCreatedAt: oldReview.submittedAt,
      resultState: oldReview.state,
      resultBodyHash: createHash("sha256").update(oldReviewBody).digest("hex"),
      findingRoots: [{
        threadId: oldFinding.id,
        commentId: 60,
        createdAt: "2026-07-26T00:02:01Z",
        bodyHash: createHash("sha256").update(oldFindingBody).digest("hex"),
      }],
    }
    const state = snapshot({
      comments: [oldTrigger, triggerComment()],
      commits: [fix, oldHead, head],
      reviews: [oldReview],
      threads: [oldFinding],
    })
    const options = {
      reviewCycles: [oldCycle, cycle],
      triggerReceipts: [oldReceipt, triggerReceipt],
      seals: [oldSeal, seal],
    }
    expect(verifyReceipt(state, claim, cycle, options).ok).toBeTrue()
    expect(verifyReceipt(
      { ...state, reviews: [{ ...oldReview, state: "DISMISSED" }] },
      claim,
      cycle,
      options,
    ).ok).toBeFalse()
    expect(verifyReceipt(
      { ...state, reviews: [{ ...oldReview, body: "edited after sealing" }] },
      claim,
      cycle,
      options,
    ).ok).toBeFalse()
    expect(verifyReceipt(
      { ...state, threads: [] },
      claim,
      cycle,
      options,
    ).ok).toBeFalse()
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
    const body = markerBody("pr-lifecycle-claim-tag:v2", { mission: "m", actor: "a" })
    expect(parseMarker(body, "pr-lifecycle-claim-tag:v2")).toEqual({ mission: "m", actor: "a" })
    expect(parseMarker(
      "<!-- pr-lifecycle-claim-tag:v2 nope -->",
      "pr-lifecycle-claim-tag:v2",
    )).toBeNull()
    expect(parseMarker(
      `${body}\n${body}`,
      "pr-lifecycle-claim-tag:v2",
    )).toBeNull()
  })
})
