import { liveApi, LiveApiError, type LiveApi } from "./liveTradingApi";
import type { LiveWriteReply } from "./liveTradingDto";

/** One user command as this page sent it: `no_reply` when no answer from Live came back, so whether it took effect is
 *  read from the run or key it names. */
export type LiveRequest = {
  request_id: string; action: string; target: { run_id?: string; credential_ref?: string };
  outcome: "sending" | "effect_recorded" | "refused" | "no_reply"; code?: string;
};
type Sent = { request: LiveRequest; path: string; body: Record<string, unknown> };
type Options = { api?: LiveApi; onRequest: (request: LiveRequest) => void; onDrop?: (id: string) => void; onError: (error: LiveApiError) => void; refresh: () => Promise<void> };

// No answer from Live itself: the page could not reach it, could not read it, the session lapsed, or Live could not
// confirm its own records. Every other code is Live's refusal.
const NO_REPLY = new Set(["LIVE_UNAVAILABLE", "LIVE_RESPONSE_UNKNOWN", "AUTH_REQUIRED", "LIVE_RECORD_UNAVAILABLE"]);
const errorOf = (error: unknown) => error instanceof LiveApiError ? error
  : new LiveApiError("LIVE_RESPONSE_UNKNOWN", "No reply from Live could be read. The run or key shows what Live recorded.");
const operationKey = (action: string, target: LiveRequest["target"]) =>
  [action, action === "prepare" || action === "credential_save" ? "" : target.run_id ?? target.credential_ref ?? ""].join(":");

export const newLiveRunId = () => `web-${Array.from(crypto.getRandomValues(new Uint8Array(10)), (v) => v.toString(16).padStart(2, "0")).join("").slice(0, 19)}`;

/** A user-command client, not a retry queue: each click sends once. A command with no reply keeps its body in this
 *  tab's memory only (never storage), so Send again repeats it with the same request ID; Live does it at most once and
 *  answers a repeat of a done command without doing it again. A reply of any kind drops the body. */
export function createLiveCommands({ api = liveApi, onRequest, onDrop = () => {}, onError, refresh }: Options) {
  const active = new Map<string, Promise<LiveRequest>>();
  const unanswered = new Map<string, Sent>();
  const send = (sent: Sent): Promise<LiveRequest> => {
    const key = operationKey(sent.request.action, sent.request.target), current = active.get(key);
    if (current) return current;
    const work = (async () => {
      const { request } = sent, id = request.request_id;
      if (!unanswered.has(id)) onRequest({ ...request, outcome: "sending" });  // a resend keeps its card until it is answered
      let answered: LiveRequest;
      try {
        const reply = await api<LiveWriteReply>(sent.path, { body: { ...sent.body, request_id: id } });
        if (reply?.request_id !== id || reply.action !== request.action)
          throw new LiveApiError("LIVE_RESPONSE_UNKNOWN", "The reply did not name this request. The run or key shows what Live recorded.");
        const target = { ...request.target, ...(typeof reply.run_id === "string" ? { run_id: reply.run_id } : {}),
          ...(typeof reply.credential_ref === "string" ? { credential_ref: reply.credential_ref } : {}) };
        answered = { ...request, target, outcome: "effect_recorded" };
      } catch (error) {
        const failed = errorOf(error);
        onError(failed);
        answered = { ...request, outcome: NO_REPLY.has(failed.code) ? "no_reply" : "refused", code: failed.code };
      }
      if (answered.outcome === "no_reply") unanswered.set(id, sent); else unanswered.delete(id);
      // A later click of the same command that Live did settles an earlier one that had no reply; its body is dropped.
      if (answered.outcome === "effect_recorded") for (const [other, { request: earlier }] of unanswered)
        if (operationKey(earlier.action, earlier.target) === key) { unanswered.delete(other); onDrop(other); }
      onRequest(answered);
      await refresh();
      return answered;
    })();
    active.set(key, work);
    void work.then(() => active.delete(key), () => active.delete(key));
    return work;
  };
  /** A new click: a new request ID. A second click while the first is still on its way shares that one. */
  const invoke = (action: string, path: string, target: LiveRequest["target"], payload: () => Record<string, unknown>) => {
    const current = active.get(operationKey(action, target));
    return current ?? send({ request: { request_id: `web-${crypto.randomUUID()}`, action, target, outcome: "sending" }, path, body: payload() });
  };
  /** Send again: the same request, its same ID and body, only for one that had no reply. */
  const resend = (id: string): Promise<LiveRequest | null> => {
    const sent = unanswered.get(id);
    return sent ? send(sent) : Promise.resolve(null);
  };
  return { invoke, resend };
}
