import type { LiveRunDto } from "../lib/liveTradingDto";

/** What a start that found a position or open orders it inherited means for the user (engine.live held; the
 *  user's decision of 2026-11-13, docs/plans/live-continuous-step4-resume-20261113.zh.md), before its first check of
 *  the stops at Binance and by what each check then shows (finding 20261114-24). Telegram says the same
 *  (live/notify.py HELD_TEXT, held_text). */
export const HELD_NOTICE = "This run started again and found a position or open orders it inherited. The strategy no "
  + "longer manages its exits and opens nothing, and the run cancels entry orders it inherited. Whether each position "
  + "has its stop at Binance is being checked, now and every 30 seconds. The run trades again by itself once the "
  + "account is flat; close the position at Binance if you want to end it sooner.";
const HELD_END = " The run trades again by itself once the account is flat.";
export const HELD_COVERED_NOTICE = "This run holds only positions that have their stop at Binance (stops of at least "
  + "each position's size, read every 30 seconds), and no entry order is working. Nothing else protects them: the "
  + "strategy does not manage their exits." + HELD_END + " Close the position at Binance if you want to end it sooner.";
export const HELD_ORDERS_NOTICE = "This run holds no position, but orders are still open at Binance." + HELD_END
  + " Cancel them at Binance if nothing needs them.";
export const HELD_UNREADABLE_NOTICE = "This run cannot verify that its positions have stops: Binance's answer could "
  + "not be read. It only observes while it holds: check the position and its stop at Binance now.";

type Restart = NonNullable<LiveRunDto["restarts"]>[number];

/** A held start's failed check, as Telegram words it (live/notify.py held_text). */
export function heldUncoveredNotice(row: Restart): string {
  if (row.unreadable) return HELD_UNREADABLE_NOTICE;
  const parts: string[] = [];
  if (row.uncovered?.length) parts.push("has a position with NO STOP at Binance: "
    + row.uncovered.map((p) => `${p.symbol ?? "?"} ${p.side ?? "?"} ${p.position ?? "?"} (stops ${p.stops ?? "?"})`).join("; ")
    + ". Nothing will close it: the run only observes while it holds. Close it or place a stop at Binance now.");
  if (row.entries) parts.push(row.entries_kept
    ? `could NOT cancel ${row.entries} inherited entry order(s): they are still working at Binance. A fill has no stop: cancel them at Binance now.`
    : `has ${row.entries} inherited entry order(s) working at Binance and is cancelling them. A fill before they are gone has no stop.`);
  return "This run " + parts.join(" It also ");
}

/** The notice while a run that has not ended holds in its latest start: no later start, and the account not yet seen
 *  flat. It follows the start's latest check of the stops at Binance. */
export function heldNotice(restarts: readonly Restart[]): string | null {
  const rows = [...restarts].reverse();  // latest first
  const at = rows.findIndex((row) => row.event === "resuming" || row.event === "venue_flat_while_held");
  const latest = rows[at];
  if (latest?.event !== "resuming" || latest.held !== true) return null;
  const verdict = rows.slice(0, at).find((row) => row.event === "held_covered" || row.event === "held_uncovered");
  if (!verdict) return HELD_NOTICE;
  if (verdict.event === "held_covered") return verdict.holding === 0 ? HELD_ORDERS_NOTICE : HELD_COVERED_NOTICE;
  return heldUncoveredNotice(verdict);
}
