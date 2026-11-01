// The market-import service's status, read through the page's server every minute (the file changes at
// most once a round): "absent" when the server has no status file (`--market-import`), so the status bar
// shows nothing; otherwise the last reply, or the refusal when there is no readable status.
import type { Refusal, Reply } from "../model/marketImport";
import { atom, useAtom } from "./atom";

const POLL_MS = 60_000;

export type MarketImport = { kind: "checking" } | { kind: "absent" } | { kind: "ready"; reply: Reply } | { kind: "unavailable"; error: Refusal };
export const marketImport = atom<MarketImport>({ kind: "checking" });
export const useMarketImport = () => useAtom(marketImport);

export async function readMarketImport(): Promise<void> {
  try {
    const response = await fetch("/api/market-import", { cache: "no-store" });
    const body = await response.json().catch(() => ({ code: "MARKET_IMPORT_UNREADABLE", message: `${response.status} ${response.statusText}` }));
    if (response.status === 404) marketImport.set({ kind: "absent" });
    else if (response.ok) marketImport.set({ kind: "ready", reply: body as Reply });
    else marketImport.set({ kind: "unavailable", error: { code: body.code ?? "MARKET_IMPORT_UNAVAILABLE", message: body.message } });
  } catch (error) {
    marketImport.set({ kind: "unavailable", error: { code: "IDE_UNREACHABLE", message: String(error) } });
  }
}

/** Follows the status while the server has one. */
export async function detectMarketImport(): Promise<void> {
  await readMarketImport();
  if (marketImport.get().kind === "absent") return;
  window.setInterval(() => void readMarketImport(), POLL_MS);
}
