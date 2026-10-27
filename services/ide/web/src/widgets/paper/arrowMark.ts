// The arrow both charts mark a moment with, as TradingView marks a strategy's orders: a head and a stem,
// ringed in the card's colour so it stands off what it crosses, its middle on its candle's wick.
import type { Rect } from "./tradeMarks";

type Size = { w: number; h: number; stem: number; ring: number };
// px: an arrow's head width and height, stem height and ring, and the smaller one for narrow candles
export const ARROW: Size = { w: 9, h: 6, stem: 5, ring: 3 }, SMALL: Size = { w: 7, h: 5, stem: 4, ring: 2 };
const STEM_W = 2;

/** An arrow with its tip at `tip` (media px), pointing up or down from x, and the box it covers. */
export function arrowAt(x: number, tip: number, up: boolean, z: Size = ARROW) {
  const s = up ? 1 : -1, base = tip + s * z.h, foot = base + s * z.stem;
  return { x, tip, base, foot, z, rect: { x: x - z.w / 2 - z.ring, y: Math.min(tip, foot) - 2, w: z.w + 2 * z.ring, h: z.h + z.stem + 4 } as Rect };
}

/** Draws arrow `a` in `fill`, ringed in `halo`, on a bitmap at ratios `hr` and `vr`: centred on the device
 *  pixels a candle's wick at x covers (Lightweight Charts draws it floor(hr) wide from round(x·hr) less half
 *  of that, so its middle falls between pixels or on one), its stem as many pixels wider either side. */
export function drawArrow(c: CanvasRenderingContext2D, a: ReturnType<typeof arrowAt>, fill: string, halo: string, hr: number, vr: number): void {
  const { tip, base, foot, z } = a, path = new Path2D(), wick = Math.max(1, Math.floor(hr)), left = Math.round(a.x * hr) - Math.floor(wick / 2);
  const mid = left + wick / 2, stem = wick / 2 + Math.max(1, Math.round((STEM_W * hr - wick) / 2));
  const X = (x: number) => mid + x * hr, Y = (y: number) => y * vr;
  path.moveTo(mid, Y(tip)); path.lineTo(X(z.w / 2), Y(base)); path.lineTo(mid + stem, Y(base)); path.lineTo(mid + stem, Y(foot));
  path.lineTo(mid - stem, Y(foot)); path.lineTo(mid - stem, Y(base)); path.lineTo(X(-z.w / 2), Y(base)); path.closePath();
  Object.assign(c, { lineJoin: "round", lineWidth: z.ring * hr, strokeStyle: halo, fillStyle: fill });
  c.stroke(path);
  c.fill(path);
}
