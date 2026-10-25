import { useMemo } from "react";
import { amount } from "../../lib/paperApi";
import { pct } from "../../lib/format";
import { days, fills as fillsOf, type Day } from "../../model/paper";
import { useAtom } from "../../state/atom";
import { pickedDay, useStream } from "../../state/paperStream";

/** A run this many days old or older gets the Calendar tool window. */
export const CALENDAR_DAYS = 7;
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Literal classes so Tailwind finds each: the day's colour deepens with the size of its return.
const UP = ["bg-meets/10", "bg-meets/20", "bg-meets/35", "bg-meets/50"], DOWN = ["bg-fail/10", "bg-fail/20", "bg-fail/35", "bg-fail/50"];
const depth = (ret: number) => [0.0025, 0.01, 0.02].filter((step) => Math.abs(ret) >= step).length;

function Month({ month, byDay, picked }: { month: string; byDay: ReadonlyMap<string, Day>; picked: string | null }) {
  const first = new Date(`${month}-01T00:00:00Z`);
  const length = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  return (
    <section className="space-y-1">
      <h3 className="text-dense font-semibold">{first.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</h3>
      <div className="grid grid-cols-[repeat(7,4.5rem)] gap-1 text-small">
        {WEEK.map((w) => <span key={w} className="text-fg-faint">{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`-${i}`} />)}
        {Array.from({ length }, (_, i) => {
          const day = `${month}-${String(i + 1).padStart(2, "0")}`, d = byDay.get(day);
          const tone = d ? (d.ret >= 0 ? UP : DOWN)[depth(d.ret)] : "";
          return (
            <div key={day} role={d ? "button" : undefined} aria-pressed={d ? picked === day : undefined}
                 onClick={d ? () => pickedDay.set(picked === day ? null : day) : undefined}
                 className={`h-12 rounded-control border px-1.5 py-1 ${d ? `cursor-default transition-colors hover:border-line-strong ${tone}` : "text-fg-ghost"} ${picked === day ? "border-focus" : "border-line"}`}>
              <div className="text-fg-faint">{i + 1}</div>
              {d && <div className="flex items-baseline justify-between"><span className={d.ret < 0 ? "text-fail" : "text-fg"}>{pct(d.ret)}</span><span className="text-fg-faint">{d.fills}</span></div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Each UTC day of the run as a cell, coloured by its return (green up, red down, deeper for more), with
 *  its return and fills; a click limits the chart and the events to that day, a second click clears it. */
export function Calendar() {
  const s = useStream();
  const picked = useAtom(pickedDay);
  const found = useMemo(() => days(s?.readings?.equity ?? [], amount(s?.readings?.starting_balance_usdt) ?? 100_000, fillsOf(s?.lines ?? [])),
    [s?.readings, s?.lines]);
  const byDay = useMemo(() => new Map(found.map((d) => [d.day, d])), [found]);
  const months = [...new Set(found.map((d) => d.day.slice(0, 7)))];
  if (!found.length) return <p className="p-3 text-dense text-fg-faint">No full day yet</p>;
  return <div className="flex flex-wrap gap-6 p-3">{months.map((m) => <Month key={m} month={m} byDay={byDay} picked={picked} />)}</div>;
}
