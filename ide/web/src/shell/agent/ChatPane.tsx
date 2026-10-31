import { useMemo } from "react";
import { ThreadPrimitive } from "@assistant-ui/react";
import { AssistantMessage, UserMessage } from "../../components/chat/Messages";
import { Composer } from "../../components/chat/Composer";
import { KnownVersions } from "../../components/chat/Markdown";
import { ModelPicker } from "../../components/chat/ModelPicker";
import { ThreadViewport } from "../../components/chat/ThreadViewport";
import { TextButton } from "../../components/TextButton";
import type { LineageWidget } from "../../model/types";
import { useWidget } from "../../model/view";
import { agentPane, chosen, currentChoice, modelOptions, useAgents, useChosen } from "../../state/agent";

// The open thread: its messages, scrolled to the newest while the user stays at the bottom, and the
// message box with the model picker. Without an active agent the box is disabled and the empty
// thread says how to add one.
export function ChatPane() {
  const list = useAgents();
  const choice = currentChoice(list, useChosen());
  const options = modelOptions(list);
  const lineage = useWidget<LineageWidget>("lineage@2");
  const versions = useMemo(() => new Set(lineage?.nodes.map((n) => n.id) ?? []), [lineage]);
  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <ThreadViewport>
        <ThreadPrimitive.Empty>
          <div className="m-auto max-w-[36ch] space-y-2 text-center text-dense text-fg-muted">
            {options.length ? <p>Ask about strategies, their runs, the line or the ledger.</p>
              : <><p>No agent is active yet.</p><TextButton className="text-fg" onClick={() => agentPane.set("settings")}>Add an agent</TextButton></>}
          </div>
        </ThreadPrimitive.Empty>
        <KnownVersions.Provider value={versions}>
          <ThreadPrimitive.Messages>
            {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage />)}
          </ThreadPrimitive.Messages>
        </KnownVersions.Provider>
      </ThreadViewport>
      <div className="shrink-0 px-3 pt-2 pb-3">
        <Composer disabled={!choice} model={<ModelPicker options={options} value={choice} onChange={(o) => chosen.set({ agent: o.agent, model: o.model })} />} />
      </div>
    </ThreadPrimitive.Root>
  );
}
