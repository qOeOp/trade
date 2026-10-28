import { useId, useState } from "react";
import { v, type ColorRole } from "../theme/roles";
import { useSize } from "../components/hooks/useSize";
import { Tip } from "../components/Tip";

/** A node: its name with its logos (images; none shown when they fail to load), in the text colour when
 *  `strong` (the secondary otherwise), its value as shown (`label`, in `tone`'s colour) and in full with
 *  what it is (`exact`, `note`, on hover), and its size. Its bar is `role`'s colour, and its ribbons take
 *  it at its end. */
export type SankeyNode = {
  key: string; name: string; note: string; label: string; exact: string; value: number; role: ColorRole; tone: ColorRole;
  logos: string[]; strong?: boolean;
};
/** Money moving from a node on the left to one on the right, by their keys. */
export type SankeyLink = { from: string; to: string; value: number };

// As Highcharts draws a sankey: each node a bar BAR wide at the chart's edge, its ribbons' height (SPLIT
// apart, as Figma's tiles part theirs) and EDGE more above and below them so they meet it clear of its
// ends (at least HAIR), and its label on one row above it, HEAD tall with the space under it, flush with
// the chart's edge, so the ribbons have the chart's whole width but PAD short of each bar. A ribbon's
// height follows the square root of its value (at least FLOOR px, the largest at most THICK), so every
// flow shows and the largest do not swamp the rest: heights rank the flows rather than measure them, and
// the labels give the amounts. A node is GAP from the next.
const BAR = 3, EDGE = 3, SPLIT = 1, PAD = 4, HAIR = 2, FLOOR = 1.5, THICK = 28, HEAD = 18, GAP = 8;
// A label is as wide as its row, up to MOST of the chart's width, its name cut first. Supply is
// monospaced, so a row's width is its characters': a name (text-small semibold, Supply Medium's 0.62 em)
// NAME px each and a value (text-small, Regular's 0.6 em) VALUE px each, SEP apart; a logo takes 14px,
// each further one 10px more (they overlap), and 4px before the name; SLACK keeps sub-pixel rounding from
// cutting a name.
const NAME = 11 * 0.62, VALUE = 11 * 0.6, SEP = 6, SLACK = 2, MOST = 0.48;
const logos = (n: number) => (n ? 14 + 10 * (Math.min(n, 3) - 1) + 4 : 0);
const row = (n: SankeyNode) => logos(n.logos.length) + n.name.length * NAME + SEP + n.label.length * VALUE + SLACK;
// Figma's ribbon: a band whose edges leave one node level and reach the other level, its height the same
// all along (a stroke would swell and pinch where it is steep), its curves' handles at EASE of the way.
const EASE = [0.2765, 0.7139] as const;
// A ribbon runs from its left node's colour to its right one's through their mix (through the faint text
// colour from profit to loss, whose mix is a muddy olive), deeper the larger it is: from FAINT for the
// smallest to DEEP for the largest, by the same square root as its height, and at least SEEN when it is
// under THIN px, so a hairline stays visible; the widest are drawn first. Under the pointer a node or a
// ribbon lights up with what it joins: the other ribbons go to DIM, bars to FADE and labels to half.
const FAINT = 0.2, DEEP = 0.55, SEEN = 0.3, THIN = 2.5, LIT = 0.75, DIM = 0.06, FADE = 0.35;
// Literal classes, so Tailwind finds them: a value's colour by its tone (the secondary text otherwise).
const TONE: Partial<Record<ColorRole, string>> = { "pnl-up": "text-pnl-up", "pnl-down": "text-pnl-down" };

/** The node's logos, overlapping when there are several (at most three); one shows once its image
 *  loads, and one that fails drops out. Sent with no referrer: Binance's image host refuses another
 *  site's. */
function Logos({ srcs }: { srcs: string[] }) {
  const [failed, setFailed] = useState<string[]>([]), [loaded, setLoaded] = useState<string[]>([]);
  const shown = srcs.filter((s) => !failed.includes(s)).slice(0, 3);
  if (!shown.length) return null;
  return (
    <span className="flex shrink-0">
      {shown.map((s, i) => (
        <img key={s} src={s} alt="" width={14} height={14} referrerPolicy="no-referrer" onLoad={() => setLoaded((l) => [...l, s])}
             onError={() => setFailed((f) => [...f, s])} className={`size-3.5 rounded-full ${i ? "-ml-1" : ""} ${loaded.includes(s) ? "" : "hidden"}`} />
      ))}
    </span>
  );
}

/** A node's place: its label from `y`, its bar from `y + HEAD`, `bar` tall. */
type Placed = { n: SankeyNode; y: number; bar: number };
type Ribbon = { from: SankeyNode; to: SankeyNode; value: number; t: number; deep: number; y0: number; y1: number };

const sum = (nodes: readonly SankeyNode[]) => nodes.reduce((s, n) => s + n.value, 0);
const thick = (value: number, k: number) => Math.max(FLOOR, Math.sqrt(value) * k);
/** A node's bar at `k`: its ribbons' heights stacked SPLIT apart with EDGE above and below (`own` the values of its links on its side). */
const barOf = (own: readonly number[], k: number) =>
  (own.length ? own.reduce((s, x) => s + thick(x, k), 2 * EDGE + (own.length - 1) * SPLIT) : HAIR);

/** Both columns on one scale, the largest `k` (px per root of a unit of value) at which the taller column
 *  fits `height` and no ribbon is taller than THICK, the shorter centred on it; and each bar's ribbons stacked on it in the order of
 *  the nodes at their other ends (top to bottom, so ribbons from one bar do not cross), centred on it. */
function layout(into: SankeyNode[], out: SankeyNode[], given: SankeyLink[], height: number) {
  const own = (n: SankeyNode, side: "from" | "to") => given.filter((l) => l[side] === n.key).map((l) => l.value);
  const columns = [into.map((n) => [n, own(n, "from")] as const), out.map((n) => [n, own(n, "to")] as const)];
  const stack = (c: (typeof columns)[number], k: number) => {
    let y = 0;
    return c.map(([n, xs]): Placed => { const p = { n, y, bar: barOf(xs, k) }; y += HEAD + p.bar + GAP; return p; });
  };
  const end = (c: Placed[]) => (c.length ? c[c.length - 1]!.y + HEAD + c[c.length - 1]!.bar : 0);
  const fits = (k: number) => columns.every((c) => end(stack(c, k)) <= height);
  const top = Math.max(...given.map((l) => l.value), 1e-9);
  let lo = 0, hi = THICK / Math.sqrt(top);
  if (fits(hi)) lo = hi;
  else for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  // The shorter column stands centred on the taller.
  const left = stack(columns[0]!, lo), right = stack(columns[1]!, lo), used = Math.max(end(left), end(right));
  for (const c of [left, right]) { const off = (used - end(c)) / 2; for (const p of c) p.y += off; }
  const at = new Map([...left, ...right].map((p) => [p.n.key, p]));
  const ribbons: Ribbon[] = given.flatMap((l) => {
    const a = at.get(l.from), b = at.get(l.to);
    return a && b ? [{ from: a.n, to: b.n, value: l.value, t: thick(l.value, lo), deep: Math.sqrt(l.value / top), y0: 0, y1: 0 }] : [];
  });
  const middle = (n: SankeyNode) => { const p = at.get(n.key)!; return p.y + HEAD + p.bar / 2; };
  for (const [side, mineOf] of [[left, true], [right, false]] as const) {
    for (const p of side) {
      const mine = ribbons.filter((r) => (mineOf ? r.from : r.to) === p.n);
      mine.sort((a, b) => middle(mineOf ? a.to : a.from) - middle(mineOf ? b.to : b.from));
      let y = p.y + HEAD + (p.bar - mine.reduce((s, r) => s + r.t, 0) - Math.max(0, mine.length - 1) * SPLIT) / 2;
      for (const r of mine) { if (mineOf) r.y0 = y + r.t / 2; else r.y1 = y + r.t / 2; y += r.t + SPLIT; }
    }
  }
  return { left, right, ribbons, used };
}

/** The ribbon from x0 to x1 as a band `t` tall all along. */
function band({ t, y0, y1 }: Ribbon, x0: number, x1: number) {
  const [c0, c1] = EASE.map((e) => x0 + e * (x1 - x0)), h = t / 2;
  return `M${x0},${y0 - h}C${c0},${y0 - h} ${c1},${y1 - h} ${x1},${y1 - h}L${x1},${y1 + h}C${c1},${y1 + h} ${c0},${y0 + h} ${x0},${y0 + h}Z`;
}

/** A node's label above its bar: its name and value on one row, flush with the chart's edge, haloed in
 *  the card's surface so a ribbon passing under it does not run through its text; under the pointer or
 *  the keyboard its tooltip says what it is, its full value and its share. */
function Label({ p, x, w, right, total, dim, onHover }: {
  p: Placed; x: number; w: number; right: boolean; total: number; dim: boolean; onHover: (n: SankeyNode | null) => void;
}) {
  const { n } = p;
  return (
    <Tip content={<div className="flex flex-col gap-0.5"><span>{n.note}</span>
      <span className="tabular-nums text-fg-muted">{n.exact} <span className="text-fg-faint">· {Math.round((n.value / total) * 100)}% of the flow</span></span></div>}>
      <div tabIndex={0} aria-label={`${n.name}: ${n.note} ${n.exact}`} onMouseEnter={() => onHover(n)} onMouseLeave={() => onHover(null)}
           onFocus={() => onHover(n)} onBlur={() => onHover(null)}
           className={`absolute flex items-start gap-1.5 outline-none text-shadow-halo transition-opacity focus-visible:ring-2 focus-visible:ring-focus
                       ${right ? "justify-end" : "justify-start"} ${dim ? "opacity-50" : ""}`}
           style={{ left: x, top: p.y, width: w, height: HEAD }}>
        <span className="flex min-w-0 items-center gap-1">
          <Logos srcs={n.logos} />
          <span className={`truncate text-small font-semibold leading-3.5 ${n.strong ? "text-fg" : "text-fg-muted"}`}>{n.name}</span>
        </span>
        <span className={`shrink-0 text-small leading-3.5 tabular-nums ${TONE[n.tone] ?? "text-fg-muted"}`}>{n.label}</span>
      </div>
    </Tip>
  );
}

/** What flows in (the left nodes) and out (the right nodes), each column adding up to the same total,
 *  joined by `links`. Under the pointer or the keyboard a node and its ribbons light up and the rest
 *  recede; under the pointer a ribbon lights up with its two nodes, its tooltip saying what moved where
 *  (`amount` writes its value). At most `height` tall (more only when a column's labels need it), less
 *  when its largest ribbon reaches THICK first. */
export function Sankey({ into, out, links, label, amount, height: wanted = 200 }: {
  into: SankeyNode[]; out: SankeyNode[]; links: SankeyLink[]; label: string; amount: (value: number) => string; height?: number;
}) {
  const [ref, { width }] = useSize();
  const [lit, setLit] = useState<SankeyNode | null>(null), [over, setOver] = useState<Ribbon | null>(null);
  const id = useId();
  const height = Math.max(wanted, ...[into, out].map((c) => c.length * (HEAD + HAIR + GAP)));
  const total = sum(into), { left, right, ribbons, used } = layout(into, out, links, height);
  const x0 = BAR + PAD, x1 = width - BAR - PAD, w = (n: SankeyNode) => Math.min(row(n), width * MOST);
  // What is in focus: everything, the lit node and its ribbons, or the ribbon under the pointer and its ends.
  const shown = (n: SankeyNode) => (over ? n === over.from || n === over.to : lit === null || lit === n);
  const lights = (r: Ribbon) => (over ? r === over : lit === r.from || lit === r.to);
  const labels = (side: Placed[], right: boolean) => side.map((p) => (
    <Label key={p.n.key} p={p} x={right ? width - w(p.n) : 0} w={w(p.n)} right={right} total={total} dim={!shown(p.n)} onHover={setLit} />
  ));
  const profitToLoss = (r: Ribbon) => [r.from.role, r.to.role].includes("pnl-up") && [r.from.role, r.to.role].includes("pnl-down");
  return (
    <div ref={ref} role="group" aria-label={label} className="relative w-full" style={{ height: width > 0 ? used : height }}
         onMouseLeave={() => { setLit(null); setOver(null); }}>
      {width > 0 && <>
        <svg width={width} height={used} className="absolute inset-0 block" aria-hidden>
          {[...ribbons].sort((a, b) => b.t - a.t).map((r, i) => {
            const g = `${id}${i}`, a = v(r.from.role), b = v(r.to.role), mid = profitToLoss(r) ? v("fg-faint") : `color-mix(in oklab, ${a}, ${b})`;
            const rest = Math.max(FAINT + (DEEP - FAINT) * r.deep, r.t < THIN ? SEEN : 0);
            return (
              <g key={`${r.from.key}>${r.to.key}`}>
                <linearGradient id={g} gradientUnits="userSpaceOnUse" x1={x0} x2={x1} y1={0} y2={0}>
                  <stop offset={0} stopColor={a} /><stop offset={0.5} stopColor={mid} /><stop offset={1} stopColor={b} />
                </linearGradient>
                {/* An 8px stroke past its edges, transparent, so a hairline can be pointed at. */}
                <Tip content={<span className="tabular-nums">{r.from.name} → {r.to.name} <span className="text-fg-muted">{amount(r.value)}</span></span>}>
                  <path d={band(r, x0, x1)} fill={`url(#${g})`} stroke="transparent" strokeWidth={8} className="transition-opacity"
                        opacity={lit === null && over === null ? rest : lights(r) ? LIT : DIM}
                        onMouseEnter={() => { setLit(null); setOver(r); }} onMouseLeave={() => setOver(null)} />
                </Tip>
              </g>
            );
          })}
          {[...left.map((p) => [p, 0] as const), ...right.map((p) => [p, width - BAR] as const)].map(([p, x]) => (
            <rect key={p.n.key} x={x} y={p.y + HEAD} width={BAR} height={p.bar} rx={BAR / 2} fill={v(p.n.role)}
                  opacity={shown(p.n) ? 1 : FADE} className="transition-opacity" />
          ))}
        </svg>
        {labels(left, false)}{labels(right, true)}
      </>}
    </div>
  );
}
