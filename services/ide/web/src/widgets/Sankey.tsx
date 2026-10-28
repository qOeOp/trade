import { useId, useState } from "react";
import { v, type ColorRole } from "../theme/roles";
import { useSize } from "../components/hooks/useSize";
import { Tip } from "../components/Tip";

/** A tile: its name with its logos (images; none shown when they fail to load), its value as shown
 *  (`label`) and in full with what it is (`exact`, `note`, on hover), and its size. A `solid` tile is
 *  filled with `role` and glows, any other is grey; its ribbons end in `role`. */
export type SankeyNode = {
  key: string; name: string; note: string; label: string; exact: string; value: number; role: ColorRole; solid: boolean;
  logos: string[];
};

// As Figma's "Sankey chart / Basic" tiles: W wide (a name of seven capitals at the small size), GAP
// apart in a column, at least MIN tall (the name at the top, the value at the bottom), the tallest column
// filling the chart INSET in from its edges. A tile's ribbons are THREAD of their values' height (each
// at least HAIR px), SPLIT apart, together centred on it, and stop PAD short of it.
const W = 80, GAP = 4, MIN = 52, INSET = 4, THREAD = 0.55, HAIR = 4, SPLIT = 1, PAD = 4;
// Figma's ribbon: a stroke whose curve leaves one tile level and reaches the other level, its handles at
// EASE of the way across from each end.
const EASE = [0.2765, 0.7139] as const;
// A ribbon's opacity between two filled tiles (BOTH) or by a grey one (ONE). One between two filled
// tiles passes through their mix (in light, LIFT of the way to the surface); the profit and loss colours
// mix round by violet, as the short way runs through olive. By a grey tile it holds the grey for HOLD of
// its length. Under the pointer the lit tile's ribbons go to LIT times that and every other to DIM.
const BOTH = 0.75, ONE = 0.6, LIFT = "30%", HOLD = 0.35, LIT = 1.3, DIM = 0.25;
// Literal classes, so Tailwind finds them: a solid tile's fill and glow by its colour.
const SOLID: Partial<Record<ColorRole, string>> = {
  "pnl-up": "bg-pnl-up shadow-pnl-up/40", "pnl-down": "bg-pnl-down shadow-pnl-down/40", equity: "bg-equity-fill shadow-equity/45",
};

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

/** How many px a unit of value takes so that both columns, each tile at least MIN tall, fit `height`. */
function scale(columns: readonly SankeyNode[][], height: number) {
  const fits = (k: number) => columns.every((c) => c.reduce((sum, n) => sum + Math.max(n.value * k, MIN), 0) + (c.length - 1) * GAP <= height);
  let lo = 0, hi = height / Math.max(...columns.map((c) => c.reduce((sum, n) => sum + n.value, 0)), 1e-9);
  if (fits(hi)) return hi;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  return lo;
}

/** A column's tiles stacked at `x`, centred on `height` below INSET. */
function stack(nodes: readonly SankeyNode[], x: number, k: number, height: number): Placed[] {
  let y = 0;
  const placed = nodes.map((n) => { const h = Math.max(MIN, n.value * k), at = y; y += h + GAP; return { n, x, y: at, h }; });
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

function Tile({ p, total, dim, onHover }: { p: Placed; total: number; dim: boolean; onHover: (n: SankeyNode | null) => void }) {
  const { n } = p, solid = n.solid ? SOLID[n.role] : undefined;
  return (
    <Tip content={<div className="flex flex-col gap-0.5"><span>{n.note}</span>
      <span className="tabular-nums text-fg-muted">{n.exact} <span className="text-fg-faint">· {Math.round((n.value / total) * 100)}% of the flow</span></span></div>}>
      <div tabIndex={0} aria-label={`${n.name}: ${n.note} ${n.exact}`} onMouseEnter={() => onHover(n)} onFocus={() => onHover(n)} onBlur={() => onHover(null)}
           className={`absolute flex flex-col justify-between overflow-hidden rounded-popup p-1.5 outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-focus
                       ${solid ? `${solid} text-primary-fg shadow-glow` : "bg-pressed text-fg"} ${dim ? "opacity-60" : ""}`}
           style={{ left: p.x, top: p.y, width: W, height: p.h }}>
        <span className="flex min-w-0 items-center gap-1">
          <Logos srcs={n.logos} />
          <span className="truncate text-small font-semibold uppercase leading-none tracking-wider">{n.name}</span>
        </span>
        <span className="truncate text-h2 leading-none tabular-nums tracking-tighter">{n.label}</span>
      </div>
    </Tip>
  );
}

/** What flows in (the left tiles) and out (the right tiles), each column adding up to the same total, as
 *  the tiles of Figma's "Sankey chart / Basic" widgets draw it. Under the pointer or the keyboard a tile
 *  and its ribbons light up and the rest recede; its tooltip says what it is, its full value and its share
 *  of the flow. At least `least` tall, taller only when a column's tiles need it. */
export function Sankey({ into, out, label, least = 200 }: { into: SankeyNode[]; out: SankeyNode[]; label: string; least?: number }) {
  const [ref, { width }] = useSize();
  const [at, setAt] = useState<SankeyNode | null>(null);
  const id = useId();
  const inner = Math.max(least, ...[into, out].map((c) => c.length * (MIN + GAP) - GAP)), height = inner + 2 * INSET;
  const total = into.reduce((sum, n) => sum + n.value, 0);
  const k = scale([into, out], inner);
  const left = stack(into, INSET, k, inner), right = stack(out, width - W - INSET, k, inner);
  const x0 = INSET + W + PAD, x1 = width - INSET - W - PAD;
  return (
    <div ref={ref} role="group" aria-label={label} className="relative w-full" style={{ height }} onMouseLeave={() => setAt(null)}>
      {width > 0 && <>
        <svg width={width} height={height} className="absolute inset-0 block" aria-hidden>
          {links(left, right, k, x0, x1).map((l, i) => {
            const both = l.from.solid && l.to.solid, lit = at === null ? 1 : at === l.from || at === l.to ? LIT : DIM, g = `${id}${i}`;
            const arc = l.from.role !== l.to.role && [l.from.role, l.to.role].every((r) => r === "pnl-up" || r === "pnl-down") ? " longer hue" : "";
            const mid = `color-mix(in oklch${arc}, ${v(l.from.role)}, ${v(l.to.role)})`;
            const stops: [number, string][] = [[0, v(l.from.role)], [1, v(l.to.role)]];
            if (both) stops.splice(1, 0, [0.5, `light-dark(color-mix(in oklch, ${mid}, ${v("island")} ${LIFT}), ${mid})`]);
            else if (!l.from.solid) stops.splice(1, 0, [HOLD, v(l.from.role)]);
            else stops.splice(1, 0, [1 - HOLD, v(l.to.role)]);
            return (
              <g key={g}>
                <linearGradient id={g} gradientUnits="userSpaceOnUse" x1={x0} x2={x1} y1={0} y2={0}>
                  {stops.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
                </linearGradient>
                <path d={l.d} fill="none" stroke={`url(#${g})`} strokeWidth={l.t} opacity={Math.min(1, (both ? BOTH : ONE) * lit)} />
              </g>
            );
          })}
        </svg>
        {[...left, ...right].map((p) => <Tile key={p.n.key} p={p} total={total} onHover={setAt} dim={at !== null && at !== p.n} />)}
      </>}
    </div>
  );
}
