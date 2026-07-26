#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"

const CLAIM_TAG_MARKER = "pr-lifecycle-claim-tag:v2"
const CLAIM_RECEIPT_MARKER = "pr-lifecycle-claim-receipt:v1"
const REVIEW_TAG_MARKER = "pr-lifecycle-review-tag:v1"
const REVIEW_TRIGGER_TAG_MARKER = "pr-lifecycle-review-trigger-tag:v1"
const REVIEW_SEAL_TAG_MARKER = "pr-lifecycle-review-seal-tag:v1"
const REVIEW_MARKER = "pr-lifecycle-review:v2"
const FINDING_MARKER = "pr-lifecycle-finding:v1"
const GATE_CONTEXT = "pr-lifecycle-gate"
const CODEX_LOGINS = new Set(["chatgpt-codex-connector", "chatgpt-codex-connector[bot]"])
const ELIGIBLE_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"])

type JsonObject = Record<string, unknown>

export interface Reaction {
  content: string
  createdAt: string
  actor: string
}

export interface IssueComment {
  id: number
  nodeId: string
  actor: string
  association: string
  body: string
  createdAt: string
  minimized: boolean
  reactions: Reaction[]
}

export interface Review {
  id: number
  actor: string
  state: string
  body: string
  submittedAt: string
  commitSha: string | null
}

export interface ReviewComment {
  id: number
  actor: string
  body: string
  createdAt: string
  outdated: boolean
  reviewCommitSha: string | null
}

export interface ReviewThread {
  id: string
  resolved: boolean
  outdated: boolean
  comments: ReviewComment[]
}

export interface PullRequestSnapshot {
  repository: string
  number: number
  open: boolean
  draft: boolean
  merged: boolean
  headSha: string
  headRepository: string
  baseRef: string
  baseSha: string
  commits: string[]
  comments: IssueComment[]
  rootReactions: Reaction[]
  reviews: Review[]
  threads: ReviewThread[]
  complete: boolean
}

export interface AnnotatedTag {
  sha: string
  name: string
  message: string
  objectSha: string
  objectType: string
}

interface ClaimPayload {
  repository: string
  pr: number
  mission: string
  capability_hash: string
  actor: string
  initial_head: string
}

interface ReviewSealTagPayload {
  repository: string
  pr: number
  claim_tag_sha: string
  review_tag_sha: string
  mission: string
  actor: string
  head: string
  result_kind: "clean" | "review"
  result_actor: string
  result_id: number
  result_created_at: string
  result_state: string | null
  result_body_hash: string | null
  finding_roots: ReviewFindingRootReceipt[]
}

export interface ReviewFindingRootReceipt {
  threadId: string
  commentId: number
  createdAt: string
  bodyHash: string
}

interface ReviewTagPayload {
  repository: string
  pr: number
  claim_tag_sha: string
  mission: string
  actor: string
  head: string
  base_ref: string
  base_sha: string
}

interface ReviewPayload {
  review_tag_sha: string
}

interface ReviewTriggerTagPayload {
  repository: string
  pr: number
  claim_tag_sha: string
  review_tag_sha: string
  mission: string
  actor: string
  head: string
  comment_id: number
  comment_node_id: string
  comment_created_at: string
}

interface FindingPayload {
  thread_id: string
  finding_comment_id: number
  disposition: "fixed" | "deferred" | "rejected"
  fix_sha: string
  reason: string
}

export interface Claim {
  tagSha: string
  actor: string
  mission: string
  initialHead: string
  capabilityHash: string
}

export interface ReviewSeal {
  tagSha: string
  reviewTagSha: string
  headSha: string
  resultKind: "clean" | "review"
  resultActor: string
  resultId: number
  resultCreatedAt: string
  resultState: string | null
  resultBodyHash: string | null
  findingRoots: ReviewFindingRootReceipt[]
}

export interface ReviewCycle {
  tagSha: string
  claimTagSha: string
  actor: string
  mission: string
  headSha: string
  baseRef: string
  baseSha: string
}

export interface ReviewTriggerReceipt {
  tagSha: string
  reviewTagSha: string
  headSha: string
  commentId: number
  commentNodeId: string
  commentCreatedAt: string
}

export interface PullRequestIdentity {
  headSha: string
  baseRef: string
  baseSha: string
}

export interface Verification {
  ok: boolean
  reasons: string[]
  receipt?: {
    repository: string
    pr: number
    claimTagSha: string
    reviewTagSha: string
    mission: string
    triggerCommentId: number
    reviewer: string
    headSha: string
    baseRef: string
    baseSha: string
    cleanReactionAt: string
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(value: JsonObject, field: string): string | null {
  return typeof value[field] === "string" ? value[field] : null
}

function numberField(value: JsonObject, field: string): number | null {
  return typeof value[field] === "number" ? value[field] : null
}

export function markerBody(marker: string, payload: JsonObject): string {
  return `<!-- ${marker} ${JSON.stringify(payload)} -->`
}

export function parseMarker<T>(body: string, marker: string): T | null {
  const prefix = `<!-- ${marker} `
  const start = body.indexOf(prefix)
  if (start === -1) return null
  if (body.indexOf(prefix, start + prefix.length) !== -1) return null
  const end = body.indexOf(" -->", start + prefix.length)
  if (end === -1) return null
  try {
    const value = JSON.parse(body.slice(start + prefix.length, end))
    return isObject(value) ? value as T : null
  } catch {
    return null
  }
}

function validSha(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{40}$/.test(value)
}

function validCapabilityHash(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{64}$/.test(value)
}

export function capabilityHash(capability: string): string {
  return createHash("sha256").update(capability).digest("hex")
}

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function validMission(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
}

function isCodex(actor: string): boolean {
  return CODEX_LOGINS.has(actor)
}

export function requireComplete(snapshot: PullRequestSnapshot): void {
  if (!snapshot.complete) throw new Error("provider snapshot is incomplete")
}

export function validateClaimTag(
  tag: AnnotatedTag,
  repository: string,
  pr: number,
): Claim {
  const payload = parseMarker<ClaimPayload>(tag.message, CLAIM_TAG_MARKER)
  if (
    !validSha(tag.sha)
    || tag.name !== `codex-pr-claim/${pr}`
    || tag.objectType !== "commit"
    || !payload
    || payload.repository !== repository
    || payload.pr !== pr
    || !validMission(payload.mission)
    || payload.actor.trim().length === 0
    || !validCapabilityHash(payload.capability_hash)
    || !validSha(payload.initial_head)
    || tag.objectSha !== payload.initial_head
  ) throw new Error("invalid claim tag")
  return {
    tagSha: tag.sha,
    actor: payload.actor,
    mission: payload.mission,
    initialHead: payload.initial_head,
    capabilityHash: payload.capability_hash,
  }
}

export function validateReviewTag(
  tag: AnnotatedTag,
  snapshot: PullRequestSnapshot,
  claim: Claim,
): ReviewCycle {
  const cycle = parseReviewTag(tag, snapshot.repository, snapshot.number, claim)
  if (
    cycle.headSha !== snapshot.headSha
    || cycle.baseRef !== snapshot.baseRef
    || cycle.baseSha !== snapshot.baseSha
  ) throw new Error("review tag does not match the live PR identity")
  return cycle
}

function parseReviewTag(
  tag: AnnotatedTag,
  repository: string,
  pr: number,
  claim: Claim,
): ReviewCycle {
  const payload = parseMarker<ReviewTagPayload>(tag.message, REVIEW_TAG_MARKER)
  if (
    !validSha(tag.sha)
    || tag.objectType !== "commit"
    || !payload
    || !validSha(payload.head)
    || !validSha(payload.base_sha)
    || tag.name !== `codex-pr-review/${pr}/${payload.head}`
    || payload.repository !== repository
    || payload.pr !== pr
    || payload.claim_tag_sha !== claim.tagSha
    || payload.mission !== claim.mission
    || payload.actor !== claim.actor
    || payload.base_ref.trim().length === 0
    || tag.objectSha !== payload.head
  ) throw new Error("invalid review tag")
  return {
    tagSha: tag.sha,
    claimTagSha: claim.tagSha,
    actor: claim.actor,
    mission: claim.mission,
    headSha: payload.head,
    baseRef: payload.base_ref,
    baseSha: payload.base_sha,
  }
}

function parseReviewTriggerTag(
  tag: AnnotatedTag,
  repository: string,
  pr: number,
  claim: Claim,
  cycle: ReviewCycle,
): ReviewTriggerReceipt {
  const payload = parseMarker<ReviewTriggerTagPayload>(tag.message, REVIEW_TRIGGER_TAG_MARKER)
  if (
    !validSha(tag.sha)
    || tag.objectType !== "commit"
    || !payload
    || tag.name !== `codex-pr-review-trigger/${pr}/${cycle.headSha}`
    || payload.repository !== repository
    || payload.pr !== pr
    || payload.claim_tag_sha !== claim.tagSha
    || payload.review_tag_sha !== cycle.tagSha
    || payload.mission !== claim.mission
    || payload.actor !== claim.actor
    || payload.head !== cycle.headSha
    || !Number.isInteger(payload.comment_id)
    || payload.comment_id <= 0
    || payload.comment_node_id.trim().length === 0
    || !Number.isFinite(Date.parse(payload.comment_created_at))
    || tag.objectSha !== cycle.headSha
  ) throw new Error("invalid review trigger tag")
  return {
    tagSha: tag.sha,
    reviewTagSha: cycle.tagSha,
    headSha: cycle.headSha,
    commentId: payload.comment_id,
    commentNodeId: payload.comment_node_id,
    commentCreatedAt: payload.comment_created_at,
  }
}

function parseFindingRootReceipts(value: unknown): ReviewFindingRootReceipt[] | null {
  if (!Array.isArray(value)) return null
  const receipts: ReviewFindingRootReceipt[] = []
  for (const item of value) {
    if (!isObject(item)) return null
    const threadId = stringField(item, "threadId")
    const commentId = numberField(item, "commentId")
    const createdAt = stringField(item, "createdAt")
    const bodyHash = stringField(item, "bodyHash")
    if (
      !threadId
      || commentId === null
      || !Number.isInteger(commentId)
      || commentId <= 0
      || !createdAt
      || !Number.isFinite(Date.parse(createdAt))
      || !validCapabilityHash(bodyHash)
    ) return null
    receipts.push({ threadId, commentId, createdAt, bodyHash })
  }
  const sorted = [...receipts].sort((left, right) =>
    left.threadId.localeCompare(right.threadId) || left.commentId - right.commentId
  )
  if (JSON.stringify(receipts) !== JSON.stringify(sorted)) return null
  if (new Set(receipts.map((receipt) => receipt.threadId)).size !== receipts.length) return null
  return receipts
}

function parseReviewSealTag(
  tag: AnnotatedTag,
  repository: string,
  pr: number,
  claim: Claim,
  cycle: ReviewCycle,
): ReviewSeal {
  const payload = parseMarker<ReviewSealTagPayload>(tag.message, REVIEW_SEAL_TAG_MARKER)
  const findingRoots = payload ? parseFindingRootReceipts(payload.finding_roots) : null
  if (
    !validSha(tag.sha)
    || tag.objectType !== "commit"
    || !payload
    || tag.name !== `codex-pr-review-seal/${pr}/${cycle.headSha}`
    || payload.repository !== repository
    || payload.pr !== pr
    || payload.claim_tag_sha !== claim.tagSha
    || payload.review_tag_sha !== cycle.tagSha
    || payload.mission !== claim.mission
    || payload.actor !== claim.actor
    || payload.head !== cycle.headSha
    || !["clean", "review"].includes(payload.result_kind)
    || !isCodex(payload.result_actor)
    || !Number.isInteger(payload.result_id)
    || payload.result_id <= 0
    || !Number.isFinite(Date.parse(payload.result_created_at))
    || (
      payload.result_state !== null
      && (typeof payload.result_state !== "string" || payload.result_state.length === 0)
    )
    || (
      payload.result_body_hash !== null
      && !validCapabilityHash(payload.result_body_hash)
    )
    || !findingRoots
    || (
      payload.result_kind === "clean"
      && (
        payload.result_state !== null
        || payload.result_body_hash !== null
        || findingRoots.length !== 0
      )
    )
    || (
      payload.result_kind === "review"
      && (
        payload.result_state === null
        || payload.result_body_hash === null
      )
    )
    || tag.objectSha !== cycle.headSha
  ) throw new Error("invalid review seal tag")
  return {
    tagSha: tag.sha,
    reviewTagSha: cycle.tagSha,
    headSha: cycle.headSha,
    resultKind: payload.result_kind,
    resultActor: payload.result_actor,
    resultId: payload.result_id,
    resultCreatedAt: payload.result_created_at,
    resultState: payload.result_state,
    resultBodyHash: payload.result_body_hash,
    findingRoots,
  }
}

function exactTrigger(
  snapshot: PullRequestSnapshot,
  claim: Claim,
  cycle: ReviewCycle,
  receipt: ReviewTriggerReceipt,
): IssueComment | null {
  const comment = snapshot.comments.find((candidate) => candidate.id === receipt.commentId)
  if (!comment) return null
  const payload = parseMarker<ReviewPayload>(comment.body, REVIEW_MARKER)
  const expectedBody = [
    "@codex review",
    "",
    markerBody(REVIEW_MARKER, { review_tag_sha: cycle.tagSha }),
  ].join("\n")
  if (
    comment.nodeId !== receipt.commentNodeId
    || comment.createdAt !== receipt.commentCreatedAt
    || comment.minimized
    || !ELIGIBLE_ASSOCIATIONS.has(comment.association)
    || comment.actor !== claim.actor
    || comment.body !== expectedBody
    || payload?.review_tag_sha !== cycle.tagSha
    || receipt.reviewTagSha !== cycle.tagSha
    || receipt.headSha !== cycle.headSha
  ) return null
  return comment
}

function findingRootReceipts(
  snapshot: PullRequestSnapshot,
  headSha: string,
): ReviewFindingRootReceipt[] {
  return snapshot.threads.flatMap((thread) => {
    const root = thread.comments[0]
    if (!root || !isCodex(root.actor) || root.reviewCommitSha !== headSha) return []
    return [{
      threadId: thread.id,
      commentId: root.id,
      createdAt: root.createdAt,
      bodyHash: contentHash(root.body),
    }]
  }).sort((left, right) =>
    left.threadId.localeCompare(right.threadId) || left.commentId - right.commentId
  )
}

function exactSealedResult(
  snapshot: PullRequestSnapshot,
  trigger: IssueComment,
  cycle: ReviewCycle,
  seal: ReviewSeal,
): boolean {
  if (seal.reviewTagSha !== cycle.tagSha || seal.headSha !== cycle.headSha) return false
  if (Date.parse(seal.resultCreatedAt) < Date.parse(trigger.createdAt)) return false
  const codexReviews = snapshot.reviews.filter((review) =>
    isCodex(review.actor) && review.commitSha === cycle.headSha
  )
  if (seal.resultKind === "clean") {
    return seal.resultState === null
      && seal.resultBodyHash === null
      && seal.findingRoots.length === 0
      && codexReviews.length === 0
      && findingRootReceipts(snapshot, cycle.headSha).length === 0
      && seal.resultId === trigger.id
      && trigger.reactions.filter((reaction) =>
        isCodex(reaction.actor)
        && reaction.content === "THUMBS_UP"
        && Date.parse(reaction.createdAt) >= Date.parse(trigger.createdAt)
      ).length === 1
      && trigger.reactions.some((reaction) =>
        reaction.actor === seal.resultActor
        && reaction.content === "THUMBS_UP"
        && reaction.createdAt === seal.resultCreatedAt
      )
  }
  const review = codexReviews[0]
  return codexReviews.length === 1
    && review?.id === seal.resultId
    && review.actor === seal.resultActor
    && review.submittedAt === seal.resultCreatedAt
    && review.state === seal.resultState
    && contentHash(review.body) === seal.resultBodyHash
    && JSON.stringify(findingRootReceipts(snapshot, cycle.headSha))
      === JSON.stringify(seal.findingRoots)
}

function validateReviewHistory(
  snapshot: PullRequestSnapshot,
  claim: Claim,
  cycles: ReviewCycle[],
  triggerReceipts: ReviewTriggerReceipt[],
  seals: ReviewSeal[],
): string[] {
  const reasons: string[] = []
  const receiptByCycle = new Map(triggerReceipts.map((receipt) => [receipt.reviewTagSha, receipt]))
  const sealByCycle = new Map(seals.map((seal) => [seal.reviewTagSha, seal]))
  const cycleByHead = new Map<string, ReviewCycle>()
  for (const cycle of cycles) {
    if (cycleByHead.has(cycle.headSha)) {
      reasons.push(`multiple review cycles exist for head ${cycle.headSha}`)
    }
    cycleByHead.set(cycle.headSha, cycle)
    const receipt = receiptByCycle.get(cycle.tagSha)
    const seal = sealByCycle.get(cycle.tagSha)
    const trigger = receipt ? exactTrigger(snapshot, claim, cycle, receipt) : null
    if (!trigger) {
      reasons.push(`review cycle ${cycle.tagSha} lacks its exact visible trigger`)
      continue
    }
    if (!seal || !exactSealedResult(snapshot, trigger, cycle, seal)) {
      reasons.push(`review cycle ${cycle.tagSha} lacks its exact immutable seal`)
    }
  }
  if (triggerReceipts.length !== cycles.length || seals.length !== cycles.length) {
    reasons.push("review cycle artifact counts do not match")
  }
  const commitSet = new Set(snapshot.commits)
  for (const review of snapshot.reviews.filter((candidate) => isCodex(candidate.actor))) {
    if (!review.commitSha || !commitSet.has(review.commitSha) || !cycleByHead.has(review.commitSha)) {
      reasons.push(`Codex review ${review.id} is not owned by one retained review cycle`)
    }
  }
  for (const thread of snapshot.threads) {
    const root = thread.comments[0]
    if (!root || !isCodex(root.actor)) continue
    if (
      !root.reviewCommitSha
      || !commitSet.has(root.reviewCommitSha)
      || !cycleByHead.has(root.reviewCommitSha)
    ) {
      reasons.push(`review thread ${thread.id} is not owned by one retained review cycle`)
    }
  }
  return reasons
}

function visibleReviewTriggers(snapshot: PullRequestSnapshot): IssueComment[] {
  return snapshot.comments.filter((comment) =>
    /@codex\s+review\b/i.test(comment.body)
  )
}

function currentOrAmbiguousReviewTriggers(
  snapshot: PullRequestSnapshot,
  identity: PullRequestIdentity,
  reviewCycles: ReviewCycle[],
  triggerReceipts: ReviewTriggerReceipt[],
): IssueComment[] {
  const knownCycles = new Map(reviewCycles.map((cycle) => [cycle.tagSha, cycle]))
  const knownReceipts = new Map(triggerReceipts.map((receipt) => [receipt.reviewTagSha, receipt]))
  return visibleReviewTriggers(snapshot).filter((comment) => {
    const payload = parseMarker<ReviewPayload>(comment.body, REVIEW_MARKER)
    if (!payload) return true
    const known = knownCycles.get(payload.review_tag_sha)
    const receipt = knownReceipts.get(payload.review_tag_sha)
    if (
      !known
      || !receipt
      || receipt.commentId !== comment.id
      || receipt.commentNodeId !== comment.nodeId
      || receipt.commentCreatedAt !== comment.createdAt
    ) return true
    return known.headSha === identity.headSha
  })
}

function findingDispositions(
  thread: ReviewThread,
  claim: Claim,
  commits: string[],
): FindingPayload[] {
  const root = thread.comments[0]
  const reviewedIndex = root?.reviewCommitSha
    ? commits.indexOf(root.reviewCommitSha)
    : -1
  if (reviewedIndex < 0) return []
  const matches: FindingPayload[] = []
  for (const comment of thread.comments.slice(1)) {
    if (comment.actor !== claim.actor) continue
    const payload = parseMarker<FindingPayload>(comment.body, FINDING_MARKER)
    if (
      payload
      && payload.thread_id === thread.id
      && payload.finding_comment_id === thread.comments[0]?.id
      && ["fixed", "deferred", "rejected"].includes(payload.disposition)
      && validSha(payload.fix_sha)
      && payload.reason.trim().length > 0
      && commits.indexOf(payload.fix_sha) > reviewedIndex
    ) matches.push(payload)
  }
  return matches
}

function findingDisposition(
  thread: ReviewThread,
  claim: Claim,
  commits: string[],
): FindingPayload | null {
  const matches = findingDispositions(thread, claim, commits)
  return matches.length === 1 ? matches[0]! : null
}

export function isCodexFindingRoot(thread: ReviewThread, commentId: number): boolean {
  const root = thread.comments[0]
  return root?.id === commentId && isCodex(root.actor)
}

export function verifyReceipt(
  snapshot: PullRequestSnapshot,
  claim: Claim,
  cycle: ReviewCycle,
  triggerReceipt: ReviewTriggerReceipt,
  options: {
    allowDraft?: boolean
    reviewCycles?: ReviewCycle[]
    triggerReceipts?: ReviewTriggerReceipt[]
    seals?: ReviewSeal[]
  } = {},
): Verification {
  const reasons: string[] = []
  const reviewCycles = options.reviewCycles ?? [cycle]
  const triggerReceipts = options.triggerReceipts ?? [triggerReceipt]
  const seals = options.seals ?? []
  if (!snapshot.complete) reasons.push("provider snapshot is incomplete")
  if (!snapshot.open || snapshot.merged) reasons.push("pull request is not open")
  if (snapshot.headRepository !== snapshot.repository) reasons.push("fork pull requests are blocked")
  if (snapshot.draft && !options.allowDraft) reasons.push("pull request is still draft")
  if (!snapshot.commits.includes(claim.initialHead)) {
    reasons.push("claim initial head is not in the current PR lineage")
  }
  if (
    cycle.claimTagSha !== claim.tagSha
    || cycle.actor !== claim.actor
    || cycle.mission !== claim.mission
    || cycle.headSha !== snapshot.headSha
    || cycle.baseRef !== snapshot.baseRef
    || cycle.baseSha !== snapshot.baseSha
  ) reasons.push("review tag does not match the live PR identity")
  reasons.push(...validateReviewHistory(
    snapshot,
    claim,
    reviewCycles,
    triggerReceipts,
    seals,
  ))

  const triggers = currentOrAmbiguousReviewTriggers(
    snapshot,
    snapshot,
    reviewCycles,
    triggerReceipts,
  )
  if (triggers.length !== 1) {
    reasons.push(`expected one visible review trigger, found ${triggers.length}`)
    return { ok: false, reasons }
  }
  const trigger = triggers[0]!
  const triggerPayload = parseMarker<ReviewPayload>(trigger.body, REVIEW_MARKER)
  if (
    trigger.minimized
    || !ELIGIBLE_ASSOCIATIONS.has(trigger.association)
    || trigger.actor !== claim.actor
    || triggerPayload?.review_tag_sha !== cycle.tagSha
    || triggerReceipt.reviewTagSha !== cycle.tagSha
    || triggerReceipt.headSha !== cycle.headSha
    || triggerReceipt.commentId !== trigger.id
    || triggerReceipt.commentNodeId !== trigger.nodeId
    || triggerReceipt.commentCreatedAt !== trigger.createdAt
  ) {
    reasons.push("visible review trigger is not the claimed exact-head trigger")
    return { ok: false, reasons }
  }
  const triggerAt = Date.parse(trigger.createdAt)
  const codexReactions = trigger.reactions.filter((reaction) =>
    isCodex(reaction.actor) && Date.parse(reaction.createdAt) >= triggerAt
  )
  const cleanReactions = codexReactions.filter((reaction) =>
    reaction.content === "THUMBS_UP"
  )
  const currentReviews = snapshot.reviews.filter((review) =>
    isCodex(review.actor) && review.commitSha === snapshot.headSha
  )
  const currentFindingThreads = snapshot.threads.filter((thread) => {
    const root = thread.comments[0]
    return root && isCodex(root.actor) && root.reviewCommitSha === snapshot.headSha
  })
  const currentSeal = seals.find((seal) => seal.reviewTagSha === cycle.tagSha)

  if (cleanReactions.length !== 1) {
    reasons.push(`expected one Codex +1 on the exact trigger, found ${cleanReactions.length}`)
  }
  if (snapshot.rootReactions.some((reaction) => isCodex(reaction.actor))) {
    reasons.push("uncorrelated Codex root reaction exists")
  }
  if (currentReviews.length > 0 || currentFindingThreads.length > 0) {
    reasons.push("Codex submitted a finding review for the current head")
  }
  if (
    !currentSeal
    || currentSeal.resultKind !== "clean"
    || !exactSealedResult(snapshot, trigger, cycle, currentSeal)
  ) {
    reasons.push("current review cycle lacks an exact clean seal")
  }
  if (codexReactions.some((reaction) =>
    reaction.content !== "EYES" && reaction.content !== "THUMBS_UP"
  )) {
    reasons.push("unexpected Codex reaction exists on the trigger")
  }

  for (const thread of snapshot.threads) {
    const root = thread.comments[0]
    if (!root || !isCodex(root.actor)) continue
    if (!thread.resolved) reasons.push(`review thread ${thread.id} is unresolved`)
    if (!findingDisposition(thread, claim, snapshot.commits)) {
      reasons.push(`review thread ${thread.id} lacks an exact fix/disposition receipt`)
    }
  }

  if (reasons.length > 0) return { ok: false, reasons }
  const clean = cleanReactions[0]!
  return {
    ok: true,
    reasons: [],
    receipt: {
      repository: snapshot.repository,
      pr: snapshot.number,
      claimTagSha: claim.tagSha,
      reviewTagSha: cycle.tagSha,
      mission: claim.mission,
      triggerCommentId: trigger.id,
      reviewer: clean.actor,
      headSha: snapshot.headSha,
      baseRef: snapshot.baseRef,
      baseSha: snapshot.baseSha,
      cleanReactionAt: clean.createdAt,
    },
  }
}

function runGh(args: string[]): unknown {
  const result = spawnSync("gh", args, { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `gh ${args.join(" ")} failed`)
  }
  return JSON.parse(result.stdout)
}

function runGhText(args: string[]): string {
  const result = spawnSync("gh", args, { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `gh ${args.join(" ")} failed`)
  }
  return result.stdout.trim()
}

function flattenPages(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) throw new Error("expected paginated GitHub array")
  const rows = value.flatMap((page) => Array.isArray(page) ? page : [page])
  if (!rows.every(isObject)) throw new Error("unexpected GitHub page shape")
  return rows
}

function paginated(endpoint: string): JsonObject[] {
  return flattenPages(runGh(["api", "--paginate", "--slurp", endpoint]))
}

function actorLogin(value: unknown): string {
  if (!isObject(value)) return ""
  return stringField(value, "login") ?? ""
}

const SNAPSHOT_QUERY = `
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reactions(first:100){pageInfo{hasNextPage} nodes{content createdAt user{login}}}
      comments(first:100){
        pageInfo{hasNextPage}
        nodes{
          databaseId id body createdAt isMinimized authorAssociation author{login}
          reactions(first:100){pageInfo{hasNextPage} nodes{content createdAt user{login}}}
        }
      }
      reviewThreads(first:100){
        pageInfo{hasNextPage}
        nodes{
          id isResolved isOutdated
          comments(first:100){
            pageInfo{hasNextPage}
            nodes{
              databaseId body createdAt outdated author{login}
              pullRequestReview{commit{oid}}
            }
          }
        }
      }
    }
  }
}`

function providerConversation(repository: string, pr: number): {
  complete: boolean
  comments: IssueComment[]
  rootReactions: Reaction[]
  threads: ReviewThread[]
} {
  const [owner, name] = repository.split("/")
  if (!owner || !name) throw new Error(`invalid repository: ${repository}`)
  const raw = runGh([
    "api", "graphql",
    "-F", `owner=${owner}`,
    "-F", `name=${name}`,
    "-F", `number=${pr}`,
    "-f", `query=${SNAPSHOT_QUERY}`,
  ])
  if (!isObject(raw) || !isObject(raw.data)) throw new Error("missing GraphQL data")
  const repositoryNode = raw.data.repository
  if (!isObject(repositoryNode) || !isObject(repositoryNode.pullRequest)) {
    throw new Error("pull request not found in GraphQL response")
  }
  const pullRequest = repositoryNode.pullRequest
  const threadConnection = pullRequest.reviewThreads
  const commentConnection = pullRequest.comments
  const reactionConnection = pullRequest.reactions
  if (
    !isObject(threadConnection)
    || !Array.isArray(threadConnection.nodes)
    || !isObject(threadConnection.pageInfo)
    || !isObject(commentConnection)
    || !Array.isArray(commentConnection.nodes)
    || !isObject(commentConnection.pageInfo)
    || !isObject(reactionConnection)
    || !Array.isArray(reactionConnection.nodes)
    || !isObject(reactionConnection.pageInfo)
  ) throw new Error("missing pull request conversation")

  let complete = threadConnection.pageInfo.hasNextPage === false
    && commentConnection.pageInfo.hasNextPage === false
    && reactionConnection.pageInfo.hasNextPage === false
  const comments = commentConnection.nodes.map((node): IssueComment => {
    if (!isObject(node) || !isObject(node.reactions) || !Array.isArray(node.reactions.nodes)) {
      throw new Error("invalid issue comment")
    }
    if (!isObject(node.reactions.pageInfo) || node.reactions.pageInfo.hasNextPage !== false) {
      complete = false
    }
    return {
      id: numberField(node, "databaseId") ?? 0,
      nodeId: stringField(node, "id") ?? "",
      actor: actorLogin(node.author),
      association: stringField(node, "authorAssociation") ?? "",
      body: stringField(node, "body") ?? "",
      createdAt: stringField(node, "createdAt") ?? "",
      minimized: node.isMinimized === true,
      reactions: node.reactions.nodes.map((reaction): Reaction => {
        if (!isObject(reaction)) throw new Error("invalid issue comment reaction")
        return {
          content: stringField(reaction, "content") ?? "",
          createdAt: stringField(reaction, "createdAt") ?? "",
          actor: actorLogin(reaction.user),
        }
      }),
    }
  })
  const rootReactions = reactionConnection.nodes.map((reaction): Reaction => {
    if (!isObject(reaction)) throw new Error("invalid pull request reaction")
    return {
      content: stringField(reaction, "content") ?? "",
      createdAt: stringField(reaction, "createdAt") ?? "",
      actor: actorLogin(reaction.user),
    }
  })
  const threads = threadConnection.nodes.map((value): ReviewThread => {
    if (!isObject(value) || !isObject(value.comments) || !Array.isArray(value.comments.nodes)) {
      throw new Error("invalid review thread")
    }
    if (!isObject(value.comments.pageInfo) || value.comments.pageInfo.hasNextPage !== false) {
      complete = false
    }
    return {
      id: stringField(value, "id") ?? "",
      resolved: value.isResolved === true,
      outdated: value.isOutdated === true,
      comments: value.comments.nodes.map((node): ReviewComment => {
        if (!isObject(node)) throw new Error("invalid review comment")
        const review = node.pullRequestReview
        const commit = isObject(review) ? review.commit : null
        return {
          id: numberField(node, "databaseId") ?? 0,
          actor: actorLogin(node.author),
          body: stringField(node, "body") ?? "",
          createdAt: stringField(node, "createdAt") ?? "",
          outdated: node.outdated === true,
          reviewCommitSha: isObject(commit) ? stringField(commit, "oid") : null,
        }
      }),
    }
  })
  return { complete, comments, rootReactions, threads }
}

interface BasicPullRequest {
  open: boolean
  merged: boolean
  draft: boolean
  headSha: string
  headRepository: string
  baseRef: string
  baseSha: string
}

function samePullRequestIdentity(left: BasicPullRequest, right: BasicPullRequest): boolean {
  return left.open === right.open
    && left.merged === right.merged
    && left.draft === right.draft
    && left.headSha === right.headSha
    && left.headRepository === right.headRepository
    && left.baseRef === right.baseRef
    && left.baseSha === right.baseSha
}

function fetchBasicPullRequest(repository: string, pr: number): BasicPullRequest {
  const pull = runGh(["api", `repos/${repository}/pulls/${pr}`])
  if (!isObject(pull) || !isObject(pull.head) || !isObject(pull.base)) {
    throw new Error("invalid pull request response")
  }
  const headRepo = isObject(pull.head.repo) ? pull.head.repo : null
  return {
    open: pull.state === "open",
    merged: pull.merged === true,
    draft: pull.draft === true,
    headSha: stringField(pull.head, "sha") ?? "",
    headRepository: headRepo ? stringField(headRepo, "full_name") ?? "" : "",
    baseRef: stringField(pull.base, "ref") ?? "",
    baseSha: stringField(pull.base, "sha") ?? "",
  }
}

function fetchSnapshotOnce(repository: string, pr: number): PullRequestSnapshot {
  const pull = fetchBasicPullRequest(repository, pr)
  const reviews = paginated(`repos/${repository}/pulls/${pr}/reviews`).map((review): Review => ({
    id: numberField(review, "id") ?? 0,
    actor: actorLogin(review.user),
    state: stringField(review, "state") ?? "",
    body: stringField(review, "body") ?? "",
    submittedAt: stringField(review, "submitted_at") ?? "",
    commitSha: stringField(review, "commit_id"),
  }))
  const commits = paginated(`repos/${repository}/pulls/${pr}/commits`)
    .map((commit) => stringField(commit, "sha"))
    .filter((sha): sha is string => sha !== null)
  const conversation = providerConversation(repository, pr)
  const after = fetchBasicPullRequest(repository, pr)
  if (!samePullRequestIdentity(pull, after)) {
    throw new Error("PR identity changed while fetching provider snapshot")
  }
  return {
    repository,
    number: pr,
    ...pull,
    commits,
    comments: conversation.comments,
    rootReactions: conversation.rootReactions,
    reviews,
    threads: conversation.threads,
    complete: conversation.complete,
  }
}

export function fetchSnapshot(repository: string, pr: number): PullRequestSnapshot {
  const first = fetchSnapshotOnce(repository, pr)
  const second = fetchSnapshotOnce(repository, pr)
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error("provider evidence changed while fetching stable snapshot")
  }
  return second
}

function addComment(repository: string, pr: number, body: string): IssueComment {
  const raw = runGh([
    "api", "--method", "POST", `repos/${repository}/issues/${pr}/comments`,
    "-f", `body=${body}`,
  ])
  if (!isObject(raw)) throw new Error("invalid created comment response")
  return {
    id: numberField(raw, "id") ?? 0,
    nodeId: stringField(raw, "node_id") ?? "",
    actor: actorLogin(raw.user),
    association: stringField(raw, "author_association") ?? "",
    body: stringField(raw, "body") ?? "",
    createdAt: stringField(raw, "created_at") ?? "",
    minimized: false,
    reactions: [],
  }
}

function currentActor(): string {
  const raw = runGh(["api", "user"])
  if (!isObject(raw)) throw new Error("invalid authenticated user response")
  const login = stringField(raw, "login")
  if (!login) throw new Error("authenticated GitHub login is unavailable")
  return login
}

function option(args: string[], name: string, required = true): string | null {
  const index = args.indexOf(name)
  if (index === -1) {
    if (required) throw new Error(`missing ${name}`)
    return null
  }
  const value = args[index + 1]
  if (!value) throw new Error(`missing value for ${name}`)
  return value
}

function integerOption(args: string[], name: string): number {
  const value = Number(option(args, name))
  if (!Number.isInteger(value) || value <= 0) throw new Error(`invalid ${name}`)
  return value
}

function claimRef(pr: number): string {
  return `codex-pr-claim/${pr}`
}

function reviewRef(pr: number, head: string): string {
  return `codex-pr-review/${pr}/${head}`
}

function reviewTriggerRef(pr: number, head: string): string {
  return `codex-pr-review-trigger/${pr}/${head}`
}

function reviewSealRef(pr: number, head: string): string {
  return `codex-pr-review-seal/${pr}/${head}`
}

function fetchAnnotatedTag(repository: string, name: string): AnnotatedTag {
  const ref = runGh(["api", `repos/${repository}/git/ref/tags/${name}`])
  if (!isObject(ref) || !isObject(ref.object)) throw new Error(`tag ref ${name} is unavailable`)
  const tagSha = stringField(ref.object, "sha")
  if (!validSha(tagSha) || stringField(ref.object, "type") !== "tag") {
    throw new Error(`tag ref ${name} is not annotated`)
  }
  const raw = runGh(["api", `repos/${repository}/git/tags/${tagSha}`])
  if (!isObject(raw) || !isObject(raw.object)) throw new Error(`annotated tag ${tagSha} is unavailable`)
  const objectSha = stringField(raw.object, "sha")
  const objectType = stringField(raw.object, "type")
  if (!validSha(objectSha) || !objectType) throw new Error(`annotated tag ${tagSha} is invalid`)
  return {
    sha: tagSha,
    name,
    message: stringField(raw, "message") ?? "",
    objectSha,
    objectType,
  }
}

function createAnnotatedTagObject(
  repository: string,
  name: string,
  objectSha: string,
  message: string,
): string {
  const created = runGh([
    "api", "--method", "POST", `repos/${repository}/git/tags`,
    "-f", `tag=${name}`,
    "-f", `message=${message}`,
    "-f", `object=${objectSha}`,
    "-f", "type=commit",
  ])
  if (!isObject(created)) throw new Error("invalid annotated tag response")
  const tagSha = stringField(created, "sha")
  if (!validSha(tagSha)) throw new Error("annotated tag SHA is unavailable")
  return tagSha
}

function createAtomicTagRef(
  repository: string,
  name: string,
  tagSha: string,
): AnnotatedTag {
  try {
    runGh([
      "api", "--method", "POST", `repos/${repository}/git/refs`,
      "-f", `ref=refs/tags/${name}`,
      "-f", `sha=${tagSha}`,
    ])
  } catch {
    const winner = fetchAnnotatedTag(repository, name)
    throw new Error(`atomic tag claim lost to ${winner.sha}`)
  }
  return fetchAnnotatedTag(repository, name)
}

function createAtomicTag(
  repository: string,
  name: string,
  objectSha: string,
  message: string,
): AnnotatedTag {
  const tagSha = createAnnotatedTagObject(repository, name, objectSha, message)
  return createAtomicTagRef(repository, name, tagSha)
}

function loadClaim(repository: string, pr: number, expectedSha?: string | null): Claim {
  const claim = validateClaimTag(fetchAnnotatedTag(repository, claimRef(pr)), repository, pr)
  if (expectedSha && claim.tagSha !== expectedSha) throw new Error("claim tag SHA does not match")
  return claim
}

function loadReviewCycle(
  repository: string,
  snapshot: PullRequestSnapshot,
  claim: Claim,
): ReviewCycle {
  return validateReviewTag(
    fetchAnnotatedTag(repository, reviewRef(snapshot.number, snapshot.headSha)),
    snapshot,
    claim,
  )
}

function loadReviewArtifacts(
  repository: string,
  snapshot: PullRequestSnapshot,
  claim: Claim,
): { cycles: ReviewCycle[]; triggerReceipts: ReviewTriggerReceipt[] } {
  const prefix = `codex-pr-review/${snapshot.number}/`
  const cycles = paginated(`repos/${repository}/git/matching-refs/tags/${prefix}`)
    .map((ref) => {
      const fullName = stringField(ref, "ref")
      if (!fullName?.startsWith("refs/tags/")) throw new Error("invalid review tag ref")
      return fetchAnnotatedTag(repository, fullName.slice("refs/tags/".length))
    })
    .map((tag) => parseReviewTag(tag, repository, snapshot.number, claim))
    .filter((cycle) => {
      if (!snapshot.commits.includes(cycle.headSha)) {
        throw new Error("review tag head is not in the current PR lineage")
      }
      return true
    })
  const triggerReceipts = cycles.map((cycle) => parseReviewTriggerTag(
    fetchAnnotatedTag(repository, reviewTriggerRef(snapshot.number, cycle.headSha)),
    repository,
    snapshot.number,
    claim,
    cycle,
  ))
  return { cycles, triggerReceipts }
}

function loadReviewCycles(
  repository: string,
  snapshot: PullRequestSnapshot,
  claim: Claim,
): { cycles: ReviewCycle[]; triggerReceipts: ReviewTriggerReceipt[]; seals: ReviewSeal[] } {
  const artifacts = loadReviewArtifacts(repository, snapshot, claim)
  const seals = artifacts.cycles.map((cycle) => parseReviewSealTag(
    fetchAnnotatedTag(repository, reviewSealRef(snapshot.number, cycle.headSha)),
    repository,
    snapshot.number,
    claim,
    cycle,
  ))
  return { ...artifacts, seals }
}

function requireClaimOwner(claim: Claim): void {
  const actor = currentActor()
  if (actor !== claim.actor) throw new Error(`claim ${claim.tagSha} belongs to ${claim.actor}`)
}

export function requireClaimCapability(claim: Claim, capability: string): void {
  if (capabilityHash(capability) !== claim.capabilityHash) {
    throw new Error("claim capability does not match")
  }
}

function requireWriter(claim: Claim, args: string[]): void {
  requireClaimOwner(claim)
  requireClaimCapability(claim, option(args, "--capability")!)
}

function requireClaimLineage(snapshot: PullRequestSnapshot, claim: Claim): void {
  if (!snapshot.commits.includes(claim.initialHead)) {
    throw new Error("claim initial head is not in the current PR lineage")
  }
}

async function commandClaim(args: string[]): Promise<void> {
  const repository = option(args, "--repo")!
  const pr = integerOption(args, "--pr")
  const mission = option(args, "--mission")!
  if (!validMission(mission)) throw new Error("invalid mission id")
  const snapshot = fetchSnapshot(repository, pr)
  requireComplete(snapshot)
  if (!snapshot.open || snapshot.merged) throw new Error("pull request is not open")
  if (snapshot.headRepository !== repository) throw new Error("fork pull requests are blocked")
  const actor = currentActor()
  const capability = randomBytes(32).toString("hex")
  const created = createAtomicTag(
    repository,
    claimRef(pr),
    snapshot.headSha,
    markerBody(CLAIM_TAG_MARKER, {
      repository,
      pr,
      mission,
      capability_hash: capabilityHash(capability),
      actor,
      initial_head: snapshot.headSha,
    }),
  )
  const claim = validateClaimTag(created, repository, pr)
  addComment(repository, pr, markerBody(CLAIM_RECEIPT_MARKER, {
    claim_tag_sha: claim.tagSha,
    mission: claim.mission,
    actor: claim.actor,
  }))
  process.stdout.write(`${JSON.stringify({ ...claim, capability })}\n`)
}

async function commandReview(args: string[]): Promise<void> {
  const repository = option(args, "--repo")!
  const pr = integerOption(args, "--pr")
  const expectedClaim = option(args, "--claim")!
  const snapshot = fetchSnapshot(repository, pr)
  requireComplete(snapshot)
  const claim = loadClaim(repository, pr, expectedClaim)
  requireWriter(claim, args)
  if (!snapshot.draft) throw new Error("review trigger requires a draft pull request")
  requireClaimLineage(snapshot, claim)
  if (
    snapshot.rootReactions.some((reaction) => isCodex(reaction.actor))
    || snapshot.reviews.some((review) =>
      isCodex(review.actor) && review.commitSha === snapshot.headSha
    )
  ) throw new Error("automatic or prior Codex review evidence already exists for this head")
  const reviewHistory = loadReviewCycles(repository, snapshot, claim)
  const historyReasons = validateReviewHistory(
    snapshot,
    claim,
    reviewHistory.cycles,
    reviewHistory.triggerReceipts,
    reviewHistory.seals,
  )
  if (historyReasons.length > 0) {
    throw new Error(`review history is poisoned: ${historyReasons[0]}`)
  }
  if (currentOrAmbiguousReviewTriggers(
    snapshot,
    snapshot,
    reviewHistory.cycles,
    reviewHistory.triggerReceipts,
  ).length > 0) {
    throw new Error("an explicit Codex review trigger already exists")
  }

  const created = createAtomicTag(
    repository,
    reviewRef(pr, snapshot.headSha),
    snapshot.headSha,
    markerBody(REVIEW_TAG_MARKER, {
      repository,
      pr,
      claim_tag_sha: claim.tagSha,
      mission: claim.mission,
      actor: claim.actor,
      head: snapshot.headSha,
      base_ref: snapshot.baseRef,
      base_sha: snapshot.baseSha,
    }),
  )
  const cycle = validateReviewTag(created, snapshot, claim)
  const trigger = addComment(repository, pr, [
    "@codex review",
    "",
    markerBody(REVIEW_MARKER, { review_tag_sha: cycle.tagSha }),
  ].join("\n"))
  const afterTrigger = fetchBasicPullRequest(repository, pr)
  if (
    afterTrigger.headSha !== snapshot.headSha
    || afterTrigger.baseRef !== snapshot.baseRef
    || afterTrigger.baseSha !== snapshot.baseSha
  ) {
    throw new Error("PR identity changed while posting review trigger; cycle is poisoned")
  }
  const triggerTag = createAtomicTag(
    repository,
    reviewTriggerRef(pr, snapshot.headSha),
    snapshot.headSha,
    markerBody(REVIEW_TRIGGER_TAG_MARKER, {
      repository,
      pr,
      claim_tag_sha: claim.tagSha,
      review_tag_sha: cycle.tagSha,
      mission: claim.mission,
      actor: claim.actor,
      head: snapshot.headSha,
      comment_id: trigger.id,
      comment_node_id: trigger.nodeId,
      comment_created_at: trigger.createdAt,
    }),
  )
  const triggerReceipt = parseReviewTriggerTag(
    triggerTag,
    repository,
    pr,
    claim,
    cycle,
  )
  process.stdout.write(`${JSON.stringify({
    triggerCommentId: trigger.id,
    reviewTagSha: cycle.tagSha,
    triggerTagSha: triggerReceipt.tagSha,
    head: snapshot.headSha,
  })}\n`)
}

async function commandSeal(args: string[]): Promise<void> {
  const repository = option(args, "--repo")!
  const pr = integerOption(args, "--pr")
  const expectedClaim = option(args, "--claim")!
  const snapshot = fetchSnapshot(repository, pr)
  requireComplete(snapshot)
  const claim = loadClaim(repository, pr, expectedClaim)
  requireWriter(claim, args)
  requireClaimLineage(snapshot, claim)

  const artifacts = loadReviewArtifacts(repository, snapshot, claim)
  const cycle = artifacts.cycles.find((candidate) => candidate.headSha === snapshot.headSha)
  const receipt = cycle
    ? artifacts.triggerReceipts.find((candidate) => candidate.reviewTagSha === cycle.tagSha)
    : null
  if (!cycle || !receipt) throw new Error("current review cycle is incomplete")

  const priorCycles = artifacts.cycles.filter((candidate) => candidate.tagSha !== cycle.tagSha)
  const priorReceipts = artifacts.triggerReceipts.filter(
    (candidate) => candidate.reviewTagSha !== cycle.tagSha,
  )
  const priorSeals = priorCycles.map((candidate) => parseReviewSealTag(
    fetchAnnotatedTag(repository, reviewSealRef(pr, candidate.headSha)),
    repository,
    pr,
    claim,
    candidate,
  ))
  const historyReasons = validateReviewHistory(
    snapshot,
    claim,
    priorCycles,
    priorReceipts,
    priorSeals,
  )
  if (historyReasons.length > 0) {
    throw new Error(`review history is poisoned: ${historyReasons[0]}`)
  }

  const trigger = exactTrigger(snapshot, claim, cycle, receipt)
  if (!trigger) throw new Error("current review trigger is missing or changed")
  const triggerAt = Date.parse(trigger.createdAt)
  const clean = trigger.reactions.filter((reaction) =>
    isCodex(reaction.actor)
    && reaction.content === "THUMBS_UP"
    && Date.parse(reaction.createdAt) >= triggerAt
  )
  const reviews = snapshot.reviews.filter((review) =>
    isCodex(review.actor)
    && review.commitSha === cycle.headSha
    && Date.parse(review.submittedAt) >= triggerAt
  )
  if (clean.length + reviews.length !== 1) {
    throw new Error("review result is pending or ambiguous")
  }
  const result = clean[0] ?? reviews[0]!
  const resultKind = clean.length === 1 ? "clean" : "review"
  const resultId = resultKind === "clean" ? trigger.id : (result as Review).id
  const resultCreatedAt = resultKind === "clean"
    ? (result as Reaction).createdAt
    : (result as Review).submittedAt
  const resultActor = result.actor
  const reviewResult = resultKind === "review" ? result as Review : null
  if (reviewResult?.state === "DISMISSED") {
    throw new Error("dismissed review result cannot be sealed")
  }
  const sealName = reviewSealRef(pr, cycle.headSha)
  const sealTagSha = createAnnotatedTagObject(
    repository,
    sealName,
    cycle.headSha,
    markerBody(REVIEW_SEAL_TAG_MARKER, {
      repository,
      pr,
      claim_tag_sha: claim.tagSha,
      review_tag_sha: cycle.tagSha,
      mission: claim.mission,
      actor: claim.actor,
      head: cycle.headSha,
      result_kind: resultKind,
      result_actor: resultActor,
      result_id: resultId,
      result_created_at: resultCreatedAt,
      result_state: reviewResult?.state ?? null,
      result_body_hash: reviewResult ? contentHash(reviewResult.body) : null,
      finding_roots: reviewResult ? findingRootReceipts(snapshot, cycle.headSha) : [],
    }),
  )
  const confirmed = fetchSnapshot(repository, pr)
  if (JSON.stringify(snapshot) !== JSON.stringify(confirmed)) {
    throw new Error("provider evidence changed while sealing review result")
  }
  const live = fetchBasicPullRequest(repository, pr)
  if (!samePullRequestIdentity(snapshot, live)) {
    throw new Error("PR identity changed while sealing review result")
  }
  const created = createAtomicTagRef(repository, sealName, sealTagSha)
  const seal = parseReviewSealTag(created, repository, pr, claim, cycle)
  process.stdout.write(`${JSON.stringify(seal)}\n`)
}

async function commandAddress(args: string[]): Promise<void> {
  const repository = option(args, "--repo")!
  const pr = integerOption(args, "--pr")
  const expectedClaim = option(args, "--claim")!
  const threadId = option(args, "--thread-id")!
  const findingCommentId = integerOption(args, "--finding-comment-id")
  const disposition = option(args, "--disposition")!
  const fixSha = option(args, "--fix-sha")!
  const reason = option(args, "--reason")!
  if (!["fixed", "deferred", "rejected"].includes(disposition)) {
    throw new Error("disposition must be fixed, deferred, or rejected")
  }
  if (!validSha(fixSha)) throw new Error("fix SHA must be a full commit SHA")

  const snapshot = fetchSnapshot(repository, pr)
  requireComplete(snapshot)
  const claim = loadClaim(repository, pr, expectedClaim)
  requireWriter(claim, args)
  requireClaimLineage(snapshot, claim)
  const reviewHistory = loadReviewCycles(repository, snapshot, claim)
  const historyReasons = validateReviewHistory(
    snapshot,
    claim,
    reviewHistory.cycles,
    reviewHistory.triggerReceipts,
    reviewHistory.seals,
  )
  if (historyReasons.length > 0) {
    throw new Error(`review history is poisoned: ${historyReasons[0]}`)
  }
  if (!snapshot.commits.includes(fixSha)) throw new Error("fix SHA is not in the current PR lineage")
  const thread = snapshot.threads.find((candidate) => candidate.id === threadId)
  if (!thread || !isCodexFindingRoot(thread, findingCommentId)) {
    throw new Error("finding is not a Codex root comment in the live review thread")
  }
  const reviewedHead = thread.comments[0]?.reviewCommitSha
  const reviewedIndex = reviewedHead ? snapshot.commits.indexOf(reviewedHead) : -1
  const fixIndex = snapshot.commits.indexOf(fixSha)
  if (
    reviewedIndex < 0
    || fixIndex <= reviewedIndex
  ) {
    throw new Error("fix SHA must be a descendant commit after the finding review head")
  }
  const existing = findingDispositions(thread, claim, snapshot.commits)
  if (existing.length > 1) throw new Error("finding has ambiguous disposition receipts")
  if (existing.length === 1) {
    const receipt = existing[0]!
    if (
      receipt.disposition !== disposition
      || receipt.fix_sha !== fixSha
      || receipt.reason !== reason
    ) {
      throw new Error("existing finding disposition does not match the requested receipt")
    }
  } else {
    runGh([
      "api", "--method", "POST",
      `repos/${repository}/pulls/${pr}/comments/${findingCommentId}/replies`,
      "-f", `body=${markerBody(FINDING_MARKER, {
        thread_id: threadId,
        finding_comment_id: findingCommentId,
        disposition,
        fix_sha: fixSha,
        reason,
      })}`,
    ])
  }
  if (!thread.resolved) {
    runGh([
      "api", "graphql",
      "-F", `threadId=${threadId}`,
      "-f", "query=mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}}",
    ])
  }
  process.stdout.write(`${JSON.stringify({ threadId, findingCommentId, disposition, fixSha })}\n`)
}

async function verifyLive(
  repository: string,
  pr: number,
  expected: {
    head?: string | null
    baseRef?: string | null
    baseSha?: string | null
    workflowSha?: string | null
  },
  allowDraft: boolean,
): Promise<{ verification: Verification; snapshot: PullRequestSnapshot }> {
  const snapshot = fetchSnapshot(repository, pr)
  const claim = loadClaim(repository, pr)
  const cycle = loadReviewCycle(repository, snapshot, claim)
  const reviewHistory = loadReviewCycles(repository, snapshot, claim)
  const triggerReceipt = reviewHistory.triggerReceipts.find(
    (receipt) => receipt.reviewTagSha === cycle.tagSha,
  )
  if (!triggerReceipt) throw new Error("current review trigger tag is unavailable")
  const verification = verifyReceipt(snapshot, claim, cycle, triggerReceipt, {
    allowDraft,
    reviewCycles: reviewHistory.cycles,
    triggerReceipts: reviewHistory.triggerReceipts,
    seals: reviewHistory.seals,
  })
  if (expected.head && expected.head !== snapshot.headSha) {
    verification.ok = false
    verification.reasons.push("expected head does not match the live PR head")
  }
  if (expected.baseRef && expected.baseRef !== snapshot.baseRef) {
    verification.ok = false
    verification.reasons.push("expected base ref does not match the live PR base")
  }
  if (expected.baseSha && expected.baseSha !== snapshot.baseSha) {
    verification.ok = false
    verification.reasons.push("expected base SHA does not match the live PR base")
  }
  if (expected.workflowSha && expected.workflowSha !== snapshot.baseSha) {
    verification.ok = false
    verification.reasons.push("trusted workflow SHA does not match the live PR base")
  }
  if (snapshot.baseRef !== "main") {
    verification.ok = false
    verification.reasons.push("only the main base branch is supported")
  }
  return { verification, snapshot }
}

function postStatus(
  repository: string,
  sha: string,
  state: "success" | "failure",
  description: string,
): void {
  runGh([
    "api", "--method", "POST", `repos/${repository}/statuses/${sha}`,
    "-f", `state=${state}`,
    "-f", `context=${GATE_CONTEXT}`,
    "-f", `description=${description.slice(0, 140)}`,
  ])
}

export function gateStatusForLiveIdentity(
  verified: PullRequestIdentity,
  live: PullRequestIdentity,
  requestedState: "success" | "failure",
): { sha: string; state: "success" | "failure"; identityChanged: boolean } {
  const identityChanged = (
    verified.headSha !== live.headSha
    || verified.baseRef !== live.baseRef
    || verified.baseSha !== live.baseSha
  )
  return {
    sha: live.headSha,
    state: identityChanged ? "failure" : requestedState,
    identityChanged,
  }
}

function publishGateStatus(
  repository: string,
  pr: number,
  verified: PullRequestIdentity,
  requestedState: "success" | "failure",
  description: string,
): boolean {
  const before = fetchBasicPullRequest(repository, pr)
  const initial = gateStatusForLiveIdentity(verified, before, requestedState)
  postStatus(
    repository,
    initial.sha,
    initial.state,
    initial.identityChanged ? "PR identity changed during lifecycle verification" : description,
  )
  if (initial.identityChanged) return false

  const after = fetchBasicPullRequest(repository, pr)
  const confirmation = gateStatusForLiveIdentity(verified, after, requestedState)
  if (confirmation.identityChanged) {
    postStatus(
      repository,
      confirmation.sha,
      "failure",
      "PR identity changed during lifecycle status publication",
    )
    return false
  }
  return true
}

async function commandVerify(args: string[], writeStatus: boolean): Promise<void> {
  const repository = option(args, "--repo")!
  const pr = integerOption(args, "--pr")
  const expected = {
    head: option(args, "--expected-head", false),
    baseRef: option(args, "--expected-base-ref", false),
    baseSha: option(args, "--expected-base-sha", false),
    workflowSha: option(args, "--trusted-workflow-sha", false),
  }
  try {
    const result = await verifyLive(repository, pr, expected, args.includes("--allow-draft"))
    if (writeStatus) {
      const published = publishGateStatus(
        repository,
        pr,
        result.snapshot,
        result.verification.ok ? "success" : "failure",
        result.verification.ok
          ? `Codex review receipt verified for ${result.snapshot.headSha.slice(0, 12)}`
          : result.verification.reasons[0] ?? "PR lifecycle verification failed",
      )
      if (!published) {
        result.verification.ok = false
        result.verification.reasons.push("PR identity changed during gate status publication")
      }
    }
    process.stdout.write(`${JSON.stringify(result.verification, null, 2)}\n`)
    if (!result.verification.ok) process.exitCode = 1
  } catch (error) {
    if (writeStatus) {
      const live = fetchBasicPullRequest(repository, pr)
      postStatus(repository, live.headSha, "failure", "PR lifecycle verification failed closed")
    }
    throw error
  }
}

async function commandDispatch(args: string[]): Promise<void> {
  const repository = option(args, "--repo")!
  const pr = integerOption(args, "--pr")
  const expectedClaim = option(args, "--claim")!
  const snapshot = fetchSnapshot(repository, pr)
  requireComplete(snapshot)
  const claim = loadClaim(repository, pr, expectedClaim)
  requireWriter(claim, args)
  requireClaimLineage(snapshot, claim)
  if (snapshot.baseRef !== "main") throw new Error("only the main base branch is supported")
  runGhText([
    "workflow", "run", "pr-lifecycle-gate.yml",
    "--repo", repository,
    "--ref", snapshot.baseRef,
    "-f", `pr_number=${pr}`,
    "-f", `expected_head_sha=${snapshot.headSha}`,
    "-f", `expected_base_ref=${snapshot.baseRef}`,
    "-f", `expected_base_sha=${snapshot.baseSha}`,
  ])
  process.stdout.write(`${JSON.stringify({
    dispatched: true,
    pr,
    head: snapshot.headSha,
    baseRef: snapshot.baseRef,
    baseSha: snapshot.baseSha,
  })}\n`)
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  if (command === "claim") return commandClaim(args)
  if (command === "review") return commandReview(args)
  if (command === "seal") return commandSeal(args)
  if (command === "address") return commandAddress(args)
  if (command === "verify") return commandVerify(args, false)
  if (command === "gate") return commandVerify(args, true)
  if (command === "dispatch") return commandDispatch(args)
  throw new Error("usage: pr-lifecycle.ts <claim|review|seal|address|verify|gate|dispatch> [options]")
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
