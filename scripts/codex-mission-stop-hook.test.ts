import { describe, expect, test } from "bun:test";

import { evaluateMissionStop } from "./codex-mission-stop-hook";

const validReceipt =
  'Mission-Handoff: {"endpoint":"local-only","candidate":"sha256:abc","acceptance":"passed","effects":[],"cleanup":"complete","route":"accept"}';

describe("bounded mission Stop hook", () => {
  test("does not affect a normal turn", () => {
    expect(
      evaluateMissionStop({ last_assistant_message: "Done." }),
    ).toEqual({ continue: true });
  });

  test("continues an active mission that omitted Handoff", () => {
    expect(
      evaluateMissionStop(
        { last_assistant_message: "Work remains.\nMission-Terminal: active" },
      ),
    ).toEqual({
      decision: "block",
      reason:
        "The bounded mission is still active. Complete the separate Handoff stage, update its plan item, and end with one valid Mission-Handoff JSON receipt.",
    });
  });

  test("accepts a valid terminal Handoff receipt", () => {
    expect(
      evaluateMissionStop(
        { last_assistant_message: `Completed.\n${validReceipt}` },
      ),
    ).toEqual({ continue: true });
  });

  test("rejects malformed or inconsistent receipts", () => {
    const malformed =
      'Mission-Terminal: active\nMission-Handoff: {"endpoint":"local-only","candidate":"abc","acceptance":"blocked","effects":[],"cleanup":"complete","route":"accept"}';
    expect(
      evaluateMissionStop({ last_assistant_message: malformed }),
    ).toMatchObject({ decision: "block" });
  });

  test("a terminal route claim without a receipt remains active", () => {
    expect(
      evaluateMissionStop({ last_assistant_message: "Mission route: accept" }),
    ).toMatchObject({ decision: "block" });
  });

  test("bounds continuation instead of looping forever", () => {
    expect(
      evaluateMissionStop(
        {
          stop_hook_active: true,
          last_assistant_message: "Still incomplete.\nMission-Terminal: active",
        },
      ),
    ).toEqual({
      continue: false,
      stopReason:
        "Bounded mission Handoff remained incomplete after one continuation.",
      systemMessage:
        "The bounded mission stopped without a valid Mission-Handoff receipt.",
    });
  });
});
