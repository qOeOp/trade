#!/usr/bin/env bun

import { spawnSync } from "node:child_process"

const REVIEW_MARKER = "pr-lifecycle-review:v3"
const CODEX_LOGINS = new Set([
  "chatgpt-codex-connector",
  "chatgpt-codex-connector[bot]",
])
const ELIGIBLE_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"])

type JsonObject = Record<string, unknown>

export interface Reaction {
  id: string
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
  includesCreatedEdit: boolean
  lastEditedAt: string | null
  minimized: boolean
  reactions: Reaction[]
}

export interface Review {
  id: number
  actor: string
  submittedAt: string
  commitSha: string
}

export interface ReviewComment {
  id: number
  nodeId: string
  actor: string
  association: string
  body: string
  createdAt: string
  includesCreatedEdit: boolean
  lastEditedAt: string | null
  reviewCommitSha: string
}

export interface ReviewThread {
  id: string
  resolved: boolean
  comments: ReviewComment[]
}

export interface PullRequestSnapshot {
  repository: string
  number: number
  body: string
  open: boolean
  merged: boolean
  draft: boolean
  headSha: string
  headObservations: string[]
  headRepository: string
  baseRef: string
  baseSha: string
  commits: string[]
  commitParents: Record<string, string[]>
  commitTimes: Record<string, string>
  comments: IssueComment[]
  reviews: Review[]
  threads: ReviewThread[]
  complete: boolean
}

export interface Verification {
  ok: boolean
  reasons: string[]
  receipt?: {
    repository: string
    pr: number
    triggerCommentId: number
    reviewer: string
    headSha: string
    baseRef: string
    baseSha: string
    cleanReactionAt: string
  }
}

interface ReviewMarker {
  head: string
  base_ref: string
  base_sha: string
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(value: JsonObject, field: string): string | null {
  return typeof value[field] === "string" ? value[field] as string : null
}

function numberField(value: JsonObject, field: string): number | null {
  return typeof value[field] === "number" ? value[field] as number : null
}

function nullableStringField(value: JsonObject, field: string, context: string): string | null {
  const result = value[field]
  if (result !== null && typeof result !== "string") throw new Error(`invalid ${context}`)
  return result as string | null
}

function validSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value)
}

function isCodex(actor: string): boolean {
  return CODEX_LOGINS.has(actor)
}

export function requireOutcome(body: string): string {
  if (body.includes("\0")) throw new Error("PR body contains an unsupported null byte")
  const lines = body.replace(/\r\n/g, "\n").split("\n")
  const first = lines.findIndex((line) => line.trim() !== "")
  if (first === -1 || lines[first] !== "## Outcome") {
    throw new Error("the first non-empty PR body line must be exactly: ## Outcome")
  }
  if (lines.filter((line) => line === "## Outcome").length !== 1) {
    throw new Error("PR body must contain exactly one column-0 ## Outcome heading")
  }
  let end = lines.length
  for (let index = first + 1; index < lines.length; index += 1) {
    if (/^##(?:[ \t]|$)/.test(lines[index]!)) {
      end = index
      break
    }
  }
  const outcome = lines.slice(first + 1, end).join("\n").trim()
  if (!outcome) throw new Error("PR body Outcome section is empty")
  return outcome
}

export function reviewTriggerBody(
  head: string,
  baseRef: string,
  baseSha: string,
): string {
  if (!validSha(head) || !validSha(baseSha) || !baseRef) {
    throw new Error("invalid review trigger identity")
  }
  const marker = JSON.stringify({ head, base_ref: baseRef, base_sha: baseSha })
  return [
    "@codex review",
    "",
    `Head: \`${head}\``,
    `Base: \`${baseRef}@${baseSha}\``,
    "",
    `<!-- ${REVIEW_MARKER} ${marker} -->`,
  ].join("\n")
}

function parseReviewMarker(body: string): ReviewMarker | null {
  const prefix = `<!-- ${REVIEW_MARKER} `
  const start = body.indexOf(prefix)
  if (start === -1 || body.indexOf(prefix, start + prefix.length) !== -1) return null
  const end = body.indexOf(" -->", start + prefix.length)
  if (end === -1) return null
  try {
    const value = JSON.parse(body.slice(start + prefix.length, end))
    if (!isObject(value)) return null
    const head = stringField(value, "head") ?? ""
    const baseRef = stringField(value, "base_ref") ?? ""
    const baseSha = stringField(value, "base_sha") ?? ""
    if (!validSha(head) || !baseRef || !validSha(baseSha)) return null
    return { head, base_ref: baseRef, base_sha: baseSha }
  } catch {
    return null
  }
}

function isStrictDescendant(
  snapshot: PullRequestSnapshot,
  descendant: string,
  ancestor: string,
): boolean {
  const retained = new Set(snapshot.commits)
  if (descendant === ancestor || !retained.has(descendant) || !retained.has(ancestor)) {
    return false
  }
  const pending = [...(snapshot.commitParents[descendant] ?? [])]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const candidate = pending.pop()!
    if (candidate === ancestor) return true
    if (visited.has(candidate) || !retained.has(candidate)) continue
    visited.add(candidate)
    pending.push(...(snapshot.commitParents[candidate] ?? []))
  }
  return false
}

export function verifySnapshot(
  snapshot: PullRequestSnapshot,
  expected: {
    head: string
    baseRef: string
    baseSha: string
    allowDraft?: boolean
  },
): Verification {
  const reasons: string[] = []
  if (!snapshot.complete) reasons.push("provider snapshot is incomplete")
  if (!snapshot.open || snapshot.merged) reasons.push("pull request is not open")
  if (snapshot.draft && !expected.allowDraft) reasons.push("pull request is still draft")
  if (snapshot.headRepository !== snapshot.repository) reasons.push("fork pull requests are blocked")
  if (snapshot.headSha !== expected.head) reasons.push("pull request head changed")
  if (snapshot.baseRef !== expected.baseRef) reasons.push("pull request base ref changed")
  if (snapshot.baseSha !== expected.baseSha) reasons.push("live base changed")
  try {
    requireOutcome(snapshot.body)
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error))
  }

  const observationTimes = snapshot.headObservations
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
  const headTime = observationTimes.length > 0 ? Math.max(...observationTimes) : Number.NaN
  if (!Number.isFinite(headTime)) {
    reasons.push("no pull_request workflow run proves when the head entered this PR")
  }
  const explicit = snapshot.comments.filter((comment) => /@codex\s+review\b/i.test(comment.body))
  const currentWindow = explicit.filter((comment) => Date.parse(comment.createdAt) > headTime)
  const exact = explicit.filter((comment) => {
    const marker = parseReviewMarker(comment.body)
    return marker?.head === snapshot.headSha
      && marker.base_ref === snapshot.baseRef
      && marker.base_sha === snapshot.baseSha
  })

  if (currentWindow.length !== 1) {
    reasons.push(`expected one current-head explicit Codex trigger, found ${currentWindow.length}`)
  }
  if (exact.length !== 1) {
    reasons.push(`expected one exact-identity Codex trigger, found ${exact.length}`)
  }
  const trigger = currentWindow.length === 1 && exact.length === 1 && currentWindow[0] === exact[0]
    ? exact[0]!
    : null
  if (trigger) {
    if (
      trigger.minimized
      || trigger.includesCreatedEdit
      || trigger.lastEditedAt !== null
      || !ELIGIBLE_ASSOCIATIONS.has(trigger.association)
      || isCodex(trigger.actor)
      || trigger.body !== reviewTriggerBody(snapshot.headSha, snapshot.baseRef, snapshot.baseSha)
    ) reasons.push("current Codex trigger is not the exact visible writer trigger")
  }

  const currentReviews = snapshot.reviews.filter((review) =>
    isCodex(review.actor) && review.commitSha === snapshot.headSha
  )
  const codexRoots = snapshot.threads.flatMap((thread) => {
    const root = thread.comments[0]
    return root && isCodex(root.actor) ? [{ thread, root }] : []
  })
  const currentRoots = codexRoots.filter(({ root }) => root.reviewCommitSha === snapshot.headSha)
  if (currentReviews.length > 0 || currentRoots.length > 0) {
    reasons.push("current head has a Codex finding review instead of a clean result")
  }

  let clean: Reaction | null = null
  if (trigger) {
    const triggerTime = Date.parse(trigger.createdAt)
    const reactions = trigger.reactions.filter((reaction) =>
      isCodex(reaction.actor) && Date.parse(reaction.createdAt) >= triggerTime
    )
    const thumbs = reactions.filter((reaction) => reaction.content === "THUMBS_UP")
    if (thumbs.length !== 1) {
      reasons.push(`expected one Codex +1 on the exact trigger, found ${thumbs.length}`)
    } else {
      clean = thumbs[0]!
    }
    if (reactions.some((reaction) =>
      reaction.content !== "EYES" && reaction.content !== "THUMBS_UP"
    )) reasons.push("unexpected Codex reaction exists on the exact trigger")
  }

  for (const { thread, root } of codexRoots) {
    if (root.reviewCommitSha === snapshot.headSha) continue
    if (!thread.resolved) {
      reasons.push(`Codex finding ${root.id} is unresolved`)
    }
    const fixedReplies = thread.comments.slice(1).flatMap((comment) => {
      const match = comment.body.match(/^Fixed in ([0-9a-f]{40}): (\S[\s\S]*)$/)
      return match ? [{ comment, sha: match[1]! }] : []
    })
    if (fixedReplies.length !== 1) {
      reasons.push(`Codex finding ${root.id} needs exactly one native Fixed in reply`)
      continue
    }
    const { comment, sha } = fixedReplies[0]!
    if (
      isCodex(comment.actor)
      || !ELIGIBLE_ASSOCIATIONS.has(comment.association)
      || comment.includesCreatedEdit
      || comment.lastEditedAt !== null
      || Date.parse(comment.createdAt) <= Date.parse(root.createdAt)
    ) reasons.push(`Codex finding ${root.id} has an invalid disposition reply`)
    if (root.includesCreatedEdit || root.lastEditedAt !== null) {
      reasons.push(`Codex finding ${root.id} was edited`)
    }
    if (!isStrictDescendant(snapshot, sha, root.reviewCommitSha)) {
      reasons.push(`Codex finding ${root.id} fix is not a strict descendant`)
    }
    if (Date.parse(snapshot.commitTimes[sha] ?? "") > Date.parse(comment.createdAt)) {
      reasons.push(`Codex finding ${root.id} reply predates its fix commit`)
    }
  }

  if (reasons.length > 0 || !trigger || !clean) return { ok: false, reasons }
  return {
    ok: true,
    reasons: [],
    receipt: {
      repository: snapshot.repository,
      pr: snapshot.number,
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
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error("GitHub returned malformed JSON")
  }
}

function requiredString(value: JsonObject, field: string, context: string): string {
  const result = stringField(value, field)
  if (result === null) throw new Error(`invalid ${context}`)
  return result
}

function requiredNonemptyString(value: JsonObject, field: string, context: string): string {
  const result = requiredString(value, field, context)
  if (!result) throw new Error(`invalid ${context}`)
  return result
}

function requiredBoolean(value: JsonObject, field: string, context: string): boolean {
  if (typeof value[field] !== "boolean") throw new Error(`invalid ${context}`)
  return value[field] as boolean
}

function requiredInteger(value: JsonObject, field: string, context: string): number {
  const result = numberField(value, field)
  if (result === null || !Number.isInteger(result) || result <= 0) {
    throw new Error(`invalid ${context}`)
  }
  return result
}

function requiredDate(value: string, context: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`invalid ${context}`)
  return value
}

function requiredSha(value: string, context: string): string {
  if (!validSha(value)) throw new Error(`invalid ${context}`)
  return value
}

function completeConnection(value: unknown, context: string): JsonObject[] {
  if (
    !isObject(value)
    || !isObject(value.pageInfo)
    || value.pageInfo.hasNextPage !== false
    || !Array.isArray(value.nodes)
    || !value.nodes.every(isObject)
  ) throw new Error(`incomplete or malformed ${context}`)
  return value.nodes
}

function unique(values: Array<string | number>, context: string): void {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${context}`)
}

const SNAPSHOT_QUERY = `
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    nameWithOwner
    pullRequest(number:$number){
      number body state merged isDraft
      headRepository{nameWithOwner} headRefOid baseRefName
      commits(first:100){
        pageInfo{hasNextPage}
        nodes{commit{oid committedDate parents(first:100){pageInfo{hasNextPage} nodes{oid}}}}
      }
      reviews(first:100){
        pageInfo{hasNextPage}
        nodes{databaseId submittedAt author{login} commit{oid}}
      }
      comments(first:100){
        pageInfo{hasNextPage}
        nodes{
          databaseId id body createdAt includesCreatedEdit lastEditedAt
          isMinimized authorAssociation author{login}
          reactions(first:100){pageInfo{hasNextPage} nodes{id content createdAt user{login}}}
        }
      }
      reviewThreads(first:100){
        pageInfo{hasNextPage}
        nodes{
          id isResolved
          comments(first:100){
            pageInfo{hasNextPage}
            nodes{
              databaseId id body createdAt includesCreatedEdit lastEditedAt
              authorAssociation author{login}
              pullRequestReview{commit{oid}}
            }
          }
        }
      }
    }
  }
}`

function liveBaseSha(repository: string, baseRef: string): string {
  const value = runGh(["api", `repos/${repository}/branches/${encodeURIComponent(baseRef)}`])
  if (!isObject(value) || !isObject(value.commit)) throw new Error("invalid live base response")
  return requiredSha(requiredString(value.commit, "sha", "live base SHA"), "live base SHA")
}

function headObservations(repository: string, pr: number, headSha: string): string[] {
  const value = runGh([
    "api",
    `repos/${repository}/actions/runs?event=pull_request&head_sha=${headSha}&per_page=100`,
  ])
  if (
    !isObject(value)
    || !Array.isArray(value.workflow_runs)
    || !value.workflow_runs.every(isObject)
    || numberField(value, "total_count") !== value.workflow_runs.length
  ) throw new Error("incomplete or malformed pull_request workflow runs")
  return value.workflow_runs.flatMap((run) => {
    const pulls = run.pull_requests
    if (!Array.isArray(pulls) || !pulls.every(isObject)) {
      throw new Error("invalid pull_request workflow association")
    }
    const belongs = pulls.some((pull) => numberField(pull, "number") === pr)
    if (
      !belongs
      || stringField(run, "event") !== "pull_request"
      || stringField(run, "head_sha") !== headSha
    ) return []
    return [requiredDate(
      requiredString(run, "created_at", "pull_request workflow creation time"),
      "pull_request workflow creation time",
    )]
  })
}

function providerSnapshot(repository: string, pr: number): PullRequestSnapshot {
  const [owner, name] = repository.split("/")
  if (!owner || !name || repository !== `${owner}/${name}`) {
    throw new Error(`invalid repository: ${repository}`)
  }
  const raw = runGh([
    "api", "graphql",
    "-F", `owner=${owner}`,
    "-F", `name=${name}`,
    "-F", `number=${pr}`,
    "-f", `query=${SNAPSHOT_QUERY}`,
  ])
  if (!isObject(raw) || Object.hasOwn(raw, "errors") || !isObject(raw.data)) {
    throw new Error("GraphQL evidence response contains errors or missing data")
  }
  const repositoryNode = raw.data.repository
  if (!isObject(repositoryNode) || !isObject(repositoryNode.pullRequest)) {
    throw new Error("pull request not found")
  }
  if (requiredNonemptyString(repositoryNode, "nameWithOwner", "repository") !== repository) {
    throw new Error("repository identity changed")
  }
  const pull = repositoryNode.pullRequest
  if (requiredInteger(pull, "number", "pull request number") !== pr) {
    throw new Error("pull request identity changed")
  }
  const state = requiredString(pull, "state", "pull request state")
  if (state !== "OPEN" && state !== "CLOSED") throw new Error("invalid pull request state")
  if (!isObject(pull.headRepository)) throw new Error("invalid head repository")
  const headSha = requiredSha(
    requiredString(pull, "headRefOid", "head SHA"),
    "head SHA",
  )

  const commits: string[] = []
  const commitParents: Record<string, string[]> = {}
  const commitTimes: Record<string, string> = {}
  for (const node of completeConnection(pull.commits, "commits")) {
    if (!isObject(node.commit)) throw new Error("invalid commit")
    const sha = requiredSha(requiredString(node.commit, "oid", "commit SHA"), "commit SHA")
    const parents = completeConnection(node.commit.parents, `parents for ${sha}`)
      .map((parent) => requiredSha(requiredString(parent, "oid", "parent SHA"), "parent SHA"))
    unique(parents, `parents for ${sha}`)
    commits.push(sha)
    commitParents[sha] = parents
    commitTimes[sha] = requiredDate(
      requiredString(node.commit, "committedDate", "commit timestamp"),
      "commit timestamp",
    )
  }
  unique(commits, "commit SHA")
  if (!commits.includes(headSha)) throw new Error("head is absent from commit history")

  const reviews = completeConnection(pull.reviews, "reviews").map((node): Review => {
    if (!isObject(node.author) || !isObject(node.commit)) throw new Error("invalid review")
    return {
      id: requiredInteger(node, "databaseId", "review ID"),
      actor: requiredNonemptyString(node.author, "login", "review actor"),
      submittedAt: requiredDate(requiredString(node, "submittedAt", "review time"), "review time"),
      commitSha: requiredSha(requiredString(node.commit, "oid", "review commit"), "review commit"),
    }
  })
  unique(reviews.map((review) => review.id), "review ID")

  const reactionIds: string[] = []
  const comments = completeConnection(pull.comments, "comments").map((node): IssueComment => {
    if (!isObject(node.author)) throw new Error("invalid comment")
    const reactions = completeConnection(node.reactions, "comment reactions")
      .map((reaction): Reaction => {
        if (!isObject(reaction.user)) throw new Error("invalid reaction")
        const id = requiredNonemptyString(reaction, "id", "reaction ID")
        reactionIds.push(id)
        return {
          id,
          content: requiredNonemptyString(reaction, "content", "reaction content"),
          createdAt: requiredDate(
            requiredString(reaction, "createdAt", "reaction time"),
            "reaction time",
          ),
          actor: requiredNonemptyString(reaction.user, "login", "reaction actor"),
        }
      })
    return {
      id: requiredInteger(node, "databaseId", "comment ID"),
      nodeId: requiredNonemptyString(node, "id", "comment node ID"),
      actor: requiredNonemptyString(node.author, "login", "comment actor"),
      association: requiredNonemptyString(node, "authorAssociation", "comment association"),
      body: requiredString(node, "body", "comment body"),
      createdAt: requiredDate(requiredString(node, "createdAt", "comment time"), "comment time"),
      includesCreatedEdit: requiredBoolean(
        node,
        "includesCreatedEdit",
        "comment edit history",
      ),
      lastEditedAt: nullableStringField(node, "lastEditedAt", "comment edit timestamp"),
      minimized: requiredBoolean(node, "isMinimized", "comment minimized"),
      reactions,
    }
  })
  unique(comments.map((comment) => comment.id), "comment ID")
  unique(comments.map((comment) => comment.nodeId), "comment node ID")
  unique(reactionIds, "reaction ID")

  const threads = completeConnection(pull.reviewThreads, "review threads")
    .map((thread): ReviewThread => {
      const id = requiredNonemptyString(thread, "id", "thread ID")
      const comments = completeConnection(thread.comments, `comments for ${id}`)
        .map((node): ReviewComment => {
          if (!isObject(node.author) || !isObject(node.pullRequestReview)
            || !isObject(node.pullRequestReview.commit)) {
            throw new Error("invalid review comment")
          }
          return {
            id: requiredInteger(node, "databaseId", "review comment ID"),
            nodeId: requiredNonemptyString(node, "id", "review comment node ID"),
            actor: requiredNonemptyString(node.author, "login", "review comment actor"),
            association: requiredNonemptyString(
              node,
              "authorAssociation",
              "review comment association",
            ),
            body: requiredString(node, "body", "review comment body"),
            createdAt: requiredDate(
              requiredString(node, "createdAt", "review comment time"),
              "review comment time",
            ),
            includesCreatedEdit: requiredBoolean(
              node,
              "includesCreatedEdit",
              "review comment edit history",
            ),
            lastEditedAt: nullableStringField(
              node,
              "lastEditedAt",
              "review comment edit timestamp",
            ),
            reviewCommitSha: requiredSha(
              requiredString(node.pullRequestReview.commit, "oid", "review comment commit"),
              "review comment commit",
            ),
          }
        })
      unique(comments.map((comment) => comment.id), `review comment ID for ${id}`)
      return { id, resolved: requiredBoolean(thread, "isResolved", "thread resolved"), comments }
    })
  unique(threads.map((thread) => thread.id), "thread ID")

  const baseRef = requiredNonemptyString(pull, "baseRefName", "base ref")
  return {
    repository,
    number: pr,
    body: requiredString(pull, "body", "pull request body"),
    open: state === "OPEN",
    merged: requiredBoolean(pull, "merged", "merged state"),
    draft: requiredBoolean(pull, "isDraft", "draft state"),
    headSha,
    headObservations: headObservations(repository, pr, headSha),
    headRepository: requiredNonemptyString(
      pull.headRepository,
      "nameWithOwner",
      "head repository",
    ),
    baseRef,
    baseSha: liveBaseSha(repository, baseRef),
    commits,
    commitParents,
    commitTimes,
    comments,
    reviews,
    threads,
    complete: true,
  }
}

interface Identity {
  open: boolean
  merged: boolean
  draft: boolean
  headSha: string
  headRepository: string
  baseRef: string
  baseSha: string
}

function basicIdentity(repository: string, pr: number): Identity {
  const pull = runGh(["api", `repos/${repository}/pulls/${pr}`])
  if (!isObject(pull) || !isObject(pull.head) || !isObject(pull.base)) {
    throw new Error("invalid pull request response")
  }
  const headRepo = isObject(pull.head.repo) ? pull.head.repo : null
  const baseRef = stringField(pull.base, "ref") ?? ""
  return {
    open: pull.state === "open",
    merged: pull.merged === true,
    draft: pull.draft === true,
    headSha: stringField(pull.head, "sha") ?? "",
    headRepository: headRepo ? stringField(headRepo, "full_name") ?? "" : "",
    baseRef,
    baseSha: liveBaseSha(repository, baseRef),
  }
}

function sameIdentity(left: Identity, right: Identity): boolean {
  return left.open === right.open
    && left.merged === right.merged
    && left.draft === right.draft
    && left.headSha === right.headSha
    && left.headRepository === right.headRepository
    && left.baseRef === right.baseRef
    && left.baseSha === right.baseSha
}

function snapshot(repository: string, pr: number): PullRequestSnapshot {
  const before = basicIdentity(repository, pr)
  const evidence = providerSnapshot(repository, pr)
  const after = basicIdentity(repository, pr)
  if (!sameIdentity(before, evidence) || !sameIdentity(evidence, after)) {
    throw new Error("PR identity changed while evidence was read")
  }
  return evidence
}

function option(args: string[], name: string, required = true): string | null {
  const index = args.indexOf(name)
  const value = index === -1 ? null : args[index + 1] ?? null
  if (required && !value) throw new Error(`missing ${name}`)
  return value
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const repository = option(args, "--repo")!
  const prRaw = option(args, "--pr")!
  const pr = Number(prRaw)
  if (!Number.isInteger(pr) || pr <= 0) throw new Error("invalid --pr")
  const expected = {
    head: option(args, "--expected-head")!,
    baseRef: option(args, "--expected-base-ref")!,
    baseSha: option(args, "--expected-base-sha")!,
    allowDraft: args.includes("--allow-draft"),
  }
  if (!validSha(expected.head) || !validSha(expected.baseSha)) {
    throw new Error("invalid expected commit")
  }

  const first = snapshot(repository, pr)
  const firstResult = verifySnapshot(first, expected)
  if (!firstResult.ok) throw new Error(firstResult.reasons.join("; "))
  const final = snapshot(repository, pr)
  const finalResult = verifySnapshot(final, expected)
  if (!finalResult.ok) throw new Error(finalResult.reasons.join("; "))
  process.stdout.write(`${JSON.stringify(finalResult.receipt)}\n`)
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
