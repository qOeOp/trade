// The run's trades on a contract chart, as TradingView's strategy view draws them: beneath the candles each
// trade as a box from its entry candle to its exit candle and from its entry price to its exit price, in
// the profit colour when it made money and the loss colour when it lost, so a box's colour and height
// read as its result; a flat block with no outline, as TradingView's position tool fills its zones; a
// trade inside one candle covers that candle, and one under two candles wide has no box while candles are
// narrow (its arrows carry it); the open position's box reaches the axis, at least a few pixels tall. A trade that starts
// on the candle where the one before it ended meets it at that candle's middle, a gap between, so no two
// boxes overlap; boxes on neighbouring candles keep a hairline apart. Above the candles each fill is an arrow off its candle, up in the up colour for a buy,
// down in the down colour for a sell, ringed in the card's colour so it stands off what it crosses, the
// entries' first and each exit's where it overlaps none, smaller while candles are narrow; and each box's
// result a small tag beyond its
// exit edge (the open position's at the axis, clear of the newest candles), at the first of a few places
// that runs into no arrow, no other tag and no level's chip (`avoid`). An arrow is a hover target (its
// fill's id).
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, PrimitiveHoveredItem,
  SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import { ARROW, arrowAt, drawArrow, SMALL } from "./arrowMark";
import { signed } from "./chartLevels";
import type { Arrow, TradeBox } from "./tradeBoxes";
import { spacing } from "./viewAnchor";

export type MarksLook = { up: string; down: string; upText: string; downText: string; buy: string; sell: string; halo: string; font: string };
type Scope = Parameters<Parameters<Parameters<IPrimitivePaneRenderer["draw"]>[0]["useBitmapCoordinateSpace"]>[0]>[0];
export type Rect = { x: number; y: number; w: number; h: number };

const TAG_H = 16, TAG_PAD = 5, TAG_GAP = 3;        // px: a result tag's height, padding and distance from its box
const OFF = 3;                                     // px: an arrow's tip off its candle (arrowMark.ts; smaller while candles are NARROW)
const NARROW = 14;                                 // px: candles narrower than this draw no box under two candles wide
const OPEN_H = 3;                                  // px: the open position's box at least this tall
const MEET = 1.5;                                  // px: two boxes meeting on a candle stop this far either side of its middle
const INSET = 1;                                   // px: a box's sides inside its candles' edges, so boxes on neighbouring candles part

export class TradeMarks implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private chart: IChartApi | null = null;
  private redraw: (() => void) | null = null;
  private boxes: readonly TradeBox[] = [];
  private arrows: readonly Arrow[] = [];
  private look: MarksLook | null = null;
  private hits: (Rect & { id: string })[] = [];

  /** `avoid` gives the places (px) the result tags keep clear of besides the arrows: the levels' chips. */
  constructor(private readonly avoid: () => readonly Rect[] = () => []) {}

  set(boxes: readonly TradeBox[], arrows: readonly Arrow[], look: MarksLook): void {
    Object.assign(this, { boxes, arrows, look });
    this.redraw?.();
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, series, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, series: null, redraw: null }); }
  paneViews(): readonly IPrimitivePaneView[] {
    const view = (zOrder: "bottom" | "top", draw: (s: Scope) => void): IPrimitivePaneView =>
      ({ zOrder: () => zOrder, renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace(draw) }) });
    return [view("bottom", (s) => this.under(s)), view("top", (s) => this.over(s))];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = this.hits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    return hit ? { externalId: hit.id, zOrder: "top", cursorStyle: "pointer" } : null;
  }

  private spacing = () => (this.chart ? spacing(this.chart.timeScale()) : 0);

  /** Media coordinates of a candle's middle and a price, null off the scale. */
  private at(time: number, price: number): { x: number; y: number } | null {
    const x = this.chart?.timeScale().timeToCoordinate(time as Time), y = this.series?.priceToCoordinate(price);
    return x == null || y == null ? null : { x, y };
  }

  /** Box `i` in media coordinates across a pane `width` wide, and how many candles it spans. */
  private frame(i: number, width: number) {
    const box = this.boxes[i]!, a = this.at(box.from, box.entry), b = this.at(box.to, box.exit), half = this.spacing() / 2, one = box.from === box.to && !box.open;
    if (!a || !b) return null;
    const left = !one && this.boxes[i - 1]?.to === box.from ? a.x + MEET : a.x - half + INSET;
    const right = box.open ? width : !one && this.boxes[i + 1]?.from === box.to ? b.x - MEET : b.x + half - INSET, candles = (right - left) / (2 * half || 1);
    if (!box.open && 2 * half < NARROW && candles < 2) return null;
    return { left, right, entry: a.y, exit: b.y, won: box.pnl >= 0, open: box.open, candles, pnl: box.pnl };
  }

  private under({ context: c, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }: Scope): void {
    const look = this.look;
    if (!look) return;
    const line = Math.max(1, Math.round(vr));
    this.boxes.forEach((_, i) => {
      const f = this.frame(i, bitmapSize.width / hr);
      if (!f) return;
      const left = Math.round(f.left * hr), right = Math.round(f.right * hr), entry = Math.round(f.entry * vr), exit = Math.round(f.exit * vr);
      const tall = Math.max(f.open ? Math.round(OPEN_H * vr) : line, Math.abs(exit - entry)), top = Math.round((entry + exit) / 2 - tall / 2);
      c.fillStyle = f.won ? look.up : look.down;
      c.fillRect(left, top, right - left, tall);
    });
  }

  private over({ context: c, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }: Scope): void {
    const look = this.look;
    this.hits = [];
    if (!look) return;
    const width = bitmapSize.width / hr, z = this.spacing() < NARROW ? SMALL : ARROW;
    const overlap = (r: Rect, t: Rect, gap = 0) => r.x < t.x + t.w + gap && t.x < r.x + r.w + gap && r.y < t.y + t.h && t.y < r.y + r.h;
    // The arrows' places first, so the tags keep clear of them: the entries', then each exit's that overlaps none.
    const placed: { a: Arrow; mark: ReturnType<typeof arrowAt>; rect: Rect }[] = [];
    for (const a of [...this.arrows.filter((x) => x.opening), ...this.arrows.filter((x) => !x.opening)]) {
      const p = this.at(a.time, a.price);
      if (!p) continue;
      // The tip OFF px off the candle: below it pointing up for a buy, above it pointing down for a sell.
      const mark = arrowAt(p.x, p.y + (a.buy ? OFF : -OFF), a.buy, z), rect = mark.rect;
      if (!a.opening && placed.some((q) => overlap(rect, q.rect))) continue;
      placed.push({ a, mark, rect });
    }
    c.save();
    c.font = look.font.replace(/(\d+)px/, (_, n: string) => `${Number(n) * vr}px`);
    c.textBaseline = "middle";
    const taken: Rect[] = [...placed.map((x) => x.rect), ...this.avoid()];
    const clear = (r: Rect) => !taken.some((t) => overlap(r, t, 4));
    this.boxes.forEach((_, i) => {
      const f = this.frame(i, width);
      if (!f) return;
      const text = signed(f.pnl, 2), w = c.measureText(text).width / hr + 2 * TAG_PAD, up = f.exit < f.entry;
      if (f.right - f.left < w || f.right < w || f.left > width - w) return;
      const beyond = up ? Math.min(f.exit, f.entry) - TAG_GAP - TAG_H : Math.max(f.exit, f.entry) + TAG_GAP;
      const behind = up ? Math.max(f.exit, f.entry) + TAG_GAP : Math.min(f.exit, f.entry) - TAG_GAP - TAG_H;
      // Beyond the arrows over the box's span on its exit side, for when they block the tag's first places.
      const over = placed.map((q) => q.rect).filter((q) => q.x < f.right && f.left < q.x + q.w);
      const lifted = up ? Math.min(beyond, ...over.filter((q) => q.y < beyond + TAG_H + 4).map((q) => q.y - 2 - TAG_H))
                        : Math.max(beyond, ...over.filter((q) => q.y + q.h > beyond - 4).map((q) => q.y + q.h + 2));
      const fit = (x: number, y = beyond) => ({ x: Math.max(2, Math.min(width - w - 2, x)), y, w, h: TAG_H });
      const spots = (y: number) => [fit(f.left + 2, y), fit((f.left + f.right) / 2 - w / 2, y), fit(f.right - z.w / 2 - z.ring - 4 - w, y)];
      // Beyond the exit edge at the box's left, middle or right, then the same beyond the arrows, just left of
      // the box, and last beyond the entry edge.
      const r = (f.open ? [fit(width - w - 4)] : [...spots(beyond), ...spots(lifted), fit(f.left - w - 4),
        fit((f.left + f.right) / 2 - w / 2, behind), fit(f.left + 2, behind)]).find(clear);
      if (!r) return;
      taken.push(r);
      c.fillStyle = look.halo;
      c.beginPath(); c.roundRect(Math.round(r.x * hr), Math.round(r.y * vr), Math.round(w * hr), Math.round(TAG_H * vr), 3 * hr); c.fill();
      c.fillStyle = f.won ? look.upText : look.downText;
      c.fillText(text, Math.round((r.x + TAG_PAD) * hr), Math.round((r.y + TAG_H / 2) * vr));
    });
    for (const { a, mark, rect } of placed) {
      drawArrow(c, mark, a.buy ? look.buy : look.sell, look.halo, hr, vr);
      this.hits.push({ id: a.id, ...rect });
    }
    c.restore();
  }
}
