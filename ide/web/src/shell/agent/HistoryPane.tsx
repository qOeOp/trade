import { dateTime, utcInstant } from "../../lib/time";
import { useTimeZone } from "../../state/timeZone";
import { useEffect, useState } from "react";
import { ThreadListPrimitive } from "@assistant-ui/react";
import { ThreadRow } from "../../components/chat/ThreadRow";
import { TextButton } from "../../components/TextButton";
import { agentApi } from "../../lib/agentApi";
import { agentPane, chatControl } from "../../state/agent";

// The saved threads, newest first; opening one returns to the chat. Each shows when it last changed:
// the time today, otherwise the day.
type Saved = { id: string; updated: string };
export function HistoryPane() {
  const zone = useTimeZone();
  const [saved, setSaved] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    void agentApi<Saved[]>("/threads").then((list) => setSaved(new Map(list.map((t) => [t.id, t.updated]))), () => setSaved(new Map()));
  }, []);
  const chat = () => agentPane.set("chat");
  if (saved?.size === 0) {
    return (
      <div className="space-y-2 p-6 text-center text-dense text-fg-muted">
        <p>No saved chats yet.</p>
        <TextButton onClick={() => { chatControl.get()?.newThread(); chat(); }}>New chat</TextButton>
      </div>
    );
  }
  return (
    <ThreadListPrimitive.Root className="space-y-0.5 p-1">
      <ThreadListPrimitive.Items>{() => <ThreadRow onOpen={chat} when={(id) => saved?.has(id) ? dateTime(utcInstant(saved.get(id)), zone, "minute") : null} />}</ThreadListPrimitive.Items>
    </ThreadListPrimitive.Root>
  );
}
