import { tabStorage } from "./storage";
import type { LiveRequest } from "./liveTradingDto";

export type LivePending = Pick<LiveRequest, "request_id" | "action" | "target">;
const KEY = "trade.live.pending@1";
const memory = new Map<string, LivePending>();
const ACTIONS = new Set(["prepare", "preflight", "start", "stop", "reconcile", "maintain", "credential_save", "credential_remove"]);
const clean = (value: unknown): LivePending | null => {
  const p = value as LivePending | null;
  if (!p || typeof p.request_id !== "string" || typeof p.action !== "string" || !ACTIONS.has(p.action) || !p.target || typeof p.target !== "object") return null;
  const target = {
    ...(typeof p.target.run_id === "string" ? { run_id: p.target.run_id } : {}),
    ...(typeof p.target.credential_ref === "string" ? { credential_ref: p.target.credential_ref } : {}),
  };
  return { request_id: p.request_id, action: p.action, target };
};
const persist = () => tabStorage.set(KEY, memory.size ? JSON.stringify([...memory.values()]) : null);

export function pendingLiveRequests(): LivePending[] {
  try {
    const saved: unknown = JSON.parse(tabStorage.get(KEY) ?? "[]");
    if (Array.isArray(saved)) for (const value of saved) { const p = clean(value); if (p) memory.set(p.request_id, p); }
  } catch { /* blocked or malformed storage does not erase this tab's request identities */ }
  return [...memory.values()];
}
export function keepLiveRequest(request: LivePending): void {
  const p = clean(request);
  if (p) { memory.set(p.request_id, p); persist(); }
}
export function finishLiveRequest(id: string): void { memory.delete(id); persist(); }
export const liveOperationKey = (action: string, target: LivePending["target"]) =>
  [action, action === "prepare" || action === "credential_save" ? "" : target.run_id ?? target.credential_ref ?? ""].join(":");

export const newLiveRunId = () => `web-${Array.from(crypto.getRandomValues(new Uint8Array(10)), (v) => v.toString(16).padStart(2, "0")).join("").slice(0, 19)}`;
