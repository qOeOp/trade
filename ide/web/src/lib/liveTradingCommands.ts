import { liveApi, LiveApiError, type LiveApi } from "./liveTradingApi";
import { finishLiveRequest, keepLiveRequest, liveOperationKey, pendingLiveRequests, type LivePending } from "./liveTradingPending";
import type { LiveRequest, LiveWriteReply } from "./liveTradingDto";

type Options = { api?: LiveApi; onRequest: (request: LiveRequest) => void; onError: (error: LiveApiError) => void; onNotice?: (text: string) => void; refresh: () => Promise<void> };
const errorOf = (error: unknown) => error instanceof LiveApiError ? error : new LiveApiError("LIVE_RESPONSE_UNKNOWN", "The request result is unknown. Check the original request before trying again.");
const receipt = (value: LiveRequest, id: string): LiveRequest => {
  if (value?.request_id !== id || typeof value.action !== "string" || !value.target || typeof value.target !== "object" ||
      !["pending", "effect_recorded", "refused", "outcome_unknown"].includes(value.outcome))
    throw new LiveApiError("LIVE_RESPONSE_UNKNOWN", "The response did not identify the original request. Its outcome remains unknown.");
  return value;
};

/** A user-command client, not a retry queue. A restored pending identity is only ever queried. */
export function createLiveCommands({ api = liveApi, onRequest, onError, onNotice = () => {}, refresh }: Options) {
  const active = new Map<string, Promise<LiveRequest | null>>();
  const resolving = new Map<string, Promise<void>>();
  const settled = new Map<string, number>();
  const observe = (request: LiveRequest) => {
    if (request.outcome === "effect_recorded" || request.outcome === "refused") {
      settled.set(request.request_id, (settled.get(request.request_id) ?? 0) + 1);
      finishLiveRequest(request.request_id);
    }
    else keepLiveRequest(request);
    onRequest(request);
  };
  const recoverOne = async (pending: LivePending): Promise<LiveRequest | null> => {
    const generation = settled.get(pending.request_id) ?? 0;
    const current = () => (settled.get(pending.request_id) ?? 0) === generation;
    try {
      const request = receipt(await api<LiveRequest>(`/requests/${encodeURIComponent(pending.request_id)}`), pending.request_id);
      if (current()) { observe(request); return request; }
    }
    catch (error) {
      if (!current()) return null;
      const failed = errorOf(error);
      onError(failed);
      const request: LiveRequest = { ...pending, outcome: "outcome_unknown", code: failed.code };
      onRequest(request);
      return request;
    }
    return null;
  };
  const recover = async () => { await Promise.all(pendingLiveRequests().map(recoverOne)); };
  const invoke = (action: string, path: string, target: LivePending["target"], payload: () => Record<string, unknown>): Promise<LiveRequest | null> => {
    const key = liveOperationKey(action, target);
    const current = active.get(key);
    if (current) return current;
    const work = (async () => {
      const prior = pendingLiveRequests().find((p) => liveOperationKey(p.action, p.target) === key);
      if (prior) { const request = await recoverOne(prior); onNotice("Checked the earlier request. This click did not submit a new action."); await refresh(); return request; }
      const pending = { request_id: `web-${crypto.randomUUID()}`, action, target };
      keepLiveRequest(pending);
      onRequest({ ...pending, outcome: "outcome_unknown" });
      let request: LiveRequest | null;
      try {
        const result = await api<LiveWriteReply>(path, { body: { ...payload(), request_id: pending.request_id } });
        request = receipt(result.request, pending.request_id);
        observe(request);
      } catch (error) {
        const failed = errorOf(error);
        onError(failed);
        // Only the same-ID durable RequestView can settle this intent, including after a 4xx.
        request = await recoverOne(pending);
      }
      await refresh();
      return request;
    })();
    active.set(key, work);
    void work.then(() => active.delete(key), () => active.delete(key));
    return work;
  };
  const resolve = (id: string): Promise<void> => {
    const key = `resolve:${id}`, current = resolving.get(key);
    if (current) return current;
    const work = (async () => {
      try { observe(receipt((await api<LiveWriteReply>(`/requests/${encodeURIComponent(id)}/resolve`, { body: { request_id: id } })).request, id)); }
      catch (error) { onError(errorOf(error)); await recover(); }
      await refresh();
    })();
    resolving.set(key, work);
    void work.then(() => resolving.delete(key), () => resolving.delete(key));
    return work;
  };
  return { invoke, recover, resolve };
}
