// What marks where a stretch (state/stretches.ts) begins on a Runs page chart, and nothing else does (no
// wash, no rule, no change of colour): its name in an 11px line at the pane's top (or under a legend drawn
// over it), left of the stretch's
// first point, in the faint colour (the shown stretch's in the text colour), outlined in the island's
// colour so nothing beneath runs through it; and that point's date on the time axis in the text colour,
// with no tick. A stretch whose start has scrolled off the left keeps its name pinned at the pane's left
// edge, until the next name comes within GAP px of it, which wins. A name is written whole or not at all:
// none runs past the pane's right edge, and of two closer than GAP the shown stretch's stays, else the
// later. A name can be clicked (`at`).
import type { IChartApi, IPrimitivePaneView, ISeriesPrimitive, ISeriesPrimitiveAxisView, SeriesAttachedParameter, Time } from "lightweight-charts";
import { dayMonth } from "./chartTheme";

export type Caption = { label: string; selected: boolean; from: number };
export type CaptionLook = { text: string; shown: string; halo: string; font: string };
type Placed = { k: number; x: number; w: number; pinned: boolean };

const TOP = 4, LINE = 14;         // px: the names' top and line height
export const BELOW = TOP + LINE / 2 + 4 + 8;  // px: what hangs from the pane's top starts 8 px under the names' baseline (4 under the middle)
const PAD = 6, GAP = 16;          // px: a name's distance from its stretch's start (and the pane's edge); the least room before the next name

export class StretchCaptions implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private redraw: (() => void) | null = null;
  private captions: readonly Caption[] = [];
  private look: CaptionLook | null = null;
  private probe: CanvasRenderingContext2D | null = null;

  /** `xOf` places a time (s) on the pane (px), null when the chart has no point there; the names' line
   *  starts `top` px down the pane. */
  constructor(private readonly xOf: (t: number) => number | null, private readonly top = TOP) {}

  set(captions: readonly Caption[], look: CaptionLook): void { Object.assign(this, { captions, look }); this.redraw?.(); }

  /** The stretch (its index) whose name is under pane point `x`, `y` (px), if any. */
  at(x: number, y: number): number | null {
    if (y < this.top || y > this.top + LINE) return null;
    return this.placed().find((p) => x >= p.x - 2 && x <= p.x + p.w + 2)?.k ?? null;
  }

  attached({ chart, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, redraw: null }); }

  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "top", renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace(({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const look = this.look;
      if (!look) return;
      c.save();
      c.font = look.font.replace(/(\d+)px/, (_, n: string) => `${Number(n) * vr}px`);
      Object.assign(c, { textBaseline: "middle", lineJoin: "round", lineWidth: 3 * hr, strokeStyle: look.halo });
      for (const p of this.placed()) {
        const x = Math.round(p.x * hr), y = Math.round((this.top + LINE / 2) * vr), text = this.captions[p.k]!.label;
        c.strokeText(text, x, y);
        c.fillStyle = this.captions[p.k]!.selected ? look.shown : look.text;
        c.fillText(text, x, y);
      }
      c.restore();
    }) }) }];
  }

  timeAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const look = this.look, width = this.chart?.timeScale().width() ?? 0;
    if (!look) return [];
    return this.captions.flatMap((s) => {
      const x = this.xOf(s.from);
      return x === null || x < 0 || x > width ? [] : [{ coordinate: () => x, text: () => dayMonth(new Date(s.from * 1000)), textColor: () => look.shown, backColor: () => look.halo, tickVisible: () => false }];
    });
  }

  /** The dates the time axis writes in the text colour (px, text), for its own ticks to give way to. */
  onAxis(): { x: number; text: string }[] { return this.timeAxisViews().map((v) => ({ x: v.coordinate(), text: v.text() })); }

  /** Where each name is written: at its stretch's start, or pinned at the left edge while the next name
   *  leaves it room; none whose stretch is wholly off either side. */
  private placed(): Placed[] {
    const width = this.chart?.timeScale().width() ?? 0, font = this.look?.font;
    if (!width || !font) return [];
    this.probe ??= document.createElement("canvas").getContext("2d");
    if (this.probe) this.probe.font = font;
    const w = (text: string) => this.probe?.measureText(text).width ?? text.length * 7;
    const starts = this.captions.map((s) => this.xOf(s.from));
    const all = this.captions.flatMap((s, k): Placed[] => {
      const x = starts[k] ?? null, next = starts.slice(k + 1).find((n) => n !== null) ?? null;
      if (x === null || x > width) return [];
      if (x >= 0) return [{ k, x: x + PAD, w: w(s.label), pinned: false }];
      if (next !== null && next < 0) return [];  // the next stretch starts off the left too: this one is out of view
      return next !== null && next - w(s.label) < GAP ? [] : [{ k, x: PAD, w: w(s.label), pinned: true }];
    });
    // Whole names only: none past the pane's right edge, and of two too close the shown stretch's, else the later.
    const fits = all.filter((p) => p.x + p.w <= width - PAD);
    return fits.filter((p, i) => {
      const next = fits[i + 1], before = fits[i - 1];
      if (next && p.x + p.w + GAP > next.x && !this.captions[p.k]!.selected) return false;
      return !(before && before.x + before.w + GAP > p.x && this.captions[before.k]!.selected);
    });
  }
}
