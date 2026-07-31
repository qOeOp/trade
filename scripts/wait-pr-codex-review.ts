#!/usr/bin/env bun

const PROVIDER_LOGIN = "chatgpt-codex-connector"
const CLEAN_REVIEW = /^(?:codex review:?\s*)?didn['’]t find any major issues[.!]?$/i
const USAGE_FAILURE = /(usage limit|rate limit|quota exceeded|try again later)/i
const REVIEW_REQUEST = /@codex\s+review\b/i

export interface ReviewSignal {
  author: string
  at: string
  kind: "comment" | "reaction" | "review"
  target: string
  body?: string
  reaction?: string
  reviewState?: string
  updatedAt?: string
}

export interface ReviewThread {
  resolved: boolean
  comments: Array<{ author: string; at: string; body: string }>
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

  let attemptAt = snapshot.createdAt
  let attemptTarget = "pull-request"
  let ambiguousAttempt = false
  for (const signal of snapshot.signals) {
    if (signal.kind !== "comment" || isProvider(signal.author) || !REVIEW_REQUEST.test(signal.body ?? "")) continue
    const requestAt = signal.updatedAt ?? signal.at
    if (requestAt > attemptAt) {
      attemptAt = requestAt
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
      && signal.at >= attemptAt,
  )
  for (const signal of relatedEyes) {
    if (signal.at > attemptAt) {
      attemptAt = signal.at
      attemptTarget = signal.target
    }
  }

  const allProviderSignals = snapshot.signals.filter((signal) => isProvider(signal.author))
  const currentProviderSignals = allProviderSignals.filter(
    (signal) => (signal.updatedAt ?? signal.at) >= attemptAt,
  )
  const providerThreads = snapshot.threads.filter((thread) =>
    isProvider(thread.comments[0]?.author ?? ""),
  )
  const usageFailure = allProviderSignals.find((signal) => USAGE_FAILURE.test(signal.body ?? ""))
  if (usageFailure) {
    return { status: "failed", reason: "Codex reported a usage or rate limit" }
  }
  if (providerThreads.length > 0) {
    const unresolved = providerThreads.some((thread) => !thread.resolved)
    return {
      status: "failed",
      reason: unresolved ? "Codex returned an unresolved review finding" : "Codex returned a review finding",
    }
  }

  const editedProviderComment = allProviderSignals.find((signal) =>
    signal.kind === "comment" && signal.updatedAt !== undefined && signal.updatedAt !== signal.at,
  )
  if (editedProviderComment) {
    return { status: "failed", reason: "an edited Codex comment cannot prove a terminal result" }
  }

  const nonCleanReview = allProviderSignals.find((signal) => {
    if (signal.kind === "review") {
      return signal.reviewState === "CHANGES_REQUESTED"
        || Boolean(signal.body?.trim() && !isCleanReview(signal.body))
    }
    return signal.kind === "comment"
      && Boolean(signal.body?.trim() && !isCleanReview(signal.body))
  })
  if (nonCleanReview) {
    return { status: "failed", reason: "Codex returned a non-clean review result" }
  }

  const cleanTerminal = currentProviderSignals.find((signal) =>
    signal.at > attemptAt && (
      (signal.kind === "reaction"
        && signal.reaction === "THUMBS_UP"
        && signal.target === attemptTarget)
      || (signal.kind === "review"
        && signal.reviewState === "APPROVED"
        && (!signal.body?.trim() || isCleanReview(signal.body)))
      || (signal.kind === "comment" && isCleanReview(signal.body ?? ""))
    ),
  )
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
    reactions: Connection<{ content: string; createdAt: string; user: { login: string } | null }>
  }>
  reviews: Connection<{
    author: { login: string } | null
    body: string
    state: string
    createdAt: string
    submittedAt: string | null
  }>
  reviewThreads: Connection<{
    isResolved: boolean
    comments: Connection<{
      author: { login: string } | null
      body: string
      updatedAt: string
    }>
  }>
}

const QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
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
          reactions(first: 100) {
            nodes { content createdAt user { login } }
            pageInfo { hasNextPage }
          }
        }
        pageInfo { hasNextPage }
      }
      reviews(first: 100) {
        nodes { author { login } body state createdAt submittedAt }
        pageInfo { hasNextPage }
      }
      reviewThreads(first: 100) {
        nodes {
          isResolved
          comments(first: 100) {
            nodes { author { login } body updatedAt }
            pageInfo { hasNextPage }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  }
}`

async function fetchSnapshot(number: number): Promise<CodexReviewSnapshot> {
  const repo = runGh(["repo", "view", "--json", "nameWithOwner"])
  const nameWithOwner = (JSON.parse(repo) as { nameWithOwner?: string }).nameWithOwner
  const [owner, name] = nameWithOwner?.split("/") ?? []
  if (!owner || !name) throw new Error("gh repo view did not return nameWithOwner")

  const response = JSON.parse(runGh([
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
  ])) as {
    data?: { repository?: { pullRequest?: GraphPullRequest | null } | null }
    errors?: Array<{ message?: string }>
  }
  if (response.errors?.length) {
    throw new Error(response.errors.map((error) => error.message ?? "GraphQL error").join("; "))
  }
  const pullRequest = response.data?.repository?.pullRequest
  if (!pullRequest) throw new Error(`pull request #${number} was not found`)

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
      comments: thread.comments.nodes.map((comment) => ({
        author: comment.author?.login ?? "",
        at: comment.updatedAt,
        body: comment.body,
      })),
    })),
  }
}

function runGh(args: string[]): string {
  const result = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString().trim() || `gh exited with status ${result.exitCode}`)
  }
  return result.stdout.toString()
}

function isProvider(login: string): boolean {
  return login.replace(/\[bot\]$/, "") === PROVIDER_LOGIN
}

function isCleanReview(body: string): boolean {
  return CLEAN_REVIEW.test(body.trim())
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  if (args.includes("--help")) {
    console.log("usage: bun scripts/wait-pr-codex-review.ts <pr-number> [--once]")
    return 0
  }
  const once = args.includes("--once")
  const positional = args.filter((arg) => arg !== "--once")
  const number = Number(positional[0])
  if (positional.length !== 1 || !Number.isInteger(number) || number <= 0) {
    console.error("usage: bun scripts/wait-pr-codex-review.ts <pr-number> [--once]")
    return 2
  }

  while (true) {
    try {
      const snapshot = await fetchSnapshot(number)
      const decision = classifyCodexReview(snapshot)
      const message = `codex-review: ${decision.status}: PR #${number} ${snapshot.headRefOid}: ${decision.reason}`
      if (decision.status === "failed") console.error(message)
      else console.log(message)
      if (decision.status === "passed") return 0
      if (decision.status === "failed") return 1
      if (once) return 10
    } catch (error) {
      console.error(`codex-review: failed: ${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
    await Bun.sleep(30_000)
  }
}

if (import.meta.main) process.exit(await main())
