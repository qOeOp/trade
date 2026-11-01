// The Market page's state: whether the page's server has an overview service (`--overview`, ide/overview)
// and reaches it, its last snapshot (read every half minute while the page shows, and once when it opens),
// and where the heatmap is: the drill-down path, the coin picked, what the tiles' area and colour follow.
import type { Color, Path, Size, Snapshot } from "../model/market";
import { atom, useAtom } from "./atom";
import { shell } from "./shell";

const POLL_MS = 30_000;

/** "absent" when the server has no overview service, so the page has no Market button; with one,
 *  "present" while it answers and "offline" while it does not. */
export const overviewService = atom<"checking" | "absent" | "offline" | "present">("checking");
export const snapshot = atom<{ data: Snapshot; read: number } | null>(null);
export const marketPath = atom<Path>([]);
export const marketCoin = atom<string | null>(null);
export const marketSize = atom<Size>("marketCap");
export const marketColor = atom<Color>("change24h");

export const useOverviewService = () => useAtom(overviewService);
export const useSnapshot = () => useAtom(snapshot)?.data ?? null;
export const useMarketView = () => ({ path: useAtom(marketPath), coin: useAtom(marketCoin), size: useAtom(marketSize), color: useAtom(marketColor) });

/** Opens a level; picking a coin leaves the level as it is. */
export function openPath(path: Path): void {
  marketPath.set(path);
  marketCoin.set(null);
}

const onPage = () => shell.get().last.left === "market";

async function read(path: string): Promise<Response | null> {
  try { return await fetch(path, { cache: "no-store" }); } catch { return null; }
}

export async function readSnapshot(): Promise<void> {
  const response = await read("/api/overview/snapshot");
  if (response?.status === 404) return overviewService.set("absent");
  const data = response?.ok ? ((await response.json().catch(() => null)) as Snapshot | null) : null;
  if (!data) return overviewService.set("offline");
  overviewService.set("present");
  snapshot.set({ data, read: Date.now() });
}

/** Follows the service while the server has one: the snapshot while the page shows, its health while not. */
export async function detectOverview(): Promise<void> {
  const health = await read("/api/overview/health");
  if (health?.status === 404) return overviewService.set("absent");
  overviewService.set(health?.ok ? "present" : "offline");
  const stale = () => Date.now() - (snapshot.get()?.read ?? 0) >= POLL_MS;
  if (onPage()) await readSnapshot();
  shell.subscribe(() => { if (onPage() && stale()) void readSnapshot(); });
  window.setInterval(() => {
    if (onPage()) void readSnapshot();
    else void read("/api/overview/health").then((r) => overviewService.set(r?.ok ? "present" : "offline"));
  }, POLL_MS);
}
