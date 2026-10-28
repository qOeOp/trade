import { useState } from "react";
import { v, type ColorRole } from "../theme/roles";
import { useSize } from "../components/hooks/useSize";
import { Tip } from "../components/Tip";

/** A tile: its name with its logos (images; none shown when they fail to load), its value as shown
 *  (`label`) and in full with what it is (`exact`, `note`, on hover), and its size. A `solid` tile is
 *  filled with `role`, any other is grey; its ribbons take `role` at its end. */
export type SankeyNode = {
  key: string; name: string; note: string; label: string; exact: string; value: number; role: ColorRole; solid: boolean;
  logos: string[];
};
/** Money moving from a node on the left to one on the right, by their keys. */
export type SankeyLink = { from: string; to: string; value: number };

// As Figma's "Sankey chart / Basic" tiles: W wide, GAP apart in a column. Ribbons share one scale, so a
// flow keeps its height from tile to tile; a tile is its ribbons' height and PAD more above and below
// them, so they meet its edge clear of its corners. A tile too small for its text stands at least ONE
// tall with its name and value on one line; from TWO tall the value goes under the name, large from BIG.
const W = 88, GAP = 4, PAD = 7, ONE = 22, TWO = 36, BIG = 52;
// Figma's ribbon: a band whose edges leave one tile level and reach the other level, its height the same
// all along (a stroke would swell and pinch where it is steep), its curves' handles at EASE of the way.
// One thinner than THIN keeps its place on its tiles but is not drawn (a hairline across the chart).
const EASE = [0.2765, 0.7139] as const, THIN = 2;
// A ribbon is its source tile's colour (grey from a grey one) at BASE opacity, the widest drawn first;
// under the pointer the lit tile's ribbons go to LIT and every other to DIM.
const BASE = 0.4, LIT = 0.75, DIM = 0.12, GREY: ColorRole = "fg-ghost";
// Literal classes, so Tailwind finds them: a solid tile's fill by its colour, the net's with a glow.
const SOLID: Partial<Record<ColorRole, string>> = { "pnl-up": "bg-pnl-up", "pnl-down": "bg-pnl-down", equity: "bg-equity-fill shadow-glow shadow-equity/45" };

/** The tile's logos, each on a white chip as Figma's tiles carry their icon, overlapping when there are
 *  several (at most three); a chip shows once its image loads, and one that fails drops out. Sent with no
 *  referrer: Binance's image host refuses another site's. */
function Logos({ srcs }: { srcs: string[] }) {
  const [failed, setFailed] = useState<string[]>([]), [loaded, setLoaded] = useState<string[]>([]);
  const shown = srcs.filter((s) => !failed.includes(s)).slice(0, 3);
  if (!shown.length) return null;
  return (
    <span className="flex shrink-0">
      {shown.map((s, i) => (
        <span key={s} className={`grid size-3.5 place-items-center rounded-full bg-primary-fg ${i ? "-ml-1" : ""} ${loaded.includes(s) ? "" : "hidden"}`}>
          <img src={s} alt="" width={10} height={10} referrerPolicy="no-referrer" onLoad={() => setLoaded((l) => [...l, s])}
               onError={() => setFailed((f) => [...f, s])} className="size-2.5 rounded-full" />
        </span>
      ))}
    </span>
  );
}

type Placed = { n: SankeyNode; x: number; y: number; h: number };
type Ribbon = { from: SankeyNode; to: SankeyNode; t: number; y0: number; y1: number };

const sum = (nodes: readonly SankeyNode[]) => nodes.reduce((s, n) => s + n.value, 0);
const tile = (n: SankeyNode, k: number) => Math.max(ONE, n.value * k + 2 * PAD);
const tall = (nodes: readonly SankeyNode[], k: number) => nodes.reduce((s, n) => s + tile(n, k), 0) + Math.max(0, nodes.length - 1) * GAP;

/** The px a unit of value takes so that the taller column, each tile at least ONE tall, is `height`. */
function scale(columns: readonly SankeyNode[][], height: number) {
  let lo = 0, hi = height / Math.max(...columns.map(sum), 1e-9);
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (columns.every((c) => tall(c, mid) <= height)) lo = mid; else hi = mid; }
  return lo;
}

/** A column's tiles stacked at `x` from the top. */
function stack(nodes: readonly SankeyNode[], x: number, k: number): Placed[] {
  let y = 0;
  return nodes.map((n) => { const h = tile(n, k), p = { n, x, y, h }; y += h + GAP; return p; });
}

/** Both columns on one scale, and each tile's ribbons stacked on its edge in the order of the tiles at
 *  their other ends (top to bottom, so ribbons from one tile do not cross), centred on it. */
function layout(into: SankeyNode[], out: SankeyNode[], given: SankeyLink[], width: number, height: number) {
  const k = scale([into, out], height), left = stack(into, 0, k), right = stack(out, width - W, k);
  const at = new Map([...left, ...right].map((p) => [p.n.key, p]));
  const ribbons: Ribbon[] = given.flatMap((l) => {
    const a = at.get(l.from), b = at.get(l.to);
    return a && b ? [{ from: a.n, to: b.n, t: l.value * k, y0: 0, y1: 0 }] : [];
  });
  const middle = (n: SankeyNode) => { const p = at.get(n.key)!; return p.y + p.h / 2; };
  for (const p of [...left, ...right]) {
    const own = p.x === 0, mine = ribbons.filter((r) => (own ? r.from : r.to) === p.n);
    mine.sort((a, b) => middle(own ? a.to : a.from) - middle(own ? b.to : b.from));
    let y = p.y + (p.h - mine.reduce((s, r) => s + r.t, 0)) / 2;
    for (const r of mine) { if (own) r.y0 = y + r.t / 2; else r.y1 = y + r.t / 2; y += r.t; }
  }
  return { left, right, ribbons };
}

/** The ribbon from x0 to x1 as a band `t` tall all along. */
function band({ t, y0, y1 }: Ribbon, x0: number, x1: number) {
  const [c0, c1] = EASE.map((e) => x0 + e * (x1 - x0)), h = t / 2;
  return `M${x0},${y0 - h}C${c0},${y0 - h} ${c1},${y1 - h} ${x1},${y1 - h}L${x1},${y1 + h}C${c1},${y1 + h} ${c0},${y0 + h} ${x0},${y0 + h}Z`;
}

function Tile({ p, total, dim, onHover }: { p: Placed; total: number; dim: boolean; onHover: (n: SankeyNode | null) => void }) {
  const { n } = p, solid = n.solid ? SOLID[n.role] : undefined, two = p.h >= TWO, big = p.h >= BIG;
  return (
    <Tip content={<div className="flex flex-col gap-0.5"><span>{n.note}</span>
      <span className="tabular-nums text-fg-muted">{n.exact} <span className="text-fg-faint">· {Math.round((n.value / total) * 100)}% of the flow</span></span></div>}>
      <div tabIndex={0} aria-label={`${n.name}: ${n.note} ${n.exact}`} onMouseEnter={() => onHover(n)} onFocus={() => onHover(n)} onBlur={() => onHover(null)}
           className={`absolute flex overflow-hidden rounded-popup px-1.5 outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-focus
                       ${two ? `flex-col justify-between ${big ? "py-1.5" : "py-1"}` : "items-center justify-between gap-1"} ${solid ? `${solid} text-primary-fg` : "bg-pressed text-fg"} ${dim ? "opacity-60" : ""}`}
           style={{ left: p.x, top: p.y, width: W, height: p.h }}>
        <span className="flex min-w-0 items-center gap-1">
          <Logos srcs={n.logos} />
          <span className={`truncate text-small font-semibold uppercase leading-none ${two ? "tracking-wider" : ""}`}>{n.name}</span>
        </span>
        <span className={`shrink-0 leading-none tabular-nums ${two ? `truncate tracking-tighter ${big ? "text-h2" : "text-value"}` : "text-small font-semibold"}`}>{n.label}</span>
      </div>
    </Tip>
  );
}

/** What flows in (the left tiles) and out (the right tiles), each column adding up to the same total,
 *  joined by `links`, as the tiles of Figma's "Sankey chart / Basic" widgets draw it. Under the pointer
 *  or the keyboard a tile and its ribbons light up and the rest recede; its tooltip says what it is, its
 *  full value and its share of the flow. `height` tall, taller only when a column's tiles at their least
 *  need it. */
export function Sankey({ into, out, links, label, height: wanted = 280 }: { into: SankeyNode[]; out: SankeyNode[]; links: SankeyLink[]; label: string; height?: number }) {
  const [ref, { width }] = useSize();
  const [lit, setLit] = useState<SankeyNode | null>(null);
  const height = Math.max(wanted, ...[into, out].map((c) => tall(c, 0)));
  const total = sum(into);
  const { left, right, ribbons } = layout(into, out, links, width, height);
  return (
    <div ref={ref} role="group" aria-label={label} className="relative w-full" style={{ height }} onMouseLeave={() => setLit(null)}>
      {width > 0 && <>
        <svg width={width} height={height} className="absolute inset-0 block" aria-hidden>
          {ribbons.filter((r) => r.t >= THIN).sort((a, b) => b.t - a.t).map((r) => {
            const on = lit === null ? BASE : lit === r.from || lit === r.to ? LIT : DIM;
            return <path key={`${r.from.key}>${r.to.key}`} d={band(r, W, width - W)} fill={v(r.from.solid ? r.from.role : GREY)} opacity={on} className="transition-opacity" />;
          })}
        </svg>
        {[...left, ...right].map((p) => <Tile key={p.n.key} p={p} total={total} onHover={setLit} dim={lit !== null && lit !== p.n} />)}
      </>}
    </div>
  );
}
