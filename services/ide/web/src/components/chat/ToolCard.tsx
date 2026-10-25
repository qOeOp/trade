import { useRef, useState } from "react";
import { Collapsible } from "radix-ui";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { Icon } from "../../icons/Icon";
import { useOverlayBars } from "../ScrollArea";

// One product command the agent ran: its command line and whether it answered, folded; open, the
// JSON it returned, which is what every number in the answer must come from. Outlined, not filled,
// so the user's question stays the thread's only card.
type Output = { command?: string; ok?: boolean; output?: unknown; truncated?: number | null };
// The command's own arguments: without its noun and verb (the tool's name says them) and the profiles.
const own = (command: string) => command.split(" ").slice(2).filter((a) => !/^--(ledger|market)=/.test(a)).join(" ");

/** The output as indented JSON when it is JSON (a refusal arrives as its text), else the text. */
function readable(output: unknown): { text: string; json: boolean } {
  if (output === undefined) return { text: "", json: false };
  let value = output;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return { text: output as string, json: false }; }
  }
  return { text: JSON.stringify(value, null, 2), json: true };
}

function Json({ output }: { output: unknown }) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLPreElement>(null);
  useOverlayBars(host, viewport);
  const { text, json } = readable(output);
  // JSON keeps its lines and scrolls sideways as code does; cut text wraps without splitting words.
  return (
    <div ref={host} className="relative">
      <pre ref={viewport} className={`max-h-80 overflow-auto rounded-control bg-island-alt p-2 font-mono text-small ${json ? "whitespace-pre" : "whitespace-pre-wrap [overflow-wrap:anywhere]"}`}>{text}</pre>
    </div>
  );
}

export function ToolCard({ toolName, result, status }: ToolCallMessagePartProps) {
  const [open, setOpen] = useState(false);
  const done = result as Output | undefined;
  const running = status.type === "running";
  const failed = status.type === "incomplete" || done?.ok === false;
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="rounded-control border border-line">
      <Collapsible.Trigger disabled={running}
        className="flex w-full min-w-0 items-center gap-2 rounded-control px-3 py-1 text-left text-dense transition-colors hover:bg-row-hover active:bg-hover disabled:hover:bg-transparent">
        <Icon name={running ? "untested" : failed ? "failed" : "tool"} tone={failed ? "fail" : "icon"} />
        <span className="shrink-0 font-mono text-fg">{toolName}</span>
        <span className="min-w-0 truncate font-mono text-fg-faint">{running ? "running…" : own(done?.command ?? "")}</span>
        {!running && <span className={`ml-auto grid text-icon transition-transform ${open ? "rotate-90" : ""}`}><Icon name="chevron-right" /></span>}
      </Collapsible.Trigger>
      <Collapsible.Content className="space-y-1 px-3 pb-2">
        <div className="font-mono text-small [overflow-wrap:anywhere] text-fg-muted">{done?.command}</div>
        {done?.truncated != null && (
          <div className="text-small text-fg-faint">The agent saw the first 20,000 of {done.truncated.toLocaleString("en-US")} characters.</div>
        )}
        <Json output={done?.output} />
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
