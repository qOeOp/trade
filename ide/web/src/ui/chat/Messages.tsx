import { ActionBarPrimitive, ErrorPrimitive, MessagePrimitive, useAuiState } from "@assistant-ui/react";
import { PROVIDER_LABEL, type Provider } from "../../lib/agentApi";
import { BrandMark } from "../../icons/Icon";
import { IconButton } from "../IconButton";
import { Markdown } from "./Markdown";
import { ToolCard, ToolFold } from "./ToolCard";
import { foldable } from "./toolFold";

// The thread's messages as IntelliJ's AI Assistant draws them, without bubbles: the user's words on a
// card, the answer on the island under the name of the model that wrote it, its tool calls as cards
// (consecutive ones that answered folded into one line).
type Written = { agent?: string; provider?: Provider; model?: string };

export function UserMessage() {
  return (
    <MessagePrimitive.Root className="rounded-card border border-card-border bg-island-alt px-3 py-2 whitespace-pre-wrap break-words">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

// "model · agent", with the provider only when the agent's name does not already say it.
function WrittenBy() {
  const written = useAuiState((s) => s.message.metadata.custom) as Written | undefined;
  if (!written?.model) return null;
  const provider = written.provider ? PROVIDER_LABEL[written.provider] : null;
  const agent = provider && !written.agent?.startsWith(provider) ? `${written.agent} · ${provider}` : written.agent;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-small text-fg-faint">
      {written.provider && <span className="text-fg-muted"><BrandMark name={written.provider} size={12} /></span>}
      <span className="-ml-0.5 whitespace-nowrap text-fg-muted">{written.model}</span>
      {agent && <><span>·</span><span className="min-w-0 truncate">{agent}</span></>}
    </div>
  );
}

/** While the answer is being written: a faint word after its parts (still under reduced motion). */
function Writing() {
  const running = useAuiState((s) => s.message.status?.type === "running");
  return running ? <div className="text-small text-fg-faint motion-safe:animate-pulse">Writing…</div> : null;
}


export function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group space-y-2">
      <WrittenBy />
      <MessagePrimitive.GroupedParts groupBy={foldable} indicator="never">
        {({ part, children }) => {
          switch (part.type) {
            case "group-reads": return <ToolFold indices={part.indices}>{children}</ToolFold>;
            case "text": return <Markdown />;
            case "tool-call": return <ToolCard {...part} />;
            default: return null;
          }
        }}
      </MessagePrimitive.GroupedParts>
      <Writing />
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="rounded-card border border-card-border bg-island-alt px-3 py-2 text-dense text-fail-fg">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
      {/* The library shows the last answer's actions and the others' on hover. */}
      <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="-ml-1 flex gap-0.5">
        <ActionBarPrimitive.Copy asChild><IconButton icon="copy" label="Copy" /></ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload asChild><IconButton icon="retry" label="Answer again" /></ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}
