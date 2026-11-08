import { useNow } from "../../components/hooks/useNow";
import { clockTime, dateTime, displayDay, timeFormatter, utcInstant, zoneOffset } from "../../lib/time";
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
  const zone = useTimeZone(), now = useNow(60_000);
  const [saved, setSaved] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    void agentApi<Saved[]>("/threads").then((list) => setSaved(new Map(list.map((t) => [t.id, t.updated]))), () => setSaved(new Map()));
  }, []);
  const chat = () => agentPane.set("chat");
  const stamp = (id: string) => {
    const ms = utcInstant(saved?.get(id));
    if (ms === null) return null;
    const label = displayDay(ms, zone) === displayDay(now, zone)
      ? `${clockTime(ms, zone)} ${zoneOffset(ms, zone)}` : timeFormatter(zone, { day: "numeric", month: "short" }).format(ms);
    return <time dateTime={new Date(ms).toISOString()} title={dateTime(ms, zone)}>{label}</time>;
  };
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
      <ThreadListPrimitive.Items>{() => <ThreadRow onOpen={chat} when={stamp} />}</ThreadListPrimitive.Items>
    </ThreadListPrimitive.Root>
  );
}
