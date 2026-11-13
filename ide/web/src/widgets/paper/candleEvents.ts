import { dateTime, type TimeZone } from "../../lib/time";
// What a contract chart marks of the run's events besides its trades: a flag along the pane's foot under
// the candle each happened in (one flag a candle, its letters the kinds there: G a gap in the bars, L a
// late bar, F a funding settlement, P a position its stops do not cover, R a refusal, X a rejected or
// denied order, S a socket's state, I the instrument's status), in the events' blue where something
// went wrong; and each gap in the bars as a hatched band from the last candle before it to the first
// after. The tooltips say the same in words: a flag's events, and an arrow's fills with what each paid
// and the order's tags (those its title does not already say), an exit's with how far the price ran for
// and against the trade while it was open.
import { candleOpen } from "../../lib/bars";
import { signedPct } from "../../lib/format";
import { lastAtOrBefore } from "../../lib/search";
import { amount, fixed, symbolOf, type JournalLine, type Precision } from "../../lib/paperApi";
import { describe, eventMs, word, type Fill } from "../../model/paper";
import type { TradeBox } from "./tradeBoxes";

export type Flag = { time: number; letters: string; warn: boolean; lines: readonly JournalLine[] };
export type Gap = { from: number; to: number };
export type Tip = { x: number; y: number; title: string; rows: readonly { text: string; faint?: boolean }[] };

const LETTER: Record<string, string> = { data_gap: "G", late_bar: "L", funding_settlement: "F", protection_gap: "P", refusal: "R", socket: "S", instrument_status: "I" };
const ORDER = "GPRXLFSI";  // a flag's letters in this order, the warnings first
const failed = (l: JournalLine) => l.kind === "order" && /Rejected|Denied/.test(String(l.type));
const letterOf = (l: JournalLine) => (failed(l) ? "X" : LETTER[l.kind]);
const warns = (letter: string) => "GPRX".includes(letter);
const ns = (value: unknown) => Number(value);
/** Distinct letters, the warnings first, three at most. */
export const ordered = (letters: string) => [...new Set(letters)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).slice(0, 3).join("");

/** The contract's events and order events (whose tags the tooltips read): its own lines and those of
 *  no contract (the sockets); every contract's with no `symbol`. */
export const eventsOf = (lines: readonly JournalLine[], symbol: string | null) =>
  lines.filter((l) => (letterOf(l) || l.kind === "order") && (symbol === null || !l.instrument_id || symbolOf(l.instrument_id) === symbol));

/** The open (s) of the candle at or before `t` among `times`, oldest first; null before the first. */
const snap = (times: readonly number[], t: number): number | null => times[lastAtOrBefore(times.length, (i) => times[i]!, t)] ?? null;

/** One flag a candle of `minutes`, at the candles drawn (`times`). A gap is flagged where the bars resume. */
export function flags(events: readonly JournalLine[], minutes: number, times: readonly number[]): Flag[] {
  const by = new Map<number, JournalLine[]>();
  for (const l of events.filter(letterOf)) {
    const t = snap(times, candleOpen(l.kind === "data_gap" ? ns(l.before_ts) : eventMs(l) * 1e6, minutes));
    if (t !== null) by.set(t, [...(by.get(t) ?? []), l]);
  }
  return [...by].sort(([a], [b]) => a - b).map(([time, lines]) => {
    const letters = ordered(lines.map(letterOf).join(""));
    return { time, letters, warn: [...letters].some(warns), lines };
  });
}

/** Each gap from the candle of its last bar to the candle of the bar after it, at `minutes`. */
export const gaps = (events: readonly JournalLine[], minutes: number): Gap[] =>
  events.filter((l) => l.kind === "data_gap").map((l) => ({ from: candleOpen(ns(l.after_ts), minutes), to: candleOpen(ns(l.before_ts), minutes) }));

const MAX_ROWS = 6;

/** An event in words for a tooltip whose title names its kind: a funding settlement by its rate and mark. */
function words(l: JournalLine, digits: ReadonlyMap<string, Precision>, zone: TimeZone): string {
  if (l.kind !== "funding_settlement") return describe(l, digits, zone);
  const rate = amount(l.stream_rate), d = digits.get(symbolOf(l.instrument_id));
  return [rate === null ? null : `Rate ${signedPct(rate, 4)}`, l.mark == null ? null : `mark ${fixed(l.mark, d?.price ?? -1)}`].filter(Boolean).join(" · ");
}

/** A flag's tooltip: each event's time and words, the newest few. */
export function flagTip(lines: readonly JournalLine[], digits: ReadonlyMap<string, Precision>, x: number, y: number, zone: TimeZone = "UTC"): Tip {
  const rows = lines.slice(-MAX_ROWS).flatMap((l) => [{ text: words(l, digits, zone) }, { text: dateTime(eventMs(l), zone), faint: true }]);
  const more = lines.length - MAX_ROWS;
  return { x, y, title: lines.length > 1 ? `${lines.length} events` : (failed(lines[0]!) ? "Order failed" : word(lines[0]!.kind)), rows: more > 0 ? [...rows, { text: `${more} more in Events`, faint: true }] : rows };
}

// Tags that only repeat what the title says (the fill's role or how it exited).
const SAID = new Set(["entry", "exit", "stop", "stop loss", "sl", "target", "take profit", "tp"]);

/** An arrow's tooltip: each fill on its candle and side with its price, the fee and whether it made or
 *  took liquidity, and the tags its order was given (`events` holds the orders' first events); for an
 *  exit, the run-up and drawdown of the trade it closed (`box`), from its average entry. */
export function fillTip(found: readonly Fill[], events: readonly JournalLine[], d: Precision, x: number, y: number, box?: TradeBox, zone: TimeZone = "UTC"): Tip {
  const tags = (id: unknown) => events.find((l) => l.kind === "order" && l.client_order_id === id && Array.isArray(l.tags))?.tags as string[] | undefined;
  const rows = found.slice(-MAX_ROWS / 2).flatMap((f) => {
    const l = f.line, fee = amount(l.commission), tagged = ((l.tags as string[] | undefined) ?? tags(l.client_order_id) ?? []).map((t) => word(t)).filter((t) => !SAID.has(t.toLowerCase()));
    return [
      { text: `${f.buy ? "Buy" : "Sell"} ${fixed(f.qty, d.size) ?? f.qty} @ ${fixed(f.px, d.price) ?? f.px} · ${word(l.order_type).toLowerCase()}` },
      { text: [fee === null ? null : `Fee ${fee.toFixed(2)} USDT`, l.liquidity_side ? word(l.liquidity_side) : null, tagged.length ? tagged.join(", ") : null].filter(Boolean).join(" · "), faint: true },
    ];
  });
  if (box?.best !== undefined && box.worst !== undefined) {
    const s = box.long ? 1 : -1;
    rows.push({ text: `Run-up ${signedPct(s * (box.best / box.entry - 1))} · drawdown ${signedPct(-Math.max(0, s * (1 - box.worst / box.entry)))}` });
  }
  return { x, y, title: `${found.length > 1 ? `${found.length} fills` : found[0]!.opening === null ? (found[0]!.buy ? "Buy" : "Sell") : found[0]!.opening ? "Entry" : `Exit${found[0]!.exit ? ` · ${found[0]!.exit}` : ""}`} · ${dateTime(found[0]!.ms, zone)}`, rows };
}
