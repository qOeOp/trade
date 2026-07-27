import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  capabilityHash,
  gateStatusForLiveIdentity,
  isCodexFindingRoot,
  isStrictDescendant,
  markerBody,
  parseMarker,
  requireComplete,
  requireClaimCapability,
  requireLifecyclePullRequestBody,
  validateClaimTag,
  validateReviewTag,
  verifyReceipt as verifyReceiptProduction,
  type AnnotatedTag,
  type Claim,
  type FindingSeal,
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
      id: `reaction-${id}`,
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
  resultNodeId: "reaction-10",
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
    findingSeals?: FindingSeal[]
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
    findingSeals: options.findingSeals ?? (
      state.threads.some((thread) =>
        thread.comments[0]?.actor.startsWith("chatgpt-codex-connector")
      )
        ? [findingSeal()]
        : []
    ),
  })
}

function snapshot(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  const commits = overrides.commits ?? [fix, head]
  const commitParents = overrides.commitParents ?? Object.fromEntries(
    commits.map((commitSha, index) => [commitSha, index === 0 ? [] : [commits[index - 1]!]]),
  )
  return {
    repository: "qOeOp/trade",
    number: 100,
    title: "Harden the PR lifecycle",
    body: "## Outcome\n\nKeep lifecycle evidence exact.",
    url: "https://github.com/qOeOp/trade/pull/100",
    open: true,
    draft: false,
    merged: false,
    headSha: head,
    headRepository: "qOeOp/trade",
    baseRef: "main",
    baseSha: base,
    commits,
    commitParents,
    comments: [triggerComment()],
    rootReactions: [],
    reviews: [],
    threads: [],
    complete: true,
    ...overrides,
    commits,
    commitParents,
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
        nodeId: "review-node-50",
        actor: "chatgpt-codex-connector",
        body: "finding",
        createdAt: "2026-07-26T00:00:30Z",
        outdated: true,
        reviewCommitSha: fix,
      },
      {
        id: 51,
        nodeId: "review-node-51",
        actor: "qOeOp",
        body: markerBody("pr-lifecycle-finding:v1", {
          thread_id: "thread-1",
          finding_comment_id: 50,
          disposition: "fixed",
          fix_sha: head,
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

function findingSeal(overrides: Partial<FindingSeal> = {}): FindingSeal {
  const replyBody = markerBody("pr-lifecycle-finding:v1", {
    thread_id: "thread-1",
    finding_comment_id: 50,
    disposition: "fixed",
    fix_sha: head,
    reason: "covered by the regression",
  })
  return {
    tagSha: "6".repeat(40),
    threadId: "thread-1",
    findingCommentId: 50,
    reviewHead: fix,
    replyCommentId: 51,
    replyCommentNodeId: "review-node-51",
    replyCreatedAt: "2026-07-26T00:00:40Z",
    replyBodyHash: createHash("sha256").update(replyBody).digest("hex"),
    disposition: "fixed",
    fixSha: head,
    reason: "covered by the regression",
    ...overrides,
  }
}

const fakeGhSource = String.raw`#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs"

const statePath = process.env.FAKE_GH_STATE
if (!statePath) throw new Error("FAKE_GH_STATE is required")
const state = JSON.parse(readFileSync(statePath, "utf8"))
const args = process.argv.slice(2)
const endpoint = args.find((arg) =>
  arg === "graphql" || arg === "user" || arg.startsWith("repos/")
)
const field = (name) => {
  const prefixes = [name + "=", name + "="]
  for (let index = 0; index < args.length - 1; index += 1) {
    if ((args[index] === "-f" || args[index] === "-F") && prefixes.some((prefix) =>
      args[index + 1].startsWith(prefix)
    )) return args[index + 1].slice(name.length + 1)
  }
  return null
}
const save = () => writeFileSync(statePath, JSON.stringify(state))
const fail = (message) => {
  process.stderr.write(message + "\n")
  process.exit(1)
}
const output = (value) => {
  save()
  process.stdout.write(JSON.stringify(value))
  process.exit(0)
}
const reaction = (value) => ({
  id: value.id,
  content: value.content,
  createdAt: value.createdAt,
  user: { login: value.actor },
})
const applyProjectionDrift = () => {
  if (!state.projectionDrift) return
  state.projectionDrift = false
  state.reviews.push({
    id: 91,
    actor: "human-reviewer",
    state: "COMMENTED",
    body: "review arrived during status publication",
    submittedAt: "2026-07-26T00:03:00Z",
    commitSha: state.pr.headSha,
  })
}
const graph = () => {
  const pull = {
    number: 100,
    title: state.pr.title,
    body: state.pr.body,
    url: state.pr.url,
    state: state.pr.open ? "OPEN" : "CLOSED",
    merged: state.pr.merged,
    isDraft: state.pr.draft,
    headRepository: { nameWithOwner: state.pr.headRepository },
    headRefOid: state.pr.headSha,
    baseRefName: state.pr.baseRef,
    baseRefOid: state.pr.baseSha,
    commits: {
      pageInfo: { hasNextPage: false },
      nodes: state.commits.map((commit) => ({
        commit: {
          oid: commit.oid,
          parents: {
            pageInfo: { hasNextPage: false },
            nodes: commit.parents.map((oid) => ({ oid })),
          },
        },
      })),
    },
    reviews: {
      pageInfo: { hasNextPage: false },
      nodes: state.reviews.map((review) => ({
        databaseId: review.id,
        state: review.state,
        body: review.body,
        submittedAt: review.submittedAt,
        author: { login: review.actor },
        commit: { oid: review.commitSha },
      })),
    },
    reactions: {
      pageInfo: { hasNextPage: false },
      nodes: state.rootReactions.map(reaction),
    },
    comments: {
      pageInfo: { hasNextPage: false },
      nodes: state.comments.map((comment) => ({
        databaseId: comment.id,
        id: comment.nodeId,
        body: comment.body,
        createdAt: comment.createdAt,
        isMinimized: comment.minimized,
        authorAssociation: comment.association,
        author: { login: comment.actor },
        reactions: {
          pageInfo: { hasNextPage: false },
          nodes: comment.reactions.map(reaction),
        },
      })),
    },
    reviewThreads: {
      pageInfo: { hasNextPage: false },
      nodes: state.threads.map((thread) => ({
        id: thread.id,
        isResolved: thread.resolved,
        isOutdated: thread.outdated,
        comments: {
          pageInfo: { hasNextPage: false },
          nodes: thread.comments.map((comment) => ({
            databaseId: comment.id,
            id: comment.nodeId,
            body: comment.body,
            createdAt: comment.createdAt,
            outdated: comment.outdated,
            author: { login: comment.actor },
            pullRequestReview: { commit: { oid: comment.reviewCommitSha } },
          })),
        },
      })),
    },
  }
  if (state.fault === "top-pagination") pull.commits.pageInfo.hasNextPage = true
  if (state.fault === "nested-pagination" && pull.commits.nodes[0]) {
    pull.commits.nodes[0].commit.parents.pageInfo.hasNextPage = true
  }
  if (state.fault === "malformed") delete pull.reviews.nodes
  if (state.fault === "duplicate" && pull.commits.nodes[0]) {
    pull.commits.nodes.push(structuredClone(pull.commits.nodes[0]))
  }
  const response = {
    data: { repository: { nameWithOwner: "qOeOp/trade", pullRequest: pull } },
  }
  if (state.fault === "partial") response.errors = [{ message: "partial provider response" }]
  return response
}

if (args[0] !== "api" || !endpoint) fail("unsupported fake gh command")
const methodIndex = args.indexOf("--method")
const method = methodIndex === -1 ? "GET" : args[methodIndex + 1]
if (endpoint === "user") output({ login: state.actor })
if (endpoint === "graphql") {
  const query = field("query") || ""
  if (query.startsWith("mutation")) {
    state.mutations += 1
    const threadId = field("threadId")
    const thread = state.threads.find((candidate) => candidate.id === threadId)
    if (!thread) fail("thread missing")
    if (state.mutationFault !== "resolve-noop") thread.resolved = true
    if (state.mutationFault === "empty-resolve") output({})
    output({ data: { resolveReviewThread: { thread: { id: thread.id, isResolved: true } } } })
  }
  output(graph())
}
if (endpoint === "repos/qOeOp/trade/pulls/100" && method === "GET") {
  state.basicReads += 1
  const headSha = state.fault === "identity-drift" && state.basicReads > 1
    ? "8".repeat(40)
    : state.pr.headSha
  output({
    state: state.pr.open ? "open" : "closed",
    merged: state.pr.merged,
    draft: state.pr.draft,
    head: { sha: headSha, repo: { full_name: state.pr.headRepository } },
    base: { ref: state.pr.baseRef, sha: state.pr.baseSha },
  })
}
if (endpoint.includes("/git/matching-refs/tags/")) {
  const prefix = endpoint.split("/git/matching-refs/tags/")[1]
  const refs = Object.entries(state.refs)
    .filter(([name]) => name.startsWith(prefix))
    .map(([name, sha]) => ({ ref: "refs/tags/" + name, object: { type: "tag", sha } }))
  output([refs])
}
if (endpoint.includes("/git/ref/tags/")) {
  const name = endpoint.split("/git/ref/tags/")[1]
  const sha = state.refs[name]
  if (!sha) fail("missing tag ref " + name)
  output({ ref: "refs/tags/" + name, object: { type: "tag", sha } })
}
if (endpoint.includes("/git/tags/") && method === "GET") {
  const sha = endpoint.split("/git/tags/")[1]
  const tag = state.tags[sha]
  if (!tag) fail("missing tag object " + sha)
  output(tag)
}
if (endpoint.endsWith("/git/tags") && method === "POST") {
  state.mutations += 1
  const sha = (state.nextSha++).toString(16).padStart(40, "0")
  state.tags[sha] = {
    sha,
    tag: field("tag"),
    message: field("message"),
    object: { sha: field("object"), type: field("type") },
  }
  output({ sha })
}
if (endpoint.endsWith("/git/refs") && method === "POST") {
  state.mutations += 1
  const name = field("ref").replace("refs/tags/", "")
  if (state.refs[name]) fail("ref exists")
  state.refs[name] = field("sha")
  output({ ref: "refs/tags/" + name, object: { type: "tag", sha: state.refs[name] } })
}
if (endpoint === "repos/qOeOp/trade/issues/100/comments" && method === "POST") {
  state.mutations += 1
  const comment = {
    id: state.nextCommentId++,
    nodeId: "issue-node-" + state.nextCommentId,
    actor: state.actor,
    association: "OWNER",
    body: field("body"),
    createdAt: "2026-07-26T00:04:00Z",
    minimized: false,
    reactions: [],
  }
  state.comments.push(comment)
  applyProjectionDrift()
  output({
    id: comment.id,
    node_id: comment.nodeId,
    user: { login: comment.actor },
    author_association: comment.association,
    body: comment.body,
    created_at: comment.createdAt,
  })
}
const commentPatch = endpoint.match(/repos\/qOeOp\/trade\/issues\/comments\/(\d+)$/)
if (commentPatch && method === "PATCH") {
  state.mutations += 1
  const comment = state.comments.find((candidate) => candidate.id === Number(commentPatch[1]))
  if (!comment) fail("comment missing")
  comment.body = field("body")
  applyProjectionDrift()
  output({
    id: comment.id,
    node_id: comment.nodeId,
    user: { login: comment.actor },
    author_association: comment.association,
    body: comment.body,
    created_at: comment.createdAt,
  })
}
const replyMatch = endpoint.match(/pulls\/100\/comments\/(\d+)\/replies$/)
if (replyMatch && method === "POST") {
  state.mutations += 1
  state.replyCount += 1
  const rootId = Number(replyMatch[1])
  const thread = state.threads.find((candidate) => candidate.comments[0]?.id === rootId)
  if (!thread) fail("finding root missing")
  thread.comments.push({
    id: state.nextReviewCommentId++,
    nodeId: "review-node-" + (state.nextReviewCommentId - 1),
    actor: state.actor,
    body: field("body"),
    createdAt: "2026-07-26T00:03:30Z",
    outdated: false,
    reviewCommitSha: state.pr.headSha,
  })
  if (state.mutationFault === "empty-reply") output({})
  const reply = thread.comments.at(-1)
  output({ id: reply.id, node_id: reply.nodeId, body: reply.body })
}
fail("unsupported fake gh endpoint " + endpoint)
`

function fakeProviderState() {
  const initial = fix
  const reviewHead = head
  const triggerTagSha = "2".repeat(40)
  const reviewBody = "one finding"
  const findingBody = "fix the lifecycle race"
  return {
    actor: "qOeOp",
    pr: {
      title: "Harden the PR lifecycle",
      body: "## Outcome\n\nMake the PR lifecycle exact and recoverable.",
      url: "https://github.com/qOeOp/trade/pull/100",
      open: true,
      merged: false,
      draft: true,
      headSha: reviewHead,
      headRepository: "qOeOp/trade",
      baseRef: "main",
      baseSha: base,
    },
    commits: [
      { oid: initial, parents: [] as string[] },
      { oid: reviewHead, parents: [initial] },
    ],
    reviews: [{
      id: 90,
      actor: "chatgpt-codex-connector[bot]",
      state: "COMMENTED",
      body: reviewBody,
      submittedAt: "2026-07-26T00:02:00Z",
      commitSha: reviewHead,
    }],
    rootReactions: [] as Array<Record<string, string>>,
    comments: [{
      id: 10,
      nodeId: "issue-node-10",
      actor: "qOeOp",
      association: "OWNER",
      body: [
        "@codex review",
        "",
        markerBody("pr-lifecycle-review:v2", { review_tag_sha: reviewTagSha }),
      ].join("\n"),
      createdAt: "2026-07-26T00:01:00Z",
      minimized: false,
      reactions: [] as Array<Record<string, string>>,
    }],
    threads: [{
      id: "thread-1",
      resolved: false,
      outdated: false,
      comments: [{
        id: 50,
        nodeId: "review-node-50",
        actor: "chatgpt-codex-connector[bot]",
        body: findingBody,
        createdAt: "2026-07-26T00:02:01Z",
        outdated: false,
        reviewCommitSha: reviewHead,
      }],
    }],
    refs: {
      "codex-pr-claim/100": claimTagSha,
      [`codex-pr-review/100/${reviewHead}`]: reviewTagSha,
      [`codex-pr-review-trigger/100/${reviewHead}`]: triggerTagSha,
    } as Record<string, string>,
    tags: {
      [claimTagSha]: {
        sha: claimTagSha,
        message: markerBody("pr-lifecycle-claim-tag:v2", {
          repository: "qOeOp/trade",
          pr: 100,
          mission: "mission-a",
          capability_hash: capabilityHash(capability),
          actor: "qOeOp",
          initial_head: initial,
        }),
        object: { sha: initial, type: "commit" },
      },
      [reviewTagSha]: {
        sha: reviewTagSha,
        message: markerBody("pr-lifecycle-review-tag:v1", {
          repository: "qOeOp/trade",
          pr: 100,
          claim_tag_sha: claimTagSha,
          mission: "mission-a",
          actor: "qOeOp",
          head: reviewHead,
          base_ref: "main",
          base_sha: base,
        }),
        object: { sha: reviewHead, type: "commit" },
      },
      [triggerTagSha]: {
        sha: triggerTagSha,
        message: markerBody("pr-lifecycle-review-trigger-tag:v1", {
          repository: "qOeOp/trade",
          pr: 100,
          claim_tag_sha: claimTagSha,
          review_tag_sha: reviewTagSha,
          mission: "mission-a",
          actor: "qOeOp",
          head: reviewHead,
          comment_id: 10,
          comment_node_id: "issue-node-10",
          comment_created_at: "2026-07-26T00:01:00Z",
        }),
        object: { sha: reviewHead, type: "commit" },
      },
    } as Record<string, {
      sha: string
      message: string
      object: { sha: string; type: string }
    }>,
    nextSha: 100,
    nextCommentId: 11,
    nextReviewCommentId: 51,
    mutations: 0,
    replyCount: 0,
    basicReads: 0,
    fault: null as string | null,
    mutationFault: null as string | null,
    projectionDrift: false,
  }
}

function withFakeProvider(
  run: (context: {
    statePath: string
    invoke: (args: string[]) => ReturnType<typeof Bun.spawnSync>
    readState: () => ReturnType<typeof fakeProviderState>
    writeState: (state: ReturnType<typeof fakeProviderState>) => void
  }) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), "pr-lifecycle-test-"))
  const statePath = join(directory, "state.json")
  const ghPath = join(directory, "gh")
  writeFileSync(ghPath, fakeGhSource)
  chmodSync(ghPath, 0o755)
  const writeState = (state: ReturnType<typeof fakeProviderState>) => {
    writeFileSync(statePath, JSON.stringify(state))
  }
  const readState = () =>
    JSON.parse(readFileSync(statePath, "utf8")) as ReturnType<typeof fakeProviderState>
  writeState(fakeProviderState())
  const invoke = (args: string[]) => Bun.spawnSync({
    cmd: ["bun", join(import.meta.dir, "pr-lifecycle.ts"), ...args],
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      GH_TOKEN: undefined,
      GITHUB_TOKEN: undefined,
      FAKE_GH_STATE: statePath,
      PATH: `${directory}:${process.env.PATH ?? ""}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    run({ statePath, invoke, readState, writeState })
  } finally {
    rmSync(directory, { recursive: true, force: true })
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
  test("accepts one correlated clean response", () => {
    expect(verifyReceipt(snapshot(), claim, cycle)).toMatchObject({
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

  test("rejects a recreated clean reaction with a different GraphQL node ID", () => {
    const replacement = triggerComment()
    replacement.reactions[0] = {
      ...replacement.reactions[0]!,
      id: "replacement-reaction",
    }
    const result = verifyReceipt(
      snapshot({ comments: [replacement] }),
      claim,
      cycle,
    )
    expect(result.ok).toBeFalse()
    expect(result.reasons).toContain("current review cycle lacks an exact clean seal")
  })

  test("replays PR #14: an untriggered root thumb is not a review receipt", () => {
    const state = snapshot({
      comments: [],
      rootReactions: [{
        id: "root-reaction-1",
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
        id: "old-clean-reaction",
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
      resultNodeId: "old-clean-reaction",
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

    const historicalDown = {
      ...oldTrigger,
      reactions: [
        ...oldTrigger.reactions,
        {
          id: "old-conflicting-reaction",
          actor: "chatgpt-codex-connector[bot]",
          content: "THUMBS_DOWN",
          createdAt: "2026-07-26T00:02:30Z",
        },
      ],
    }
    expect(verifyReceipt(
      snapshot({
        comments: [historicalDown, triggerComment()],
        commits: [fix, oldHead, head],
      }),
      claim,
      cycle,
      {
        reviewCycles: [oldCycle, cycle],
        triggerReceipts: [oldReceipt, triggerReceipt],
        seals: [oldSeal, seal],
      },
    ).ok).toBeFalse()

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
          nodeId: "review-node-60",
          actor: "chatgpt-codex-connector[bot]",
          body: oldFindingBody,
          createdAt: "2026-07-26T00:02:01Z",
          outdated: true,
          reviewCommitSha: oldHead,
        },
        {
          id: 61,
          nodeId: "review-node-61",
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
      resultNodeId: null,
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
    const oldFindingSeal: FindingSeal = {
      tagSha: "7".repeat(40),
      threadId: "thread-old",
      findingCommentId: 60,
      reviewHead: oldHead,
      replyCommentId: 61,
      replyCommentNodeId: "review-node-61",
      replyCreatedAt: "2026-07-26T00:03:00Z",
      replyBodyHash: createHash("sha256").update(oldFinding.comments[1]!.body).digest("hex"),
      disposition: "fixed",
      fixSha: head,
      reason: "fixed on the current head",
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
      findingSeals: [oldFindingSeal],
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
    expect(verifyReceipt(
      {
        ...state,
        reviews: [
          oldReview,
          { ...oldReview, id: 91, submittedAt: "2026-07-26T00:02:30Z" },
        ],
      },
      claim,
      cycle,
      options,
    ).ok).toBeFalse()
    expect(verifyReceipt(
      {
        ...state,
        threads: [{
          ...oldFinding,
          comments: oldFinding.comments.map((entry, index) =>
            index === 1
              ? {
                  ...entry,
                  body: markerBody("pr-lifecycle-finding:v1", {
                    thread_id: "thread-old",
                    finding_comment_id: 60,
                    disposition: "fixed",
                    fix_sha: fix,
                    reason: "incorrectly points before the finding",
                  }),
                }
              : entry
          ),
        }],
      },
      claim,
      cycle,
      options,
    ).ok).toBeFalse()
    expect(verifyReceipt(
      snapshot({
        reviews: [oldReview],
        threads: [oldFinding],
        commits: [fix, oldHead, head],
      }),
      claim,
      cycle,
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
        id: "automatic-root-reaction",
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
    expect(result.reasons.some((reason) =>
      reason.includes("lacks an exact sealed disposition receipt")
    )).toBeTrue()
  })

  test("a later sibling in the commit list is not a descendant disposition", () => {
    const sibling = "9".repeat(40)
    const state = snapshot({
      commits: [fix, sibling, head],
      commitParents: {
        [fix]: [],
        [sibling]: [fix],
        [head]: [],
      },
      threads: [findingThread()],
    })
    expect(isStrictDescendant(state, head, fix)).toBeFalse()
    const result = verifyReceipt(state, claim, cycle)
    expect(result.ok).toBeFalse()
    expect(result.reasons).toContain(
      "review thread thread-1 lacks an exact sealed disposition receipt",
    )
  })

  test("finding seals fail closed on missing, edited, deleted, duplicate, or mismatched replies", () => {
    const valid = findingThread()
    const cases: Array<{
      state: PullRequestSnapshot
      findingSeals: FindingSeal[]
    }> = [
      {
        state: snapshot({ threads: [valid] }),
        findingSeals: [],
      },
      {
        state: snapshot({
          threads: [{
            ...valid,
            comments: valid.comments.map((entry, index) =>
              index === 1 ? { ...entry, body: `${entry.body}\nedited` } : entry
            ),
          }],
        }),
        findingSeals: [findingSeal()],
      },
      {
        state: snapshot({
          threads: [{ ...valid, comments: [valid.comments[0]!] }],
        }),
        findingSeals: [findingSeal()],
      },
      {
        state: snapshot({
          threads: [{
            ...valid,
            comments: [
              ...valid.comments,
              {
                ...valid.comments[1]!,
                id: 52,
                nodeId: "review-node-52",
              },
            ],
          }],
        }),
        findingSeals: [findingSeal()],
      },
      {
        state: snapshot({ threads: [valid] }),
        findingSeals: [findingSeal({ disposition: "deferred" })],
      },
      {
        state: snapshot({ threads: [valid] }),
        findingSeals: [findingSeal({ replyCommentNodeId: "replacement-review-node" })],
      },
    ]
    for (const entry of cases) {
      const result = verifyReceipt(
        entry.state,
        claim,
        cycle,
        { findingSeals: entry.findingSeals },
      )
      expect(result.ok).toBeFalse()
      expect(result.reasons).toContain(
        "review thread thread-1 lacks an exact sealed disposition receipt",
      )
    }
  })

  test("human review threads are outside the Codex disposition protocol", () => {
    const humanThread = findingThread()
    humanThread.comments[0]!.actor = "human-reviewer"
    expect(isCodexFindingRoot(humanThread, 50)).toBeFalse()
    expect(verifyReceipt(snapshot({ threads: [humanThread] }), claim, cycle).ok).toBeTrue()
  })
})

describe("lifecycle status projection", () => {
  const writerArgs = [
    "--repo", "qOeOp/trade",
    "--pr", "100",
    "--claim", claimTagSha,
    "--capability", capability,
  ]

  test("requires Outcome and nonempty explicit H2 sections", () => {
    expect(requireLifecyclePullRequestBody(
      "## Outcome\n\nShip exact evidence.\n\n## Verification\n\nFocused tests.",
    )).toBe("Ship exact evidence.")
    expect(() => requireLifecyclePullRequestBody("## Verification\n\nReady")).toThrow(
      "missing required section: ## Outcome",
    )
    expect(() => requireLifecyclePullRequestBody("## Outcome\n\n## Verification\n\nReady")).toThrow(
      "section is empty: ## Outcome",
    )
    expect(() => requireLifecyclePullRequestBody(
      "## Outcome\n\nReady\n\n## Risks\n\n<!-- placeholder -->",
    )).toThrow("section is empty: ## Risks")
  })

  test("posts, patches, recreates, and keeps one non-authoritative navigation comment", () => {
    withFakeProvider(({ invoke, readState, writeState }) => {
      const initial = readState()
      initial.pr.body = "## Outcome\n\nAsk @codex review without triggering one."
      writeState(initial)
      expect(invoke(["status", ...writerArgs]).exitCode).toBe(0)
      const posted = readState()
      const projection = posted.comments.find((entry) =>
        entry.body.includes("pr-lifecycle-status:v1")
      )!
      expect(posted.mutations).toBe(1)
      expect(projection.body).toContain(
        "Non-authoritative navigation; immutable tags/reviews/threads/checks remain authority.",
      )
      expect(projection.body).toContain("#issuecomment-10")
      expect(projection.body).toContain("#pullrequestreview-90")
      expect(projection.body).toContain("#discussion_r50")
      expect(projection.body).toContain("@\u200bcodex review")
      expect(projection.body).not.toMatch(/@codex\s+review\b/i)
      expect(projection.body.match(/^## /gm)).toHaveLength(5)
      expect(parseMarker(projection.body, "pr-lifecycle-status:v1")).toEqual({
        schema: "v1",
        claim_tag_sha: claimTagSha,
      })

      posted.refs = { "codex-pr-claim/100": claimTagSha }
      posted.comments = [projection]
      posted.reviews = []
      posted.threads = []
      projection.body = `edited\n\n${markerBody("pr-lifecycle-status:v1", {
        schema: "v1",
        claim_tag_sha: claimTagSha,
      })}`
      writeState(posted)
      expect(invoke(["status", ...writerArgs]).exitCode).toBe(0)
      const patched = readState()
      expect(patched.comments).toHaveLength(1)
      expect(patched.comments[0]!.id).toBe(projection.id)
      expect(patched.comments[0]!.body).toContain("## What happened\n\n- None")
      expect(patched.comments[0]!.body).toContain("## Next action\n\nrequest review")

      const beforeRetry = patched.mutations
      expect(invoke(["status", ...writerArgs]).exitCode).toBe(0)
      expect(readState().mutations).toBe(beforeRetry + 1)
      expect(readState().comments[0]!.id).toBe(projection.id)

      const deleted = readState()
      deleted.comments = []
      writeState(deleted)
      expect(invoke(["status", ...writerArgs]).exitCode).toBe(0)
      const recreated = readState()
      expect(recreated.comments).toHaveLength(1)
      expect(recreated.comments[0]!.id).not.toBe(projection.id)

      recreated.comments.push({
        ...recreated.comments[0]!,
        id: 999,
        nodeId: "issue-node-999",
      })
      writeState(recreated)
      const beforeDuplicate = recreated.mutations
      const duplicate = invoke(["status", ...writerArgs])
      expect(duplicate.exitCode).not.toBe(0)
      expect(duplicate.stderr.toString()).toContain("multiple lifecycle status")
      expect(readState().mutations).toBe(beforeDuplicate)
    })
  }, 20_000)

  test("fresh provider evidence must reproduce the written projection", () => {
    withFakeProvider(({ invoke, readState, writeState }) => {
      const state = readState()
      state.projectionDrift = true
      writeState(state)
      const result = invoke(["status", ...writerArgs])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain("provider evidence changed")
      expect(readState().mutations).toBe(1)
    })
  }, 20_000)

  test("clean seals give conservative draft and Ready guidance", () => {
    withFakeProvider(({ invoke, readState, writeState }) => {
      const state = readState()
      state.reviews = []
      state.threads = []
      state.comments[0]!.reactions.push({
        id: "clean-reaction",
        actor: "chatgpt-codex-connector[bot]",
        content: "THUMBS_UP",
        createdAt: "2026-07-26T00:03:00Z",
      })
      writeState(state)
      expect(invoke(["seal", ...writerArgs]).exitCode).toBe(0)
      expect(invoke(["status", ...writerArgs]).exitCode).toBe(0)
      const draft = readState()
      expect(draft.comments.at(-1)!.body).toContain(
        "mark Ready after required checks pass",
      )
      draft.pr.draft = false
      writeState(draft)
      expect(invoke(["status", ...writerArgs]).exitCode).toBe(0)
      expect(readState().comments.at(-1)!.body).toContain(
        "run gate, then merge only after every required check passes",
      )
    })
  }, 20_000)

  test("body failure stops status mutation and verify ignores status identity", () => {
    withFakeProvider(({ invoke, readState, writeState }) => {
      const state = readState()
      state.pr.body = "## Verification\n\nReady"
      writeState(state)
      expect(invoke(["status", ...writerArgs]).exitCode).not.toBe(0)
      expect(readState().mutations).toBe(0)
    })
    const projection = comment(
      99,
      markerBody("pr-lifecycle-status:v1", {
        schema: "v1",
        claim_tag_sha: "0".repeat(40),
      }),
      { actor: "other-writer" },
    )
    expect(verifyReceipt(
      snapshot({ comments: [triggerComment(), projection] }),
      claim,
      cycle,
    )).toEqual(verifyReceipt(snapshot(), claim, cycle))
  }, 20_000)

  test("status markers never exempt literal review triggers", () => {
    const marked = [
      markerBody("pr-lifecycle-status:v1", { schema: "v1", claim_tag_sha: claimTagSha }),
      markerBody("pr-lifecycle-status:v1", { schema: "v1", claim_tag_sha: "0".repeat(40) }),
      "<!-- pr-lifecycle-status:v1 nope -->",
    ]
    for (const [index, marker] of marked.entries()) {
      const extra = comment(90 + index, `@codex review\n${marker}`)
      expect(verifyReceipt(
        snapshot({ comments: [triggerComment(), extra] }),
        claim,
        cycle,
      ).reasons).toContain("expected one visible review trigger, found 2")
    }
    const otherActor = comment(99, `@codex review\n${marked[0]}`, { actor: "outsider" })
    expect(verifyReceipt(
      snapshot({ comments: [triggerComment(), otherActor] }),
      claim,
      cycle,
    ).reasons).toContain("expected one visible review trigger, found 2")
  })
})

describe("command lifecycle with a fake provider", () => {
  test("seals a finding, addresses it with a descendant, and verifies the next clean cycle", () => {
    withFakeProvider(({ invoke, readState, writeState }) => {
      const writerArgs = [
        "--repo", "qOeOp/trade",
        "--pr", "100",
        "--claim", claimTagSha,
        "--capability", capability,
      ]
      const findingSeal = invoke(["seal", ...writerArgs])
      expect(findingSeal.exitCode, findingSeal.stderr.toString()).toBe(0)

      const descendant = "f".repeat(40)
      const afterSeal = readState()
      expect(afterSeal.refs[`codex-pr-review-seal/100/${head}`]).toBeDefined()
      afterSeal.pr.headSha = descendant
      afterSeal.commits.push({ oid: descendant, parents: [head] })
      writeState(afterSeal)

      const prematureReview = invoke(["review", ...writerArgs])
      expect(prematureReview.exitCode).not.toBe(0)
      expect(readState().mutations).toBe(afterSeal.mutations)

      const beforeAddressMutations = afterSeal.mutations
      const address = invoke([
        "address",
        ...writerArgs,
        "--thread-id", "thread-1",
        "--finding-comment-id", "50",
        "--disposition", "fixed",
        "--fix-sha", descendant,
        "--reason", "covered by the command simulation",
      ])
      expect(address.exitCode).toBe(0)
      const afterAddress = readState()
      expect(afterAddress.replyCount).toBe(1)
      expect(afterAddress.threads[0]!.resolved).toBeTrue()
      expect(afterAddress.mutations - beforeAddressMutations).toBe(4)
      expect(afterAddress.refs["codex-pr-finding-seal/100/50"]).toBeDefined()

      const exactRetry = invoke([
        "address",
        ...writerArgs,
        "--thread-id", "thread-1",
        "--finding-comment-id", "50",
        "--disposition", "fixed",
        "--fix-sha", descendant,
        "--reason", "covered by the command simulation",
      ])
      expect(exactRetry.exitCode, exactRetry.stderr.toString()).toBe(0)
      expect(readState().mutations).toBe(afterAddress.mutations)
      expect(readState().replyCount).toBe(1)

      const review = invoke(["review", ...writerArgs])
      expect(review.exitCode).toBe(0)
      const afterReview = readState()
      const cleanTrigger = afterReview.comments.at(-1)!
      cleanTrigger.reactions.push({
        id: "reaction-clean",
        actor: "chatgpt-codex-connector[bot]",
        content: "THUMBS_UP",
        createdAt: "2026-07-26T00:05:00Z",
      })
      writeState(afterReview)

      const cleanSeal = invoke(["seal", ...writerArgs])
      expect(cleanSeal.exitCode).toBe(0)
      const verification = invoke([
        "verify",
        "--repo", "qOeOp/trade",
        "--pr", "100",
        "--allow-draft",
      ])
      expect(verification.exitCode).toBe(0)
      expect(JSON.parse(verification.stdout.toString())).toMatchObject({
        ok: true,
        receipt: { headSha: descendant },
      })
    })
  }, 20_000)

  test("rejects incomplete or ambiguous evidence and identity drift before mutation", () => {
    for (const fault of [
      "partial",
      "top-pagination",
      "nested-pagination",
      "malformed",
      "duplicate",
      "identity-drift",
    ]) {
      withFakeProvider(({ invoke, readState, writeState }) => {
        const state = readState()
        state.fault = fault
        state.refs = {}
        state.tags = {}
        state.mutations = 0
        state.basicReads = 0
        writeState(state)
        const result = invoke([
          "claim",
          "--repo", "qOeOp/trade",
          "--pr", "100",
          "--mission", "negative-evidence",
        ])
        expect(result.exitCode, fault).not.toBe(0)
        expect(readState().mutations, fault).toBe(0)
      })
    }
  }, 20_000)

  test("rejects empty reasons and unproven address mutation responses", () => {
    for (const mutationFault of [
      "empty-reason",
      "empty-reply",
      "empty-resolve",
      "resolve-noop",
    ]) {
      withFakeProvider(({ invoke, readState, writeState }) => {
        const writerArgs = [
          "--repo", "qOeOp/trade",
          "--pr", "100",
          "--claim", claimTagSha,
          "--capability", capability,
        ]
        const findingSeal = invoke(["seal", ...writerArgs])
        expect(findingSeal.exitCode, findingSeal.stderr.toString()).toBe(0)
        const descendant = "f".repeat(40)
        const state = readState()
        state.pr.headSha = descendant
        state.commits.push({ oid: descendant, parents: [head] })
        state.mutationFault = mutationFault === "empty-reason" ? null : mutationFault
        writeState(state)

        const beforeMutations = state.mutations
        const address = invoke([
          "address",
          ...writerArgs,
          "--thread-id", "thread-1",
          "--finding-comment-id", "50",
          "--disposition", "fixed",
          "--fix-sha", descendant,
          "--reason", mutationFault === "empty-reason" ? "   " : "prove both mutations",
        ])
        expect(address.exitCode, mutationFault).not.toBe(0)
        expect(address.stdout.toString(), mutationFault).toBe("")
        const after = readState()
        if (mutationFault === "empty-reason") {
          expect(after.mutations, mutationFault).toBe(beforeMutations)
        } else if (mutationFault === "empty-reply") {
          expect(after.mutations - beforeMutations, mutationFault).toBe(1)
        } else {
          expect(after.mutations - beforeMutations, mutationFault).toBe(4)
        }
      })
    }
  }, 20_000)

  test("legacy, malformed, or invalid disposition markers block a second reply", () => {
    for (const body of [
      "<!-- pr-lifecycle-finding:v0 {} -->",
      "<!-- pr-lifecycle-finding:v1 nope -->",
      markerBody("pr-lifecycle-finding:v1", {
        thread_id: "thread-1",
        finding_comment_id: 50,
        disposition: "fixed",
        fix_sha: head,
        reason: "not a descendant",
      }),
    ]) {
      withFakeProvider(({ invoke, readState, writeState }) => {
        const writerArgs = [
          "--repo", "qOeOp/trade",
          "--pr", "100",
          "--claim", claimTagSha,
          "--capability", capability,
        ]
        expect(invoke(["seal", ...writerArgs]).exitCode).toBe(0)
        const descendant = "f".repeat(40)
        const state = readState()
        state.pr.headSha = descendant
        state.commits.push({ oid: descendant, parents: [head] })
        state.threads[0]!.comments.push({
          id: 51,
          nodeId: "review-node-51",
          actor: "qOeOp",
          body,
          createdAt: "2026-07-26T00:03:00Z",
          outdated: false,
          reviewCommitSha: descendant,
        })
        writeState(state)
        const before = state.mutations
        const result = invoke([
          "address",
          ...writerArgs,
          "--thread-id", "thread-1",
          "--finding-comment-id", "50",
          "--disposition", "fixed",
          "--fix-sha", descendant,
          "--reason", "must not post a second reply",
        ])
        expect(result.exitCode).not.toBe(0)
        expect(result.stderr.toString()).toContain("invalid or legacy disposition")
        expect(readState().mutations).toBe(before)
        expect(readState().replyCount).toBe(0)
      })
    }
  }, 20_000)

  test("recovers an exact reply after an uncertain response without posting a duplicate", () => {
    withFakeProvider(({ invoke, readState, writeState }) => {
      const writerArgs = [
        "--repo", "qOeOp/trade",
        "--pr", "100",
        "--claim", claimTagSha,
        "--capability", capability,
      ]
      expect(invoke(["seal", ...writerArgs]).exitCode).toBe(0)
      const descendant = "f".repeat(40)
      const state = readState()
      state.pr.headSha = descendant
      state.commits.push({ oid: descendant, parents: [head] })
      state.mutationFault = "empty-reply"
      writeState(state)
      const addressArgs = [
        "address",
        ...writerArgs,
        "--thread-id", "thread-1",
        "--finding-comment-id", "50",
        "--disposition", "fixed",
        "--fix-sha", descendant,
        "--reason", "recover the exact reply",
      ]
      expect(invoke(addressArgs).exitCode).not.toBe(0)
      const afterUncertain = readState()
      expect(afterUncertain.replyCount).toBe(1)
      expect(afterUncertain.refs["codex-pr-finding-seal/100/50"]).toBeUndefined()
      afterUncertain.mutationFault = null
      writeState(afterUncertain)

      const recovered = invoke(addressArgs)
      expect(recovered.exitCode, recovered.stderr.toString()).toBe(0)
      const afterRecovered = readState()
      expect(afterRecovered.replyCount).toBe(1)
      expect(afterRecovered.refs["codex-pr-finding-seal/100/50"]).toBeDefined()
      expect(afterRecovered.threads[0]!.resolved).toBeTrue()
    })
  }, 20_000)

  test("rejects a closed or merged draft before creating lifecycle artifacts", () => {
    for (const stateChange of [
      { open: false, merged: false },
      { open: false, merged: true },
    ]) {
      withFakeProvider(({ invoke, readState, writeState }) => {
        const state = readState()
        state.pr.open = stateChange.open
        state.pr.merged = stateChange.merged
        writeState(state)
        const before = state.mutations
        const result = invoke([
          "review",
          "--repo", "qOeOp/trade",
          "--pr", "100",
          "--claim", claimTagSha,
          "--capability", capability,
        ])
        expect(result.exitCode).not.toBe(0)
        expect(result.stderr.toString()).toContain("pull request is not open")
        expect(readState().mutations).toBe(before)
      })
    }
  }, 20_000)

  test("rejects a Codex down-reaction on a non-trigger historical comment", () => {
    withFakeProvider(({ invoke, readState, writeState }) => {
      const state = readState()
      state.comments.push({
        id: 99,
        nodeId: "issue-node-99",
        actor: "qOeOp",
        association: "OWNER",
        body: "ordinary historical conversation",
        createdAt: "2026-07-26T00:00:30Z",
        minimized: false,
        reactions: [{
          id: "historical-down",
          actor: "chatgpt-codex-connector[bot]",
          content: "THUMBS_DOWN",
          createdAt: "2026-07-26T00:00:40Z",
        }],
      })
      writeState(state)
      const result = invoke([
        "seal",
        "--repo", "qOeOp/trade",
        "--pr", "100",
        "--claim", claimTagSha,
        "--capability", capability,
      ])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain("historical Codex THUMBS_DOWN")
      expect(readState().mutations).toBe(0)
    })
  }, 20_000)
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
    expect(workflow).toContain("PR_NUMBER: ${{ inputs.pr_number }}")
    const shellProgram = workflow.slice(workflow.indexOf("        run: |"))
    expect(shellProgram).not.toContain("${{ inputs.")
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
