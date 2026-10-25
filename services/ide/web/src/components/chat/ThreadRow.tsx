import { ThreadListItemPrimitive, useAuiState } from "@assistant-ui/react";
import { IconButton } from "../IconButton";

// One saved thread in the history: its title opens it, the time it last changed tells threads with
// the same first question apart, and delete removes it from the chat service.
export function ThreadRow({ onOpen, when }: { onOpen: () => void; when: (remoteId: string) => string | null }) {
  const remoteId = useAuiState((s) => s.threadListItem.remoteId);
  const time = remoteId ? when(remoteId) : null;
  return (
    <ThreadListItemPrimitive.Root className="group flex h-6 items-center gap-2 rounded-control px-2 hover:bg-row-hover data-active:bg-selection-inactive">
      <ThreadListItemPrimitive.Trigger onClick={onOpen} className="min-w-0 flex-1 truncate text-left">
        <ThreadListItemPrimitive.Title fallback="New chat" />
      </ThreadListItemPrimitive.Trigger>
      {time && <span className="shrink-0 text-small text-fg-faint group-hover:hidden">{time}</span>}
      <ThreadListItemPrimitive.Delete asChild>
        <IconButton icon="delete" label="Delete chat" className="hidden group-hover:grid" />
      </ThreadListItemPrimitive.Delete>
    </ThreadListItemPrimitive.Root>
  );
}
