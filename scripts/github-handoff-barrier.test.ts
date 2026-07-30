import { describe, expect, test } from "bun:test";

import {
  inspectBarrier,
  mergeArguments,
  triggerBody,
  waitForBarrier,
  type ReviewBarrierSnapshot,
} from "./github-handoff-barrier";

const head = "a".repeat(40);
const base = "b".repeat(40);
const expectation = {
  repository: "owner/repo",
  pullRequest: 38,
  head,
  base,
  provider: "chatgpt-codex-connector",
  triggerActor: "owner",
};

function snapshot(
  overrides: Partial<ReviewBarrierSnapshot> = {},
): ReviewBarrierSnapshot {
  return {
    repository: expectation.repository,
    pullRequest: expectation.pullRequest,
    head,
    base,
    state: "OPEN",
    isDraft: false,
    mergedAt: null,
    autoMergeArmed: false,
    pageComplete: true,
    triggers: [
      {
        id: "trigger",
        login: expectation.triggerActor,
        body: triggerBody(head),
        createdAt: "2026-07-30T06:35:00Z",
        reactions: [],
      },
    ],
    reviews: [
      {
        id: "review",
        login: expectation.provider,
        state: "COMMENTED",
        submittedAt: "2026-07-30T06:36:02Z",
        commit: head,
      },
    ],
    threads: [],
    requiredChecks: [
      {
        name: "quality",
        state: "SUCCESS",
        bucket: "pass",
        workflow: "repository-quality",
      },
    ],
    ...overrides,
  };
}

describe("GitHub Handoff barrier", () => {
  test("requires a review bound to the exact head after the trigger", () => {
    expect(
      inspectBarrier(
        snapshot({
          reviews: [
            {
              ...snapshot().reviews[0]!,
              commit: "c".repeat(40),
            },
          ],
        }),
        expectation,
      ),
    ).toMatchObject({ status: "pending" });
  });

  test("does not trust an exact marker posted by another actor", () => {
    const current = snapshot();
    current.triggers[0]!.login = "another-user";
    expect(inspectBarrier(current, expectation)).toMatchObject({
      status: "pending",
      reason: "exact-head Codex review has not been triggered",
    });
  });

  test("accepts one uniquely correlated no-finding thumbs-up", () => {
    const current = snapshot({ reviews: [] });
    current.triggers[0]!.reactions.push({
      content: "THUMBS_UP",
      login: expectation.provider,
      createdAt: "2026-07-30T06:36:02Z",
    });
    expect(inspectBarrier(current, expectation)).toMatchObject({
      status: "ready",
    });
  });

  test("rejects ambiguous terminal signals", () => {
    const current = snapshot();
    current.triggers[0]!.reactions.push({
      content: "THUMBS_UP",
      login: expectation.provider,
      createdAt: "2026-07-30T06:36:03Z",
    });
    expect(inspectBarrier(current, expectation)).toMatchObject({
      status: "blocked",
      reason: "Codex review completion is ambiguous",
    });
  });

  test("blocks incomplete pagination and unresolved conversations", () => {
    expect(
      inspectBarrier(snapshot({ pageComplete: false }), expectation),
    ).toMatchObject({ status: "blocked" });
    expect(
      inspectBarrier(
        snapshot({
          threads: [
            {
              id: "late-thread",
              isResolved: false,
              isOutdated: false,
              comments: [],
            },
          ],
        }),
        expectation,
      ),
    ).toMatchObject({ status: "blocked" });
  });

  test("fails closed for missing, pending, or failing required checks", () => {
    expect(
      inspectBarrier(snapshot({ requiredChecks: [] }), expectation),
    ).toMatchObject({ status: "pending" });
    expect(
      inspectBarrier(
        snapshot({
          requiredChecks: [
            {
              name: "quality",
              state: "IN_PROGRESS",
              bucket: "pending",
              workflow: "repository-quality",
            },
          ],
        }),
        expectation,
      ),
    ).toMatchObject({ status: "pending" });
    expect(
      inspectBarrier(
        snapshot({
          requiredChecks: [
            {
              name: "quality",
              state: "FAILURE",
              bucket: "fail",
              workflow: "repository-quality",
            },
          ],
        }),
        expectation,
      ),
    ).toMatchObject({ status: "blocked" });
  });

  test("blocks head/base drift, drafts, and pre-armed auto-merge", () => {
    expect(
      inspectBarrier(snapshot({ head: "c".repeat(40) }), expectation),
    ).toMatchObject({ status: "blocked" });
    expect(
      inspectBarrier(snapshot({ base: "c".repeat(40) }), expectation),
    ).toMatchObject({ status: "blocked" });
    expect(
      inspectBarrier(snapshot({ isDraft: true }), expectation),
    ).toMatchObject({ status: "blocked" });
    expect(
      inspectBarrier(snapshot({ autoMergeArmed: true }), expectation),
    ).toMatchObject({ status: "blocked" });
  });

  test("replays the PR 38 review/thread publication race", async () => {
    let time = 0;
    let index = 0;
    const snapshots = [
      snapshot({ reviews: [] }),
      snapshot(),
      snapshot({
        threads: [
          {
            id: "late-thread",
            isResolved: false,
            isOutdated: false,
            comments: [
              {
                id: "late-comment",
                login: expectation.provider,
                createdAt: "2026-07-30T06:36:03Z",
              },
            ],
          },
        ],
      }),
    ];
    const decision = await waitForBarrier({
      expectation,
      load: () => snapshots[Math.min(index++, snapshots.length - 1)]!,
      settleMs: 2_000,
      timeoutMs: 10_000,
      pollMs: 1_000,
      now: () => time,
      sleep: async (milliseconds) => {
        time += milliseconds;
      },
    });
    expect(decision).toMatchObject({
      status: "blocked",
      reason: "1 review thread(s) remain unresolved",
    });
  });

  test("passes only after two stable observations span the settle window", async () => {
    let time = 0;
    let loads = 0;
    const decision = await waitForBarrier({
      expectation,
      load: () => {
        loads += 1;
        return snapshot();
      },
      settleMs: 2_000,
      timeoutMs: 10_000,
      pollMs: 1_000,
      now: () => time,
      sleep: async (milliseconds) => {
        time += milliseconds;
      },
    });
    expect(decision.status).toBe("ready");
    expect(loads).toBe(3);
  });

  test("builds only the guarded squash auto-merge command", () => {
    const args = mergeArguments(expectation);
    expect(args).toEqual([
      "pr",
      "merge",
      "--repo",
      "owner/repo",
      "--auto",
      "--squash",
      "--match-head-commit",
      head,
      "38",
    ]);
    expect(args).not.toContain("--admin");
  });
});
