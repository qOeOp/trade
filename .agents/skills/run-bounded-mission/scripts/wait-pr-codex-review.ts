#!/usr/bin/env bun

const PROVIDER_LOGIN = "chatgpt-codex-connector"
const CLEAN_REVIEW = /^(?:codex review:?\s*)?didn['’]t find any major issues[.!]?$/i
const CLEAN_COMMENT_HEADINGS = new Set([
  "Codex Review: Didn't find any major issues. You're on a roll.",
  "Codex Review: Didn't find any major issues. Bravo.",
  "Codex Review: Didn't find any major issues. :rocket:",
])
const REVIEWED_COMMIT = /^\*\*Reviewed commit:\*\* `([0-9a-f]{10,64})`$/
const CLEAN_COMMENT_SUFFIX = [
  "",
  "<details> <summary>ℹ️ About Codex in GitHub</summary>",
  "<br/>",
  "",
  "[Your team has set up Codex to review pull requests in this repo](https://chatgpt.com/codex/cloud/settings/general). Reviews are triggered when you",
  "- Open a pull request for review",
  "- Mark a draft as ready",
  "- Comment \"@codex review\".",
  "",
  "If Codex has suggestions, it will comment; otherwise it will react with 👍.",
  "",
  "Codex can also answer questions or update the PR. Try commenting \"@codex address that feedback\".",
  "",
  "</details>",
]
const USAGE_FAILURE = /(usage limit|rate limit|quota exceeded|try again later)/i
const REVIEW_REQUEST = /@codex\s+review\b/i
const EXACT_HEAD_REVIEW_REQUEST = /^@codex review\n\nExact head: `([0-9a-f]{40})`$/

export interface ReviewSignal {
  author: string
  at: string
  kind: "comment" | "reaction" | "review"
  target: string
  body?: string
  reaction?: string
  reviewState?: string
  reviewId?: string
  commitOid?: string
  includesCreatedEdit?: boolean
  lastEditedAt?: string
  updatedAt?: string
}

export interface ReviewThread {
  resolved: boolean
  resolvedBy?: string
  comments: Array<{ author: string; at: string; body: string; reviewId?: string }>
}

export interface CodexReviewSnapshot {
  state: string
  headRefOid: string
  createdAt: string
  complete: boolean
  signals: ReviewSignal[]
  threads: ReviewThread[]
}

export interface CodexReviewDecision {
  status: "passed" | "pending" | "failed"
  reason: string
}

export function classifyCodexReview(snapshot: CodexReviewSnapshot): CodexReviewDecision {
  if (snapshot.state !== "OPEN") {
    return { status: "failed", reason: `pull request is ${snapshot.state.toLowerCase()}` }
  }
  if (!snapshot.complete) {
    return { status: "failed", reason: "GitHub response exceeded the supported 100-item window" }
  }

  let attemptAt = timestampValue(snapshot.createdAt)
  let explicitAttemptAt: number | null = null
  let explicitAttemptHead: string | null = null
  let attemptTarget = "pull-request"
  let ambiguousAttempt = false
  for (const signal of snapshot.signals) {
    if (signal.kind !== "comment" || isProvider(signal.author) || !REVIEW_REQUEST.test(signal.body ?? "")) continue
    if (signal.includesCreatedEdit === true
      || signal.lastEditedAt !== undefined
      || (signal.updatedAt !== undefined && signal.updatedAt !== signal.at)) {
      return { status: "failed", reason: "an edited Codex review request cannot start an attempt" }
    }
    const requestAt = timestampValue(signal.at)
    if (requestAt > attemptAt) {
      attemptAt = requestAt
      explicitAttemptAt = requestAt
      explicitAttemptHead = EXACT_HEAD_REVIEW_REQUEST.exec(signal.body ?? "")?.[1] ?? null
      attemptTarget = signal.target
      ambiguousAttempt = false
    } else if (requestAt === attemptAt && signal.target !== attemptTarget) {
      ambiguousAttempt = true
    }
  }
  if (ambiguousAttempt) {
    return { status: "pending", reason: "multiple review requests have no reliable order" }
  }

  const relatedEyes = snapshot.signals.filter((signal) =>
    signal.kind === "reaction"
      && signal.reaction === "EYES"
      && isProvider(signal.author)
      && signal.target === attemptTarget
      && timestampValue(signal.at) >= attemptAt,
  )
  for (const signal of relatedEyes) {
    const signalAt = timestampValue(signal.at)
    if (signalAt > attemptAt) {
      attemptAt = signalAt
      attemptTarget = signal.target
    }
  }

  const allProviderSignals = snapshot.signals.filter((signal) => isProvider(signal.author))
  const editedProviderReview = allProviderSignals.find((signal) =>
    signal.kind === "review" && (signal.includesCreatedEdit === true || signal.lastEditedAt !== undefined),
  )
  if (editedProviderReview) {
    return { status: "failed", reason: "an edited Codex review cannot prove a terminal result" }
  }
  const currentProviderSignals = allProviderSignals.filter(
    (signal) => timestampValue(signal.updatedAt ?? signal.at) >= attemptAt,
  )
  const providerThreads = snapshot.threads.filter((thread) =>
    isProvider(thread.comments[0]?.author ?? ""),
  )
  const usageFailure = currentProviderSignals.find((signal) => USAGE_FAILURE.test(signal.body ?? ""))
  if (usageFailure) {
    return { status: "failed", reason: "Codex reported a usage or rate limit" }
  }
  if (providerThreads.some((thread) => !thread.resolved)) {
    return { status: "failed", reason: "Codex returned an unresolved review finding" }
  }
  const latestResolvedThreadAt = Math.max(
    ...providerThreads.flatMap((thread) => thread.comments.map((comment) => timestampValue(comment.at))),
  )
  if (providerThreads.length > 0
    && (explicitAttemptAt === null || explicitAttemptAt <= latestResolvedThreadAt)) {
    return { status: "failed", reason: "Codex returned a review finding" }
  }
  const undisposedHistoricalFinding = explicitAttemptAt !== null && allProviderSignals.some((signal) => {
    if (timestampValue(signal.updatedAt ?? signal.at) >= explicitAttemptAt
      || !isNonCleanProviderResult(signal, snapshot.headRefOid)) return false
    if (signal.kind !== "review"
      || signal.reviewState !== "COMMENTED"
      || signal.reviewId === undefined
      || !isFindingReviewSummary(signal.body ?? "")) return true
    const matchingThreads = providerThreads.filter(
      (thread) => thread.comments[0]?.reviewId === signal.reviewId,
    )
    return matchingThreads.length === 0 || matchingThreads.some((thread) => {
      const resolver = thread.resolvedBy
      if (!thread.resolved || resolver === undefined || isProvider(resolver)) return true
      const findingAt = timestampValue(thread.comments[0].at)
      return !thread.comments.some((comment) => {
        const commentAt = timestampValue(comment.at)
        return comment.author.toLowerCase() === resolver.toLowerCase()
          && comment.body.trim() !== ""
          && commentAt > findingAt
          && commentAt < explicitAttemptAt
      })
    })
  })
  if (undisposedHistoricalFinding) {
    return { status: "failed", reason: "Codex returned a review finding" }
  }
  const editedProviderComment = currentProviderSignals.find((signal) =>
    signal.kind === "comment" && (
      signal.includesCreatedEdit === true
      || signal.lastEditedAt !== undefined
      || (signal.updatedAt !== undefined && signal.updatedAt !== signal.at)
    ),
  )
  if (editedProviderComment) {
    return { status: "failed", reason: "an edited Codex comment cannot prove a terminal result" }
  }
  const wrongHeadApproval = currentProviderSignals.find((signal) =>
    signal.kind === "review"
      && signal.reviewState === "APPROVED"
      && signal.commitOid !== snapshot.headRefOid,
  )
  if (wrongHeadApproval) {
    return { status: "failed", reason: "Codex approved a different head" }
  }

  const nonCleanReview = currentProviderSignals.find(
    (signal) => isNonCleanProviderResult(signal, snapshot.headRefOid),
  )
  if (nonCleanReview) {
    return { status: "failed", reason: "Codex returned a non-clean review result" }
  }

  const explicitAttemptMatchesCurrentHead = explicitAttemptAt === null
    || explicitAttemptHead === snapshot.headRefOid
  const cleanTerminal = explicitAttemptMatchesCurrentHead
    ? currentProviderSignals.find((signal) => timestampValue(signal.at) > attemptAt && (
      (signal.kind === "reaction"
        && signal.reaction === "THUMBS_UP"
        && signal.target === attemptTarget)
      || (signal.kind === "review"
        && signal.reviewState === "APPROVED"
        && signal.commitOid === snapshot.headRefOid
        && (!signal.body?.trim() || isCleanReview(signal.body)))
      || (signal.kind === "comment" && isCleanComment(signal.body ?? "", snapshot.headRefOid))
    ))
    : undefined
  if (cleanTerminal) {
    return { status: "passed", reason: "Codex opening review completed cleanly" }
  }
  if (relatedEyes.length > 0) {
    return { status: "pending", reason: "Codex opening review is still in progress" }
  }
  return { status: "pending", reason: "Codex opening review has not produced a terminal result" }
}

interface Connection<T> {
  nodes: T[]
  pageInfo: { hasNextPage: boolean }
}

interface GraphPullRequest {
  number: number
  state: string
  headRefOid: string
  createdAt: string
  reactions: Connection<{ content: string; createdAt: string; user: { login: string } | null }>
  comments: Connection<{
    id: string
    author: { login: string } | null
    body: string
    createdAt: string
    updatedAt: string
    includesCreatedEdit: boolean
    lastEditedAt: string | null
    reactions: Connection<{ content: string; createdAt: string; user: { login: string } | null }>
  }>
  reviews: Connection<{
    id: string
    author: { login: string } | null
    body: string
    state: string
    createdAt: string
    submittedAt: string | null
    commit: { oid: string }
    includesCreatedEdit: boolean
    lastEditedAt: string | null
  }>
  reviewThreads: Connection<{
    isResolved: boolean
    resolvedBy: { login: string } | null
    comments: Connection<{
      author: { login: string } | null
      body: string
      updatedAt: string
      pullRequestReview: { id: string }
    }>
  }>
}

interface ReviewOutput {
  repository: string
  pull_request: number
  head_oid: string | null
  status: "passed" | "pending" | "failed"
  reason: string
}

class ReviewSnapshotError extends Error {
  constructor(message: string, readonly headOid: string | null, cause: unknown) {
    super(message, { cause })
  }
}

const QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    pullRequest(number: $number) {
      number
      state
      headRefOid
      createdAt
      reactions(first: 100) {
        nodes { content createdAt user { login } }
        pageInfo { hasNextPage }
      }
      comments(first: 100) {
        nodes {
          id
          author { login }
          body
          createdAt
          updatedAt
          includesCreatedEdit
          lastEditedAt
          reactions(first: 100) {
            nodes { content createdAt user { login } }
            pageInfo { hasNextPage }
          }
        }
        pageInfo { hasNextPage }
      }
      reviews(first: 100) {
        nodes {
          id
          author { login }
          body
          state
          createdAt
          submittedAt
          commit { oid }
          includesCreatedEdit
          lastEditedAt
        }
        pageInfo { hasNextPage }
      }
      reviewThreads(first: 100) {
        nodes {
          isResolved
          resolvedBy { login }
          comments(first: 100) {
            nodes { author { login } body updatedAt pullRequestReview { id } }
            pageInfo { hasNextPage }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  }
}`

async function fetchSnapshot(repository: string, number: number): Promise<CodexReviewSnapshot> {
  const [owner, name] = repository.split("/")
  let response: {
    data?: {
      repository?: { nameWithOwner?: string; pullRequest?: GraphPullRequest | null } | null
    }
    errors?: unknown[]
  }
  try {
    const parsed: unknown = JSON.parse(runGh([
      "api",
      "graphql",
      "-f",
      `query=${QUERY}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `number=${number}`,
    ])) as typeof response
    if (!isRecord(parsed)) throw new Error("GitHub returned malformed response")
    response = parsed as typeof response
  } catch (error) {
    if (error instanceof Error && error.message === "GitHub CLI request failed") throw error
    if (error instanceof Error && error.message === "GitHub returned malformed response") throw error
    throw new Error("GitHub returned invalid JSON", { cause: error })
  }
  if (response.errors !== undefined && !Array.isArray(response.errors)) {
    throw new Error("GitHub returned malformed response")
  }
  if (response.errors?.length) {
    throw new Error("GitHub query returned errors")
  }
  const graphRepository = response.data?.repository
  if (!graphRepository) throw new Error("repository was not found")
  if (typeof graphRepository.nameWithOwner !== "string"
    || !matchesRepository(graphRepository.nameWithOwner, repository)) {
    throw new Error("GitHub returned a different repository")
  }
  const pullRequest = graphRepository.pullRequest
  if (!pullRequest) throw new Error("pull request was not found")
  if (!isPullRequestNumber(pullRequest.number)) {
    throw new Error("GitHub returned malformed pull request data")
  }
  if (pullRequest.number !== number) throw new Error("GitHub returned a different pull request")
  const observedHead = isHeadOid(pullRequest.headRefOid) ? pullRequest.headRefOid : null
  try {
    assertPullRequest(pullRequest)
  } catch (error) {
    throw new ReviewSnapshotError("GitHub returned malformed pull request data", observedHead, error)
  }

  const signals: ReviewSignal[] = []
  for (const reaction of pullRequest.reactions.nodes) {
    signals.push({
      author: reaction.user?.login ?? "",
      at: reaction.createdAt,
      kind: "reaction",
      target: "pull-request",
      reaction: reaction.content,
    })
  }
  for (const comment of pullRequest.comments.nodes) {
    const target = `comment:${comment.id}`
    signals.push({
      author: comment.author?.login ?? "",
      at: comment.createdAt,
      updatedAt: comment.updatedAt,
      includesCreatedEdit: comment.includesCreatedEdit,
      lastEditedAt: comment.lastEditedAt ?? undefined,
      kind: "comment",
      target,
      body: comment.body,
    })
    for (const reaction of comment.reactions.nodes) {
      signals.push({
        author: reaction.user?.login ?? "",
        at: reaction.createdAt,
        kind: "reaction",
        target,
        reaction: reaction.content,
      })
    }
  }
  for (const review of pullRequest.reviews.nodes) {
    signals.push({
      author: review.author?.login ?? "",
      at: review.submittedAt ?? review.createdAt,
      kind: "review",
      target: "review",
      body: review.body,
      reviewState: review.state,
      reviewId: review.id,
      commitOid: review.commit.oid,
      includesCreatedEdit: review.includesCreatedEdit,
      lastEditedAt: review.lastEditedAt ?? undefined,
    })
  }

  return {
    state: pullRequest.state,
    headRefOid: pullRequest.headRefOid,
    createdAt: pullRequest.createdAt,
    complete: !pullRequest.reactions.pageInfo.hasNextPage
      && !pullRequest.comments.pageInfo.hasNextPage
      && pullRequest.comments.nodes.every((comment) => !comment.reactions.pageInfo.hasNextPage)
      && !pullRequest.reviews.pageInfo.hasNextPage
      && !pullRequest.reviewThreads.pageInfo.hasNextPage
      && pullRequest.reviewThreads.nodes.every((thread) => !thread.comments.pageInfo.hasNextPage),
    signals,
    threads: pullRequest.reviewThreads.nodes.map((thread) => ({
      resolved: thread.isResolved,
      resolvedBy: thread.resolvedBy?.login,
      comments: thread.comments.nodes.map((comment) => ({
        author: comment.author?.login ?? "",
        at: comment.updatedAt,
        body: comment.body,
        reviewId: comment.pullRequestReview.id,
      })),
    })),
  }
}

function runGh(args: string[]): string {
  const result = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) {
    throw new Error("GitHub CLI request failed")
  }
  return result.stdout.toString()
}

function normalizeRepository(value: string): string {
  const match = /^([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)\/([a-z\d._-]{1,100})$/i.exec(value)
  if (!match || match[2] === "." || match[2] === "..") {
    throw new Error("repository must be owner/name")
  }
  return `${match[1].toLowerCase()}/${match[2].toLowerCase()}`
}

function matchesRepository(value: string, expected: string): boolean {
  try {
    return normalizeRepository(value) === expected
  } catch {
    return false
  }
}

function assertPullRequest(value: GraphPullRequest): void {
  if (!isPullRequestNumber(value.number)
    || typeof value.state !== "string"
    || !isHeadOid(value.headRefOid)
    || !isIsoTimestamp(value.createdAt)
    || !isConnection(value.reactions)
    || !isConnection(value.comments)
    || !isConnection(value.reviews)
    || !isConnection(value.reviewThreads)
    || value.reactions.nodes.some((reaction) => !isReaction(reaction))
    || value.comments.nodes.some((comment) => !isComment(comment))
    || value.reviews.nodes.some((review) => !isReview(review))
    || value.reviewThreads.nodes.some((thread) => !isReviewThread(thread))) {
    throw new Error("GitHub returned malformed pull request data")
  }
}

function isConnection(value: unknown): value is Connection<unknown> {
  if (typeof value !== "object" || value === null) return false
  const connection = value as { nodes?: unknown; pageInfo?: { hasNextPage?: unknown } }
  return Array.isArray(connection.nodes)
    && typeof connection.pageInfo?.hasNextPage === "boolean"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isPullRequestNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function isHeadOid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value)
}

function isActor(value: unknown): boolean {
  return value === null || (isRecord(value) && typeof value.login === "string")
}

function isReaction(value: unknown): boolean {
  return isRecord(value)
    && typeof value.content === "string"
    && isIsoTimestamp(value.createdAt)
    && isActor(value.user)
}

function isComment(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && isActor(value.author)
    && typeof value.body === "string"
    && isIsoTimestamp(value.createdAt)
    && isIsoTimestamp(value.updatedAt)
    && typeof value.includesCreatedEdit === "boolean"
    && (value.lastEditedAt === null || isIsoTimestamp(value.lastEditedAt))
    && isConnection(value.reactions)
    && value.reactions.nodes.every((reaction) => isReaction(reaction))
}

function isReview(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && isActor(value.author)
    && typeof value.body === "string"
    && typeof value.state === "string"
    && isIsoTimestamp(value.createdAt)
    && (value.submittedAt === null || isIsoTimestamp(value.submittedAt))
    && isRecord(value.commit)
    && isHeadOid(value.commit.oid)
    && typeof value.includesCreatedEdit === "boolean"
    && (value.lastEditedAt === null || isIsoTimestamp(value.lastEditedAt))
}

function isReviewThread(value: unknown): boolean {
  return isRecord(value)
    && typeof value.isResolved === "boolean"
    && isActor(value.resolvedBy)
    && isConnection(value.comments)
    && value.comments.nodes.length > 0
    && value.comments.nodes.every((comment) => isRecord(comment)
      && isActor(comment.author)
      && typeof comment.body === "string"
      && isIsoTimestamp(comment.updatedAt)
      && isRecord(comment.pullRequestReview)
      && typeof comment.pullRequestReview.id === "string")
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!match) return false
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = match.slice(1).map(Number)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = month === 2 ? (leapYear ? 29 : 28) : ([4, 6, 9, 11].includes(month) ? 30 : 31)
  return month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth
    && hour <= 23
    && minute <= 59
    && second <= 59
    && (Number.isNaN(offsetHour) || (offsetHour <= 23 && offsetMinute <= 59))
    && Number.isFinite(Date.parse(value))
}

function timestampValue(value: string): number {
  return Date.parse(value)
}

function isProvider(login: string): boolean {
  return login.replace(/\[bot\]$/, "") === PROVIDER_LOGIN
}

function isCleanReview(body: string): boolean {
  return CLEAN_REVIEW.test(body.trim())
}

function isCleanComment(body: string, headOid: string): boolean {
  const lines = body.trim().split(/\r?\n/).map((line) => line.trimEnd()).filter(
    (line, index, allLines) => line !== "" || index === 0 || allLines[index - 1] !== "",
  )
  const reviewedCommit = REVIEWED_COMMIT.exec(lines[2] ?? "")?.[1]
  return lines[1] === ""
    && CLEAN_COMMENT_HEADINGS.has(lines[0] ?? "")
    && reviewedCommit !== undefined
    && headOid.startsWith(reviewedCommit)
    && lines.length === CLEAN_COMMENT_SUFFIX.length + 3
    && CLEAN_COMMENT_SUFFIX.every((line, index) => lines[index + 3] === line)
}

function isNonCleanProviderResult(signal: ReviewSignal, headOid: string): boolean {
  if (signal.kind === "review") {
    return signal.reviewState === "CHANGES_REQUESTED"
      || Boolean(signal.body?.trim() && !isCleanReview(signal.body))
  }
  return signal.kind === "comment"
    && Boolean(signal.body?.trim() && !isCleanComment(signal.body, headOid))
}

function isFindingReviewSummary(body: string): boolean {
  const lines = body.trim().split(/\r?\n/).map((line) => line.trimEnd()).filter(
    (line, index, allLines) => line !== "" || index === 0 || allLines[index - 1] !== "",
  )
  return lines[0] === "### 💡 Codex Review"
    && lines[1] === ""
    && lines[2] === "Here are some automated review suggestions for this pull request."
    && lines[3] === ""
    && REVIEWED_COMMIT.test(lines[4] ?? "")
    && lines.length === CLEAN_COMMENT_SUFFIX.length + 5
    && CLEAN_COMMENT_SUFFIX.every((line, index) => lines[index + 5] === line)
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  if (args.includes("--help")) {
    console.log("usage: bun .agents/skills/run-bounded-mission/scripts/wait-pr-codex-review.ts --repo <owner/name> <pr-number>")
    return 0
  }
  const repoIndex = args.indexOf("--repo")
  const repositoryArgument = repoIndex >= 0 ? args[repoIndex + 1] : undefined
  const positional = args.filter((_, index) => index !== repoIndex && index !== repoIndex + 1)
  const numberToken = positional[0]
  const number = typeof numberToken === "string" && /^[1-9]\d*$/.test(numberToken)
    ? Number(numberToken)
    : Number.NaN
  let repository: string
  try {
    repository = normalizeRepository(repositoryArgument ?? "")
  } catch {
    console.error("codex-review: failed: repository must be owner/name")
    return 2
  }
  if (args.filter((arg) => arg === "--repo").length !== 1
    || positional.length !== 1
    || !Number.isSafeInteger(number)) {
    console.error("codex-review: failed: expected --repo <owner/name> and one positive PR number")
    return 2
  }

  try {
    const snapshot = await fetchSnapshot(repository, number)
    const decision = classifyCodexReview(snapshot)
    writeOutput({
      repository,
      pull_request: number,
      head_oid: snapshot.headRefOid,
      ...decision,
    })
    if (decision.status === "passed") return 0
    if (decision.status === "pending") return 10
    return 1
  } catch (error) {
    writeOutput({
      repository,
      pull_request: number,
      head_oid: error instanceof ReviewSnapshotError ? error.headOid : null,
      status: "failed",
      reason: error instanceof Error ? error.message : "unexpected provider failure",
    })
    return 1
  }
}

function writeOutput(output: ReviewOutput): void {
  const line = `${JSON.stringify(output)}\n`
  if (output.status === "failed") process.stderr.write(line)
  else process.stdout.write(line)
}

if (import.meta.main) process.exit(await main())
