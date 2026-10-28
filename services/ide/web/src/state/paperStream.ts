// The journal of the run the Paper page shows, as it grows: one stream from the daemon for the run and
// the contract its chart shows (every line but other contracts' bars), with state.json, the readings
// and the exceptions its strategy raised. The page's links: the time the chart should show and the
// event to highlight, the trades card's tab, and the day picked in the calendar.
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
/** The tab the trades card shows; a click on a chart marker turns it to the events. */
export const tradesTab = atom<"trades" | "events" | "exceptions" | "reconcile">("trades");
/** The month (YYYY-MM) the calendar shows, or null for the run's latest. */
export const calendarMonth = atom<string | null>(null);
/** The event categories the Events list shows. */
export const shownCategories = atom<ReadonlySet<Category>>(new Set(CATEGORIES));

let n = 0;
export const showTime = (ms: number) => chartTime.set({ ms, n: ++n });

let source: EventSource | null = null;
// Each contract's bars of the run shown, as its stream last had them: they show at once when the chart
// switches back to it, before its stream sends them again.
let cached: { paperId: number | null; bars: Map<string, JournalLine[]> } = { paperId: null, bars: new Map() };

/** `whole`, a stream's first batch (all of it again), as `had` where it brings nothing more, else `had`
 *  and what follows it: an unchanged journal keeps its identity, so what reads it is not worked out
 *  again. Lines are append-only; `had` is used only while `whole` still holds its last line in place. */
function again(had: JournalLine[], whole: JournalLine[]): JournalLine[] {
  const n = had.length, same = (a?: JournalLine, b?: JournalLine) => !!a && !!b && a.kind === b.kind && a.wall_ns === b.wall_ns && a.ts_event === b.ts_event;
  if (!n || whole.length < n || !same(whole[n - 1], had[n - 1])) return whole;
  return whole.length === n ? had : [...had, ...whole.slice(n)];
}

/** Follows `paperId` with the bars of `symbol` (null: none), replacing the previous stream. */
export function follow(paperId: number | null, symbol: string | null): void {
  const now = stream.get();
  if (now && now.paperId === paperId && now.symbol === symbol && source) return;
  source?.close();
  source = null;
  if (paperId === null) { stream.set(null); return; }
  // Lines of the same run carry over while another contract's stream starts, and its bars as they last were.
  const kept = now?.paperId === paperId ? now : null;
  if (cached.paperId !== paperId) cached = { paperId, bars: new Map() };
  stream.set({ paperId, symbol, lines: kept?.lines ?? [], bars: (symbol && cached.bars.get(symbol)) || [], closes: {}, state: kept?.state ?? null,
               readings: kept?.readings ?? null, seal: kept?.seal ?? null, failures: kept?.failures ?? [], connected: false });
  const events = new EventSource(streamUrl(paperId, symbol));
  source = events;
  let first = true, firstCloses = true;
  const update = (f: (s: Stream) => Stream) => { const s = stream.get(); if (s && source === events) stream.set(f(s)); };
  events.addEventListener("lines", (event) => {
    const lines = JSON.parse((event as MessageEvent).data) as JournalLine[];
    const bars = lines.filter((l) => l.kind === "bar"), rest = lines.filter((l) => l.kind !== "bar");
    // The first batch is the whole journal again: it replaces what an earlier stream of the run gave.
    update((s) => {
      const next = { ...s, connected: true, lines: first ? again(s.lines, rest) : [...s.lines, ...rest], bars: first ? again(s.bars, bars) : [...s.bars, ...bars] };
      if (symbol) cached.bars.set(symbol, next.bars);
      return next;
    });
    first = false;
  });
  events.addEventListener("closes", (event) => {
    const found = JSON.parse((event as MessageEvent).data) as Record<string, [number, number][]>;
    // Like the lines, the first batch is every close so far.
    update((s) => ({ ...s, closes: firstCloses ? found : Object.fromEntries([...new Set([...Object.keys(s.closes), ...Object.keys(found)])]
      .map((k) => [k, [...(s.closes[k] ?? []), ...(found[k] ?? [])]])) }));
    firstCloses = false;
  });
  events.addEventListener("state", (event) => update((s) => ({ ...s, state: JSON.parse((event as MessageEvent).data) })));
  events.addEventListener("failures", (event) => update((s) => ({ ...s, failures: JSON.parse((event as MessageEvent).data) })));
  events.addEventListener("readings", (event) => update((s) => ({ ...s, readings: JSON.parse((event as MessageEvent).data) })));
  events.addEventListener("end", (event) => {
    update((s) => ({ ...s, seal: JSON.parse((event as MessageEvent).data) }));
    events.close();
  });
  events.onopen = () => { first = firstCloses = true; };  // a reconnected stream starts again from the whole journal
  events.onerror = () => update((s) => ({ ...s, connected: false }));
}
