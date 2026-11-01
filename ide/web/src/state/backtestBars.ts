// A contract's daily bars over the shown backtest's window (model/backtest.ts) at the line's market commit,
// read once per contract, days and commit for the session: the backtest's candles on the contract chart.
// Where they are not to be had, what the chart says instead.
import { useEffect } from "react";
import type { Candle } from "../lib/bars";
import { fetchBars } from "../lib/barsApi";
import type { Backtest } from "../model/backtest";
import { atom, useAtom } from "./atom";

/** Being read; read; refused by the product (its code and words); or not served by this page's server. */
export type LoadedBars = { kind: "reading" } | { kind: "ready"; candles: Candle[] } | { kind: "refused"; code: string; message: string } | { kind: "absent"; message: string };
const loaded = atom<ReadonlyMap<string, LoadedBars>>(new Map());
const put = (key: string, value: LoadedBars) => loaded.set(new Map(loaded.get()).set(key, value));
const DAY_MS = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The UTC days the window covers: from its first day to the day after its last (ms, the end left out). */
export const daysOf = (window: readonly [number, number]): [string, string] =>
  [day(Math.floor(window[0] / DAY_MS) * DAY_MS), day(Math.ceil(window[1] / DAY_MS) * DAY_MS)];

/** `symbol`'s daily bars over `b`'s window at `market`; null when there is no backtest, contract or commit. */
export function useBacktestBars(symbol: string, b: Backtest | null, market: string | null): LoadedBars | null {
  const all = useAtom(loaded), [start, end] = b ? daysOf(b.window) : ["", ""];
  const key = symbol && b && market ? `${symbol}:${start}:${end}@${market}` : null;
  useEffect(() => {
    if (!key || loaded.get().has(key)) return;
    put(key, { kind: "reading" });
    void fetchBars(symbol, start, end, market!).then((r) => put(key, r.kind === "bars" ? { kind: "ready", candles: r.candles } : r));
  }, [key]);
  if (!b || !symbol) return null;
  return key ? all.get(key) ?? { kind: "reading" } : { kind: "absent", message: "the line names no market commit" };
}

/** What the contract chart says of the backtest's bars it does not draw: being read, refused, not served. */
export function barsNote(l: LoadedBars | null): string | null {
  if (!l || l.kind === "ready") return null;
  if (l.kind === "reading") return "Reading daily bars…";
  if (l.kind === "absent") return "Backtest bars not served by this IDE";
  return `Backtest bars · ${l.code}: ${l.message}`;
}
