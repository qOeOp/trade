import { useRef, useState, type ReactNode } from "react";
import { Collapsible } from "radix-ui";
import { useAuiState, type ToolCallMessagePartProps } from "@assistant-ui/react";
import { Icon } from "../../icons/Icon";
import { useOverlayBars } from "../ScrollArea";
import { foldNames } from "./toolFold";

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

export function ToolCard({ toolName, result, status }: Pick<ToolCallMessagePartProps, "toolName" | "result" | "status">) {
  const [open, setOpen] = useState(false);
  const done = result as Output | undefined;
  const running = status.type === "running";
  const failed = status.type === "incomplete" || done?.ok === false;
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="rounded-control border border-line">
      <Collapsible.Trigger disabled={running}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-control px-3 py-1 text-left text-dense transition-colors hover:bg-row-hover active:bg-hover disabled:hover:bg-transparent">
        {/* 12px icons, as everywhere beside 12px text; the status icons take the wrench's place at the same size. */}
        <Icon name={running ? "untested" : failed ? "failed" : "tool"} size={12} tone={failed ? "fail" : "icon"} />
        <span className="shrink-0 font-mono text-fg">{toolName}</span>
        <span className="min-w-0 truncate font-mono text-fg-faint">{running ? "running…" : own(done?.command ?? "")}</span>
        {!running && <span className={`ml-auto grid text-icon transition-transform ${open ? "rotate-90" : ""}`}><Icon name="chevron-right" size={12} /></span>}
      </Collapsible.Trigger>
      <Collapsible.Content className="space-y-1 px-3 pb-2">
        <div className="font-mono text-small [overflow-wrap:anywhere] text-fg-muted">{done?.command}</div>
        {done?.truncated != null && (
          <div className="text-small text-fg-faint">The answer had {done.truncated.toLocaleString("en-US")} characters; the agent saw at most 20,000, below, with notes where lists were cut.</div>
        )}
        <Json output={done?.output} />
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

/** Consecutive calls that answered (toolFold.ts), folded into one line naming their tools; open, their cards. One
 *  call alone stays its card. */
export function ToolFold({ indices, children }: { indices: readonly number[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const names = useAuiState((s) => foldNames(indices.map((i) => {
    const part = s.message.parts[i];
    return part?.type === "tool-call" ? part.toolName : "";
  })));
  if (indices.length < 2) return children;
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="space-y-1">
      <Collapsible.Trigger
        className="flex w-full min-w-0 items-center gap-1.5 rounded-control border border-line px-3 py-1 text-left text-dense transition-colors hover:bg-row-hover active:bg-hover">
        <Icon name="tool" size={12} tone="icon" />
        <span className="shrink-0 text-fg">{indices.length} commands</span>
        <span className="min-w-0 truncate font-mono text-fg-faint">{names}</span>
        <span className={`ml-auto grid text-icon transition-transform ${open ? "rotate-90" : ""}`}><Icon name="chevron-right" size={12} /></span>
      </Collapsible.Trigger>
      <Collapsible.Content className="ml-3 space-y-1 border-l border-line pl-2">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
