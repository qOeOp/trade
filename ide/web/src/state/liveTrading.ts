import { atom, useAtom } from "./atom";
import { sessionRequired } from "./session";
import { LIVE_UNAVAILABLE, type LiveTradingActions, type LiveTradingView } from "../model/liveTrading";
import { liveHomePresentation } from "../model/liveTradingMap";
import { liveApi, LiveApiError } from "../lib/liveTradingApi";
import { createLiveCommands } from "../lib/liveTradingCommands";
import { newLiveRunId } from "../lib/liveTradingPending";
import { whileVisible } from "../lib/whileVisible";
import type { LiveHomeDto, LiveRequest, LiveRunDto } from "../lib/liveTradingDto";

export const liveTrading = atom<{ view: LiveTradingView; actions: LiveTradingActions }>({ view: LIVE_UNAVAILABLE, actions: {} });
export const useLiveTrading = () => useAtom(liveTrading);
let home: LiveHomeDto | null = null, readError: string | null = null, commandNotice: string | null = null;
let reading: Promise<void> | null = null, started = false;
const reviews = new Map<string, LiveRunDto>(), requests = new Map<string, LiveRequest>(), inspecting = new Map<string, Promise<void>>();
const safeError = (error: unknown) => error instanceof LiveApiError ? error : new LiveApiError("LIVE_UNAVAILABLE", "Live observations are unavailable. Previously received facts may be stale.");
const recordError = (error: LiveApiError) => {
  if (error.code === "AUTH_REQUIRED") sessionRequired.set(true);
  commandNotice = `${error.code} · ${error.message}`; publish();
};
const client = createLiveCommands({
  onRequest: (request) => {
    requests.set(request.request_id, request);
    if (request.outcome === "effect_recorded" || request.outcome === "refused") commandNotice = null;
    const finished = [...requests.values()].filter((r) => r.outcome === "effect_recorded" || r.outcome === "refused");
    for (const old of finished.slice(0, -5)) requests.delete(old.request_id);
    publish();
  }, onError: recordError, onNotice: (text) => { commandNotice = text; publish(); }, refresh: () => readLiveHome(),
});

const perRun = async (action: "preflight" | "start" | "stop" | "reconcile" | "maintain", id: string, extra = {}) => {
  await client.invoke(action, `/runs/${encodeURIComponent(id)}/${action}`, { run_id: id }, () => extra);
};
const writes: LiveTradingActions = {
  saveCredentials: async (input) => { await client.invoke("credential_save", "/credentials", {}, () => input); },
  removeCredential: async (ref) => { await client.invoke("credential_remove", `/credentials/${encodeURIComponent(ref)}/remove`, { credential_ref: ref }, () => ({})); },
  prepare: (input) => {
    const id = newLiveRunId(), credential = home?.credentials.find((item) => item.selected);
    return client.invoke("prepare", "/runs", { run_id: id }, () => ({
      run_id: id, source_id: input.sourceId, credential_ref: credential?.credential_ref ?? "",
      config: { budget_usdt: input.values.budget_usdt, max_notional_per_order: input.values.max_notional_per_order,
        max_loss_usdt: input.values.max_loss_usdt, duration_seconds: Number(input.values.duration_seconds) },
    }));
  },
  preflight: (id) => perRun("preflight", id), start: (id, source) => perRun("start", id, { confirm_real_orders: source }),
  stop: (id) => perRun("stop", id), reconcile: (id) => perRun("reconcile", id), maintain: (id) => perRun("maintain", id),
  resolveRequest: (id) => client.resolve(id),
};
// Notification settings are not account operations: no request ID, so a plain call and a fresh read.
const notifyCall = (path: string, body: Record<string, unknown>) => async (): Promise<string | null> => {
  try { await liveApi(path, { body }); return null; }
  catch (error) { const failed = safeError(error); if (failed.code === "AUTH_REQUIRED") sessionRequired.set(true); return `${failed.code} · ${failed.message}`; }
  finally { await readLiveHome(); }
};
const notifyWrites: LiveTradingActions = {
  saveNotify: (token) => notifyCall("/notify/telegram", { bot_token: token })(),
  testNotify: notifyCall("/notify/test", {}), removeNotify: notifyCall("/notify/remove", {}),
};

function publish(): void {
  const view = home ? liveHomePresentation(home, reviews) : { ...LIVE_UNAVAILABLE };
  if (readError) view.availability = "unavailable";
  view.notice = readError ?? commandNotice ?? view.notice;
  view.requests = [...requests.values()];
  view.request = view.requests.at(-1) ?? null;
  // STOP remains available during a release or failed observation. Cleanup has its
  // own owner; the server rechecks these derived permissions under the custody lock.
  const retained = home ? { stop: writes.stop, maintain: home.maintenance_enabled ? writes.maintain : undefined,
    resolveRequest: home.write_enabled ? writes.resolveRequest : undefined } : {};
  liveTrading.set({ view, actions: { ...(home?.write_enabled && !readError ? writes : {}), ...retained, ...(home?.notify && !readError ? notifyWrites : {}),
    refresh: refreshLiveTrading, inspect: inspectLiveRun } });
}

async function readLiveHome(): Promise<void> {
  if (reading) return reading;
  reading = (async () => {
    try { home = await liveApi<LiveHomeDto>(""); readError = null; }
    catch (error) {
      const failed = safeError(error);
      if (failed.code === "AUTH_REQUIRED") sessionRequired.set(true);
      readError = `${failed.code} · ${failed.message}${home ? " Showing previously received facts." : ""}`;
    }
    publish();
  })();
  try { await reading; } finally { reading = null; }
}

export async function inspectLiveRun(id: string): Promise<void> {
  const current = inspecting.get(id);
  if (current) return current;
  const work = (async () => {
    try { reviews.set(id, await liveApi<LiveRunDto>(`/runs/${encodeURIComponent(id)}`)); }
    catch (error) { recordError(safeError(error)); }
    publish();
  })();
  inspecting.set(id, work);
  try { await work; } finally { inspecting.delete(id); }
}

/** Startup, visibility changes and manual refresh read only; none recreate a prior POST. */
export async function refreshLiveTrading(): Promise<void> { await readLiveHome(); await client.recover(); }
export async function detectLiveTrading(): Promise<void> {
  if (started) return;
  started = true;
  await refreshLiveTrading();
  whileVisible(() => void refreshLiveTrading(), 15_000);
}
