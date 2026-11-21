// The market-import service's status, read through the page's server every minute (the file changes at
// most once a round): "absent" when the server has no status file (`--market-import`), so the status bar
// shows nothing; otherwise the last reply, or the refusal when there is no readable status.
import type { Refusal, Reply } from "../model/marketImport";
import { polled, type Answer, type Poll } from "../lib/polled";
import { atom, useAtom } from "./atom";

const POLL_MS = 60_000;

type MarketImport = { kind: "checking" } | { kind: "absent" } | { kind: "ready"; reply: Reply } | { kind: "unavailable"; error: Refusal };
const marketImport = atom<MarketImport>({ kind: "checking" });
export const useMarketImport = () => useAtom(marketImport);

function map(answer: Answer): void {
  const body = answer?.body as (Reply & Partial<Refusal>) | null | undefined;
  if (!answer) marketImport.set({ kind: "unavailable", error: { code: "IDE_UNREACHABLE", message: "The page's server did not answer." } });
  else if (answer.status === 404) marketImport.set({ kind: "absent" });
  else if (!body) marketImport.set({ kind: "unavailable", error: { code: "MARKET_IMPORT_UNREADABLE", message: `HTTP ${answer.status}` } });
  else if (answer.ok) marketImport.set({ kind: "ready", reply: body });
  else marketImport.set({ kind: "unavailable", error: { code: body.code ?? "MARKET_IMPORT_UNAVAILABLE", message: body.message ?? "" } });
}

let poll: Poll | null = null;
/** Reads the status now (the status bar's popover opening). */
export const readMarketImport = () => poll?.read();

/** Follows the status while the server has one. */
export async function detectMarketImport(): Promise<void> {
  poll = polled("/api/market-import", (answer: Answer) => answer?.status === 404 ? null : POLL_MS, map);
  await poll.read();
}
