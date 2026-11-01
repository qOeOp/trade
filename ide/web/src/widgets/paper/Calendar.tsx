import { useMemo } from "react";
import { pct } from "../../lib/format";
import { days, fills as fillsOf, utcDay } from "../../model/paper";
import type { Account } from "../../model/account";
import { IconButton } from "../../components/IconButton";
import { Section } from "../../components/Section";
import { Tip } from "../../components/Tip";
import { useAtom } from "../../state/atom";
import { calendarMonth, pickedDay, type Stream } from "../../state/paperStream";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const TIP = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const WEEK_DAYS = 7;  // a run shorter than a week opens its calendar folded
// A day's tile in three steps of its return's size against the month's largest, profit green and loss
// red; a day flat to the shown hundredth of a percent takes the neutral tile.
const UP = ["bg-cal-up-1", "bg-cal-up-2", "bg-cal-up-3"], DOWN = ["bg-cal-down-1", "bg-cal-down-2", "bg-cal-down-3"];
const FLAT = 5e-5;
const monthOf = (m: string) => new Date(`${m}-01T00:00:00Z`);
const step = (m: string, by: number) => { const d = monthOf(m); d.setUTCMonth(d.getUTCMonth() + by); return d.toISOString().slice(0, 7); };
// The size alone: the tile's colour says up or down.
const size = (r: number) => Math.abs(r * 100).toFixed(2);

/** The paper run's month as a card in Details, Monday first, as Binance's P&L calendar: each day of the
 *  run a tile tinted by its return (three steps of size, against the month's largest) with its date over
 *  the return's size in percent, both centred, today outlined; days outside the run show only their
 *  date, centred. The title names the month; under it the month's up and down days and the arrows that
 *  page through the months the run spans. A click limits the chart and the events to that UTC day; a
 *  second click clears it. Folded while the run is shorter than a week. */
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
    <Section title={first ? `${MONTH.format(first)} · paper` : "Calendar"} open={list.length >= WEEK_DAYS}>
      {!shown || a?.start == null ? <p className="text-fg-faint">No day yet: the run has not started</p> : <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 text-fg-muted">
          <span className="tabular-nums"><span className="text-pnl-up">{inMonth.filter((d) => d.ret >= FLAT).length}</span> up · <span className="text-pnl-down">{inMonth.filter((d) => d.ret <= -FLAT).length}</span> down</span>
          <span className="flex items-center gap-0.5">
            <IconButton icon="chevron-left" label="Month before" disabled={at <= 0} onClick={() => calendarMonth.set(step(shown, -1))} />
            <IconButton icon="chevron-right" label="Month after" disabled={at >= months.length - 1} onClick={() => calendarMonth.set(step(shown, 1))} />
          </span>
        </div>
        <div className="grid grid-cols-7 gap-0.75">{WEEK.map((w) => <span key={w} className="text-center text-small text-fg-faint">{w}</span>)}</div>
        <div className="grid grid-cols-7 gap-0.75 auto-rows-9">
          {Array.from({ length: lead }, (_, i) => <span key={`lead-${i}`} />)}
          {Array.from({ length }, (_, i) => {
            const n = i + 1, day = `${shown}-${String(n).padStart(2, "0")}`, d = byDay.get(day);
            if (!d) return <span key={n} className="grid place-items-center text-small text-fg-ghost">{n}</span>;
            const share = Math.abs(d.ret) / largest, k = share > 2 / 3 ? 2 : share > 1 / 3 ? 1 : 0;
            const flat = Math.abs(d.ret) < FLAT, tile = flat ? "bg-hover" : d.ret > 0 ? UP[k] : DOWN[k];
            const tip = `${TIP.format(new Date(`${day}T00:00:00Z`))} · ${d.ret > 0 ? "+" : ""}${pct(d.ret)} that day · ${d.fills} fills`;
            return (
              <Tip key={n} content={tip}>
                <span role="button" tabIndex={0} aria-pressed={picked === day} aria-label={tip}
                      onClick={() => pickedDay.set(picked === day ? null : day)} onKeyDown={(e) => { if (e.key === "Enter") pickedDay.set(picked === day ? null : day); }}
                      className={`flex min-h-0 cursor-default flex-col items-center justify-center gap-0.5 rounded-card text-small outline-none transition-shadow hover:ring-1 hover:ring-inset hover:ring-line-strong focus-visible:ring-2 focus-visible:ring-focus ${tile} ${day === today ? "ring-1 ring-inset ring-fg-muted" : ""} ${picked === day ? "ring-2 ring-inset ring-focus" : ""}`}>
                  <span className={day === today ? "font-semibold text-fg" : "text-fg-faint"}>{n}</span>
                  <span className={`tabular-nums ${flat ? "text-fg-muted" : "text-fg"}`}>{size(d.ret)}</span>
                </span>
              </Tip>
            );
          })}
        </div>
      </div>}
    </Section>
  );
}
