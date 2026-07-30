type StopHookInput = {
  stop_hook_active?: unknown;
  last_assistant_message?: unknown;
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

function parseHandoffReceipt(message: string): Record<string, unknown> | null {
  return parseHandoffReceiptAt(message, message.lastIndexOf(HANDOFF_MARKER));
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
    !candidate ||
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

export function evaluateMissionStop(input: StopHookInput): StopHookOutput {
  const lastMessage = readString(input.last_assistant_message);
  const claimsTerminalRoute = /\bMission route:\s*(accept|blocked)\b/i.test(lastMessage);

  if (isValidReceipt(parseHandoffReceipt(lastMessage))) {
    return { continue: true };
  }

  const missionActive =
    lastMessage.includes(ACTIVE_MARKER) || claimsTerminalRoute;
  if (!missionActive) {
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
  let input: StopHookInput = {};
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
