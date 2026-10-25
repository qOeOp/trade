// The journal of the run the Paper page shows, as it grows: one stream from the daemon for the run and
// the contract its chart shows (every line but other contracts' bars), with state.json and the
// readings. The page's links: the time the chart should show and the event to highlight, the trades
// card's tab, and the day picked in the calendar.
import { streamUrl, type JournalLine, type Live, type PaperState, type Seal } from "../lib/paperApi";
import { CATEGORIES, type Category } from "../model/paper";
import { atom, useAtom } from "./atom";

export type Stream = {
  paperId: number; symbol: string | null; lines: JournalLine[]; bars: JournalLine[];
  state: PaperState | null; readings: Live | null; seal: Seal | null; connected: boolean;
};
export const stream = atom<Stream | null>(null);
export const useStream = () => useAtom(stream);

/** The chart scrolls to this time (ms); the Events list highlights this line. */
export const chartTime = atom<{ ms: number; n: number } | null>(null);
export const highlighted = atom<JournalLine | null>(null);
/** A UTC day (YYYY-MM-DD) the chart and the events are limited to, or null. */
export const pickedDay = atom<string | null>(null);
/** The tab the trades card shows; a click on a chart marker turns it to the events. */
export const tradesTab = atom<"trades" | "events">("trades");
/** The month (YYYY-MM) the calendar shows, or null for the run's latest. */
export const calendarMonth = atom<string | null>(null);
/** The event categories the Events list shows. */
export const shownCategories = atom<ReadonlySet<Category>>(new Set(CATEGORIES));

let n = 0;
export const showTime = (ms: number) => chartTime.set({ ms, n: ++n });

let source: EventSource | null = null;

/** Follows `paperId` with the bars of `symbol` (null: none), replacing the previous stream. */
export function follow(paperId: number | null, symbol: string | null): void {
  const now = stream.get();
  if (now && now.paperId === paperId && now.symbol === symbol && source) return;
  source?.close();
  source = null;
  if (paperId === null) { stream.set(null); return; }
  // Lines of the same run carry over while another contract's stream starts; its bars do not.
  const kept = now?.paperId === paperId ? now : null;
  stream.set({ paperId, symbol, lines: kept?.lines ?? [], bars: [], state: kept?.state ?? null,
               readings: kept?.readings ?? null, seal: kept?.seal ?? null, connected: false });
  const events = new EventSource(streamUrl(paperId, symbol));
  source = events;
  let first = true;
  const update = (f: (s: Stream) => Stream) => { const s = stream.get(); if (s && source === events) stream.set(f(s)); };
  events.addEventListener("lines", (event) => {
    const lines = JSON.parse((event as MessageEvent).data) as JournalLine[];
    const bars = lines.filter((l) => l.kind === "bar"), rest = lines.filter((l) => l.kind !== "bar");
    // The first batch is the whole journal again: it replaces what an earlier stream of the run gave.
    update((s) => ({ ...s, connected: true, lines: first ? rest : [...s.lines, ...rest], bars: first ? bars : [...s.bars, ...bars] }));
    first = false;
  });
  events.addEventListener("state", (event) => update((s) => ({ ...s, state: JSON.parse((event as MessageEvent).data) })));
  events.addEventListener("readings", (event) => update((s) => ({ ...s, readings: JSON.parse((event as MessageEvent).data) })));
  events.addEventListener("end", (event) => {
    update((s) => ({ ...s, seal: JSON.parse((event as MessageEvent).data) }));
    events.close();
  });
  events.onopen = () => { first = true; };  // a reconnected stream starts again from the whole journal
  events.onerror = () => update((s) => ({ ...s, connected: false }));
}
