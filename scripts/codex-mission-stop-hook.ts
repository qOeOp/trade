import { readFileSync } from "node:fs";

type StopHookInput = {
  stop_hook_active?: unknown;
  last_assistant_message?: unknown;
  transcript_path?: unknown;
};

type StopHookOutput =
  | { continue: true }
  | { decision: "block"; reason: string }
  | {
      continue: false;
      stopReason: string;
      systemMessage: string;
    };

const ACTIVE_MARKER = "Mission-Terminal: active";
const HANDOFF_MARKER = "Mission-Handoff:";
const START_MARKER = "Mission-Start:";
const TERMINAL_ROUTE_PATTERN = /\bMission route:\s*(accept|blocked)\b/gi;

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseHandoffReceiptAt(
  message: string,
  markerIndex: number,
): Record<string, unknown> | null {
  if (markerIndex < 0) {
    return null;
  }

  const receiptLine = message
    .slice(markerIndex + HANDOFF_MARKER.length)
    .split(/\r?\n/, 1)[0]
    ?.trim();
  if (!receiptLine) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(receiptLine);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isImmutableCandidate(candidate: string): boolean {
  return (
    candidate === "none" ||
    /^sha256:[0-9a-f]{64}$/.test(candidate) ||
    /^git:(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(candidate)
  );
}

function isValidReceipt(receipt: Record<string, unknown> | null): boolean {
  if (!receipt) {
    return false;
  }

  const endpoint = readString(receipt.endpoint);
  const candidate = readString(receipt.candidate);
  const acceptance = readString(receipt.acceptance);
  const cleanup = readString(receipt.cleanup);
  const route = readString(receipt.route);
  const effects = receipt.effects;

  if (
    !endpoint ||
    !isImmutableCandidate(candidate) ||
    !Array.isArray(effects) ||
    effects.some((effect) => typeof effect !== "string") ||
    !["complete", "preserved"].includes(cleanup)
  ) {
    return false;
  }

  return (
    (acceptance === "passed" && route === "accept") ||
    (acceptance === "blocked" && route === "blocked")
  );
}

function readAssistantMessages(transcriptPath: string): string[] {
  if (!transcriptPath) {
    return [];
  }

  try {
    return readFileSync(transcriptPath, "utf8")
      .split(/\r?\n/)
      .flatMap((line) => {
        if (!line.trim()) {
          return [];
        }

        let entry: {
          type?: unknown;
          payload?: {
            type?: unknown;
            role?: unknown;
            content?: unknown;
          };
        };
        try {
          entry = JSON.parse(line) as typeof entry;
        } catch {
          return [];
        }

        const payload = entry.payload;
        if (
          entry.type !== "response_item" ||
          payload?.type !== "message" ||
          payload.role !== "assistant" ||
          !Array.isArray(payload.content)
        ) {
          return [];
        }
        return payload.content.flatMap((content) => {
          if (
            content !== null &&
            typeof content === "object" &&
            "type" in content &&
            content.type === "output_text" &&
            "text" in content &&
            typeof content.text === "string"
          ) {
            return [content.text];
          }
          return [];
        });
      });
  } catch {
    return [];
  }
}

type LifecycleMarker = {
  index: number;
  state: "active" | "closed";
};

function lifecycleMarkers(message: string): LifecycleMarker[] {
  const markers: LifecycleMarker[] = [];

  for (const marker of [START_MARKER, ACTIVE_MARKER]) {
    let index = message.indexOf(marker);
    while (index >= 0) {
      markers.push({ index, state: "active" });
      index = message.indexOf(marker, index + marker.length);
    }
  }

  for (const match of message.matchAll(TERMINAL_ROUTE_PATTERN)) {
    markers.push({ index: match.index, state: "active" });
  }

  let handoffIndex = message.indexOf(HANDOFF_MARKER);
  while (handoffIndex >= 0) {
    markers.push({
      index: handoffIndex,
      state: isValidReceipt(parseHandoffReceiptAt(message, handoffIndex))
        ? "closed"
        : "active",
    });
    handoffIndex = message.indexOf(
      HANDOFF_MARKER,
      handoffIndex + HANDOFF_MARKER.length,
    );
  }

  return markers.sort((left, right) => left.index - right.index);
}

function missionState(input: StopHookInput): "inactive" | "active" | "closed" {
  const messages = readAssistantMessages(readString(input.transcript_path));
  const lastMessage = readString(input.last_assistant_message);
  if (lastMessage && messages.at(-1) !== lastMessage) {
    messages.push(lastMessage);
  }

  let state: "inactive" | "active" | "closed" = "inactive";
  for (const message of messages) {
    for (const marker of lifecycleMarkers(message)) {
      state = marker.state;
    }
  }
  return state;
}

export function evaluateMissionStop(input: StopHookInput): StopHookOutput {
  const state = missionState(input);
  if (state === "closed" || state === "inactive") {
    return { continue: true };
  }

  if (input.stop_hook_active === true) {
    return {
      continue: false,
      stopReason: "Bounded mission Handoff remained incomplete after one continuation.",
      systemMessage:
        "The bounded mission stopped without a valid Mission-Handoff receipt.",
    };
  }

  return {
    decision: "block",
    reason:
      "The bounded mission is still active. Complete the separate Handoff stage, update its plan item, and end with one valid Mission-Handoff JSON receipt.",
  };
}

async function main(): Promise<void> {
  let input: StopHookInput;
  try {
    input = JSON.parse(await Bun.stdin.text()) as StopHookInput;
  } catch {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  console.log(JSON.stringify(evaluateMissionStop(input)));
}

if (import.meta.main) {
  await main();
}
