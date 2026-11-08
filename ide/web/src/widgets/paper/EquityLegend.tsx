import type { ReactNode } from "react";
import { fixed } from "../../lib/paperApi";
import type { Reading } from "../../model/equityReadings";
import { deepestDrawdown } from "../../model/joined";
import { TextButton } from "../../components/TextButton";
import { pnlClass } from "../../theme/roles";
import { dayMonth, during } from "./chartTheme";
import { downRows, type Down } from "./downLook";
import type { EquityPoint } from "./equityLayers";
import type { Placed } from "./equityStretches";

const number = (n: number, d: number) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/^-/, "−");
const signedPct = (r: number) => `${r >= 0 ? "+" : "−"}${number(Math.abs(r) * 100, 2)}%`;
const Swatch = ({ className }: { className: string }) => <i className={`inline-block w-3 ${className}`} />;
const Value = ({ name, children }: { name: string; children: ReactNode }) => <span><span className="mr-1 text-fg-faint">{name}</span>{children}</span>;

/** A stretch in words, for its name under the pointer: its dates, its own return and deepest drawdown. */
function About({ s, minutes }: { s: Placed; minutes: readonly EquityPoint[] }) {
  const own = minutes.slice(s.first, s.last + 1).filter((p) => !p.down).map((p) => [p.time, p.value / s.scale] as [number, number]);
  const end = own.at(-1)?.[1] ?? s.starting;
  return (
    <>
      <span className="text-fg">{s.label}</span><span>{dayMonth(new Date(s.from * 1000))} – {dayMonth(new Date(s.to * 1000))}</span>
      <span className={pnlClass(end - s.starting)}>{signedPct(end / s.starting - 1)}</span>
      <Value name="max drawdown">{number(deepestDrawdown(own, s.starting) * 100, 2)}%</Value>
      <span className="text-fg-faint">{s.selected ? "shown" : "click to show"}</span>
    </>
  );
}

/** The equity chart's readout, one row: at `point` (under the pointer, else the shown stretch's last),
 *  timed at the line's step (a backtest's day; the stretch is named on the chart, a lone one here at the head as `name`), its equity on the joined line
 *  and, past the first stretch, the stretch's own equity and return, and of a backtest's day the cycles
 *  it held, and on the shown stretch its worst below the peak, with how it was measured (`basis`) where
 *  that differs; over a stretch a chain of runs was offline, when it stopped, when it started again and
 *  why; over a stretch's name (`named`), that stretch in words. Its buy and hold, early so it is never
 *  left out, names a toggle for that line (`hold`, null with no contract's closes). Whole values only: one that does not fit is left
 *  out, never cut. `aside` (what is not drawn, how fresh the data is) ends the row on the right. */
export function EquityLegend({ name, point, stretch, named, minutes, offline, reading, hold, onHold, starting, replayed, worst, step, many, ret, basis, aside }: {
  name: string | null; point: EquityPoint | null; stretch: Placed | null; named: Placed | null; minutes: readonly EquityPoint[]; offline: Down | null; reading: Reading | null;
  hold: boolean | null; onHold: () => void; starting: number; replayed: ReadonlyMap<number, number>; worst: number; step: number; many: boolean; ret: number | undefined;
  basis: string | null; aside: ReactNode;
}) {
  const own = point && stretch ? point.value / stretch.scale : null, base = stretch ? stretch.starting * stretch.scale : starting;
  return (
    <div className="flex shrink-0 items-center gap-x-4 whitespace-nowrap text-small tabular-nums @max-md/page:flex-col @max-md/page:items-start @max-md/page:gap-y-1">
      <div className="flex h-5 min-w-0 flex-1 flex-wrap content-start items-center gap-x-3 overflow-clip leading-5 text-fg @max-md/page:h-20 @max-md/page:self-stretch">
        {named ? <About s={named} minutes={minutes} />
          : offline ? <><span className="text-fg">{offline.label}</span>{downRows(offline).map((r) => <span key={r}>· {r}</span>)}</>
          : point && <>
            {name && <span>{name}</span>}
            <span className="text-fg-faint">{during(point.time, point.day ? 86_400 : step)}</span>
            <span className="font-medium">{stretch && stretch.scale !== 1 && <span className="mr-1 font-normal text-fg-faint">normalized</span>}{fixed(point.value, 2)}</span>
            {own !== null && stretch && (stretch.scale !== 1
              ? <Value name="paper">{fixed(own, 2)} <span className={pnlClass(own - stretch.starting)}>{signedPct(own / stretch.starting - 1)}</span></Value>
              : <span className={pnlClass(own - stretch.starting)}>{signedPct(own / stretch.starting - 1)}</span>)}
            {!stretch && <span className={pnlClass(point.value - starting)}>{signedPct(point.value / starting - 1)}</span>}
            {hold !== null && <span><TextButton size="inline" active={hold} onClick={onHold} aria-label="Buy and hold line" title={hold ? "Hide buy and hold" : "Show buy and hold"} className="mr-1 gap-1 px-0.5">
              <Swatch className={`border-t border-dashed ${hold ? "border-fg/50" : "border-fg/25"}`} />hold</TextButton>{reading?.hold != null && <span className={pnlClass(reading.hold - base)}>{signedPct(reading.hold / base - 1)}</span>}</span>}
            {replayed.has(point.minute ?? point.time) && <Value name="replay">{fixed(replayed.get(point.minute ?? point.time)!, 2)}</Value>}
            {reading?.balance != null && <Value name="open"><span className={pnlClass(point.value - reading.balance)}>{fixed((point.value - reading.balance) / (stretch?.scale ?? 1), 2)}</span></Value>}
            {reading?.positions != null && <Value name="held">{reading.positions}</Value>}
            {reading?.exposure != null && <Value name="exposure">{number(reading.exposure * 100, 0)}%{reading.margin != null && reading.margin > 0 && <span className="text-fg-faint"> · margin {number(reading.margin * 100, 0)}%</span>}</Value>}
            {reading?.before != null && <Value name="costs">{fixed((reading.before - point.value) / (stretch?.scale ?? 1), 2)}</Value>}
            {point.pace !== null && <Value name="vs pace"><span className={pnlClass(point.value - point.pace)}>{signedPct(point.value / point.pace - 1)}</span></Value>}
            {many && ret != null && <Value name="day"><span className={pnlClass(ret)}>{signedPct(ret)}</span></Value>}
            <Value name="below peak">{number((1 - point.value / point.peak) * 100, 2)}%</Value>
            {worst > 0 && (!stretch || stretch.selected) && <Value name="worst">−{number(worst * 100, 1)}%{basis && <span className="text-fg-faint"> · {basis}</span>}</Value>}
          </>}
      </div>
      {aside && <div className="ml-auto flex min-w-0 max-w-[50%] items-center gap-x-3 text-fg-faint *:truncate @max-md/page:ml-0 @max-md/page:max-w-none @max-md/page:flex-wrap @max-md/page:whitespace-normal">{aside}</div>}
    </div>
  );
}
