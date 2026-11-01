import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CrosshairMode, LineStyle, type UTCTimestamp } from "lightweight-charts";
import { utc } from "../../model/paper";
import { useAtom } from "../../state/atom";
import { pickedDay, pickedTrade, tradesTab } from "../../state/paperStream";
import { useResolvedTheme } from "../../state/theme";
import { canvasColor } from "../../theme/roles";
import { afterFonts, chartLook, priceFormat, seriesColors } from "./chartTheme";
import type { Down } from "./downLook";
import { equityApi, type Api, type Now } from "./equityApi";
import { EquityExtras } from "./equityExtras";
import { EquityLegend } from "./EquityLegend";
import { FEW } from "./equityLayers";
import type { Close } from "./equityCloses";
import { resample, STEPS } from "./equityResolution";
import { covered, firstView, lastWhere, stepOver, type Line } from "./equityStretches";
import { glide } from "./glide";
import { BELOW } from "./stretchCaptions";
import { showStretch, stretchKey } from "./stretchKeys";
import { restore, spacing, timeAt, whenSettled } from "./viewAnchor";

const at = (t: number) => t as UTCTimestamp;
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
const views = new Map<string, { step: number; from: number; to: number }>();  // the view each set of stretches had last, for the session

/** The account over the version's stretches (equityStretches.ts: its backtest a point a day, its paper
 *  runs a point a minute) as one line, after vibe-trading's daily-returns chart: equity as its indigo hero line; the pace the line's minimum annual
 *  return asks for as a dashed line, the gap filled green ahead and red behind (against the start with no
 *  return target); behind them the drawdown from the peak hanging from the top and, of the shown stretch,
 *  each day's return from the bottom and the stretches a position was held (equityLayers), any stretch a
 *  chain of runs was offline over all of them; on the line the drawdown limit's floor and the shown
 *  stretch's deepest drawdowns (equityNotes) and an arrow at each of its closes (equityCloses), whose click
 *  picks the trade; the balance, the costs' band, a buy and hold, and the exposure (equityExtras); a
 *  reconciled run's replay dotted. Each stretch is named at its start (stretchCaptions), a click on the
 *  name shows it and fits the view to it.
 *  The line is drawn at the finest step that keeps the points in view at least a pixel and a half apart
 *  (equityResolution, counting the points, as the time between stretches takes no room), changed once a
 *  pan or zoom settles with the moment under the pointer kept in place (viewAnchor). It first shows the
 *  shown stretch with the end of the one before it (firstView), or the view these stretches last had.
 *  Wheel or drag the time axis to zoom, drag to pan, double-click for all of it; the keys are
 *  stretchKeys'. The legend names the layers, and gives their values under the pointer; `note` says
 *  what of the backtest is not drawn. */
export function EquityChart({ line, remembers, replay = null, annual, limit = null, closes = [], held = [], warmup = null, note = null }: {
  line: Line; remembers: string; replay?: readonly [number, number][] | null; annual: number | null;
  limit?: number | null; closes?: readonly Close[]; held?: readonly [number, number][]; warmup?: number | null; note?: string | null;
}) {
  const { minutes, placed, restarts, readings, days, drops, sealed } = line;
  const host = useRef<HTMLDivElement>(null), api = useRef<Api | null>(null);
  const [step, setStep] = useState<number>(STEPS[0]);
  const stepRef = useRef<number>(STEPS[0]);
  const keep = useRef<{ t: number; x: number; w: number } | null>(null);
  const refit = useRef(false), theme = useResolvedTheme();
  const day = useAtom(pickedDay);
  const [hover, setHover] = useState<number | null>(null), [off, setOff] = useState<Down | null>(null), [named, setNamed] = useState<number | null>(null);
  const [hold, setHold] = useState(false);
  const points = useMemo(() => resample(minutes, step), [minutes, step]);
  const worst = useMemo(() => minutes.reduce((w, p) => Math.max(w, 1 - p.value / p.peak), sealed), [minutes, sealed]);
  const shown = placed.findIndex((p) => p.selected), own = placed[shown], starting = placed[0]?.starting ?? 100_000;
  const many = !!own && own.to - own.from >= FEW;
  // The backtest's as sealed, at bar closes; a paper stretch's from its minutes.
  const worstShown = useMemo(() => (own?.run === null ? sealed : own ? minutes.slice(own.first, own.last + 1).reduce((w, p) => Math.max(w, 1 - p.value / p.peak), 0) : worst), [minutes, own, worst, sealed]);
  const now = useRef<Now>({ points, shown, starting }), stretches = useRef(placed), minutesRef = useRef(minutes), rememberRef = useRef(remembers);
  now.current = { points, shown, starting }; stretches.current = placed; minutesRef.current = minutes; rememberRef.current = remembers;
  const fitted = useRef<string | null>(null), layout = placed.map((p) => `${p.label}:${p.from}`).join();
  const extras = useMemo(() => new EquityExtras(), []);
  const fit = (k: number) => { const p = stretches.current[k], time = api.current?.chart.timeScale(); if (p && time) glide(time, { from: p.from, to: p.to }); };
  const whole = () => { const d = api.current?.equity.data(), time = api.current?.chart.timeScale(); if (d?.length && time) glide(time, { from: d[0]!.time as number, to: d.at(-1)!.time as number }); };

  useEffect(() => {
    const a = equityApi(host.current!, extras, () => now.current), time = a.chart.timeScale();
    // Once the view has settled: the step chosen anew for the points in view, the time under the pointer
    // kept where it is across the redraw (the effect drawing the points puts it back).
    const release = whenSettled(host.current!, time, (x) => {
      const r = time.getVisibleRange(), step = stepRef.current;
      a.ticks.refresh();
      if (!r || !time.width()) return;
      const next = stepOver(minutesRef.current, r.from as number, r.to as number, time.width(), step);
      if (next === step) return;
      // The spacing scaled by the points in view before and after: the backtest's days stay one each.
      const anchor = x ?? time.width() / 2, t = timeAt(time, a.equity.data().map((d) => d.time as number), step, anchor);
      const { span, days } = covered(minutesRef.current, r.from as number, r.to as number);
      keep.current = t === null ? null : { t, x: anchor, w: (spacing(time) * (days + span / step)) / (days + span / next) };
      stepRef.current = next;
      setStep(next);
    });
    a.chart.subscribeCrosshairMove((param) => {
      setHover(param.logical === undefined || !param.point ? null : Math.round(param.logical));
      setOff(param.point ? a.layers.offlineAt(param.point.x) : null);
      setNamed(param.point ? a.captions.at(param.point.x, param.point.y) : null);
      // The pointer's tag sits at the equity it snaps to.
      const value = param.point ? (param.seriesData.get(a.equity) as { value: number } | undefined)?.value : undefined;
      a.ticks.cross(param.point?.x ?? null, value === undefined ? null : a.equity.priceToCoordinate(value));
      // No pointer's dot over a close's arrow.
      const onArrow = String(param.hoveredObjectId ?? "").startsWith("close:");
      if (onArrow === a.equity.options().crosshairMarkerVisible) a.equity.applyOptions({ crosshairMarkerVisible: !onArrow });
    });
    a.chart.subscribeClick((param) => {
      const id = String(param.hoveredObjectId ?? ""), k = param.point ? a.captions.at(param.point.x, param.point.y) : null;
      if (id.startsWith("close:")) { pickedTrade.set(id.slice(6)); tradesTab.set("trades"); }
      else if (k !== null) { showStretch(stretches.current[k]!); fit(k); }
    });
    host.current!.addEventListener("dblclick", whole);
    api.current = a;
    return () => {
      const r = time.getVisibleRange();
      if (r) views.set(rememberRef.current, { step: stepRef.current, from: r.from as number, to: r.to as number });
      release(); extras.destroy(); a.chart.remove(); api.current = null;
    };
  }, []);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    // The pointer snaps to the equity line, its dot hollowed in the island's colour.
    const c = seriesColors(theme === "dark"), apply = () => { api.current?.chart.applyOptions(chartLook()); api.current?.ticks.refresh(); api.current?.chart.applyOptions({ crosshair: { mode: CrosshairMode.Magnet }, grid: { horzLines: { visible: false } } }); };
    apply();
    afterFonts(apply);
    a.pace.applyOptions({ color: canvasColor("fg-muted", 0.9), visible: annual !== null });
    a.replay.applyOptions({ color: c.layers.line });
    a.equity.applyOptions({ color: c.layers.line, crosshairMarkerBorderColor: c.layers.line, crosshairMarkerBackgroundColor: c.island });
    if (a.start) a.equity.removePriceLine(a.start);
    // The start as a line only where it is what the gap is measured against; with a pace, which starts
    // there, only its tag.
    a.start = a.equity.createPriceLine({ price: starting, color: c.ghost, lineWidth: 1, lineStyle: LineStyle.Solid, lineVisible: annual === null, axisLabelVisible: true, axisLabelColor: c.tag, axisLabelTextColor: c.fg, title: "" });
  }, [theme, starting, annual]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    // The first view whenever the stretches change (one more read, or another version's), at the step it
    // takes: the view these stretches had last, else the shown stretch with the end of the one before.
    const saved = views.get(remembers);
    if (minutes.length && fitted.current !== layout) {
      fitted.current = layout;
      refit.current = true;
      const width = a.chart.timeScale().width() || host.current!.clientWidth;
      const first = saved?.step ?? (own ? stepOver(minutes, own.from, own.to, width, 0, own.first > 0 ? 100 / 85 : 1) : stepOver(minutes, -Infinity, Infinity, width, 0));
      if (first !== step) { stepRef.current = first; setStep(first); return; }
    }
    a.equity.setData(points.map((p) => (p.down ? { time: at(p.time) } : { time: at(p.time), value: p.value })));
    a.pace.setData(annual === null ? [] : points.map((p) => (p.down ? { time: at(p.time) } : { time: at(p.time), value: p.pace! })));
    a.fenced();
    const time = a.chart.timeScale();
    if (refit.current) {
      refit.current = false; keep.current = null;
      const view = firstView(points, shown);
      // Or the day picked before there were points to glide on.
      if (day) glide(time, { from: Math.max(points[0]!.time, dayStart(day)), to: Math.min(points.at(-1)!.time, dayStart(day) + 86_400) });
      else if (saved) time.setVisibleRange({ from: at(saved.from), to: at(saved.to) });
      else if (view) time.setVisibleLogicalRange({ from: view.from, to: view.to === points.length - 1 ? view.to + 6 : view.to });
      else time.fitContent();
    } else if (keep.current) { const k = keep.current; keep.current = null; restore(time, points.map((p) => p.time), step, k.t, k.x, k.w); }
  }, [points, annual]);

  useEffect(() => {
    const c = seriesColors(theme === "dark");
    api.current?.layers.set(points, days, day ? dayStart(day) : null, starting, worst, held, c.layers, restarts, own ? [own.from, own.to] : null, BELOW);
    api.current?.notes.set(points, minutes, limit, c.notes, priceFormat(0).formatter, starting, shown >= 0 ? shown : null, drops);
    api.current?.closes.set(points, closes, c.closes);
    api.current?.captions.set(placed.map((p) => ({ label: p.label, selected: p.selected, from: p.from })), c.captions);
    extras.set({ points, readings, hold, look: c.extras });
    api.current?.layers.lift(extras.foot());
    api.current?.notes.lift(extras.foot());
  }, [points, minutes, days, day, starting, worst, held, limit, closes, readings, hold, theme, restarts, placed, drops]);

  const replayed = useMemo(() => new Map((replay ?? []).map(([ns, value]) => [Math.floor(ns / 1e9), value])), [replay]);
  useEffect(() => {
    api.current?.replay.setData(points.filter((p) => replayed.has(p.minute ?? p.time)).map((p) => ({ time: at(p.time), value: replayed.get(p.minute ?? p.time)! })));
  }, [points, replayed]);

  useEffect(() => {
    const a = api.current;
    if (!a || !day || !minutes.length || !a.equity.data().length) return;
    glide(a.chart.timeScale(), { from: Math.max(minutes[0]!.time, dayStart(day)), to: Math.min(minutes.at(-1)!.time, dayStart(day) + 86_400) });
  }, [day, minutes.length > 0]);

  // Under the pointer its point, else the shown stretch's last.
  const i = !off && named === null && hover !== null && hover >= 0 && hover < points.length && !points[hover]!.down ? hover : own ? lastWhere(points, (p) => p.stretch === shown && !p.down) : -1;
  const p = points[i] ?? null, mine = p !== null && p.stretch === shown;
  const today = p && mine ? [...days].reverse().find((d) => d.from <= p.time) : undefined;
  useEffect(() => { api.current?.layers.hover(hover !== null ? today?.from ?? null : null); }, [today?.from, hover !== null]);
  const onKey = (e: KeyboardEvent) => { if (stretchKey(e.key, placed, shown, fit, whole)) e.preventDefault(); };
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 pb-1">
      <EquityLegend point={p} stretch={p ? placed[p.stretch ?? -1] ?? null : null} named={named === null ? null : placed[named] ?? null} minutes={minutes} offline={off}
                    reading={p ? readings.get(p.minute ?? p.time) ?? null : null} hold={readings.values().next().value?.hold != null ? hold : null} onHold={() => setHold(!hold)}
                    starting={starting} annual={annual} replayed={replayed} worst={worstShown} step={step} many={many && mine} ret={today?.ret} note={note} basis={own?.run === null ? "bar-close mark" : null} />
      <div className="relative min-h-0 flex-1 outline-none" tabIndex={0} onKeyDown={onKey}>
        <div ref={host} className="h-full w-full" />
        {/* Over the chart's own layers (z-index 1), taking the pointer so an empty chart draws no crosshair. */}
        {!points.length && <p className="absolute inset-0 z-10 grid place-items-center text-dense text-fg-faint">{warmup === null ? "No equity yet: the run has not started" : `No equity yet: the run starts at ${utc(warmup).slice(0, 16)} UTC, after its daily warm-up`}</p>}
      </div>
    </div>
  );
}
