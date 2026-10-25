import { useMemo } from "react";
import { pct } from "../../lib/format";
import { days, fills as fillsOf, utcDay } from "../../model/paper";
import type { Account } from "../../model/account";
import { IconButton } from "../../components/IconButton";
import { Tip } from "../../components/Tip";
import { useAtom } from "../../state/atom";
import { calendarMonth, pickedDay, type Stream } from "../../state/paperStream";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const TIP = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
// A day's tile in three steps of its return's size against the month's largest, profit green and loss
// red; a day flat to the shown hundredth of a percent takes the neutral tile.
const UP = ["bg-cal-up-1", "bg-cal-up-2", "bg-cal-up-3"], DOWN = ["bg-cal-down-1", "bg-cal-down-2", "bg-cal-down-3"];
const FLAT = 5e-5;
const monthOf = (m: string) => new Date(`${m}-01T00:00:00Z`);
const step = (m: string, by: number) => { const d = monthOf(m); d.setUTCMonth(d.getUTCMonth() + by); return d.toISOString().slice(0, 7); };
const signed = (r: number) => `${Math.abs(r) < FLAT ? "\u2007" : r > 0 ? "+" : "−"}${Math.abs(r * 100).toFixed(2)}`;

/** The run's month, Monday first: each day of the run a tile tinted by its return (three steps of
 *  size, against the month's largest), the return in figures on it, today outlined; days outside the
 *  run show only their date. The title counts the month's up and down days; the arrows page through the
 *  months the run spans. A click limits the chart and the events to that UTC day; a second click clears it. */
export function Calendar({ s, a }: { s: Stream | null; a: Account | null }) {
  const month = useAtom(calendarMonth);
  const picked = useAtom(pickedDay);
  const { list, months } = useMemo(() => {
    const list = days(a?.path ?? [], a?.starting ?? 100_000, fillsOf(s?.lines ?? []));
    const months = a?.start == null ? [] : [...new Set([utcDay(a.start).slice(0, 7), ...list.map((d) => d.day.slice(0, 7)), utcDay(a.end).slice(0, 7)])].sort();
    return { list, months };
  }, [a?.path, a?.start, a?.end, s?.lines]);
  const shown = month && months.includes(month) ? month : months[months.length - 1] ?? null;
  const at = shown ? months.indexOf(shown) : -1;
  const byDay = new Map(list.map((d) => [d.day, d]));
  const inMonth = list.filter((d) => shown && d.day.startsWith(shown));
  const largest = Math.max(1e-9, ...inMonth.map((d) => Math.abs(d.ret)));
  const today = utcDay(Date.now());
  const first = shown ? monthOf(shown) : null, lead = first ? (first.getUTCDay() + 6) % 7 : 0;
  const length = first ? new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate() : 0;
  return (
    <section aria-label="Calendar" className="flex min-h-0 flex-col gap-1.5 rounded-island bg-island px-5 pb-3.5 pt-3">
      <div className="flex h-7 items-center justify-between gap-2">
        <h2 className="text-h2 font-semibold tracking-[-0.01em]">{first ? MONTH.format(first) : "Calendar"}</h2>
        {shown && <span className="flex items-center gap-0.5 text-dense text-fg-muted">
          <span className="mr-1.5 tabular-nums"><span className="text-pnl-up">{inMonth.filter((d) => d.ret >= FLAT).length}</span> up · <span className="text-pnl-down">{inMonth.filter((d) => d.ret <= -FLAT).length}</span> down</span>
          <IconButton icon="chevron-left" label="Month before" disabled={at <= 0} onClick={() => calendarMonth.set(step(shown, -1))} />
          <IconButton icon="chevron-right" label="Month after" disabled={at >= months.length - 1} onClick={() => calendarMonth.set(step(shown, 1))} />
        </span>}
      </div>
      {!shown || a?.start == null ? <p className="py-2 text-dense text-fg-faint">No day yet: the run has not started</p> : <>
        <div className="grid grid-cols-7 gap-0.75">{WEEK.map((w) => <span key={w} className="pl-1.5 text-small text-fg-faint">{w}</span>)}</div>
        <div className="grid min-h-0 flex-1 grid-cols-7 gap-0.75 [grid-auto-rows:minmax(28px,1fr)]">
          {Array.from({ length: lead }, (_, i) => <span key={`lead-${i}`} />)}
          {Array.from({ length }, (_, i) => {
            const n = i + 1, day = `${shown}-${String(n).padStart(2, "0")}`, d = byDay.get(day);
            if (!d) return <span key={n} className="px-1.5 py-0.75 text-small text-fg-ghost">{n}</span>;
            const size = Math.abs(d.ret) / largest, k = size > 2 / 3 ? 2 : size > 1 / 3 ? 1 : 0;
            const flat = Math.abs(d.ret) < FLAT, tile = flat ? "bg-hover" : d.ret > 0 ? UP[k] : DOWN[k];
            const tip = `${TIP.format(new Date(`${day}T00:00:00Z`))} · ${d.ret > 0 ? "+" : ""}${pct(d.ret)} that day · ${d.fills} fills`;
            return (
              <Tip key={n} content={tip}>
                <span role="button" tabIndex={0} aria-pressed={picked === day} aria-label={tip}
                      onClick={() => pickedDay.set(picked === day ? null : day)} onKeyDown={(e) => { if (e.key === "Enter") pickedDay.set(picked === day ? null : day); }}
                      className={`flex min-h-0 cursor-default flex-col justify-between rounded-card px-1.5 py-0.75 text-small outline-none transition-shadow hover:ring-1 hover:ring-inset hover:ring-line-strong focus-visible:ring-2 focus-visible:ring-focus ${tile} ${day === today ? "ring-1 ring-inset ring-fg-muted" : ""} ${picked === day ? "ring-2 ring-inset ring-focus" : ""}`}>
                  <span className={day === today ? "font-semibold text-fg" : "text-fg-faint"}>{n}</span>
                  <span className={`whitespace-pre text-right tabular-nums ${flat ? "text-fg-muted" : "text-fg"}`}>{signed(d.ret)}</span>
                </span>
              </Tip>
            );
          })}
        </div>
      </>}
    </section>
  );
}
