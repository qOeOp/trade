import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { AssistantRuntimeProvider, RuntimeAdapterProvider, useAui, useRemoteThreadListRuntime,
  type RemoteThreadListAdapter, type ThreadHistoryAdapter } from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/ai-sdk";
import { createAssistantStream } from "assistant-stream";
import { agentApi } from "../../lib/agentApi";
import { useView } from "../../model/view";
import { agents, chatControl, chosen, currentChoice } from "../../state/agent";
import { selection } from "../../state/selection";

// The chat runtime for the whole page, so an answer keeps streaming while another tool window is
// open: assistant-ui's AI SDK runtime posting to /api/agent/chat, its threads and their messages kept
// by the chat service. Each request names the chosen agent and model and what the page shows.
type Meta = { id: string; title: string | null; status: "regular" | "archived" };
type Row = { id: string; parent_id: string | null; format: string; content: Record<string, unknown> };

function useHistory(): ThreadHistoryAdapter {
  const aui = useAui();
  return useMemo<ThreadHistoryAdapter>(() => ({
    async load() { return { messages: [] }; },  // unused on the AI SDK path, which goes through withFormat
    async append() {},
    withFormat: (fmt) => {
      const save = async (item: Parameters<typeof fmt.encode>[0]) => {
        const { remoteId } = await aui.threadListItem.initialize();
        await agentApi(`/threads/${remoteId}/messages`, { method: "POST", body: {
          id: fmt.getId(item.message), parent_id: item.parentId, format: fmt.format, content: fmt.encode(item) } });
      };
      return {
        async load() {
          const { remoteId } = aui.threadListItem.getState();
          if (!remoteId) return { messages: [] };
          const rows = await agentApi<Row[]>(`/threads/${remoteId}/messages`);
          return { messages: rows.map((row) => fmt.decode(row as never)) };
        },
        append: save,
        update: save,
      };
    },
  }), [aui]);
}

const meta = (t: Meta) => ({ status: t.status, remoteId: t.id, title: t.title ?? undefined });

const threads: RemoteThreadListAdapter = {
  async list() { return { threads: (await agentApi<Meta[]>("/threads")).map(meta) }; },
  async initialize() { return { remoteId: (await agentApi<Meta>("/threads", { method: "POST", body: {} })).id, externalId: undefined }; },
  async rename(id, title) { await agentApi(`/threads/${id}`, { method: "PATCH", body: { title } }); },
  async archive(id) { await agentApi(`/threads/${id}`, { method: "PATCH", body: { status: "archived" } }); },
  async unarchive(id) { await agentApi(`/threads/${id}`, { method: "PATCH", body: { status: "regular" } }); },
  async delete(id) { await agentApi(`/threads/${id}`, { method: "DELETE" }); },
  async fetch(id) { return meta(await agentApi<Meta>(`/threads/${id}`)); },
  // The title is the first line of the first question: no model call is spent on it.
  async generateTitle(id, messages) {
    const first = messages.find((m) => m.role === "user");
    const text = first?.content.map((p) => (p.type === "text" ? p.text : "")).join(" ") ?? "";
    const title = (text.trim().split("\n")[0] ?? "").slice(0, 60) || "New chat";
    await threads.rename(id, title);
    return createAssistantStream((controller) => { controller.appendText(title); });
  },
  unstable_Provider({ children }) {
    const history = useHistory();
    const adapters = useMemo(() => ({ history }), [history]);
    return <RuntimeAdapterProvider adapters={adapters}>{children}</RuntimeAdapterProvider>;
  },
};

export function AgentRuntime({ children }: { children: ReactNode }) {
  const view = useView();
  const page = useRef(view);
  page.current = view;
  const transport = useMemo(() => new AssistantChatTransport({
    api: "/api/agent/chat",
    body: () => {
      const choice = currentChoice(agents.get(), chosen.get());
      return { agent: choice?.agent, model: choice?.model, context: {
        version: selection.get(), line: page.current.line.bundle, ledger_commit: page.current.scope?.ledger_commit ?? null } };
    },
  }), []);
  const runtime = useRemoteThreadListRuntime({ runtimeHook: () => useChatRuntime({ transport }), adapter: threads });
  useEffect(() => {
    chatControl.set({ newThread: () => void runtime.threads.switchToNewThread() });
    return () => chatControl.set(null);
  }, [runtime]);
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
