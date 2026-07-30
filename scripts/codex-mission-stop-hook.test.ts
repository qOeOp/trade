import { describe, expect, test } from "bun:test";

import { evaluateMissionStop } from "./codex-mission-stop-hook";

const origin = `git:${"b".repeat(40)}`;
const candidate = `sha256:${"a".repeat(64)}`;
const start = `Mission-Start: {"endpoint":"merged","origin":"${origin}","stop":"two revisions"}`;
const active = `Mission-Terminal: {"status":"active","endpoint":"merged","origin":"${origin}"}`;

function receipt(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    endpoint: "merged",
    origin,
    candidate,
    acceptance: "passed",
    effects: [],
    cleanup: "complete",
    route: "accept",
    ...overrides,
  };
}

function handoff(overrides: Record<string, unknown> = {}): string {
  return `Mission-Handoff: ${JSON.stringify(receipt(overrides))}`;
}

function evaluate(
  lastAssistantMessage: string,
  transcriptMessagesNewestFirst: string[] = [],
  stopHookActive = false,
) {
  return evaluateMissionStop(
    {
      last_assistant_message: lastAssistantMessage,
      stop_hook_active: stopHookActive,
    },
    transcriptMessagesNewestFirst,
  );
}

describe("bounded mission Stop hook", () => {
  test("does not affect a normal turn", () => {
    expect(evaluate("Done.")).toEqual({ continue: true });
  });

  test("continues an active mission that omitted Handoff", () => {
    expect(evaluate(`Work remains.\n${active}`)).toEqual({
      decision: "block",
      reason:
        "The bounded mission is still active. Complete the separate Handoff stage, update its plan item, and end with one valid Mission-Handoff receipt.",
    });
  });

  test("tracks an active mission across assistant messages", () => {
    expect(evaluate("Implemented and tested.", [start])).toMatchObject({
      decision: "block",
    });
  });

  test("accepts one receipt bound to the active mission", () => {
    expect(evaluate(`Completed.\n${handoff()}`, [start])).toEqual({
      continue: true,
    });
  });

  test("does not activate from a receipt without an active mission", () => {
    expect(evaluate(handoff())).toEqual({ continue: true });
  });

  test("rejects a receipt with a different endpoint", () => {
    expect(
      evaluate(handoff({ endpoint: "local-only" }), [start]),
    ).toMatchObject({ decision: "block" });
  });

  test("rejects a receipt with a different origin", () => {
    expect(
      evaluate(handoff({ origin: `git:${"c".repeat(40)}` }), [start]),
    ).toMatchObject({ decision: "block" });
  });

  test("does not accept a receipt followed by an active marker", () => {
    expect(evaluate(`${handoff()}\n${active}`, [start])).toMatchObject({
      decision: "block",
    });
  });

  test("does not activate from prose, a quote, or a fenced example", () => {
    const message = [
      "The label Mission-Start: is documented here.",
      `> ${start}`,
      "```text",
      start,
      "```",
    ].join("\n");
    expect(evaluate(message)).toEqual({ continue: true });
  });

  test("ignores malformed start and active labels", () => {
    expect(
      evaluate("Mission-Start: example only\nMission-Terminal: active"),
    ).toEqual({ continue: true });
  });

  test("rejects malformed or inconsistent receipts", () => {
    expect(
      evaluate(
        handoff({
          candidate: "abc",
          acceptance: "blocked",
          route: "accept",
        }),
        [start],
      ),
    ).toMatchObject({ decision: "block" });
  });

  test("accepts structured effect entries without inventing their schema", () => {
    expect(
      evaluate(
        handoff({
          effects: [{ kind: "pull-request", number: 38 }, "branch pushed"],
        }),
        [start],
      ),
    ).toEqual({ continue: true });
  });

  test("accepts a strict JSON output envelope", () => {
    const envelope = JSON.stringify({
      result: { status: "done" },
      mission_handoff: receipt(),
    });
    expect(evaluate(envelope, [start])).toEqual({ continue: true });
  });

  test("rejects multiple receipts in one response", () => {
    expect(evaluate(`${handoff()}\n${handoff()}`, [start])).toMatchObject({
      decision: "block",
    });
  });

  test("uses the nearest structured active boundary", () => {
    const oldStart = `Mission-Start: {"endpoint":"local-only","origin":"git:${"d".repeat(40)}","stop":"one revision"}`;
    expect(
      evaluate("Implemented.", [active, oldStart]),
    ).toMatchObject({ decision: "block" });
  });

  test("bounds continuation instead of looping forever", () => {
    expect(evaluate(`Still incomplete.\n${active}`, [], true)).toEqual({
      continue: false,
      stopReason:
        "Bounded mission Handoff remained incomplete after one continuation.",
      systemMessage:
        "The bounded mission stopped without a valid Mission-Handoff receipt.",
    });
  });
});
