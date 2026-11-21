// The Market page's state: whether the page's server has an overview service (`--overview`, ide/overview)
// and reaches it, its last snapshot and the week's headlines (both read every half minute while the page
// shows, and once when it opens) and the picked coin's details (read when it is picked, then with the snapshot), and where the heatmap
// is: the drill-down path, the coin picked, what the tiles' area and colour follow.
import { shared } from "../lib/shared";
import { pageFetch } from "../lib/transport";
import { polled } from "../lib/polled";
import type { CoinDetail, Color, NewsItem, Path, Size, Snapshot } from "../model/market";
import { atom, useAtom } from "./atom";
import { shell } from "./shell";

const POLL_MS = 30_000;

/** "absent" when the server has no overview service, so the page has no Market button; with one,
 *  "present" while it answers and "offline" while it does not. */
const overviewService = atom<"checking" | "absent" | "offline" | "present">("checking");
const snapshot = atom<{ data: Snapshot; read: number } | null>(null);
const marketPath = atom<Path>([]);
export const marketCoin = atom<string | null>(null);
export const marketSize = atom<Size>("marketCap");
export const marketColor = atom<Color>("change24h");
const coinDetail = atom<CoinDetail | null>(null);
const news = atom<NewsItem[] | null>(null);
/** Whether the last read of the headlines failed (the last ones, if any, stay). */
const newsFailed = atom(false);
/** Which headlines the News window shows. */
export const newsKind = atom<"all" | NewsItem["kind"]>("all");

export const useOverviewService = () => useAtom(overviewService);
export const useSnapshot = () => useAtom(snapshot)?.data ?? null;
export const useNews = () => useAtom(news);
export const useNewsFailed = () => useAtom(newsFailed);
export const useMarketView = () => ({ path: useAtom(marketPath), coin: useAtom(marketCoin), size: useAtom(marketSize), color: useAtom(marketColor) });
/** The picked coin's details, once they are the picked coin's. */
export const useCoinDetail = (symbol: string) => { const d = useAtom(coinDetail); return d?.symbol === symbol ? d : null; };

/** Opens a level; picking a coin leaves the level as it is. */
export function openPath(path: Path): void {
  marketPath.set(path);
  marketCoin.set(null);
}

/** Set while the phone shows: its runs' positions are marked at the snapshot's prices, on every tab. */
export const pricesWanted = atom(false);
const onPage = () => shell.get().last.left === "market" || pricesWanted.get();

async function read(path: string): Promise<Response | null> {
  try { return await pageFetch(path, { cache: "no-store" }); } catch { return null; }
}

async function readSnapshot(): Promise<void> {
  const response = await read("/api/overview/snapshot");
  if (response?.status === 404) return overviewService.set("absent");
  const data = response?.ok ? ((await response.json().catch(() => null)) as Snapshot | null) : null;
  if (!data) return overviewService.set("offline");
  overviewService.set("present");
  snapshot.set({ data: shared(snapshot.get()?.data, data), read: Date.now() });
  await Promise.all([readCoin(), readNews()]);
}

/** The week's headlines; a failed read keeps the last ones and says it failed. */
async function readNews(): Promise<void> {
  const response = await read("/api/overview/news");
  const data = response?.ok ? ((await response.json().catch(() => null)) as { items: NewsItem[] } | null) : null;
  newsFailed.set(!data);
  if (data) news.set(data.items);
}

/** The picked coin's details; a failed read keeps the last ones. */
async function readCoin(): Promise<void> {
  const symbol = marketCoin.get();
  if (!symbol) return;
  const response = await read(`/api/overview/coin?symbol=${encodeURIComponent(symbol)}`);
  const data = response?.ok ? ((await response.json().catch(() => null)) as CoinDetail | null) : null;
  if (data && data.symbol === marketCoin.get()) coinDetail.set(data);
}
marketCoin.subscribe(() => void readCoin());

/** The snapshot while the Market page or the phone shows, the service's health while not. */
async function follow(): Promise<void> {
  if (onPage()) return readSnapshot();
  const health = await read("/api/overview/health");
  overviewService.set(health?.status === 404 ? "absent" : health?.ok ? "present" : "offline");
}

/** Follows the service while the server has one. */
export async function detectOverview(): Promise<void> {
  await polled(follow, () => overviewService.get() === "absent" ? null : POLL_MS).read();
  if (overviewService.get() === "absent") return;
  const stale = () => Date.now() - (snapshot.get()?.read ?? 0) >= POLL_MS;
  shell.subscribe(() => { if (onPage() && stale()) void readSnapshot(); });
  pricesWanted.subscribe(() => { if (onPage() && stale()) void readSnapshot(); });
}
