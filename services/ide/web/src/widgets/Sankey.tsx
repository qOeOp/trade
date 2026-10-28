import { useId, useState } from "react";
import { v, type ColorRole } from "../theme/roles";
import { useSize } from "../components/hooks/useSize";
import { Tip } from "../components/Tip";

/** A tile: its name with its logos (images; none shown when they fail to load), its value as shown
 *  (`label`, in `tone`'s colour) and in full with what it is (`exact`, `note`, on hover), and its size.
 *  Its ribbons end in `role`. */
export type SankeyNode = {
  key: string; name: string; note: string; label: string; exact: string; value: number; role: ColorRole; tone: ColorRole;
  logos: string[];
};

// The tiles are the card's own grey, at least W wide, GAP apart in a column, the tallest column filling
// the chart INSET in from its edges. A tile sets its name and value on one row at its top, down to ROW
// tall; the tiles widen to fit the widest row, up to WIDE of the chart's width, and a tile whose row is
// wider than that sets its value under its name, down to TWO tall. A tile's ribbons are THREAD of their
// values' height (each at least HAIR px), SPLIT apart, together centred on it, and stop PAD short of it.
const W = 64, WIDE = 0.3, GAP = 4, ROW = 20, TWO = 36, INSET = 4, THREAD = 0.55, HAIR = 2, SPLIT = 1, PAD = 4;
// Supply is monospaced, so a row's width is its characters': a name (text-small semibold, Supply Medium's
// 0.62 em) NAME px each and a value (text-dense, Regular's 0.6 em) VALUE px each, SEP apart, PADX in from
// the tile's sides; a logo chip takes 14px, each further one 10px more (they overlap), and 4px before
// the name.
const NAME = 11 * 0.62, VALUE = 12 * 0.6, SEP = 6, PADX = 6;
const chips = (n: number) => (n ? 14 + 10 * (Math.min(n, 3) - 1) + 4 : 0);
const rowWidth = (n: SankeyNode) => 2 * PADX + chips(n.logos.length) + n.name.length * NAME + SEP + n.label.length * VALUE;
// Figma's ribbon: a stroke whose curve leaves one tile level and reaches the other level, its handles at
// EASE of the way across from each end.
const EASE = [0.2765, 0.7139] as const;
// A ribbon runs from its left tile's colour to its right one's through their mix, at REST opacity;
// under the pointer the lit tile's ribbons go to LIT and every other to DIM.
const REST = 0.3, LIT = 0.6, DIM = 0.08;
// Literal classes, so Tailwind finds them: a value's colour by its role (the secondary text otherwise).
const TONE: Partial<Record<ColorRole, string>> = { "pnl-up": "text-pnl-up", "pnl-down": "text-pnl-down" };

/** The tile's logos, each on a white chip as Figma's tiles carry their icon, overlapping when there are
 *  several (at most three); a chip shows once its image loads, and one that fails drops out. */
function Logos({ srcs }: { srcs: string[] }) {
  const [failed, setFailed] = useState<string[]>([]), [loaded, setLoaded] = useState<string[]>([]);
  const shown = srcs.filter((s) => !failed.includes(s)).slice(0, 3);
  if (!shown.length) return null;
  return (
    <span className="flex shrink-0">
      {shown.map((s, i) => (
        <span key={s} className={`grid size-3.5 place-items-center rounded-full bg-primary-fg ${i ? "-ml-1" : ""} ${loaded.includes(s) ? "" : "hidden"}`}>
          <img src={s} alt="" width={10} height={10} onLoad={() => setLoaded((l) => [...l, s])} onError={() => setFailed((f) => [...f, s])}
               className="size-2.5 rounded-full" />
        </span>
      ))}
    </span>
  );
}

type Placed = { n: SankeyNode; x: number; y: number; h: number };
type Link = { from: SankeyNode; to: SankeyNode; i: number; j: number; t: number; d?: string };

/** How many px a unit of value takes so that both columns, each tile at least `least` tall, fit `height`. */
function scale(columns: readonly SankeyNode[][], least: (n: SankeyNode) => number, height: number) {
  const fits = (k: number) => columns.every((c) => c.reduce((sum, n) => sum + Math.max(n.value * k, least(n)), 0) + (c.length - 1) * GAP <= height);
  let lo = 0, hi = height / Math.max(...columns.map((c) => c.reduce((sum, n) => sum + n.value, 0)), 1e-9);
  if (fits(hi)) return hi;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  return lo;
}

/** A column's tiles stacked at `x`, centred on `height` below INSET. */
function stack(nodes: readonly SankeyNode[], x: number, k: number, least: (n: SankeyNode) => number, height: number): Placed[] {
  let y = 0;
  const placed = nodes.map((n) => { const h = Math.max(least(n), n.value * k), at = y; y += h + GAP; return { n, x, y: at, h }; });
  const off = INSET + Math.max(0, (height - (y - GAP)) / 2);
  return placed.map((p) => ({ ...p, y: p.y + off }));
}

/** The ribbons: both columns share out one total, so the left one's values, in order, meet the right
 *  one's in order (a ribbon is a share of the total, not a pairing of trades). Each is a stroke along its
 *  middle from x0 to x1, its ends stacked on their tiles as drawn. */
function links(left: Placed[], right: Placed[], k: number, x0: number, x1: number): Link[] {
  const a = left.map((p) => p.n.value), b = right.map((p) => p.n.value), out: Link[] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    const share = Math.min(a[i]!, b[j]!);
    if (share > 0) out.push({ from: left[i]!.n, to: right[j]!.n, i, j, t: Math.max(HAIR, share * k * THREAD) });
    a[i]! -= share; b[j]! -= share;
    if (a[i]! <= 1e-9) i++;
    if (b[j]! <= 1e-9) j++;
  }
  // Where each tile's bundle starts: its ribbons as drawn, SPLIT apart, centred on the tile.
  const starts = (side: Placed[], end: "i" | "j") => side.map((p, s) => {
    const mine = out.filter((l) => l[end] === s);
    return p.y + (p.h - mine.reduce((sum, l) => sum + l.t, 0) - (mine.length - 1) * SPLIT) / 2;
  });
  const y0s = starts(left, "i"), y1s = starts(right, "j"), [c0, c1] = EASE.map((e) => x0 + e * (x1 - x0));
  return out.map((l) => {
    const y0 = y0s[l.i]! + l.t / 2, y1 = y1s[l.j]! + l.t / 2;
    y0s[l.i]! += l.t + SPLIT; y1s[l.j]! += l.t + SPLIT;
    return { ...l, d: `M${x0},${y0}C${c0},${y0} ${c1},${y1} ${x1},${y1}` };
  });
}

function Tile({ p, w, total, dim, onHover }: { p: Placed; w: number; total: number; dim: boolean; onHover: (n: SankeyNode | null) => void }) {
  const { n } = p, row = rowWidth(n) <= w;
  return (
    <Tip content={<div className="flex flex-col gap-0.5"><span>{n.note}</span>
      <span className="tabular-nums text-fg-muted">{n.exact} <span className="text-fg-faint">· {Math.round((n.value / total) * 100)}% of the flow</span></span></div>}>
      <div tabIndex={0} aria-label={`${n.name}: ${n.note} ${n.exact}`} onMouseEnter={() => onHover(n)} onFocus={() => onHover(n)} onBlur={() => onHover(null)}
           className={`absolute flex overflow-hidden rounded-control bg-pressed px-1.5 py-0.75 outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-focus
                       ${row ? "items-start justify-between gap-1.5" : "flex-col gap-0.5"} ${dim ? "opacity-60" : ""}`}
           style={{ left: p.x, top: p.y, width: w, height: p.h }}>
        <span className="flex h-3.5 min-w-0 items-center gap-1">
          <Logos srcs={n.logos} />
          <span className="truncate text-small font-semibold leading-3.5 text-fg-muted">{n.name}</span>
        </span>
        <span className={`text-dense leading-3.5 tabular-nums ${row ? "shrink-0" : "truncate"} ${TONE[n.tone] ?? "text-fg-muted"}`}>{n.label}</span>
      </div>
    </Tip>
  );
}

/** What flows in (the left tiles) and out (the right tiles), each column adding up to the same total, as
 *  the tiles of Figma's "Sankey chart / Basic" widgets draw it. Under the pointer or the keyboard a tile
 *  and its ribbons light up and the rest recede; its tooltip says what it is, its full value and its share
 *  of the flow. At least `least` tall, taller only when a column's tiles need it. */
export function Sankey({ into, out, label, least = 112 }: { into: SankeyNode[]; out: SankeyNode[]; label: string; least?: number }) {
  const [ref, { width }] = useSize();
  const [at, setAt] = useState<SankeyNode | null>(null);
  const id = useId();
  const w = Math.max(W, ...[...into, ...out].map(rowWidth).filter((r) => r <= width * WIDE));
  const fit = (n: SankeyNode) => (rowWidth(n) <= w ? ROW : TWO);
  const inner = Math.max(least, ...[into, out].map((c) => c.reduce((sum, n) => sum + fit(n) + GAP, -GAP))), height = inner + 2 * INSET;
  const total = into.reduce((sum, n) => sum + n.value, 0);
  const k = scale([into, out], fit, inner);
  const left = stack(into, INSET, k, fit, inner), right = stack(out, width - w - INSET, k, fit, inner);
  const x0 = INSET + w + PAD, x1 = width - INSET - w - PAD;
  return (
    <div ref={ref} role="group" aria-label={label} className="relative w-full" style={{ height }} onMouseLeave={() => setAt(null)}>
      {width > 0 && <>
        <svg width={width} height={height} className="absolute inset-0 block" aria-hidden>
          {links(left, right, k, x0, x1).map((l, i) => {
            const g = `${id}${i}`, a = v(l.from.role), b = v(l.to.role);
            return (
              <g key={g}>
                <linearGradient id={g} gradientUnits="userSpaceOnUse" x1={x0} x2={x1} y1={0} y2={0}>
                  <stop offset={0} stopColor={a} /><stop offset={0.5} stopColor={`color-mix(in oklab, ${a}, ${b})`} /><stop offset={1} stopColor={b} />
                </linearGradient>
                <path d={l.d} fill="none" stroke={`url(#${g})`} strokeWidth={l.t} className="transition-opacity"
                      opacity={at === null ? REST : at === l.from || at === l.to ? LIT : DIM} />
              </g>
            );
          })}
        </svg>
        {[...left, ...right].map((p) => <Tile key={p.n.key} p={p} w={w} total={total} onHover={setAt} dim={at !== null && at !== p.n} />)}
      </>}
    </div>
  );
}
