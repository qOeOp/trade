// What a phone shows of a run at a glance (docs/plans/ide-phone-scope-20261111.zh.md): its equity, the last
// fill, what it holds and its working orders, and for Live how much of its loss threshold is used. Live's rows
// are its native events as they are (live/views.py keeps the last of them): a position's latest event, an
// order's latest event while it has not ended. Paper's come from the listing (paper/serve.py held()).
import type { LiveEventRow } from "../lib/liveTradingDto";
import { plural } from "../lib/format";
import { amount, symbolOf, type Listing, type PaperRun } from "../lib/paperApi";
import { START } from "./chain";
import type { LiveRun } from "./liveTrading";
import type { Coin } from "./market";

export type Held = { key: string; symbol: string; long: boolean; qty: number; entry: number | null; mark: number | null; pnl: number | null };
export type Working = { key: string; symbol: string; buy: boolean | null; qty: number | null; type: string; trigger: number | null; price: number | null; reduceOnly: boolean };
export type Fill = { ms: number; symbol: string; buy: boolean | null; qty: number | null; px: number | null };
/** A Live run's money: the equity it armed with, now, the result; its highest equity, how far below it equity is now
 *  and was at worst, how far the brake lets it fall and the equity it stops at (engine/live_brake.py). */
export type Money = { start: number; equity: number | null; result: number | null; peak: number | null; drawdown: number | null;
  deepest: number; room: number | null; stopsAt: number | null };
type LiveStatus = { word: string; tone: "meets" | "misses" | "fail" | "masked" };

const ENDED = new Set(["OrderFilled", "OrderCanceled", "OrderRejected", "OrderExpired", "OrderDenied"]);
const ms = (ns: string | number | null | undefined) => (ns == null || ns === "" ? NaN : Number(ns) / 1e6);
const at = (row: LiveEventRow) => ms(row.ts_event ?? row.observed_ns);
const num = (v: string | null | undefined) => (v == null ? null : amount(v));

/** The latest row of each key, in the rows' own time order. */
function latest(rows: readonly LiveEventRow[], key: (row: LiveEventRow) => string | null | undefined): LiveEventRow[] {
  const found = new Map<string, LiveEventRow>();
  for (const row of [...rows].sort((a, b) => (at(a) || 0) - (at(b) || 0))) {
    const k = key(row);
    if (k) found.set(k, row);
  }
  return [...found.values()];
}

/** The positions whose latest native event leaves them open. */
export function liveHeld(run: LiveRun): Held[] {
  return latest(run.positions ?? [], (r) => r.position_id).flatMap((r) => {
    const signed = num(r.signed_qty) ?? 0;
    if (r.event_type === "PositionClosed" || r.side === "FLAT" || signed === 0) return [];
    return [{ key: r.position_id!, symbol: symbolOf(r.instrument_id), long: signed > 0, qty: Math.abs(signed), entry: num(r.avg_px_open), mark: null, pnl: null }];
  });
}

/** Positions marked at the overview's Binance price where they have no mark of their own: the mark and the
 *  unrealised P&L it gives. An estimate for a glance; the account of record is Binance. */
export function marked(held: readonly Held[], coins: readonly Coin[] | undefined): Held[] {
  return held.map((h) => {
    const mark = h.mark ?? coins?.find((c) => c.symbol === h.symbol)?.price ?? null;
    return { ...h, mark, pnl: h.pnl ?? (mark === null || h.entry === null ? null : (mark - h.entry) * h.qty * (h.long ? 1 : -1)) };
  });
}

/** Whether a working order protects a held position: a trigger on the other side of its contract. */
export const protects = (o: Working, held: readonly Held[]) => o.trigger !== null && held.some((h) => h.symbol === o.symbol && o.buy === !h.long);
/** The working order protecting a held position. */
export const stopFor = (h: Held, working: readonly Working[]) => working.find((o) => protects(o, [h])) ?? null;

/** How far a stop's trigger is from the mark, as a share of the mark. */
export const away = (trigger: number | null, mark: number | null) => (trigger === null || mark === null || !mark ? null : Math.abs(trigger - mark) / mark);

/** The orders whose latest native event has not ended them. */
export function liveWorking(run: LiveRun): Working[] {
  return latest(run.orders ?? [], (r) => r.client_order_id).flatMap((r) => ENDED.has(r.event_type) ? [] : [{
    key: r.client_order_id!, symbol: symbolOf(r.instrument_id), buy: r.order_side == null ? null : r.order_side === "BUY",
    qty: num(r.quantity), type: (r.order_type ?? "order").toLowerCase().replace(/_/g, " "), trigger: num(r.trigger_price), price: num(r.price),
    reduceOnly: false,
  }]);
}

/** The run's last native fill. */
export function lastFill(run: LiveRun): Fill | null {
  const fills = (run.orders ?? []).filter((r) => r.event_type === "OrderFilled" && Number.isFinite(at(r)));
  const r = fills.sort((a, b) => at(a) - at(b)).at(-1);
  return r ? { ms: at(r), symbol: symbolOf(r.instrument_id), buy: r.order_side == null ? null : r.order_side === "BUY", qty: num(r.last_qty), px: num(r.last_px) } : null;
}

const factOf = (facts: readonly { label: string; value: string | null }[], label: string) => facts.find((f) => f.label === label)?.value ?? null;

export function liveMoney(run: LiveRun): Money | null {
  const start = run.equity?.budget ?? amount(factOf(run.config, "Equity at start (USDT)"));
  if (start == null) return null;
  const known = (run.equity?.minutes ?? []).flatMap(([, v]) => (v === null ? [] : [v]));
  const equity = known.at(-1) ?? null, brake = amount(factOf(run.config, "Drawdown brake"));
  // The brake counts from the highest equity it read; the chart's minutes are its own estimate between reads.
  const peak = Math.max(amount(factOf(run.config, "Highest equity (USDT)")) ?? start, ...known);
  let high = start, deepest = 0;
  for (const v of known) { high = Math.max(high, v); deepest = Math.max(deepest, high - v); }
  return { start, equity, result: equity === null ? null : equity - start, peak, drawdown: equity === null ? null : Math.max(0, peak - equity),
           deepest, room: brake === null ? null : peak * brake, stopsAt: brake === null ? null : peak * (1 - brake) };
}

/** The run's state as one coloured word, as the desktop's run picker says it. */
export const stopRequested = (run: LiveRun) => factOf(run.ending, "Stop requested") === "Yes";
export function liveStatus(run: LiveRun): LiveStatus {
  const state = run.hostState, stopping = stopRequested(run);
  if (state === "unresolved") return { word: "Unresolved", tone: "fail" };
  if (run.running) return stopping ? { word: "Stopping", tone: "misses" }
    : run.heldNotice ? { word: "Holding", tone: "misses" } : { word: "Running", tone: "meets" };
  if (run.ended) return { word: "Ended", tone: "masked" };
  return { word: state ? state.replace(/_/g, " ") : "Unknown", tone: "misses" };
}

/** The Runs button's dot, on the desktop's stripe and the phone's tab: red while a Live run is unresolved or the
 *  paper daemon does not answer, green while a Live or paper run runs. */
export const runsDot = (live: readonly LiveRun[], paper: Listing | null, service: string): "fail" | "meets" | undefined =>
  service === "offline" || live.some((r) => liveStatus(r).word === "Unresolved") ? "fail"
    : live.some((r) => r.running) || (paper?.running ?? 0) > 0 ? "meets" : undefined;

/** When the run was last observed: its account observation, else its terminal event, in ms. */
export const liveObserved = (run: LiveRun) => {
  const t = ms(run.observedNs.account ?? run.observedNs.terminal);
  return Number.isFinite(t) ? t : null;
};

/** A paper run's open positions as the runner's last state has them. */
export function paperHeld(run: PaperRun): Held[] {
  return (run.readings?.held?.positions ?? []).flatMap((p) => {
    const signed = amount(p.signed_qty) ?? 0;
    return signed === 0 ? [] : [{ key: p.position_id, symbol: symbolOf(p.instrument_id), long: signed > 0, qty: Math.abs(signed),
                                  entry: amount(p.avg_px_open), mark: amount(p.mark), pnl: amount(p.unrealized_pnl) }];
  });
}

/** What a paper run's listing says needs a look: missing and late bars, exceptions and protection gaps. */
export function paperIssues(run: PaperRun): { text: string; tone: "misses" | "fail" }[] {
  const l = run.readings, issues: { text: string; tone: "misses" | "fail" }[] = [];
  if (!l) return issues;
  if (l.protection_gaps) issues.push({ text: plural(l.protection_gaps, "protection gap"), tone: "fail" });
  if (l.missing_bars) issues.push({ text: plural(l.missing_bars, "missing bar"), tone: "misses" });
  if (l.late_bars) issues.push({ text: plural(l.late_bars, "late bar"), tone: "misses" });
  if (l.exceptions) issues.push({ text: plural(l.exceptions, "exception"), tone: "fail" });
  return issues;
}

/** A paper run's equity now and its outline as [seconds, equity], from the listing. */
export function paperEquity(run: PaperRun): { starting: number; equity: number | null; ret: number | null; points: [number, number][] } {
  const l = run.readings, starting = amount(l?.starting_balance_usdt) ?? START;
  const points = (l?.outline ?? []).map(([ns, v]) => [Math.floor(ns / 1e9), v] as [number, number]);
  return { starting, equity: amount(l?.final_equity_usdt ?? run.seal?.final_equity_usdt), ret: l?.total_return ?? run.total_return ?? null, points };
}
