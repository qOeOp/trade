import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { evaluateMissionStop } from "./codex-mission-stop-hook";

const validReceipt =
  `Mission-Handoff: {"endpoint":"local-only","candidate":"sha256:${"a".repeat(64)}","acceptance":"passed","effects":[],"cleanup":"complete","route":"accept"}`;

function withTranscript(messages: string[], run: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "mission-stop-hook-"));
  const path = join(directory, "rollout.jsonl");
  const transcript = messages
    .map((text) =>
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        },
      }),
    )
    .join("\n");
  writeFileSync(path, transcript);
  try {
    run(path);
  } finally {
    rmSync(directory, { recursive: true });
  }
}

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

  test("tracks an active mission across assistant messages", () => {
    withTranscript(
      [
        "Mission-Start: endpoint=merged; origin=git:abc; stop=bounded",
        "Implemented and tested.",
      ],
      (transcriptPath) => {
        expect(
          evaluateMissionStop({
            transcript_path: transcriptPath,
            last_assistant_message: "Implemented and tested.",
          }),
        ).toMatchObject({ decision: "block" });
      },
    );
  });

  test("ignores an incomplete transcript line without losing prior state", () => {
    const directory = mkdtempSync(join(tmpdir(), "mission-stop-hook-"));
    const path = join(directory, "rollout.jsonl");
    writeFileSync(
      path,
      `${JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Mission-Start: endpoint=merged; origin=git:abc; stop=bounded",
            },
          ],
        },
      })}\n{"type":"response_item"`,
    );
    try {
      expect(
        evaluateMissionStop({
          transcript_path: path,
          last_assistant_message: "Implemented and tested.",
        }),
      ).toMatchObject({ decision: "block" });
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  test("accepts a valid terminal Handoff receipt", () => {
    expect(
      evaluateMissionStop(
        { last_assistant_message: `Completed.\n${validReceipt}` },
      ),
    ).toEqual({ continue: true });
  });

  test("does not accept a receipt followed by an active marker", () => {
    expect(
      evaluateMissionStop({
        last_assistant_message: `${validReceipt}\nMission-Terminal: active`,
      }),
    ).toMatchObject({ decision: "block" });
  });

  test("does not activate from non-assistant transcript content", () => {
    const directory = mkdtempSync(join(tmpdir(), "mission-stop-hook-"));
    const path = join(directory, "rollout.jsonl");
    writeFileSync(
      path,
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          output: "Mission-Start: example only",
        },
      }),
    );
    try {
      expect(
        evaluateMissionStop({
          transcript_path: path,
          last_assistant_message: "Done.",
        }),
      ).toEqual({ continue: true });
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  test("rejects malformed or inconsistent receipts", () => {
    const malformed =
      'Mission-Terminal: active\nMission-Handoff: {"endpoint":"local-only","candidate":"abc","acceptance":"blocked","effects":[],"cleanup":"complete","route":"accept"}';
    expect(
      evaluateMissionStop({ last_assistant_message: malformed }),
    ).toMatchObject({ decision: "block" });
  });

  test("rejects receipts without an immutable candidate", () => {
    const mutableCandidate =
      'Mission-Handoff: {"endpoint":"local-only","candidate":"abc","acceptance":"passed","effects":[],"cleanup":"complete","route":"accept"}';
    expect(
      evaluateMissionStop({
        last_assistant_message:
          `Mission-Start: endpoint=local-only\n${mutableCandidate}`,
      }),
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
