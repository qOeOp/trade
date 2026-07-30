import { closeSync, fstatSync, openSync, readSync } from "node:fs";

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

type MissionBoundary = {
  endpoint: string;
  origin: string;
};

type LifecycleEvent =
  | { kind: "active"; boundary: MissionBoundary }
  | { kind: "handoff"; boundary: MissionBoundary }
  | { kind: "invalid-handoff" };

type MessageLifecycle = {
  events: LifecycleEvent[];
  handoffCount: number;
};

type PendingHandoff =
  | { kind: "valid"; boundary: MissionBoundary }
  | { kind: "invalid" };

const ACTIVE_MARKER = "Mission-Terminal:";
const HANDOFF_MARKER = "Mission-Handoff:";
const START_MARKER = "Mission-Start:";
const TRANSCRIPT_CHUNK_BYTES = 64 * 1024;

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isImmutableIdentity(identity: string): boolean {
  return (
    identity === "none" ||
    /^sha256:[0-9a-f]{64}$/.test(identity) ||
    /^git:(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(identity)
  );
}

function parseBoundary(
  record: Record<string, unknown> | null,
): MissionBoundary | null {
  if (!record) {
    return null;
  }

  const endpoint = readString(record.endpoint);
  const origin = readString(record.origin);
  return endpoint && isImmutableIdentity(origin) ? { endpoint, origin } : null;
}

function parseStart(record: Record<string, unknown> | null): MissionBoundary | null {
  const boundary = parseBoundary(record);
  return boundary && readString(record?.stop) ? boundary : null;
}

function parseActive(record: Record<string, unknown> | null): MissionBoundary | null {
  const boundary = parseBoundary(record);
  return boundary && record?.status === "active" ? boundary : null;
}

function parseHandoff(
  record: Record<string, unknown> | null,
): MissionBoundary | null {
  const boundary = parseBoundary(record);
  if (!record || !boundary) {
    return null;
  }

  const candidate = readString(record.candidate);
  const acceptance = readString(record.acceptance);
  const cleanup = readString(record.cleanup);
  const route = readString(record.route);

  if (
    !isImmutableIdentity(candidate) ||
    !Array.isArray(record.effects) ||
    !["complete", "preserved"].includes(cleanup)
  ) {
    return null;
  }

  const dispositionMatches =
    (acceptance === "passed" && route === "accept") ||
    (acceptance === "blocked" && route === "blocked");
  return dispositionMatches ? boundary : null;
}

function lifecycleForMessage(message: string): MessageLifecycle {
  const events: LifecycleEvent[] = [];
  let handoffCount = 0;
  let fence: "```" | "~~~" | null = null;

  for (const originalLine of message.split(/\r?\n/)) {
    const line = originalLine.trimEnd();
    const fenceMatch = line.match(/^(```|~~~)/);
    if (fenceMatch) {
      const delimiter = fenceMatch[1] as "```" | "~~~";
      fence = fence === delimiter ? null : fence ?? delimiter;
      continue;
    }
    if (fence) {
      continue;
    }

    if (line.startsWith(`${START_MARKER} `)) {
      const boundary = parseStart(
        parseObject(line.slice(START_MARKER.length).trim()),
      );
      if (boundary) {
        events.push({ kind: "active", boundary });
      }
      continue;
    }

    if (line.startsWith(`${ACTIVE_MARKER} `)) {
      const boundary = parseActive(
        parseObject(line.slice(ACTIVE_MARKER.length).trim()),
      );
      if (boundary) {
        events.push({ kind: "active", boundary });
      }
      continue;
    }

    if (line.startsWith(`${HANDOFF_MARKER} `)) {
      handoffCount += 1;
      const boundary = parseHandoff(
        parseObject(line.slice(HANDOFF_MARKER.length).trim()),
      );
      events.push(
        boundary
          ? { kind: "handoff", boundary }
          : { kind: "invalid-handoff" },
      );
    }
  }

  const envelope = parseObject(message.trim());
  if (envelope && Object.hasOwn(envelope, "mission_handoff")) {
    handoffCount += 1;
    const value = envelope.mission_handoff;
    const record =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    const boundary = parseHandoff(record);
    events.push(
      boundary ? { kind: "handoff", boundary } : { kind: "invalid-handoff" },
    );
  }

  return { events, handoffCount };
}

function* readLinesNewestFirst(path: string): Generator<string> {
  const descriptor = openSync(path, "r");
  try {
    let position = fstatSync(descriptor).size;
    let suffix = Buffer.alloc(0);

    while (position > 0) {
      const length = Math.min(position, TRANSCRIPT_CHUNK_BYTES);
      position -= length;
      const chunk = Buffer.allocUnsafe(length);
      const bytesRead = readSync(descriptor, chunk, 0, length, position);
      const combined = Buffer.concat([chunk.subarray(0, bytesRead), suffix]);
      let end = combined.length;

      for (let index = combined.length - 1; index >= 0; index -= 1) {
        if (combined[index] !== 0x0a) {
          continue;
        }
        if (index + 1 < end) {
          yield combined.subarray(index + 1, end).toString("utf8");
        }
        end = index;
      }
      suffix = combined.subarray(0, end);
    }

    if (suffix.length > 0) {
      yield suffix.toString("utf8");
    }
  } finally {
    closeSync(descriptor);
  }
}

function assistantMessageFromTranscriptLine(line: string): string {
  const entry = parseObject(line);
  const payload =
    entry?.payload !== null &&
    typeof entry?.payload === "object" &&
    !Array.isArray(entry.payload)
      ? (entry.payload as Record<string, unknown>)
      : null;

  if (
    entry?.type !== "response_item" ||
    payload?.type !== "message" ||
    payload.role !== "assistant" ||
    !Array.isArray(payload.content)
  ) {
    return "";
  }

  return payload.content
    .flatMap((content) => {
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
    })
    .join("");
}

function* readAssistantMessagesNewestFirst(path: string): Generator<string> {
  if (!path) {
    return;
  }

  try {
    for (const line of readLinesNewestFirst(path)) {
      const message = assistantMessageFromTranscriptLine(line);
      if (message) {
        yield message;
      }
    }
  } catch {
    return;
  }
}

function sameBoundary(
  left: MissionBoundary,
  right: MissionBoundary,
): boolean {
  return left.endpoint === right.endpoint && left.origin === right.origin;
}

function missionState(
  input: StopHookInput,
  transcriptMessages?: Iterable<string>,
): "inactive" | "active" | "closed" {
  const lastMessage = readString(input.last_assistant_message);
  const history =
    transcriptMessages ??
    readAssistantMessagesNewestFirst(readString(input.transcript_path));
  const messages = (function* newestMessages(): Generator<string> {
    if (lastMessage) {
      yield lastMessage;
    }
    yield* history;
  })();
  let skippedCurrentDuplicate = false;
  let firstMessage = true;
  let pendingHandoff: PendingHandoff | null = null;

  for (const message of messages) {
    if (
      !firstMessage &&
      lastMessage &&
      message === lastMessage &&
      !skippedCurrentDuplicate
    ) {
      skippedCurrentDuplicate = true;
      continue;
    }
    firstMessage = false;

    const lifecycle = lifecycleForMessage(message);
    if (lifecycle.handoffCount > 1) {
      return "active";
    }

    for (const event of lifecycle.events.toReversed()) {
      if (!pendingHandoff) {
        if (event.kind === "active") {
          return "active";
        }
        pendingHandoff =
          event.kind === "handoff"
            ? { kind: "valid", boundary: event.boundary }
            : { kind: "invalid" };
        continue;
      }

      if (event.kind !== "active") {
        pendingHandoff = { kind: "invalid" };
        continue;
      }
      return pendingHandoff.kind === "valid" &&
        sameBoundary(event.boundary, pendingHandoff.boundary)
        ? "closed"
        : "active";
    }
  }

  return "inactive";
}

export function evaluateMissionStop(
  input: StopHookInput,
  transcriptMessagesNewestFirst?: Iterable<string>,
): StopHookOutput {
  const state = missionState(input, transcriptMessagesNewestFirst);
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
      "The bounded mission is still active. Complete the separate Handoff stage, update its plan item, and end with one valid Mission-Handoff receipt.",
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
