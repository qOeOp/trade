// What the candle chart says beyond its candles, trades and levels, kept apart from the controller: the
// run's events as flags and its gaps as bands (eventFlags.ts), a tooltip for whatever the pointer rests
// on (an arrow's fills, a flag's events, a stretch the run was offline), what a click on one opens (its line in Events), and while the
// run is live a countdown to the close of the candle forming now under the last price's tag, which says
// "Stale" once no bar has come for STALE.
import type { ISeriesApi, SeriesType } from "lightweight-charts";
import { candleOpen } from "../../lib/bars";
import { symbolOf, type JournalLine } from "../../lib/paperApi";
import type { Fill } from "../../model/paper";
import { atom } from "../../state/atom";
import { highlighted, tradesTab } from "../../state/paperStream";
import { fillTip, flags, flagTip, gaps, type Tip } from "./candleEvents";
import { downRows, type Down } from "./downLook";
import { EventFlags, type FlagsLook } from "./eventFlags";
import type { TradeBox } from "./tradeBoxes";
import type { Levels } from "./levels";

export type Notes = { events: readonly JournalLine[]; fills: readonly Fill[]; boxes: readonly TradeBox[]; minutes: number; times: readonly number[]; downs: readonly Down[];
  places: number; size: number; live: boolean; lastBar: number | null; look: FlagsLook };
const STALE = 150_000;  // ms without a bar after which a live chart says its last price is stale

/** A duration in seconds as 0:42, 14:05 or 3:14:05. */
const clock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.floor(s % 60), two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
};

export class CandleNotes {
  readonly tip = atom<Tip | null>(null);
  private readonly flags = new EventFlags();
  private notes: Notes | null = null;
  private levels: Levels | null = null;
  private timer = 0;

  /** Draws on `series`, its countdown under the last price's tag in `levels`. */
  attach(series: ISeriesApi<SeriesType>, levels: Levels): this {
    series.attachPrimitive(this.flags);
    this.levels = levels;
    return this;
  }

  set(notes: Notes): void {
    this.notes = notes;
    this.flags.set(flags(notes.events, notes.minutes, notes.times), gaps(notes.events, notes.minutes), notes.look, notes.downs);
    window.clearInterval(this.timer);
    this.tick();
    if (notes.live) this.timer = window.setInterval(() => this.tick(), 1000);
  }

  /** The tags on the time axis: where they sit (px) and what they say. */
  onAxis(): { x: number; text: string }[] { return this.flags.onAxis(); }

  /** The pointer over hover target `id` at `point` (px in the pane), or over nothing. */
  hover(id: string, point: { x: number; y: number } | null): void {
    this.levels?.cross(point?.y ?? null);
    const n = this.notes, f = this.fillsAt(id), pill = this.flags.pill(id), off = this.flags.down(id), digits = { price: n?.places ?? 2, size: n?.size ?? -1 };
    if (!n || !point || (!f.length && !pill && !off)) { if (this.tip.get()) this.tip.set(null); return; }
    const same = this.tip.get();
    if (same && same.x === point.x && same.y === point.y) return;
    if (off) { this.tip.set({ x: point.x, y: point.y, title: off.label, rows: downRows(off).map((text) => ({ text, faint: false })) }); return; }
    // An exit's arrow also tells the trade it closed: the box ending on its candle.
    const box = f.some((x) => !x.opening) ? n.boxes.find((b) => !b.open && b.to === candleOpen(f[0]!.ms * 1e6, n.minutes)) : undefined;
    this.tip.set(f.length ? fillTip(f, n.events, digits, point.x, point.y, box) : flagTip(pill!.lines, new Map(pill!.lines.map((l) => [symbolOf(l.instrument_id), digits])), point.x, point.y));
  }

  /** A click on hover target `id`: an arrow or a flag opens its line in Events. */
  click(id: string): void {
    const line = this.fillsAt(id)[0]?.line ?? this.flags.pill(id)?.lines.at(-1);
    if (line) { highlighted.set(line); tradesTab.set("events"); }
  }

  destroy(): void { window.clearInterval(this.timer); Object.assign(this, { notes: null, levels: null }); this.tip.set(null); }

  /** The fills an arrow stands for: those on its candle on its side. */
  private fillsAt(id: string): Fill[] {
    const n = this.notes, first = id.startsWith("fill-") ? n?.fills[parseInt(id.slice(5), 10)] : undefined;
    if (!n || !first) return [];
    const candle = (f: Fill) => candleOpen(f.ms * 1e6, n.minutes);
    return n.fills.filter((f) => f.buy === first.buy && candle(f) === candle(first));
  }

  private tick(): void {
    const n = this.notes, now = Date.now(), step = (n?.minutes ?? 0) * 60;
    if (!n?.live || !step || n.lastBar === null) { this.levels?.countdown(null); return; }
    this.levels?.countdown(now - n.lastBar > STALE ? "Stale" : clock(step - ((now / 1000) % step)));
  }
}
