// A contract's daily bars over the shown backtest's window (model/backtest.ts) at the line's market day,
// read once per contract, days and market day for the session: the backtest's candles on the contract chart,
// and every contract's closes for the equity chart's buy and hold. Where they are not to be had, what the
// chart says instead.
import { useEffect, useMemo } from "react";
import type { Candle } from "../lib/bars";
import { fetchBars } from "../lib/barsApi";
import { DAY_MS } from "../lib/time";
import type { Backtest } from "../model/backtest";
import { atom, useAtom } from "./atom";

/** Being read; read; refused by the product (its code and words); or not served by this page's server. */
export type LoadedBars = { kind: "reading" } | { kind: "ready"; candles: Candle[] } | { kind: "refused"; code: string; message: string } | { kind: "absent"; message: string };
const loaded = atom<ReadonlyMap<string, LoadedBars>>(new Map());
const put = (key: string, value: LoadedBars) => loaded.set(new Map(loaded.get()).set(key, value));
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The UTC days the window covers: from its first day to the day after its last (ms, the end left out). */
export const daysOf = (window: readonly [number, number]): [string, string] =>
  [day(Math.floor(window[0] / DAY_MS) * DAY_MS), day(Math.ceil(window[1] / DAY_MS) * DAY_MS)];

/** Reads `symbol`'s daily bars from UTC day `start` to `end` at `market` under `key`, unless already asked. */
function read(key: string, symbol: string, start: string, end: string, market: string): void {
  if (loaded.get().has(key)) return;
  put(key, { kind: "reading" });
  void fetchBars(symbol, start, end, market).then((r) => put(key, r.kind === "bars" ? { kind: "ready", candles: r.candles } : r));
}

/** `symbols`' daily closes ([day start s, close]) over `b`'s window at `market`, by symbol; null until every
 *  one is read, and when any is not to be had (a buy and hold short of a contract would mislead). */
export function useBacktestCloses(symbols: readonly string[], b: Backtest | null, market: string | null): Record<string, [number, number][]> | null {
  const all = useAtom(loaded), [start, end] = b ? daysOf(b.window) : ["", ""], asked = symbols.join();
  const keys = useMemo(() => (b && market ? symbols.map((s) => [s, `${s}:${start}:${end}@${market}`] as const) : []), [asked, start, end, market, b !== null]);
  useEffect(() => { for (const [s, key] of keys) read(key, s, start, end, market!); }, [keys]);
  // Anew only as one of them is read: a key's bars, once read, stay as they are.
  const found = keys.map(([s, key]) => [s, all.get(key)] as const), kinds = found.map(([, l]) => l?.kind).join();
  return useMemo(() => {
    if (!found.length || found.some(([, l]) => l?.kind !== "ready")) return null;
    return Object.fromEntries(found.map(([s, l]) => [s, (l as { candles: Candle[] }).candles.map((c) => [c.time, c.close] as [number, number])]));
  }, [keys, kinds]);
}

/** `symbol`'s daily bars over `b`'s window at `market`; null when there is no backtest, contract or market day. */
export function useBacktestBars(symbol: string, b: Backtest | null, market: string | null): LoadedBars | null {
  const all = useAtom(loaded), [start, end] = b ? daysOf(b.window) : ["", ""];
  const key = symbol && b && market ? `${symbol}:${start}:${end}@${market}` : null;
  useEffect(() => { if (key) read(key, symbol, start, end, market!); }, [key]);
  if (!b || !symbol) return null;
  return key ? all.get(key) ?? { kind: "reading" } : { kind: "absent", message: "the line names no market day" };
}

/** What the contract chart says of the backtest's bars it does not draw: being read, refused, not served. */
export function barsNote(l: LoadedBars | null): string | null {
  if (!l || l.kind === "ready") return null;
  if (l.kind === "reading") return "Reading daily bars…";
  if (l.kind === "absent") return "Backtest bars not served by this IDE";
  return `Backtest bars · ${l.code}: ${l.message}`;
}
