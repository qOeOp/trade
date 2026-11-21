// Which tool calls of an answer fold into one line: every tool the agent has reads (ide/agent/src/tools.ts), so a
// run of calls that answered is folded, while a call still running or one that failed stays a card of its own.
type Part = { type: string; toolName?: string; result?: unknown; status: { type: string } };

/** The group path of `part` for MessagePrimitive.GroupedParts: "group-reads" for a call that answered. */
export const foldable = (part: Part): ["group-reads"] | null =>
  part.type === "tool-call" && part.status.type === "complete" && (part.result as { ok?: boolean } | undefined)?.ok !== false
    ? ["group-reads"] : null;

/** The folded line's names: each tool once, in the order first called, with how often when more than once. */
export function foldNames(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", ");
}
