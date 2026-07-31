import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

  test("--once exposes pending and clean exit codes", () => {
    expect(runCli(reactionNode("EYES")).exitCode).toBe(10)
    expect(runCli(reactionNode("THUMBS_UP")).exitCode).toBe(0)
  })
})

function fixture(signals: ReviewSignal[] = []): CodexReviewSnapshot {
  return {
    state: "OPEN",
    headRefOid: "0123456789abcdef",
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

function runCli(node: object): ReturnType<typeof Bun.spawnSync> {
  const root = mkdtempSync(join(tmpdir(), "trade-codex-review-"))
  temporaryRoots.push(root)
  const gh = join(root, "gh")
  writeFileSync(gh, `#!/bin/sh
if [ "$1" = repo ]; then
  printf '%s' '{"nameWithOwner":"owner/repo"}'
else
  printf '%s' "$GH_RESPONSE"
fi
`)
  chmodSync(gh, 0o755)
  const response = {
    data: {
      repository: {
        pullRequest: {
          state: "OPEN",
          headRefOid: "0123456789abcdef",
          createdAt,
          reactions: connection([node]),
          comments: connection([]),
          reviews: connection([]),
          reviewThreads: connection([]),
        },
      },
    },
  }
  return Bun.spawnSync([process.execPath, join(import.meta.dir, "wait-pr-codex-review.ts"), "1", "--once"], {
    env: { ...process.env, GH_RESPONSE: JSON.stringify(response), PATH: `${root}:${process.env.PATH ?? ""}` },
    stdout: "pipe",
    stderr: "pipe",
  })
}

function connection(nodes: object[]): object {
  return { nodes, pageInfo: { hasNextPage: false } }
}
