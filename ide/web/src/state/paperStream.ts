// The journal of the run the Runs page shows, as it grows: one stream from the daemon for the run and
// the contract its chart shows (every line but other contracts' bars), with state.json, the readings
// and the exceptions its strategy raised. The page's links: the time the chart should show and the
// event to highlight, the Trades window's tab, and the day picked in the calendar.
import { streamUrl, type JournalLine, type Live, type PaperState, type RuntimeFailure, type Seal } from "../lib/paperApi";
import { CATEGORIES, type Category } from "../model/paper";
import { atom, useAtom } from "./atom";

export type Stream = {
  paperId: number; symbol: string | null; lines: JournalLine[]; bars: JournalLine[];
  /** Every contract's bar closes ([bar time ns, close]), by symbol: the Account view's stream only. */
  closes: Record<string, [number, number][]>;
  state: PaperState | null; readings: Live | null; seal: Seal | null; failures: RuntimeFailure[]; connected: boolean;
};
export const stream = atom<Stream | null>(null);
export const useStream = () => useAtom(stream);

/** The chart scrolls to this time (ms); the Events list highlights this line. */
export const chartTime = atom<{ ms: number; n: number } | null>(null);
export const highlighted = atom<JournalLine | null>(null);
/** The closed trade (its id) the Trades list highlights: one picked on the equity chart. */
export const pickedTrade = atom<string | null>(null);
/** A UTC day (YYYY-MM-DD) the chart and the events are limited to, or null. */
export const pickedDay = atom<string | null>(null);
/** The tab the Trades window shows; a click on a chart marker turns it to the events. */
export const tradesTab = atom<"trades" | "events" | "exceptions" | "reconcile">("trades");
/** The month (YYYY-MM) the calendar shows, or null for the run's latest. */
export const calendarMonth = atom<string | null>(null);
/** The event categories the Events list shows. */
export const shownCategories = atom<ReadonlySet<Category>>(new Set(CATEGORIES));

let n = 0;
export const showTime = (ms: number) => chartTime.set({ ms, n: ++n });

let source: EventSource | null = null;
type Closes = Stream["closes"];
// What the page holds of the run shown beyond its lines: each contract's bars and every contract's closes,
// as their streams last had them. They show at once when the chart switches back, and the stream then
// sends only what came since (a resumed stream).
let cached: { paperId: number | null; bars: Map<string, JournalLine[]>; closes: Closes } = { paperId: null, bars: new Map(), closes: {} };

/** `whole`, a stream's first batch (all of it again), as `had` where it brings nothing more, else `had`
 *  and what follows it: an unchanged journal keeps its identity, so what reads it is not worked out
 *  again. Lines are append-only; `had` is used only while `whole` still holds its last line in place. */
function again(had: JournalLine[], whole: JournalLine[]): JournalLine[] {
  const n = had.length, same = (a?: JournalLine, b?: JournalLine) => !!a && !!b && a.kind === b.kind && a.wall_ns === b.wall_ns && a.ts_event === b.ts_event;
  if (!n || whole.length < n || !same(whole[n - 1], had[n - 1])) return whole;
  return whole.length === n ? had : [...had, ...whole.slice(n)];
}

// A resumed stream's first batch after what the page held when it asked (a reconnect may ask again with
// what it held then, so what came since is dropped first): the lines after the first `n`; the bars after
// `upTo` (ns, a double's precision either side); each contract's closes after its last.
const linesAfter = (had: JournalLine[], n: number, more: JournalLine[]) => (had.length === n && !more.length ? had : [...had.slice(0, n), ...more]);
function barsAfter(had: JournalLine[], upTo: number, more: JournalLine[]): JournalLine[] {
  const kept = had.length && Number(had.at(-1)!.ts_event) > upTo ? had.filter((b) => Number(b.ts_event) <= upTo) : had;
  const last = kept.length ? Number(kept.at(-1)!.ts_event) : -Infinity, fresh = more.filter((b) => Number(b.ts_event) > last);
  return fresh.length ? [...kept, ...fresh] : kept;
}
const closesAfter = (had: Closes, more: Closes): Closes => ({ ...had, ...Object.fromEntries(Object.entries(more).map(([k, found]) => {
  const last = had[k]?.at(-1)?.[0] ?? -Infinity;
  return [k, [...(had[k] ?? []), ...found.filter(([t]) => t > last)]];
})) });

/** Follows `paperId` with the bars of `symbol` (null: none), replacing the previous stream. */
export function follow(paperId: number | null, symbol: string | null): void {
  const now = stream.get();
  if (now && now.paperId === paperId && now.symbol === symbol && source) return;
  source?.close();
  source = null;
  if (paperId === null) { stream.set(null); return; }
  // Lines of the same run carry over while another contract's stream starts, and its bars or the closes as
  // they last were; the stream is asked for what came since.
  const kept = now?.paperId === paperId ? now : null;
  if (cached.paperId !== paperId) cached = { paperId, bars: new Map(), closes: {} };
  const lines = kept?.lines ?? [], bars = (symbol && cached.bars.get(symbol)) || [], held = symbol ? {} : cached.closes;
  const lasts = Object.values(held).map((c) => c.at(-1)?.[0] ?? 0);
  const upTo = symbol ? (bars.length ? Number(bars.at(-1)!.ts_event) : 0) : lasts.length ? Math.min(...lasts) : 0;
  stream.set({ paperId, symbol, lines, bars, closes: held, state: kept?.state ?? null,
               readings: kept?.readings ?? null, seal: kept?.seal ?? null, failures: kept?.failures ?? [], connected: false });
  const events = new EventSource(streamUrl(paperId, symbol, lines.length ? { lines: lines.length, last: lines.at(-1)!.wall_ns, bars: upTo } : null));
  source = events;
  let first = true, firstCloses = true, from: { lines: number; bars: number } | null = null;
  const update = (f: (s: Stream) => Stream) => { const s = stream.get(); if (s && source === events) stream.set(f(s)); };
  events.addEventListener("resumed", (event) => { from = JSON.parse((event as MessageEvent).data); });
  events.addEventListener("lines", (event) => {
    const lines = JSON.parse((event as MessageEvent).data) as JournalLine[];
    const bars = lines.filter((l) => l.kind === "bar"), rest = lines.filter((l) => l.kind !== "bar");
    // The first batch is what came since, when resumed; else the whole journal again, which replaces what
    // an earlier stream of the run gave.
    update((s) => {
      const next = { ...s, connected: true,
        lines: !first ? [...s.lines, ...rest] : from ? linesAfter(s.lines, from.lines, rest) : again(s.lines, rest),
        bars: !first ? [...s.bars, ...bars] : from ? barsAfter(s.bars, from.bars, bars) : again(s.bars, bars) };
      if (symbol) cached.bars.set(symbol, next.bars);
      return next;
    });
    first = false;
  });
  events.addEventListener("closes", (event) => {
    const found = JSON.parse((event as MessageEvent).data) as Closes;
    // Like the lines, the first batch is every close so far, or those since when resumed.
    update((s) => {
      const closes = firstCloses && !from ? found : closesAfter(s.closes, found);
      if (!symbol) cached.closes = closes;
      return { ...s, closes };
    });
    firstCloses = false;
  });
  events.addEventListener("state", (event) => update((s) => ({ ...s, state: JSON.parse((event as MessageEvent).data) })));
  events.addEventListener("failures", (event) => update((s) => ({ ...s, failures: JSON.parse((event as MessageEvent).data) })));
  events.addEventListener("readings", (event) => update((s) => ({ ...s, readings: JSON.parse((event as MessageEvent).data) })));
  events.addEventListener("end", (event) => {
    update((s) => ({ ...s, seal: JSON.parse((event as MessageEvent).data) }));
    events.close();
  });
  // A reconnected stream starts again: resumed from what the page held when it first asked, or whole.
  events.onopen = () => { first = firstCloses = true; from = null; };
  events.onerror = () => update((s) => ({ ...s, connected: false }));
}
