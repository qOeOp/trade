import { useEffect, useState } from "react";
import { ThreadListPrimitive } from "@assistant-ui/react";
import { ThreadRow } from "../../components/chat/ThreadRow";
import { TextButton } from "../../components/TextButton";
import { agentApi } from "../../lib/agentApi";
import { agentPane, chatControl } from "../../state/agent";

// The saved threads, newest first; opening one returns to the chat. Each shows when it last changed:
// the time today, otherwise the day.
type Saved = { id: string; updated: string };
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

function stamp(iso: string): string {
  const at = new Date(iso);
  return at.toDateString() === new Date().toDateString() ? TIME.format(at) : DAY.format(at);
}

export function HistoryPane() {
  const [saved, setSaved] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    void agentApi<Saved[]>("/threads").then((list) => setSaved(new Map(list.map((t) => [t.id, stamp(t.updated)]))), () => setSaved(new Map()));
  }, []);
  const chat = () => agentPane.set("chat");
  if (saved?.size === 0) {
    return (
      <div className="space-y-2 p-6 text-center text-dense text-fg-muted">
        <p>No saved chats yet.</p>
        <TextButton className="text-fg" onClick={() => { chatControl.get()?.newThread(); chat(); }}>New chat</TextButton>
      </div>
    );
  }
  return (
    <ThreadListPrimitive.Root className="space-y-0.5 p-1">
      <ThreadListPrimitive.Items>{() => <ThreadRow onOpen={chat} when={(id) => saved?.get(id) ?? null} />}</ThreadListPrimitive.Items>
    </ThreadListPrimitive.Root>
  );
}
