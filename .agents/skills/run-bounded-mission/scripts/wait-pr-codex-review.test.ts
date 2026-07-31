import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  classifyCodexReview,
  type CodexReviewSnapshot,
  type ReviewSignal,
} from "./wait-pr-codex-review"

const createdAt = "2026-07-31T10:00:00Z"
const bot = "chatgpt-codex-connector[bot]"
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("Codex opening review state", () => {
  test("no activity and eyes are pending", () => {
    expect(classifyCodexReview(fixture()).status).toBe("pending")
    expect(classifyCodexReview(fixture([
      reaction(bot, "2026-07-31T10:01:00Z", "EYES"),
    ])).status).toBe("pending")
  })

  test("a provider thumbs-up is clean completion", () => {
    expect(classifyCodexReview(fixture([
      reaction(bot, "2026-07-31T10:01:00Z", "THUMBS_UP"),
    ]))).toEqual({
      status: "passed",
      reason: "Codex opening review completed cleanly",
    })
  })

  test("a clean comment or approved review is clean completion", () => {
    expect(classifyCodexReview(fixture([
      comment(bot, "2026-07-31T10:01:00Z", "Didn't find any major issues."),
    ])).status).toBe("passed")
    expect(classifyCodexReview(fixture([
      review(bot, "2026-07-31T10:01:00Z", "", "APPROVED"),
    ])).status).toBe("passed")
  })

  test("usage failures and review findings fail", () => {
    expect(classifyCodexReview(fixture([
      comment(bot, "2026-07-31T10:01:00Z", "Usage limit reached. Try again later."),
    ])).status).toBe("failed")
    expect(classifyCodexReview(fixture([
      review(bot, "2026-07-31T10:01:00Z", "This path can merge before review completes.", "COMMENTED"),
    ])).status).toBe("failed")
    expect(classifyCodexReview(fixture([
      comment(bot, "2026-07-31T10:01:00Z", "Didn’t find any major issues here, but another path is unsafe."),
    ])).status).toBe("failed")
    expect(classifyCodexReview(fixture([
      review(bot, "2026-07-31T10:01:00Z", "Approved, but this path can still merge early.", "APPROVED"),
    ])).status).toBe("failed")
  })

  test("unresolved Codex review threads fail", () => {
    const snapshot = fixture()
    snapshot.threads.push({
      resolved: false,
      comments: [{ author: bot, at: "2026-07-31T10:01:00Z", body: "Wait for the terminal result." }],
    })

    expect(classifyCodexReview(snapshot)).toEqual({
      status: "failed",
      reason: "Codex returned an unresolved review finding",
    })
  })

  test("a new request or eyes signal invalidates an older clean terminal", () => {
    const oldThumb = reaction(bot, "2026-07-31T10:01:00Z", "THUMBS_UP")
    expect(classifyCodexReview(fixture([
      oldThumb,
      comment("maintainer", "2026-07-31T10:02:00Z", "@codex review"),
    ])).status).toBe("pending")
    expect(classifyCodexReview(fixture([
      oldThumb,
      reaction(bot, "2026-07-31T10:02:00Z", "EYES"),
    ])).status).toBe("pending")
  })

  test("same-second and unrelated terminals do not satisfy a new request", () => {
    const request = comment("maintainer", "2026-07-31T10:01:00Z", "@codex review", "comment:request")
    expect(classifyCodexReview(fixture([
      reaction(bot, "2026-07-31T10:01:00Z", "THUMBS_UP"),
      request,
    ])).status).toBe("pending")
    expect(classifyCodexReview(fixture([
      request,
      reaction(bot, "2026-07-31T10:02:00Z", "THUMBS_UP", "comment:other"),
    ])).status).toBe("pending")
    expect(classifyCodexReview(fixture([
      request,
      reaction(bot, "2026-07-31T10:02:00Z", "THUMBS_UP"),
    ])).status).toBe("pending")
    expect(classifyCodexReview(fixture([
      request,
      reaction(bot, "2026-07-31T10:02:00Z", "THUMBS_UP", "comment:request"),
    ])).status).toBe("passed")
  })

  test("an edited clean comment cannot become terminal evidence", () => {
    const edited = comment(bot, "2026-07-31T10:00:30Z", "Didn't find any major issues.")
    edited.updatedAt = "2026-07-31T10:02:00Z"
    expect(classifyCodexReview(fixture([
      edited,
      comment("maintainer", "2026-07-31T10:01:00Z", "@codex review", "comment:request"),
    ])).status).toBe("failed")
  })

  test("a later clean attempt cannot hide an earlier finding", () => {
    const signals = [
      review(bot, "2026-07-31T10:01:00Z", "This path can merge before review completes.", "COMMENTED"),
      comment("maintainer", "2026-07-31T10:02:00Z", "@codex review", "comment:request"),
      reaction(bot, "2026-07-31T10:03:00Z", "THUMBS_UP", "comment:request"),
    ]
    expect(classifyCodexReview(fixture(signals)).status).toBe("failed")

    const resolvedThread = fixture(signals.slice(1))
    resolvedThread.threads.push({
      resolved: true,
      comments: [{ author: bot, at: "2026-07-31T10:01:00Z", body: "The merge can race review." }],
    })
    expect(classifyCodexReview(resolvedThread).status).toBe("failed")
  })

  test("a Codex reply does not turn a maintainer thread into a Codex finding", () => {
    const snapshot = fixture([
      reaction(bot, "2026-07-31T10:03:00Z", "THUMBS_UP"),
    ])
    snapshot.threads.push({
      resolved: true,
      comments: [
        { author: "maintainer", at: "2026-07-31T10:01:00Z", body: "Can this be simpler?" },
        { author: bot, at: "2026-07-31T10:02:00Z", body: "Yes." },
      ],
    })
    expect(classifyCodexReview(snapshot).status).toBe("passed")
  })

  test("truncated evidence and non-open PRs fail closed", () => {
    const truncated = fixture()
    truncated.complete = false
    expect(classifyCodexReview(truncated).status).toBe("failed")

    const merged = fixture()
    merged.state = "MERGED"
    expect(classifyCodexReview(merged).status).toBe("failed")
  })

  test("a single invocation exposes pending, clean, and finding exit codes", () => {
    expect(runCli(reactionNode("EYES")).exitCode).toBe(10)
    expect(runCli(reactionNode("THUMBS_UP")).exitCode).toBe(0)
    expect(runCli(undefined, { reviewBody: "This can merge before review completes." }).exitCode).toBe(1)
  })

  test("output binds the normalized repository, PR, head, and classification", () => {
    const result = runCli(reactionNode("THUMBS_UP"), { repository: "Owner/Repo", number: 42 })
    expect(JSON.parse(result.stdout.toString())).toEqual({
      repository: "owner/repo",
      pull_request: 42,
      head_oid: "0123456789abcdef0123456789abcdef01234567",
      status: "passed",
      reason: "Codex opening review completed cleanly",
    })
  })

  test("an explicit repository cannot be replaced by a different checkout", () => {
    const checkout = mkdtempSync(join(tmpdir(), "trade-other-checkout-"))
    temporaryRoots.push(checkout)
    Bun.spawnSync(["git", "init", "-q", checkout])
    const result = runCli(reactionNode("EYES"), { cwd: checkout, repository: "Target/Repo", number: 17 })
    const calls = readFileSync(result.calls, "utf8")

    expect(result.exitCode).toBe(10)
    expect(calls).toContain("owner=target")
    expect(calls).toContain("name=repo")
    expect(calls).toContain("number=17")
    expect(calls).not.toContain("repo view")
    expect(JSON.parse(result.stdout.toString()).repository).toBe("target/repo")
  })

  test("missing and invalid repository arguments fail before querying GitHub", () => {
    const missing = runCli(reactionNode("EYES"), { arguments: ["1"] })
    expect(missing.exitCode).toBe(2)
    expect(missing.stderr.toString()).toBe("codex-review: failed: repository must be owner/name\n")
    expect(readFileSync(missing.calls, "utf8")).toBe("")

    const invalid = runCli(reactionNode("EYES"), { arguments: ["--repo", "owner/repo/extra", "1"] })
    expect(invalid.exitCode).toBe(2)
    expect(invalid.stderr.toString()).toBe("codex-review: failed: repository must be owner/name\n")
    expect(readFileSync(invalid.calls, "utf8")).toBe("")
  })

  test("non-canonical or unsafe PR tokens fail before querying GitHub", () => {
    const invalidArguments = [
      ["--repo", "owner/repo", "1e3"],
      ["--repo", "owner/repo", "01"],
      ["--repo", "owner/repo", " 1"],
      ["--repo", "owner/repo", "0"],
      ["--repo", "owner/repo", "-1"],
      ["--repo", "owner/repo", "9007199254740992"],
      ["1", "--once"],
    ]
    for (const arguments_ of invalidArguments) {
      const result = runCli(reactionNode("EYES"), { arguments: arguments_ })
      expect(result.exitCode, arguments_.join(" ")).toBe(2)
      const expectedError = arguments_.includes("--once")
        ? "codex-review: failed: repository must be owner/name\n"
        : "codex-review: failed: expected --repo <owner/name> and one positive PR number\n"
      expect(result.stderr.toString(), arguments_.join(" "))
        .toBe(expectedError)
      expect(readFileSync(result.calls, "utf8"), arguments_.join(" ")).toBe("")
    }
  })

  test("wrong repository and malformed provider output fail closed", () => {
    const wrongRepository = runCli(reactionNode("EYES"), { responseRepository: "other/repo" })
    expect(wrongRepository.exitCode).toBe(1)
    expect(JSON.parse(wrongRepository.stderr.toString())).toEqual({
      repository: "owner/repo",
      pull_request: 1,
      head_oid: null,
      status: "failed",
      reason: "GitHub returned a different repository",
    })

    const malformed = runCli(reactionNode("EYES"), { rawResponse: "not json" })
    expect(malformed.exitCode).toBe(1)
    expect(JSON.parse(malformed.stderr.toString()).reason).toBe("GitHub returned invalid JSON")

    const malformedPullRequest = runCli(null, { pullRequest: { state: "OPEN" } })
    expect(malformedPullRequest.exitCode).toBe(1)
    expect(JSON.parse(malformedPullRequest.stderr.toString()).reason)
      .toBe("GitHub returned malformed pull request data")

    const wrongNumber = runCli(null, { pullRequest: pullRequestFixture(undefined, { number: 2 }) })
    expect(wrongNumber.exitCode).toBe(1)
    expect(JSON.parse(wrongNumber.stderr.toString()).reason)
      .toBe("GitHub returned a different pull request")

    const invalidErrors = runCli(reactionNode("EYES"), { errors: { message: "partial failure" } })
    expect(invalidErrors.exitCode).toBe(1)
    expect(JSON.parse(invalidErrors.stderr.toString()).reason)
      .toBe("GitHub returned malformed response")

    const partialErrors = runCli(reactionNode("THUMBS_UP"), { errors: [{ message: "partial failure" }] })
    expect(partialErrors.exitCode).toBe(1)
    expect(JSON.parse(partialErrors.stderr.toString()).reason)
      .toBe("GitHub query returned errors")
  })

  test("malformed timestamps fail closed before review classification", () => {
    const badTimestamp = "not-a-time"
    const invalidPullRequests = [
      pullRequestFixture(reactionNode("THUMBS_UP"), { createdAt: badTimestamp }),
      pullRequestFixture({ ...reactionNode("THUMBS_UP"), createdAt: badTimestamp }),
      pullRequestFixture(undefined, {
        comments: connection([commentNode({ createdAt: badTimestamp })]),
      }),
      pullRequestFixture(undefined, {
        comments: connection([commentNode({ updatedAt: badTimestamp })]),
      }),
      pullRequestFixture(undefined, {
        comments: connection([commentNode({
          reactions: connection([{ ...reactionNode("THUMBS_UP"), createdAt: badTimestamp }]),
        })]),
      }),
      pullRequestFixture(undefined, {
        reviews: connection([reviewNode({ createdAt: badTimestamp })]),
      }),
      pullRequestFixture(undefined, {
        reviews: connection([reviewNode({ submittedAt: badTimestamp })]),
      }),
      pullRequestFixture(undefined, {
        reviewThreads: connection([threadNode(badTimestamp)]),
      }),
    ]

    for (const pullRequest of invalidPullRequests) {
      const result = runCli(null, { pullRequest })
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stderr.toString()).reason)
        .toBe("GitHub returned malformed pull request data")
    }
  })

  test("RFC3339 offsets are compared by epoch instead of source text", () => {
    const pullRequest = pullRequestFixture(reactionNode("THUMBS_UP"), {
      createdAt: "2026-07-31T12:00:00+02:00",
    })
    const result = runCli(null, { pullRequest })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout.toString()).status).toBe("passed")
  })

  test("every paginated evidence connection fails closed", () => {
    const paginatedPullRequests = [
      pullRequestFixture(undefined, { reactions: connection([], true) }),
      pullRequestFixture(undefined, { comments: connection([], true) }),
      pullRequestFixture(undefined, {
        comments: connection([commentNode({ reactions: connection([], true) })]),
      }),
      pullRequestFixture(undefined, { reviews: connection([], true) }),
      pullRequestFixture(undefined, { reviewThreads: connection([], true) }),
      pullRequestFixture(undefined, {
        reviewThreads: connection([{
          isResolved: false,
          comments: connection([{ author: { login: bot }, body: "Finding", updatedAt: createdAt }], true),
        }]),
      }),
    ]

    for (const pullRequest of paginatedPullRequests) {
      const result = runCli(null, { pullRequest })
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stderr.toString()).reason)
        .toBe("GitHub response exceeded the supported 100-item window")
    }
  })
})

function fixture(signals: ReviewSignal[] = []): CodexReviewSnapshot {
  return {
    state: "OPEN",
    headRefOid: "0123456789abcdef0123456789abcdef01234567",
    createdAt,
    complete: true,
    signals,
    threads: [],
  }
}

function reaction(author: string, at: string, value: string, target = "pull-request"): ReviewSignal {
  return { author, at, kind: "reaction", target, reaction: value }
}

function comment(author: string, at: string, body: string, target = "comment:1"): ReviewSignal {
  return { author, at, kind: "comment", target, body }
}

function review(author: string, at: string, body: string, reviewState: string): ReviewSignal {
  return { author, at, kind: "review", target: "review", body, reviewState }
}

function reactionNode(content: string): object {
  return {
    content,
    createdAt: "2026-07-31T10:01:00Z",
    user: { login: bot },
  }
}

function commentNode(overrides: Record<string, unknown> = {}): object {
  return {
    id: "comment-1",
    author: { login: "maintainer" },
    body: "@codex review",
    createdAt,
    updatedAt: createdAt,
    reactions: connection([]),
    ...overrides,
  }
}

function reviewNode(overrides: Record<string, unknown> = {}): object {
  return {
    author: { login: bot },
    body: "Didn't find any major issues.",
    state: "APPROVED",
    createdAt,
    submittedAt: createdAt,
    ...overrides,
  }
}

function threadNode(updatedAt: string): object {
  return {
    isResolved: false,
    comments: connection([{ author: { login: bot }, body: "Finding", updatedAt }]),
  }
}

function pullRequestFixture(reaction?: object, overrides: Record<string, unknown> = {}): object {
  return {
    number: 1,
    state: "OPEN",
    headRefOid: "0123456789abcdef0123456789abcdef01234567",
    createdAt,
    reactions: connection(reaction ? [reaction] : []),
    comments: connection([]),
    reviews: connection([]),
    reviewThreads: connection([]),
    ...overrides,
  }
}

interface CliOptions {
  arguments?: string[]
  cwd?: string
  errors?: unknown
  number?: number
  rawResponse?: string
  repository?: string
  responseRepository?: string
  reviewBody?: string
  pullRequest?: object
}

function runCli(node?: object | null, options: CliOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "trade-codex-review-"))
  temporaryRoots.push(root)
  const gh = join(root, "gh")
  const calls = join(root, "calls")
  writeFileSync(calls, "")
  writeFileSync(gh, `#!/bin/sh
printf '%s\\n' "$*" >> "$GH_CALLS"
printf '%s' "$GH_RESPONSE"
`)
  chmodSync(gh, 0o755)
  const response = {
    errors: options.errors,
    data: {
      repository: {
        nameWithOwner: options.responseRepository ?? options.repository ?? "owner/repo",
        pullRequest: options.pullRequest ?? pullRequestFixture(node ?? undefined, {
          number: options.number ?? 1,
          reviews: connection(options.reviewBody
            ? [{ author: { login: bot }, body: options.reviewBody, state: "COMMENTED", createdAt, submittedAt: createdAt }]
            : []),
        }),
      },
    },
  }
  const cliArguments = options.arguments
    ?? ["--repo", options.repository ?? "owner/repo", String(options.number ?? 1)]
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "wait-pr-codex-review.ts"), ...cliArguments], {
    cwd: options.cwd,
    env: {
      ...process.env,
      GH_CALLS: calls,
      GH_RESPONSE: options.rawResponse ?? JSON.stringify(response),
      PATH: `${root}:${process.env.PATH ?? ""}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  if (!result.stdout || !result.stderr) throw new Error("CLI fixture requires piped output")
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, calls }
}

function connection(nodes: object[], hasNextPage = false): object {
  return { nodes, pageInfo: { hasNextPage } }
}
