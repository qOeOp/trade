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

/** The equity chart's legend in two rows. The first names its layers, whole items only (one that does not
 *  fit is left out, never cut), the buy and hold a toggle (`hold`, null with no contract's closes). The
 *  second reads them at `point` (under the pointer, else the shown stretch's last), timed at the line's
 *  step after its stretch's name, its equity on the joined line and, past the first stretch, the
 *  stretch's own equity and return; over a stretch a chain of runs was offline, when it stopped, when it
 *  started again and why; over a stretch's name (`named`), that stretch in words. */
export function EquityLegend({ point, stretch, named, minutes, offline, reading, hold, onHold, starting, annual, replayed, worst, step, many, ret }: {
  point: EquityPoint | null; stretch: Placed | null; named: Placed | null; minutes: readonly EquityPoint[]; offline: Down | null; reading: Reading | null;
  hold: boolean | null; onHold: () => void; starting: number; annual: number | null; replayed: ReadonlyMap<number, number>; worst: number; step: number; many: boolean; ret: number | undefined;
}) {
  const against = annual === null ? "start" : "pace", own = point && stretch ? point.value / stretch.scale : null, base = stretch ? stretch.starting * stretch.scale : starting;
  return (
    <div className="flex shrink-0 flex-col whitespace-nowrap text-small tabular-nums text-fg-muted">
      <div className="flex h-5 min-w-0 flex-wrap content-start items-center gap-x-3.5 overflow-hidden leading-5">
        <span className="inline-flex items-center gap-1.5"><Swatch className="h-0.5 rounded-full bg-equity shadow-[0_1px_2px_rgb(0_0_0/0.25)]" />Equity</span>
        {replayed.size > 0 && <span className="inline-flex items-center gap-1.5"><Swatch className="border-t border-dotted border-equity" />Replay</span>}
        {annual !== null && <span className="inline-flex items-center gap-1.5"><Swatch className="border-t border-dashed border-fg-muted" />Pace for {number(annual * 100, 0)}% a year</span>}
        <span className="inline-flex items-center gap-1.5"><Swatch className="h-2 rounded-badge bg-pnl-up/40" /><Swatch className="-ml-1 h-2 rounded-badge bg-pnl-down/40" />Ahead · behind {against}</span>
        <span className="inline-flex items-center gap-1.5"><Swatch className="h-2 bg-pnl-up/20" /><Swatch className="-ml-1 h-2 bg-pnl-down/20" />Open profit and loss</span>
        <span className="inline-flex items-center gap-1.5"><span className="grid w-3 grid-cols-4 gap-0.5">{[1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0].map((on, i) => <i key={i} className={`size-px ${on ? "bg-fg-faint" : ""}`} />)}</span><span>Below the peak{worst > 0 && <span className="text-fg-faint">, worst −{number(worst * 100, 1)}%</span>}</span></span>
        <span className="inline-flex items-center gap-1.5"><Swatch className="h-2 border-t border-b-2 border-t-fg-muted/45 border-b-equity bg-fg/10" />Fees and funding</span>
        <span className="inline-flex items-center gap-1.5"><Swatch className="h-2 border-t border-equity/50 bg-equity/10" />Exposure</span>
        {hold !== null && <TextButton active={hold} onClick={onHold} className="h-5 gap-1.5"><Swatch className="border-t border-dashed border-fg/30" />Buy and hold</TextButton>}
        {many && <span className="inline-flex items-center gap-1.5"><i className="h-2 w-1 bg-pnl-up/60" /><i className="-ml-1 h-1.5 w-1 bg-pnl-down/60" />Daily return</span>}
      </div>
      <div className="flex h-5 min-w-0 items-center gap-3 overflow-hidden leading-5">
        {named ? <About s={named} minutes={minutes} />
          : offline ? <><span className="text-fg">{offline.label}</span>{downRows(offline).map((r) => <span key={r}>· {r}</span>)}</>
          : point && <>
            {stretch && <span className="text-fg-faint">{stretch.label}</span>}
            <span className="text-fg-faint">{during(point.time, step)}</span>
            <span className="text-fg">{fixed(point.value, 2)}</span>
            {own !== null && stretch && (stretch.scale !== 1
              ? <span className="text-fg-faint">(run {fixed(own, 2)} · <span className={pnlClass(own - stretch.starting)}>{signedPct(own / stretch.starting - 1)}</span>)</span>
              : <span className={pnlClass(own - stretch.starting)}>{signedPct(own / stretch.starting - 1)}</span>)}
            {!stretch && <span className={pnlClass(point.value - starting)}>{signedPct(point.value / starting - 1)}</span>}
            {replayed.has(point.minute ?? point.time) && <Value name="replay">{fixed(replayed.get(point.minute ?? point.time)!, 2)}</Value>}
            {reading?.balance != null && <Value name="open"><span className={pnlClass(point.value - reading.balance)}>{fixed(point.value - reading.balance, 2)}</span></Value>}
            {reading?.exposure != null && <Value name="exposure">{number(reading.exposure * 100, 0)}%{reading.margin != null && reading.margin > 0 && <span className="text-fg-faint"> · margin {number(reading.margin * 100, 0)}%</span>}</Value>}
            {reading?.before != null && <Value name="costs">{fixed(reading.before - point.value, 2)}</Value>}
            {reading?.hold != null && <Value name="hold"><span className={pnlClass(reading.hold - base)}>{signedPct(reading.hold / base - 1)}</span></Value>}
            {point.pace !== null && <Value name="vs pace"><span className={pnlClass(point.value - point.pace)}>{signedPct(point.value / point.pace - 1)}</span></Value>}
            {many && ret != null && <Value name="day"><span className={pnlClass(ret)}>{signedPct(ret)}</span></Value>}
            <Value name="below peak">{number((1 - point.value / point.peak) * 100, 2)}%</Value>
          </>}
      </div>
    </div>
  );
}
