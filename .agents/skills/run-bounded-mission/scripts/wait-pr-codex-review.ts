#!/usr/bin/env bun

const PROVIDER_LOGIN = "chatgpt-codex-connector"
const PROVIDER_APP_ID = 1144995
const RECEIPT_SCHEMA = "codex-review-receipt/v1"
const REQUEST_VALIDATION_SCHEMA = "codex-review-request-validation/v1"
const CLEAN_REVIEW = /^(?:codex review:?\s*)?didn['’]t find any major issues[.!]?$/i
const CLEAN_COMMENT_HEADING = /^Codex Review: Didn['’]t find any major issues\.(?: (?=[^\r\n]{1,64}$)\S(?:[^\r\n]*\S)?)?$/
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
  "",
  "",
  "",
  "Codex can also answer questions or update the PR. Try commenting \"@codex address that feedback\".",
  "            ",
  "</details>",
]
const USAGE_FAILURE = /(usage limit|rate limit|quota exceeded|try again later)/i
const REVIEW_REQUEST = /@codex\s+review\b/i
const EXACT_HEAD_REVIEW_REQUEST = /^@codex review\n\nExact head: `([0-9a-f]{40})`$/
const REQUESTED_HEAD = /^@codex review\n\nExact head:\s*`?([0-9a-f]{40})`?$/

export type RequestClassification =
  | "valid"
  | "missing"
  | "malformed"
  | "edited"
  | "ambiguous"
  | "wrong-head"
  | "self-trigger"
  | "incomplete"

export type DiscoveryStatus = "waiting" | "clean" | "finding_unrouted" | "finding_routed"

export type DiscoveryProblem =
  | "pull-request-closed"
  | "snapshot-incomplete"
  | "usage-failure"
  | "provider-edited"
  | "provider-wrong-head"
  | "provider-result-incomplete"

export interface GitHubAppProvenance {
  id: number
  slug: string
}

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
  locator?: string
  databaseId?: number
  url?: string
  performedViaGithubApp?: GitHubAppProvenance | null
  includesCreatedEdit?: boolean
  lastEditedAt?: string
  updatedAt?: string
}

export interface ReviewThread {
  locator?: string
  resolved: boolean
  resolvedBy?: string
  comments: Array<{
    locator?: string
    url?: string
    author: string
    at: string
    body: string
    reviewId?: string
    includesCreatedEdit?: boolean
    lastEditedAt?: string
  }>
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
  request: ReviewRequestProjection
  discovery: ReviewDiscoveryProjection
  exitCode: 0 | 1 | 10 | 20
}

export interface ObservedReviewRequestProjection {
  classification: RequestClassification
  locator: string | null
  comment_id: number | null
  url: string | null
  author: string | null
  created_at: string | null
  updated_at: string | null
  edited: boolean | null
  body: string | null
  requested_head: string | null
  provenance_complete: boolean
  performed_via_github_app: GitHubAppProvenance | null
}

export interface ReviewRequestProjection extends ObservedReviewRequestProjection {
  expected_locator: string
  expected_author: string
  binding_matches: boolean | null
  candidate_locators: string[]
  observed: ObservedReviewRequestProjection[]
}

export interface ReviewRequestExpectation {
  locator: string
  author: string
}

export interface ReviewEvidenceProjection {
  locator: string
  url: string | null
  author: string
  at: string
  body: string
  edited: boolean
}

export interface ProviderReviewProjection {
  locator: string
  url: string | null
  author: string
  at: string
  state: string
  reviewed_head: string
  edited: boolean
}

export interface ReviewFindingProjection {
  reviewed_head: string | null
  provider_review: ProviderReviewProjection | null
  finding: ReviewEvidenceProjection
  thread: {
    locator: string
    resolved: boolean
    resolver: string | null
  } | null
  disposition: ReviewEvidenceProjection | null
  routed: boolean
}

export interface ReviewDiscoveryProjection {
  status: DiscoveryStatus
  reviewed_head: string | null
  provider_review: ProviderReviewProjection | null
  clean_signal: ReviewEvidenceProjection | null
  progress_signal: ReviewEvidenceProjection | null
  findings: ReviewFindingProjection[]
  problems: DiscoveryProblem[]
}

export function renderCodexReviewRequest(headOid: string): string {
  if (!/^[0-9a-f]{40}$/.test(headOid)) throw new Error("head must be a full lowercase 40-hex OID")
  return `@codex review\n\nExact head: \`${headOid}\``
}

export function validateCodexReviewRequest(body: string, expectedHead: string): {
  schema: typeof REQUEST_VALIDATION_SCHEMA
  classification: "valid" | "malformed" | "wrong-head"
  expected_head: string
  requested_head: string | null
  body: string
} {
  if (!/^[0-9a-f]{40}$/.test(expectedHead)) throw new Error("head must be a full lowercase 40-hex OID")
  const requestedHead = EXACT_HEAD_REVIEW_REQUEST.exec(body)?.[1] ?? REQUESTED_HEAD.exec(body)?.[1] ?? null
  const classification = EXACT_HEAD_REVIEW_REQUEST.test(body)
    ? (requestedHead === expectedHead ? "valid" : "wrong-head")
    : "malformed"
  return {
    schema: REQUEST_VALIDATION_SCHEMA,
    classification,
    expected_head: expectedHead,
    requested_head: requestedHead,
    body,
  }
}

export function classifyCodexReview(
  snapshot: CodexReviewSnapshot,
  expectation: ReviewRequestExpectation,
): CodexReviewDecision {
  const { request, selected } = classifyRequest(snapshot, expectation)
  const attemptAt = selected ? timestampValue(selected.at) : timestampValue(snapshot.createdAt)
  const attemptTarget = selected?.target ?? "pull-request"
  const allProviderSignals = snapshot.signals.filter((signal) => isProvider(signal.author))
  const currentProviderSignals = allProviderSignals.filter(
    (signal) => timestampValue(signal.updatedAt ?? signal.at) >= attemptAt,
  )
  const problems: DiscoveryProblem[] = []
  if (snapshot.state !== "OPEN") problems.push("pull-request-closed")
  if (!snapshot.complete) problems.push("snapshot-incomplete")
  if (allProviderSignals.some((signal) => (signal.kind === "review" || signal.kind === "comment")
    && isEditedSignal(signal))) problems.push("provider-edited")
  const usageFailure = currentProviderSignals.find((signal) =>
    USAGE_FAILURE.test(signal.body ?? "")
      && !isGeneratedReviewComment(signal.body ?? "", snapshot.headRefOid),
  )
  if (usageFailure) problems.push("usage-failure")
  if (currentProviderSignals.some((signal) => signal.kind === "review"
    && signal.commitOid !== undefined
    && signal.commitOid !== snapshot.headRefOid)) problems.push("provider-wrong-head")

  const { findings, incomplete } = projectFindings(snapshot, allProviderSignals)
  if (incomplete) problems.push("provider-result-incomplete")
  const relatedEyes = currentProviderSignals.filter((signal) =>
    signal.kind === "reaction"
      && signal.reaction === "EYES"
      && signal.target === attemptTarget
      && timestampValue(signal.at) >= attemptAt,
  )
  const cleanTerminal = selected
    ? currentProviderSignals.find((signal) => timestampValue(signal.at) > attemptAt && (
      (signal.kind === "reaction"
        && signal.reaction === "THUMBS_UP"
        && (signal.target === attemptTarget || signal.target === "pull-request"))
      || (signal.kind === "review"
        && signal.reviewState === "APPROVED"
        && signal.commitOid === snapshot.headRefOid
        && (!signal.body?.trim() || isCleanReview(signal.body)))
    ))
    : undefined
  const routedFindings = findings.length > 0 && findings.every((finding) => finding.routed)
  const discoveryStatus: DiscoveryStatus = findings.length > 0
    ? (routedFindings ? "finding_routed" : "finding_unrouted")
    : (cleanTerminal ? "clean" : "waiting")
  const findingReview = [...findings].reverse().find((finding) => finding.provider_review !== null)?.provider_review ?? null
  const terminalReview = cleanTerminal?.kind === "review" ? providerReviewProjection(cleanTerminal) : null
  const observedReview = currentProviderSignals
    .filter((signal) => signal.kind === "review")
    .map(providerReviewProjection)
    .filter((review): review is ProviderReviewProjection => review !== null)
    .at(-1) ?? null
  const reviewedHead = findings.at(-1)?.reviewed_head
    ?? cleanTerminal?.commitOid
    ?? observedReview?.reviewed_head
    ?? (cleanTerminal ? request.requested_head : null)
  const discovery: ReviewDiscoveryProjection = {
    status: discoveryStatus,
    reviewed_head: reviewedHead ?? null,
    provider_review: findingReview ?? terminalReview ?? observedReview,
    clean_signal: cleanTerminal ? signalEvidence(cleanTerminal) : null,
    progress_signal: relatedEyes.length > 0 ? signalEvidence(relatedEyes.at(-1)!) : null,
    findings,
    problems: [...new Set(problems)],
  }

  if (snapshot.state !== "OPEN") {
    return decision("failed", `pull request is ${snapshot.state.toLowerCase()}`, 1, request, discovery)
  }
  if (!snapshot.complete) {
    return decision("failed", "GitHub response exceeded a supported pagination boundary", 1, request, discovery)
  }
  if (request.classification !== "valid") {
    return decision("failed", requestFailureReason(request.classification), 1, request, discovery)
  }
  if (discovery.problems.length > 0) {
    return decision("failed", discoveryProblemReason(discovery.problems[0]!), 1, request, discovery)
  }
  if (discovery.status === "finding_unrouted") {
    return decision("failed", "Codex returned an unrouted review finding", 1, request, discovery)
  }
  if (discovery.status === "finding_routed") {
    return decision("failed", "Codex review finding was routed and resolved", 20, request, discovery)
  }
  if (discovery.status === "clean") {
    return decision("passed", "Codex review completed cleanly", 0, request, discovery)
  }
  if (discovery.progress_signal !== null) {
    return decision("pending", "Codex review is still in progress", 10, request, discovery)
  }
  return decision("pending", "Codex review has not produced a terminal result", 10, request, discovery)
}

function decision(
  status: CodexReviewDecision["status"],
  reason: string,
  exitCode: CodexReviewDecision["exitCode"],
  request: ReviewRequestProjection,
  discovery: ReviewDiscoveryProjection,
): CodexReviewDecision {
  return { status, reason, request, discovery, exitCode }
}

function requestFailureReason(classification: RequestClassification): string {
  const reasons: Record<RequestClassification, string> = {
    valid: "Codex review request is valid",
    missing: "Codex review request is missing",
    malformed: "Codex review request is malformed",
    edited: "an edited Codex review request cannot start an attempt",
    ambiguous: "multiple review requests have no reliable order",
    "wrong-head": "Codex review request targets a different head",
    "self-trigger": "Codex connector cannot trigger its own review",
    incomplete: "Codex review request provenance is incomplete",
  }
  return reasons[classification]
}

function discoveryProblemReason(problem: DiscoveryProblem): string {
  const reasons: Record<DiscoveryProblem, string> = {
    "pull-request-closed": "pull request is not open",
    "snapshot-incomplete": "GitHub review snapshot is incomplete",
    "usage-failure": "Codex reported a usage or rate limit",
    "provider-edited": "an edited Codex provider result cannot prove a terminal result",
    "provider-wrong-head": "Codex approved a different head",
    "provider-result-incomplete": "Codex provider result is missing required lifecycle evidence",
  }
  return reasons[problem]
}

function classifyRequest(snapshot: CodexReviewSnapshot, expectation: ReviewRequestExpectation): {
  request: ReviewRequestProjection
  selected: ReviewSignal | null
} {
  const requests = snapshot.signals.filter((signal) =>
    signal.kind === "comment" && !isProvider(signal.author) && REVIEW_REQUEST.test(signal.body ?? ""),
  )
  const observed = [...requests]
    .sort((left, right) => timestampValue(left.at) - timestampValue(right.at))
    .map((signal) => projectObservedRequest(snapshot, signal))
  if (requests.length === 0) return { request: emptyRequest("missing", expectation), selected: null }
  const latestAt = Math.max(...requests.map((signal) => timestampValue(signal.at)))
  const latest = requests.filter((signal) => timestampValue(signal.at) === latestAt)
  const candidateLocators = latest.map(signalLocator).filter((value): value is string => value !== null).sort()
  if (latest.length !== 1) {
    return {
      request: { ...emptyRequest("ambiguous", expectation), candidate_locators: candidateLocators, observed },
      selected: null,
    }
  }
  const selected = latest[0]!
  const projected = projectObservedRequest(snapshot, selected)
  const bindingMatches = projected.locator === expectation.locator
    && projected.author?.toLowerCase() === expectation.author.toLowerCase()
  return {
    request: {
      ...projected,
      classification: bindingMatches ? projected.classification : "incomplete",
      expected_locator: expectation.locator,
      expected_author: expectation.author,
      binding_matches: bindingMatches,
      candidate_locators: candidateLocators,
      observed,
    },
    selected,
  }
}

function projectObservedRequest(
  snapshot: CodexReviewSnapshot,
  selected: ReviewSignal,
): ObservedReviewRequestProjection {
  const body = selected.body ?? ""
  const exactHead = EXACT_HEAD_REVIEW_REQUEST.exec(body)?.[1] ?? null
  const requestedHead = exactHead ?? REQUESTED_HEAD.exec(body)?.[1] ?? null
  const edited = isEditedSignal(selected)
  const provenanceComplete = selected.performedViaGithubApp !== undefined
  const bindingComplete = signalLocator(selected) !== null
    && selected.author !== ""
    && isIsoTimestamp(selected.at)
    && isIsoTimestamp(selected.updatedAt ?? selected.at)
  const app = selected.performedViaGithubApp ?? null
  let classification: RequestClassification
  if (edited) classification = "edited"
  else if (!provenanceComplete || !bindingComplete) classification = "incomplete"
  else if (app?.id === PROVIDER_APP_ID && app.slug === PROVIDER_LOGIN) classification = "self-trigger"
  else if (app !== null) classification = "incomplete"
  else if (exactHead === null) classification = "malformed"
  else if (exactHead !== snapshot.headRefOid) classification = "wrong-head"
  else classification = "valid"
  return {
    classification,
    locator: signalLocator(selected),
    comment_id: selected.databaseId ?? null,
    url: selected.url ?? null,
    author: selected.author || null,
    created_at: selected.at,
    updated_at: selected.updatedAt ?? selected.at,
    edited,
    body,
    requested_head: requestedHead,
    provenance_complete: provenanceComplete,
    performed_via_github_app: app,
  }
}

function emptyRequest(
  classification: RequestClassification,
  expectation: ReviewRequestExpectation,
): ReviewRequestProjection {
  return {
    classification,
    locator: null,
    expected_locator: expectation.locator,
    expected_author: expectation.author,
    binding_matches: null,
    candidate_locators: [],
    observed: [],
    comment_id: null,
    url: null,
    author: null,
    created_at: null,
    updated_at: null,
    edited: null,
    body: null,
    requested_head: null,
    provenance_complete: false,
    performed_via_github_app: null,
  }
}

function isEditedSignal(signal: ReviewSignal): boolean {
  return signal.includesCreatedEdit === true
    || signal.lastEditedAt !== undefined
    || (signal.updatedAt !== undefined && signal.updatedAt !== signal.at)
}

function signalLocator(signal: ReviewSignal): string | null {
  return signal.locator ?? (signal.target.startsWith("comment:") ? signal.target.slice("comment:".length) : signal.target)
}

function signalEvidence(signal: ReviewSignal): ReviewEvidenceProjection | null {
  const locator = signalLocator(signal)
  if (!locator || !signal.author || !isIsoTimestamp(signal.at)) return null
  const body = signal.body ?? signal.reaction ?? signal.reviewState ?? ""
  return { locator, url: signal.url ?? null, author: signal.author, at: signal.at, body, edited: isEditedSignal(signal) }
}

function providerReviewProjection(signal: ReviewSignal): ProviderReviewProjection | null {
  const locator = signalLocator(signal)
  if (signal.kind !== "review" || !locator || !signal.author || !signal.reviewState || !signal.commitOid) return null
  return {
    locator,
    url: signal.url ?? null,
    author: signal.author,
    at: signal.at,
    state: signal.reviewState,
    reviewed_head: signal.commitOid,
    edited: isEditedSignal(signal),
  }
}

function threadCommentEvidence(comment: ReviewThread["comments"][number]): ReviewEvidenceProjection | null {
  if (!comment.locator || !comment.author || !isIsoTimestamp(comment.at) || comment.body.trim() === "") return null
  return {
    locator: comment.locator,
    url: comment.url ?? null,
    author: comment.author,
    at: comment.at,
    body: comment.body,
    edited: comment.includesCreatedEdit === true || comment.lastEditedAt !== undefined,
  }
}

function projectFindings(snapshot: CodexReviewSnapshot, providerSignals: ReviewSignal[]): {
  findings: ReviewFindingProjection[]
  incomplete: boolean
} {
  const findings: ReviewFindingProjection[] = []
  const representedReviews = new Set<string>()
  let incomplete = false
  for (const thread of snapshot.threads.filter((value) => isProvider(value.comments[0]?.author ?? ""))) {
    const first = thread.comments[0]!
    if (first.reviewId) representedReviews.add(first.reviewId)
    const reviewSignal = providerSignals.find((signal) => signal.kind === "review" && signal.reviewId === first.reviewId)
    const review = reviewSignal ? providerReviewProjection(reviewSignal) : null
    const structuredFindingReview = reviewSignal?.reviewState === "COMMENTED"
      && isFindingReviewSummary(reviewSignal.body ?? "", reviewSignal.commitOid ?? "")
    const finding = threadCommentEvidence(first)
    const resolver = thread.resolvedBy && !isProvider(thread.resolvedBy) ? thread.resolvedBy : null
    const dispositionComment = resolver
      ? thread.comments.find((comment) => comment.author.toLowerCase() === resolver.toLowerCase()
        && timestampValue(comment.at) > timestampValue(first.at)
        && comment.body.trim() !== "")
      : undefined
    const disposition = dispositionComment ? threadCommentEvidence(dispositionComment) : null
    const threadProjection = thread.locator ? {
      locator: thread.locator,
      resolved: thread.resolved,
      resolver,
    } : null
    if (!finding || finding.edited || !review || !structuredFindingReview || !threadProjection
      || disposition?.edited) incomplete = true
    findings.push({
      reviewed_head: review?.reviewed_head ?? null,
      provider_review: review,
      finding: finding ?? {
        locator: first.locator ?? "missing",
        url: first.url ?? null,
        author: first.author,
        at: first.at,
        body: first.body,
        edited: first.includesCreatedEdit === true || first.lastEditedAt !== undefined,
      },
      thread: threadProjection,
      disposition,
      routed: Boolean(
        review && structuredFindingReview && finding && !finding.edited && threadProjection
          && thread.resolved && resolver && disposition && !disposition.edited,
      ),
    })
  }
  for (const signal of providerSignals) {
    if (signal.reviewId && representedReviews.has(signal.reviewId)) continue
    if (USAGE_FAILURE.test(signal.body ?? "")) continue
    if (!isNonCleanProviderResult(signal)) continue
    const evidence = signalEvidence(signal)
    const review = providerReviewProjection(signal)
    if (!evidence || (signal.kind === "review" && !review)) incomplete = true
    if (!evidence) continue
    findings.push({
      reviewed_head: review?.reviewed_head ?? null,
      provider_review: review,
      finding: evidence,
      thread: null,
      disposition: null,
      routed: false,
    })
  }
  findings.sort((left, right) => timestampValue(left.finding.at) - timestampValue(right.finding.at))
  return { findings, incomplete }
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
    databaseId: number
    url: string
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
    url: string
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
    id: string
    isResolved: boolean
    resolvedBy: { login: string } | null
    comments: Connection<{
      id: string
      url: string
      author: { login: string } | null
      body: string
      createdAt: string
      includesCreatedEdit: boolean
      lastEditedAt: string | null
      pullRequestReview: { id: string }
    }>
  }>
}

interface ReviewOutput {
  schema: typeof RECEIPT_SCHEMA
  repository: string
  pull_request: number
  head_oid: string | null
  status: "passed" | "pending" | "failed"
  reason: string
  request: ReviewRequestProjection
  discovery: ReviewDiscoveryProjection
}

interface RestIssueComment {
  id: number
  node_id: string
  html_url: string
  body: string
  user: { login: string }
  created_at: string
  updated_at: string
  performed_via_github_app: GitHubAppProvenance | null
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
          databaseId
          url
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
          url
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
          id
          isResolved
          resolvedBy { login }
          comments(first: 100) {
            nodes {
              id
              url
              author { login }
              body
              createdAt
              includesCreatedEdit
              lastEditedAt
              pullRequestReview { id }
            }
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
  const issueComments = fetchIssueComments(repository, number)
  const issueCommentsById = new Map(issueComments.map((comment) => [comment.id, comment]))
  const graphIssueCommentIds = new Set(pullRequest.comments.nodes.map((comment) => comment.databaseId))
  if (graphIssueCommentIds.size !== pullRequest.comments.nodes.length
    || issueComments.length !== pullRequest.comments.nodes.length
    || issueComments.some((comment) => !graphIssueCommentIds.has(comment.id))) {
    throw new ReviewSnapshotError("GitHub issue-comment collections did not bind", observedHead, null)
  }

  const signals: ReviewSignal[] = []
  for (const reaction of pullRequest.reactions.nodes) {
    signals.push({
      author: reaction.user?.login ?? "",
      at: reaction.createdAt,
      kind: "reaction",
      target: "pull-request",
      locator: "pull-request",
      reaction: reaction.content,
    })
  }
  for (const comment of pullRequest.comments.nodes) {
    const restComment = issueCommentsById.get(comment.databaseId)
    if (!restComment
      || restComment.node_id !== comment.id
      || restComment.html_url !== comment.url
      || restComment.user.login !== (comment.author?.login ?? "")
      || restComment.body !== comment.body
      || restComment.created_at !== comment.createdAt
      || restComment.updated_at !== comment.updatedAt) {
      throw new ReviewSnapshotError("GitHub issue-comment provenance did not bind to GraphQL", observedHead, null)
    }
    const target = `comment:${comment.id}`
    signals.push({
      author: comment.author?.login ?? "",
      at: comment.createdAt,
      locator: comment.id,
      databaseId: comment.databaseId,
      url: comment.url,
      updatedAt: comment.updatedAt,
      includesCreatedEdit: comment.includesCreatedEdit,
      lastEditedAt: comment.lastEditedAt ?? undefined,
      performedViaGithubApp: restComment.performed_via_github_app,
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
        locator: comment.id,
        url: comment.url,
        reaction: reaction.content,
      })
    }
  }
  for (const review of pullRequest.reviews.nodes) {
    signals.push({
      author: review.author?.login ?? "",
      at: review.submittedAt ?? review.createdAt,
      locator: review.id,
      url: review.url,
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
  const actorsComplete = pullRequest.reactions.nodes.every((reaction) => reaction.user !== null)
    && pullRequest.comments.nodes.every((comment) => comment.author !== null
      && comment.reactions.nodes.every((reaction) => reaction.user !== null))
    && pullRequest.reviews.nodes.every((review) => review.author !== null)
    && pullRequest.reviewThreads.nodes.every((thread) => (!thread.isResolved || thread.resolvedBy !== null)
      && thread.comments.nodes.every((comment) => comment.author !== null))

  return {
    state: pullRequest.state,
    headRefOid: pullRequest.headRefOid,
    createdAt: pullRequest.createdAt,
    complete: !pullRequest.reactions.pageInfo.hasNextPage
      && !pullRequest.comments.pageInfo.hasNextPage
      && pullRequest.comments.nodes.every((comment) => !comment.reactions.pageInfo.hasNextPage)
      && !pullRequest.reviews.pageInfo.hasNextPage
      && !pullRequest.reviewThreads.pageInfo.hasNextPage
      && pullRequest.reviewThreads.nodes.every((thread) => !thread.comments.pageInfo.hasNextPage)
      && actorsComplete,
    signals,
    threads: pullRequest.reviewThreads.nodes.map((thread) => ({
      locator: thread.id,
      resolved: thread.isResolved,
      resolvedBy: thread.resolvedBy?.login,
      comments: thread.comments.nodes.map((comment) => ({
        locator: comment.id,
        url: comment.url,
        author: comment.author?.login ?? "",
        at: comment.createdAt,
        body: comment.body,
        reviewId: comment.pullRequestReview.id,
        includesCreatedEdit: comment.includesCreatedEdit,
        lastEditedAt: comment.lastEditedAt ?? undefined,
      })),
    })),
  }
}

function fetchIssueComments(repository: string, number: number): RestIssueComment[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(runGh([
      "api",
      "--paginate",
      "--slurp",
      `repos/${repository}/issues/${number}/comments`,
    ]))
  } catch (error) {
    if (error instanceof Error && error.message === "GitHub CLI request failed") throw error
    throw new Error("GitHub returned invalid issue-comment JSON", { cause: error })
  }
  if (!Array.isArray(parsed) || parsed.some((page) => !Array.isArray(page))) {
    throw new Error("GitHub returned malformed issue-comment pages")
  }
  const comments = parsed.flat()
  if (comments.some((comment) => !isRestIssueComment(comment))) {
    throw new Error("GitHub returned malformed issue-comment provenance")
  }
  const typed = (comments as RestIssueComment[]).map((comment): RestIssueComment => ({
    id: comment.id,
    node_id: comment.node_id,
    html_url: comment.html_url,
    body: comment.body,
    user: { login: comment.user.login },
    created_at: comment.created_at,
    updated_at: comment.updated_at,
    performed_via_github_app: comment.performed_via_github_app === null ? null : {
      id: comment.performed_via_github_app.id,
      slug: comment.performed_via_github_app.slug,
    },
  }))
  if (new Set(typed.map((comment) => comment.id)).size !== typed.length) {
    throw new Error("GitHub returned duplicate issue comments")
  }
  return typed
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

function normalizeRequestExpectation(locator: string, author: string): ReviewRequestExpectation {
  if (!/^[A-Za-z0-9_-]+$/.test(locator)
    || !/^[A-Za-z\d](?:[A-Za-z\d-]{0,37}[A-Za-z\d])?$/.test(author)) {
    throw new Error("invalid request expectation")
  }
  return { locator, author }
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
  return value === null || (isRecord(value) && typeof value.login === "string" && value.login !== "")
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
    && value.id !== ""
    && typeof value.databaseId === "number"
    && Number.isSafeInteger(value.databaseId)
    && value.databaseId > 0
    && typeof value.url === "string"
    && value.url !== ""
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
    && value.id !== ""
    && typeof value.url === "string"
    && value.url !== ""
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
    && typeof value.id === "string"
    && value.id !== ""
    && typeof value.isResolved === "boolean"
    && isActor(value.resolvedBy)
    && isConnection(value.comments)
    && value.comments.nodes.length > 0
    && value.comments.nodes.every((comment) => isRecord(comment)
      && typeof comment.id === "string"
      && comment.id !== ""
      && typeof comment.url === "string"
      && comment.url !== ""
      && isActor(comment.author)
      && typeof comment.body === "string"
      && isIsoTimestamp(comment.createdAt)
      && typeof comment.includesCreatedEdit === "boolean"
      && (comment.lastEditedAt === null || isIsoTimestamp(comment.lastEditedAt))
      && isRecord(comment.pullRequestReview)
      && typeof comment.pullRequestReview.id === "string")
}

function isRestIssueComment(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "number"
    && Number.isSafeInteger(value.id)
    && value.id > 0
    && typeof value.node_id === "string"
    && value.node_id !== ""
    && typeof value.html_url === "string"
    && value.html_url !== ""
    && typeof value.body === "string"
    && isRecord(value.user)
    && typeof value.user.login === "string"
    && value.user.login !== ""
    && isIsoTimestamp(value.created_at)
    && isIsoTimestamp(value.updated_at)
    && Object.prototype.hasOwnProperty.call(value, "performed_via_github_app")
    && (value.performed_via_github_app === null || isGitHubAppProvenance(value.performed_via_github_app))
}

function isGitHubAppProvenance(value: unknown): value is GitHubAppProvenance {
  return isRecord(value)
    && typeof value.id === "number"
    && Number.isSafeInteger(value.id)
    && value.id > 0
    && typeof value.slug === "string"
    && value.slug !== ""
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

function isGeneratedReviewComment(body: string, headOid?: string): boolean {
  const lines = body.split("\n")
  const cleanHeading = CLEAN_COMMENT_HEADING.exec(lines[0] ?? "")
  const reviewedCommit = REVIEWED_COMMIT.exec(lines[2] ?? "")?.[1]
  return cleanHeading !== null
    && lines[1] === ""
    && reviewedCommit !== undefined
    && (headOid === undefined || headOid.startsWith(reviewedCommit))
    && lines.length === CLEAN_COMMENT_SUFFIX.length + 3
    && CLEAN_COMMENT_SUFFIX.every((line, index) => lines[index + 3] === line)
}

function isNonCleanProviderResult(signal: ReviewSignal): boolean {
  if (signal.kind === "review") {
    return signal.reviewState === "CHANGES_REQUESTED"
      || Boolean(signal.body?.trim() && !isCleanReview(signal.body))
  }
  return signal.kind === "comment"
    && !isGeneratedReviewComment(signal.body ?? "")
}

function isFindingReviewSummary(body: string, commitOid: string): boolean {
  const lines = body.split("\n")
  const reviewedCommit = REVIEWED_COMMIT.exec(lines[5] ?? "")?.[1]
  return lines[0] === ""
    && lines[1] === "### 💡 Codex Review"
    && lines[2] === ""
    && lines[3] === "Here are some automated review suggestions for this pull request."
    && lines[4] === ""
    && reviewedCommit !== undefined
    && commitOid.startsWith(reviewedCommit)
    && lines[6] === "    "
    && lines.length === CLEAN_COMMENT_SUFFIX.length + 7
    && CLEAN_COMMENT_SUFFIX.every((line, index) => lines[index + 7] === line)
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  if (args.includes("--help")) {
    console.log([
      "usage:",
      "  bun .agents/skills/run-bounded-mission/scripts/wait-pr-codex-review.ts --repo <owner/name> --request-locator <node-id> --request-author <login> <pr-number>",
      "  bun .agents/skills/run-bounded-mission/scripts/wait-pr-codex-review.ts --render-request <head-oid>",
      "  bun .agents/skills/run-bounded-mission/scripts/wait-pr-codex-review.ts --validate-request <head-oid> < request-body",
    ].join("\n"))
    return 0
  }
  if (args[0] === "--render-request") {
    if (args.length !== 2) {
      console.error("codex-review: failed: expected --render-request and one full lowercase 40-hex head")
      return 2
    }
    try {
      process.stdout.write(renderCodexReviewRequest(args[1]!))
      return 0
    } catch (error) {
      console.error(`codex-review: failed: ${error instanceof Error ? error.message : "invalid head"}`)
      return 2
    }
  }
  if (args[0] === "--validate-request") {
    if (args.length !== 2) {
      console.error("codex-review: failed: expected --validate-request and one full lowercase 40-hex head")
      return 2
    }
    try {
      const validation = validateCodexReviewRequest(await Bun.stdin.text(), args[1]!)
      process.stdout.write(`${JSON.stringify(validation)}\n`)
      return validation.classification === "valid" ? 0 : 1
    } catch (error) {
      console.error(`codex-review: failed: ${error instanceof Error ? error.message : "invalid head"}`)
      return 2
    }
  }
  const repoIndex = args.indexOf("--repo")
  const locatorIndex = args.indexOf("--request-locator")
  const authorIndex = args.indexOf("--request-author")
  const repositoryArgument = repoIndex >= 0 ? args[repoIndex + 1] : undefined
  const locatorArgument = locatorIndex >= 0 ? args[locatorIndex + 1] : undefined
  const authorArgument = authorIndex >= 0 ? args[authorIndex + 1] : undefined
  const consumedIndexes = new Set([
    repoIndex, repoIndex + 1,
    locatorIndex, locatorIndex + 1,
    authorIndex, authorIndex + 1,
  ])
  const positional = args.filter((_, index) => !consumedIndexes.has(index))
  const numberToken = positional[0]
  const number = typeof numberToken === "string" && /^[1-9]\d*$/.test(numberToken)
    ? Number(numberToken)
    : Number.NaN
  let repository: string
  let expectation: ReviewRequestExpectation
  try {
    repository = normalizeRepository(repositoryArgument ?? "")
    expectation = normalizeRequestExpectation(locatorArgument ?? "", authorArgument ?? "")
  } catch {
    console.error("codex-review: failed: repository, request locator, or request author is invalid")
    return 2
  }
  if (args.filter((arg) => arg === "--repo").length !== 1
    || args.filter((arg) => arg === "--request-locator").length !== 1
    || args.filter((arg) => arg === "--request-author").length !== 1
    || positional.length !== 1
    || !Number.isSafeInteger(number)) {
    console.error("codex-review: failed: expected repository, request locator/author, and one positive PR number")
    return 2
  }

  try {
    const snapshot = await fetchSnapshot(repository, number)
    const decision = classifyCodexReview(snapshot, expectation)
    writeOutput({
      schema: RECEIPT_SCHEMA,
      repository,
      pull_request: number,
      head_oid: snapshot.headRefOid,
      status: decision.status,
      reason: decision.reason,
      request: decision.request,
      discovery: decision.discovery,
    })
    return decision.exitCode
  } catch (error) {
    writeOutput({
      schema: RECEIPT_SCHEMA,
      repository,
      pull_request: number,
      head_oid: error instanceof ReviewSnapshotError ? error.headOid : null,
      status: "failed",
      reason: error instanceof Error ? error.message : "unexpected provider failure",
      request: emptyRequest("incomplete", expectation),
      discovery: {
        status: "waiting",
        reviewed_head: null,
        provider_review: null,
        clean_signal: null,
        progress_signal: null,
        findings: [],
        problems: ["snapshot-incomplete"],
      },
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
