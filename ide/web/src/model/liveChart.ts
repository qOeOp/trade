// What a live run's chart draws: its contract's minutes around the run and the run's own native fills. Live
// keeps no equity or bar series, so the window is read from the run's observations: its first native
// event or account observation to its terminal one, or now while it runs.
import { symbolOf } from "../lib/paperApi";
import type { LiveRun } from "./liveTrading";
import type { Fill } from "./paper";

type LiveChart = { symbol: string; from: number; to: number; running: boolean; fills: Fill[]; places: number; size: number };

const MINUTE = 60_000, PAD = 60 * MINUTE, LONGEST = 3 * 24 * 60 * MINUTE;
const ms = (ns: string | null | undefined) => (ns ? Number(ns) / 1e6 : NaN);
const decimals = (v: unknown) => (typeof v === "string" && v.includes(".") ? v.split(".")[1]!.length : 0);

/** The chart of `run` at `now` (ms), or null while nothing places it in time. */
export function liveChart(run: LiveRun, now: number): LiveChart | null {
  const symbol = run.symbols?.[0];
  if (!symbol) return null;
  const events = [...(run.orders ?? []), ...(run.positions ?? [])];
  const times = [...events.map((e) => ms(e.ts_event ?? e.observed_ns)), ms(run.observedNs?.account)].filter(Number.isFinite);
  if (!times.length) return null;
  const terminal = ms(run.observedNs?.terminal), running = run.running && !Number.isFinite(terminal);
  const start = Math.min(...times), end = Number.isFinite(terminal) ? terminal : running ? now : Math.max(...times);
  const to = Math.min(Math.ceil((end + PAD) / MINUTE) * MINUTE, Math.ceil(now / MINUTE) * MINUTE + MINUTE);
  const from = Math.max(Math.floor((start - PAD) / MINUTE) * MINUTE, to - LONGEST);
  // The native fills as they are: Live sums no fills and infers no position (live/views.py), and keeps only
  // the last of its events, so no fill is called an entry or an exit and no position box is drawn.
  const shown: Fill[] = (run.orders ?? []).flatMap((o) => {
    const at = ms(o.ts_event ?? o.observed_ns), px = Number(o.last_px), qty = Number(o.last_qty);
    return o.event_type === "OrderFilled" && symbolOf(o.instrument_id) === symbol && Number.isFinite(at) && o.last_px != null && o.last_qty != null && px > 0
      ? [{ ms: at, symbol, buy: o.order_side === "BUY", px, qty, opening: null, exit: null, line: { kind: "order", wall_ns: at * 1e6, ...o } }] : [];
  });
  const priced = (run.orders ?? []).flatMap((o) => [o.last_px, o.price, o.trigger_price]);
  return { symbol, from, to, running, fills: shown,
           places: Math.max(1, ...priced.map(decimals)), size: Math.max(0, ...(run.orders ?? []).flatMap((o) => [o.last_qty, o.quantity]).map(decimals)) };
}
