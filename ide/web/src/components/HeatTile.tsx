import type { CSSProperties, ReactNode } from "react";
import { change, funding, price, usd } from "../lib/format";
import { fillRole, inkRoles, step } from "../model/heat";
import { capOf, isChange, valueOf, weighted, type Coin, type Color, type Node } from "../model/market";
import { corners, tileStyle } from "../model/ripple/layout";
import { usePhone } from "../state/phone";
import type { Tile } from "../model/ripple/split";
import { v } from "../theme/roles";

type TileFrame = { width: number; height: number; maxArea: number; minArea: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const shown = (x: number | null, color: Color, digits = 2) => (color === "funding" ? funding(x) : change(x, digits));
const sum = (coins: readonly Coin[], of: (c: Coin) => number | null) => coins.reduce((a, c) => a + (of(c) ?? 0), 0);

const Stat = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="grid grid-cols-[auto_auto] justify-between gap-2"><span className="opacity-85">{label}</span><span>{value}</span></div>
);

/** One coin's rows: its money and open interest, then the funding and the 24h and 7d changes the tiles'
 *  colour does not already show. */
function coinRows(c: Coin, color: Color, rows: number) {
  const all: [string, string][] = [["Market cap", usd(c.marketCap)], ["Open interest", usd(c.oi)], ["Volume 24h", usd(c.volume24h)]];
  if (color !== "funding") all.push(["Funding", funding(c.funding)]);
  if (color !== "change24h") all.push(["Change 24h", change(c.change24h)]);
  if (color !== "change7d") all.push(["Change 7d", change(c.change7d)]);
  return all.slice(0, Math.min(rows, 5)).map(([l, x]) => <Stat key={l} label={l} value={x} />);
}

/** A coin's open interest across exchanges as one bar, a segment for each, its shade fading down the
 *  order; an exchange holding 14% or more is named under its segment with its share, each on hover. */
function venueShares(c: Coin) {
  const total = c.oiByVenue.reduce((a, [, oi]) => a + oi, 0);
  return (
    <div className="mt-auto flex flex-col gap-2 border-t border-current/15 pt-3">
      <span className="text-small opacity-85">Open interest by exchange</span>
      <div className="flex gap-0.5">
        {c.oiByVenue.map(([venue, oi], i) => (
          <div key={venue} title={`${venue} ${((oi / total) * 100).toFixed(0)}%`} className="flex min-w-0 flex-col gap-0.5 overflow-hidden" style={{ flex: oi }}>
            <i className="mb-1 block h-2 rounded-xs bg-current" style={{ opacity: 0.9 - i * 0.12 }} />
            {oi / total >= 0.14 && <><span className="truncate pr-1.5 text-small opacity-85">{venue}</span><b className="font-medium">{((oi / total) * 100).toFixed(0)}%</b></>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A group's leaders by market cap, each with its share of the group as a bar (a figure under 3%, left out where it would touch the change). */
function leaders(n: Node, color: Color, count: number, w: number) {
  return [...n.coins].sort((a, b) => capOf(b) - capOf(a)).slice(0, count).map((c) => {
    const share = n.cap > 0 ? (capOf(c) / n.cap) * 100 : 0;
    return (
      <div key={c.symbol} className={`grid items-center leading-tight ${w > 170 ? "grid-cols-[minmax(2.75rem,4.5rem)_minmax(0,1fr)_auto] gap-2" : "grid-cols-[2.75rem_minmax(0,1fr)_auto] gap-1.5"}`}>
        <span className="truncate">{c.base}</span>
        {share >= 3 ? <i className="block h-1 rounded-full bg-current opacity-40" style={{ width: `${share.toFixed(1)}%` }} />
          : w > 170 ? <span className="text-small opacity-75">{share < 1 ? "<1" : share.toFixed(0)}%</span> : <span />}
        <span>{shown(valueOf(c, color), color, 1)}</span>
      </div>
    );
  });
}

/** A group's totals under its leaders, when the tile has room for both: its volume and open interest,
 *  its funding weighted by market cap (the rate its money pays) and its 7d change, or its 24h one when
 *  the tiles show the 7d. */
const groupStats = (n: Node, color: Color) => (
  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-current/15 pt-3">
    {([["Volume 24h", usd(sum(n.coins, (c) => c.volume24h))], ["Open interest", usd(sum(n.coins, (c) => c.oi))],
       ["Funding", funding(weighted(n.coins, "funding"))],
       color === "change7d" ? ["Change 24h", change(weighted(n.coins, "change24h"))] : ["Change 7d", change(weighted(n.coins, "change7d"))]] as const).map(([l, x]) => (
      <div key={l} className="flex flex-col gap-px"><span className="text-small opacity-85">{l}</span><b className="font-medium">{x}</b></div>
    ))}
  </div>
);

/** One tile of the Market heatmap, styled by its size as vibe-trading's are: the name and the colour
 *  metric's badge on top; a coin's price and money (on a large tile also its open interest by exchange),
 *  or a group's leaders and totals, as room allows; a group's market cap, median and up and down counts
 *  at the foot. A group opens a level, a coin selects. */
export function HeatTile({ tile, frame, color, hovered, selected, onPick }: {
  tile: Tile<Node>; frame: TileFrame; color: Color; hovered: boolean; selected: boolean; onPick: () => void;
}) {
  const n = tile.data, { width: w, height: h } = tile, k = step(n.value, color), phone = usePhone();
  const style0 = tileStyle(w, h, n.name, frame.maxArea, frame.minArea), [ink, badge, edge] = inkRoles(k);
  // "+N more" is a folder, not a coin: its name never outgrows a mid-sized tile's.
  const st = n.kind === "more" ? { ...style0, nameSize: Math.min(style0.nameSize, 17) } : style0;
  // A phone's tiles are narrow for their names: where a name and its badge do not fit side by side, one over the
  // other, the name whole; on a tile too low for that the name alone, its colour still the metric. The face is
  // monospace, so its width is a count of characters.
  const badgeSize = w < 60 && phone ? 10 : Math.max(11, st.nameSize * 0.62);
  const crowded = phone && n.name.length * st.nameSize * 0.62 + 16 + 4.7 * badgeSize + 2 * st.pad > w;
  const stack = crowded && h >= st.nameSize * 1.25 + 4 + badgeSize * 1.4 + 2 * st.pad + 2;
  const valueSize = clamp(st.nameSize * 0.55, 10, 13), lineSize = clamp(valueSize, 10.5, 12.5);
  const rows = Math.floor((h - 2 * st.pad - st.nameSize * 1.3 - 44) / 19);
  let mid: ReactNode = null, sub: ReactNode = null, foot: ReactNode = null;
  if (n.kind === "coin") {
    const c = n.coins[0]!;
    if (rows >= 2 && w > 150) mid = <>{coinRows(c, color, rows)}{rows >= 12 && w > 300 && c.oiByVenue.length > 1 && venueShares(c)}</>;
    if (h > (stack ? 90 : 70) && w > 90) sub = <div className="mt-0.5 truncate opacity-85">{price(c.price)}{!mid && ` · ${usd(n.cap)}`}{w > 200 && ` · ${c.name}`}</div>;
  } else {
    if (rows >= 1 && w > 130) {
      const withStats = w > 240 && (rows >= 10 || rows - Math.min(n.coins.length, 8) >= 3);
      mid = <>{leaders(n, color, Math.min(withStats ? rows - 4 : rows, 8), w)}{withStats && groupStats(n, color)}</>;
    }
    if (w > 150 && h > 80) foot = `${usd(n.cap, 1)}${w > 260 ? ` · median ${shown(n.median, color, 1)}` : ""} · ${n.up}↑ ${n.down}↓${isChange(color) ? "" : " 24h"}`;
    else if (w > 90 && h > (stack ? 80 : 60)) foot = usd(n.cap, 1);
  }
  const style: CSSProperties = {
    left: tile.x, top: tile.y, width: w, height: h, borderRadius: corners(tile.x, tile.y, w, h, frame.width, frame.height),
    background: v(fillRole(k)), color: v(ink), borderColor: v("heat-edge"), padding: st.pad, fontSize: valueSize,
  };
  const ring = selected ? "z-10 ring-2 ring-inset ring-fg" : hovered ? "z-10 shadow-popup ring-1 ring-inset ring-fg/50" : "";
  return (
    <button type="button" aria-label={`${n.name} ${shown(n.value, color)}`} onClick={onPick} style={style}
            className={`absolute flex flex-col overflow-hidden border text-left transition-[left,top,width,height] duration-300 ease-out ${ring}`}>
      <div className={`flex min-w-0 justify-between ${stack ? "flex-col items-start gap-1" : st.vertical ? "flex-col items-start gap-2" : "items-baseline gap-2"}`}>
        <span className="min-w-0 max-w-full truncate leading-tight" style={{ fontSize: st.nameSize, fontWeight: st.nameWeight }}>
          {n.name}{n.kind !== "coin" && w > 90 && <span className="ml-1 font-normal opacity-60">›</span>}
        </span>
        {/* Slim and long (padding in em, so it keeps its shape at every size), raised by a hairline, a lit top
            edge and a short shadow, as vibe-trading's badge is. */}
        {(!crowded || stack) && (
          <span className={`ml-auto shrink-0 whitespace-nowrap rounded-control border py-[0.1em] ${w < 60 && phone ? "px-[0.15em]" : "px-[0.5em]"} font-semibold leading-[1.15] tabular-nums shadow-badge`}
                style={{ background: v(badge), borderColor: v(edge), fontSize: badgeSize }}>
            {shown(n.value, color, w > 80 ? 2 : 1)}
          </span>
        )}
      </div>
      {sub}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden pt-2 pb-1.5" style={{ fontSize: lineSize }}>{mid}</div>
      {foot && <div className="mt-auto whitespace-nowrap opacity-85">{foot}</div>}
    </button>
  );
}
