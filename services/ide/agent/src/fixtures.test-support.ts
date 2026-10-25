// Mock models and a throwaway data directory for the tests.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";

export const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};
const stop = { unified: "stop", raw: "stop" } as const;
const calls = { unified: "tool-calls", raw: "tool_calls" } as const;

export const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], finishReason: stop, usage, warnings: [] });
export const toolCall = (name: string, input: unknown) => ({
  content: [{ type: "tool-call" as const, toolCallId: `call-${name}`, toolName: name, input: JSON.stringify(input) }],
  finishReason: calls, usage, warnings: [],
});

/** A model whose successive generate calls return `results` in order. */
export const generating = (...results: (ReturnType<typeof text> | ReturnType<typeof toolCall>)[]) => new MockLanguageModelV4({ doGenerate: results as never });

/** A model whose first stream calls `tool` with `input` and whose second streams `answer`. */
export function streaming(tool: string, input: unknown, answer: string) {
  return new MockLanguageModelV4({
    doStream: [
      { stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        { type: "tool-call", toolCallId: "call-1", toolName: tool, input: JSON.stringify(input) },
        { type: "finish", finishReason: calls, usage },
      ]) },
      { stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: answer },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: stop, usage },
      ]) },
    ] as never,
  });
}

export const dataDir = () => mkdtempSync(join(tmpdir(), "trade-ide-agent-test-"));
