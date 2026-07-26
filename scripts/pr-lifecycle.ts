#!/usr/bin/env bun

import { spawnSync } from "node:child_process"

const CLAIM_MARKER = "pr-lifecycle-claim:v1"
const TAKEOVER_MARKER = "pr-lifecycle-takeover:v1"
const REVIEW_MARKER = "pr-lifecycle-review:v1"
const FINDING_MARKER = "pr-lifecycle-finding:v1"
const LOSS_MARKER = "pr-lifecycle-loss:v1"
const GATE_CONTEXT = "pr-lifecycle-gate"
const CLAIM_WINDOW_MS = 30_000
const STABILITY_DELAY_MS = 5_000
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
  defaultBranch: string
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

interface ClaimPayload {
  mission: string
  actor: string
}

interface TakeoverPayload {
  claim_id: number
  authority: string
  actor: string
}

interface ReviewPayload {
  claim_id: number
  mission: string
  head: string
  base_ref: string
  base_sha: string
}

interface FindingPayload {
  thread_id: string
  finding_comment_id: number
  disposition: "fixed" | "deferred" | "rejected"
  fix_sha: string
  reason: string
}

export interface Claim {
  id: number
  actor: string
  mission: string
  createdAt: string
}

export interface Verification {
  ok: boolean
  reasons: string[]
  receipt?: {
    repository: string
    pr: number
    claimId: number
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
  const end = body.indexOf(" -->", start + prefix.length)
  if (end === -1) return null
  try {
    const value = JSON.parse(body.slice(start + prefix.length, end))
    return isObject(value) ? value as T : null
  } catch {
    return null
  }
}

function eligibleComment(comment: IssueComment): boolean {
  return !comment.minimized && ELIGIBLE_ASSOCIATIONS.has(comment.association)
}

function claimsAndTakeovers(snapshot: PullRequestSnapshot): {
  claims: Claim[]
  takeovers: Array<TakeoverPayload & { createdAt: string }>
} {
  const claims: Claim[] = []
  const takeovers: Array<TakeoverPayload & { createdAt: string }> = []

  for (const comment of snapshot.comments) {
    if (!eligibleComment(comment)) continue
    const claim = parseMarker<ClaimPayload>(comment.body, CLAIM_MARKER)
    if (
      claim
      && claim.actor === comment.actor
      && /^[A-Za-z0-9._:-]{1,128}$/.test(claim.mission)
    ) {
      claims.push({
        id: comment.id,
        actor: comment.actor,
        mission: claim.mission,
        createdAt: comment.createdAt,
      })
    }

    const takeover = parseMarker<TakeoverPayload>(comment.body, TAKEOVER_MARKER)
    if (
      takeover
      && takeover.actor === comment.actor
      && Number.isInteger(takeover.claim_id)
      && takeover.claim_id > 0
      && takeover.authority.trim().length > 0
    ) {
      takeovers.push({ ...takeover, createdAt: comment.createdAt })
    }
  }

  claims.sort((left, right) =>
    Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id - right.id
  )
  takeovers.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
  return { claims, takeovers }
}

export function activeClaimEpoch(snapshot: PullRequestSnapshot): Claim[] {
  const { claims, takeovers } = claimsAndTakeovers(snapshot)
  let epochClaims = claims

  while (epochClaims.length > 0) {
    const winner = epochClaims[0]!
    const takeover = takeovers.find((candidate) =>
      candidate.claim_id === winner.id
      && Date.parse(candidate.createdAt) > Date.parse(winner.createdAt)
    )
    if (!takeover) return epochClaims
    epochClaims = claims.filter((claim) =>
      Date.parse(claim.createdAt) > Date.parse(takeover.createdAt)
    )
  }

  return []
}

export function stableClaim(
  first: PullRequestSnapshot,
  second: PullRequestSnapshot,
  nowMs = Date.now(),
): Claim | null {
  if (
    first.repository !== second.repository
    || first.number !== second.number
    || first.headSha !== second.headSha
    || first.baseRef !== second.baseRef
    || first.baseSha !== second.baseSha
  ) return null

  const firstClaims = activeClaimEpoch(first)
  const secondClaims = activeClaimEpoch(second)
  if (firstClaims.length === 0 || secondClaims.length === 0) return null
  if (
    firstClaims.map((claim) => `${claim.createdAt}:${claim.id}`).join(",")
    !== secondClaims.map((claim) => `${claim.createdAt}:${claim.id}`).join(",")
  ) return null

  const winner = firstClaims[0]!
  if (nowMs < Date.parse(winner.createdAt) + CLAIM_WINDOW_MS) return null
  return winner
}

function currentReviewTriggers(snapshot: PullRequestSnapshot, claim: Claim): Array<{
  comment: IssueComment
  payload: ReviewPayload
}> {
  const triggers: Array<{ comment: IssueComment; payload: ReviewPayload }> = []
  for (const comment of snapshot.comments) {
    if (!eligibleComment(comment) || comment.actor !== claim.actor) continue
    const payload = parseMarker<ReviewPayload>(comment.body, REVIEW_MARKER)
    if (
      payload
      && comment.body.includes("@codex review")
      && payload.claim_id === claim.id
      && payload.mission === claim.mission
      && payload.head === snapshot.headSha
      && payload.base_ref === snapshot.baseRef
      && payload.base_sha === snapshot.baseSha
    ) {
      triggers.push({ comment, payload })
    }
  }
  return triggers
}

function isCodex(actor: string): boolean {
  return CODEX_LOGINS.has(actor)
}

function findingDisposition(
  thread: ReviewThread,
  claim: Claim,
  commitSet: Set<string>,
): FindingPayload | null {
  for (const comment of thread.comments.slice(1)) {
    if (comment.actor !== claim.actor) continue
    const payload = parseMarker<FindingPayload>(comment.body, FINDING_MARKER)
    if (
      payload
      && payload.thread_id === thread.id
      && payload.finding_comment_id === thread.comments[0]?.id
      && ["fixed", "deferred", "rejected"].includes(payload.disposition)
      && /^[0-9a-f]{40}$/.test(payload.fix_sha)
      && payload.reason.trim().length > 0
      && commitSet.has(payload.fix_sha)
    ) return payload
  }
  return null
}

export function verifyReceipt(
  snapshot: PullRequestSnapshot,
  claim: Claim,
  options: { allowDraft?: boolean } = {},
): Verification {
  const reasons: string[] = []
  if (!snapshot.complete) reasons.push("provider snapshot is incomplete")
  if (!snapshot.open || snapshot.merged) reasons.push("pull request is not open")
  if (snapshot.headRepository !== snapshot.repository) reasons.push("fork pull requests are blocked")
  if (snapshot.draft && !options.allowDraft) reasons.push("pull request is still draft")

  const triggers = currentReviewTriggers(snapshot, claim)
  if (triggers.length !== 1) {
    reasons.push(`expected one exact-head review trigger, found ${triggers.length}`)
    return { ok: false, reasons }
  }
  const trigger = triggers[0]!.comment
  const triggerAt = Date.parse(trigger.createdAt)
  const codexReactions = trigger.reactions.filter((reaction) =>
    isCodex(reaction.actor) && Date.parse(reaction.createdAt) >= triggerAt
  )
  const cleanReactions = codexReactions.filter((reaction) => reaction.content === "+1")
  const ambiguousRootReactions = snapshot.rootReactions.filter((reaction) =>
    isCodex(reaction.actor) && Date.parse(reaction.createdAt) >= triggerAt
  )
  const currentReviews = snapshot.reviews.filter((review) =>
    isCodex(review.actor)
    && review.commitSha === snapshot.headSha
    && Date.parse(review.submittedAt) >= triggerAt
  )
  const currentFindingThreads = snapshot.threads.filter((thread) => {
    const root = thread.comments[0]
    return root
      && isCodex(root.actor)
      && root.reviewCommitSha === snapshot.headSha
      && Date.parse(root.createdAt) >= triggerAt
  })

  if (cleanReactions.length !== 1) {
    reasons.push(`expected one Codex +1 on the exact trigger, found ${cleanReactions.length}`)
  }
  if (ambiguousRootReactions.length > 0) {
    reasons.push("uncorrelated Codex root reaction exists after the trigger")
  }
  if (currentReviews.length > 0 || currentFindingThreads.length > 0) {
    reasons.push("Codex submitted a finding review for the current head")
  }
  if (codexReactions.some((reaction) => reaction.content !== "EYES" && reaction.content !== "+1")) {
    reasons.push("unexpected Codex reaction exists on the trigger")
  }

  const commitSet = new Set(snapshot.commits)
  for (const thread of snapshot.threads) {
    const root = thread.comments[0]
    if (!root || !isCodex(root.actor)) continue
    if (!thread.resolved) reasons.push(`review thread ${thread.id} is unresolved`)
    if (!findingDisposition(thread, claim, commitSet)) {
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
      claimId: claim.id,
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
      reactions(first:100){
        pageInfo{hasNextPage}
        nodes{content createdAt user{login}}
      }
      comments(first:100){
        pageInfo{hasNextPage}
        nodes{
          databaseId
          id
          body
          createdAt
          isMinimized
          authorAssociation
          author{login}
          reactions(first:100){
            pageInfo{hasNextPage}
            nodes{content createdAt user{login}}
          }
        }
      }
      reviewThreads(first:100){
        pageInfo{hasNextPage}
        nodes{
          id
          isResolved
          isOutdated
          comments(first:100){
            pageInfo{hasNextPage}
            nodes{
              databaseId
              body
              createdAt
              outdated
              author{login}
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
    "api",
    "graphql",
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
  const connection = pullRequest.reviewThreads
  if (!isObject(connection) || !Array.isArray(connection.nodes) || !isObject(connection.pageInfo)) {
    throw new Error("missing review thread connection")
  }
  const commentsConnection = pullRequest.comments
  const reactionsConnection = pullRequest.reactions
  if (
    !isObject(commentsConnection)
    || !Array.isArray(commentsConnection.nodes)
    || !isObject(commentsConnection.pageInfo)
    || !isObject(reactionsConnection)
    || !Array.isArray(reactionsConnection.nodes)
    || !isObject(reactionsConnection.pageInfo)
  ) throw new Error("missing pull request conversation")

  let complete = connection.pageInfo.hasNextPage === false
    && commentsConnection.pageInfo.hasNextPage === false
    && reactionsConnection.pageInfo.hasNextPage === false
  const comments = commentsConnection.nodes.map((node): IssueComment => {
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
  const rootReactions = reactionsConnection.nodes.map((reaction): Reaction => {
    if (!isObject(reaction)) throw new Error("invalid pull request reaction")
    return {
      content: stringField(reaction, "content") ?? "",
      createdAt: stringField(reaction, "createdAt") ?? "",
      actor: actorLogin(reaction.user),
    }
  })
  const threads = connection.nodes.map((value): ReviewThread => {
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

export function fetchSnapshot(repository: string, pr: number): PullRequestSnapshot {
  const pull = runGh(["api", `repos/${repository}/pulls/${pr}`])
  if (!isObject(pull) || !isObject(pull.head) || !isObject(pull.base)) {
    throw new Error("invalid pull request response")
  }
  const headRepo = isObject(pull.head.repo) ? pull.head.repo : null
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
  return {
    repository,
    defaultBranch: "",
    number: pr,
    open: pull.state === "open",
    draft: pull.draft === true,
    merged: pull.merged === true,
    headSha: stringField(pull.head, "sha") ?? "",
    headRepository: headRepo ? stringField(headRepo, "full_name") ?? "" : "",
    baseRef: stringField(pull.base, "ref") ?? "",
    baseSha: stringField(pull.base, "sha") ?? "",
    commits,
    comments: conversation.comments,
    rootReactions: conversation.rootReactions,
    reviews,
    threads: conversation.threads,
    complete: conversation.complete,
  }
}

function sleep(milliseconds: number): void {
  if (milliseconds <= 0) return
  Bun.sleepSync(milliseconds)
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

async function verifiedClaim(repository: string, pr: number): Promise<{
  claim: Claim
  snapshot: PullRequestSnapshot
}> {
  const first = fetchSnapshot(repository, pr)
  sleep(STABILITY_DELAY_MS)
  const second = fetchSnapshot(repository, pr)
  const claim = stableClaim(first, second)
  if (!claim) throw new Error("claim epoch is not stable or has no winner")
  return { claim, snapshot: second }
}

async function commandClaim(args: string[]): Promise<void> {
  const repository = option(args, "--repo")!
  const pr = integerOption(args, "--pr")
  const mission = option(args, "--mission")!
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(mission)) throw new Error("invalid mission id")
  const actor = currentActor()
  const takeoverId = option(args, "--takeover", false)
  if (takeoverId) {
    const authority = option(args, "--authority")!
    addComment(repository, pr, markerBody(TAKEOVER_MARKER, {
      claim_id: Number(takeoverId),
      authority,
      actor,
    }))
  }
  const created = addComment(repository, pr, markerBody(CLAIM_MARKER, { mission, actor }))
  const waitUntil = Date.parse(created.createdAt) + CLAIM_WINDOW_MS
  sleep(waitUntil - Date.now())
  const { claim } = await verifiedClaim(repository, pr)
  if (claim.id !== created.id) {
    addComment(repository, pr, markerBody(LOSS_MARKER, {
      claim_id: created.id,
      winner_claim_id: claim.id,
      actor,
    }))
    throw new Error(`claim lost to ${claim.id}`)
  }
  process.stdout.write(`${JSON.stringify(claim)}\n`)
}

async function commandReview(args: string[]): Promise<void> {
  const repository = option(args, "--repo")!
  const pr = integerOption(args, "--pr")
  const { claim, snapshot } = await verifiedClaim(repository, pr)
  if (claim.actor !== currentActor()) throw new Error(`claim ${claim.id} belongs to ${claim.actor}`)
  if (!snapshot.draft) throw new Error("review trigger requires a draft pull request")
  if (currentReviewTriggers(snapshot, claim).length > 0) {
    throw new Error("an exact-head review trigger already exists")
  }
  const body = [
    "@codex review",
    "",
    markerBody(REVIEW_MARKER, {
      claim_id: claim.id,
      mission: claim.mission,
      head: snapshot.headSha,
      base_ref: snapshot.baseRef,
      base_sha: snapshot.baseSha,
    }),
  ].join("\n")
  const created = addComment(repository, pr, body)
  process.stdout.write(`${JSON.stringify({ triggerCommentId: created.id, head: snapshot.headSha })}\n`)
}

async function commandAddress(args: string[]): Promise<void> {
  const repository = option(args, "--repo")!
  const pr = integerOption(args, "--pr")
  const threadId = option(args, "--thread-id")!
  const findingCommentId = integerOption(args, "--finding-comment-id")
  const disposition = option(args, "--disposition")!
  const fixSha = option(args, "--fix-sha")!
  const reason = option(args, "--reason")!
  if (!["fixed", "deferred", "rejected"].includes(disposition)) {
    throw new Error("disposition must be fixed, deferred, or rejected")
  }
  if (!/^[0-9a-f]{40}$/.test(fixSha)) throw new Error("fix SHA must be a full commit SHA")

  const { claim, snapshot } = await verifiedClaim(repository, pr)
  if (claim.actor !== currentActor()) throw new Error(`claim ${claim.id} belongs to ${claim.actor}`)
  if (!snapshot.commits.includes(fixSha)) throw new Error("fix SHA is not in the current PR lineage")
  const thread = snapshot.threads.find((candidate) => candidate.id === threadId)
  if (!thread || thread.comments[0]?.id !== findingCommentId) {
    throw new Error("finding does not match the live review thread")
  }
  if (!findingDisposition(thread, claim, new Set(snapshot.commits))) {
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
  const { claim, snapshot } = await verifiedClaim(repository, pr)
  const verification = verifyReceipt(snapshot, claim, { allowDraft })
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

async function commandVerify(args: string[], writeStatus: boolean): Promise<void> {
  const repository = option(args, "--repo")!
  const pr = integerOption(args, "--pr")
  const expected = {
    head: option(args, "--expected-head", false),
    baseRef: option(args, "--expected-base-ref", false),
    baseSha: option(args, "--expected-base-sha", false),
    workflowSha: option(args, "--trusted-workflow-sha", false),
  }
  let snapshot: PullRequestSnapshot | null = null
  try {
    const result = await verifyLive(repository, pr, expected, args.includes("--allow-draft"))
    snapshot = result.snapshot
    if (writeStatus) {
      postStatus(
        repository,
        snapshot.headSha,
        result.verification.ok ? "success" : "failure",
        result.verification.ok
          ? `Codex review receipt verified for ${snapshot.headSha.slice(0, 12)}`
          : result.verification.reasons[0] ?? "PR lifecycle verification failed",
      )
    }
    process.stdout.write(`${JSON.stringify(result.verification, null, 2)}\n`)
    if (!result.verification.ok) process.exitCode = 1
  } catch (error) {
    if (writeStatus && snapshot) {
      postStatus(repository, snapshot.headSha, "failure", "PR lifecycle verification failed closed")
    }
    throw error
  }
}

async function commandDispatch(args: string[]): Promise<void> {
  const repository = option(args, "--repo")!
  const pr = integerOption(args, "--pr")
  const snapshot = fetchSnapshot(repository, pr)
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
  if (command === "address") return commandAddress(args)
  if (command === "verify") return commandVerify(args, false)
  if (command === "gate") return commandVerify(args, true)
  if (command === "dispatch") return commandDispatch(args)
  throw new Error("usage: pr-lifecycle.ts <claim|review|address|verify|gate|dispatch> [options]")
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
