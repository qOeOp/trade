import { useMemo, useState, type MouseEvent } from "react";
import { plural } from "../../lib/format";
import { coinsAt, level, into, MORE, type Color, type Node, type Size } from "../../model/market";
import { layout } from "../../model/treemap";
import { hoverAt, ripple } from "../../model/ripple/layout";
import { marketCoin, marketColor, marketSize, openPath, useMarketView, useOverviewService, useSnapshot } from "../../state/market";
import { Breadcrumbs, type Crumb } from "../../components/Breadcrumbs";
import { Dropdown, DropdownRadio } from "../../components/Dropdown";
import { usePhone } from "../../state/phone";
import { HeatLegend } from "../../components/HeatLegend";
import { HeatTile } from "../../components/HeatTile";
import { useSize } from "../../components/hooks/useSize";

const SIZES = [{ value: "marketCap", label: "Market cap" }, { value: "volume24h", label: "Volume 24h" }, { value: "oi", label: "Open interest" }] as const;
const COLORS = [{ value: "change1h", label: "Change 1h" }, { value: "change4h", label: "Change 4h" }, { value: "change24h", label: "Change 24h" },
                { value: "change7d", label: "Change 7d" }, { value: "funding", label: "Funding" }, { value: "oiChange24h", label: "Open interest 24h" }] as const;

/** A compact menu of one choice, its trigger naming what it sets and the chosen option. */
function Choice<T extends string>({ name, options, value, onChange }: { name: string; options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <Dropdown variant="compact" align="end" label={`Tile ${name.toLowerCase()}`}
              trigger={<span className="whitespace-nowrap"><span className="text-fg-faint">{name}</span> {options.find((o) => o.value === value)?.label}</span>}>
      <DropdownRadio value={value} options={options} onChange={onChange} />
    </Dropdown>
  );
}

const Empty = ({ title, children }: { title: string; children?: string }) => (
  <div className="grid h-full place-items-center p-6 text-center text-dense">
    <div className="max-w-md"><p className="font-semibold text-fg">{title}</p>{children && <p className="mt-2 text-balance text-fg-muted">{children}</p>}</div>
  </div>
);

/** The path as steps: All, the sector, its sub-sector, then each opened "+N more" by how many coins it holds. */
const crumbs = (path: readonly string[], labels: readonly string[]): Crumb[] => [
  { id: "all", label: "All", onSelect: () => openPath([]) },
  ...path.map((p, i) => ({ id: `${i}:${p}`, label: labels[i] ?? p, onSelect: () => openPath(path.slice(0, i + 1)) })),
];

/** The heatmap of one level, filling its area: tiles laid out by the size metric, the hovered one grown so
 *  its text reads (model/ripple), a group opening its level on a click and a coin becoming the pick. The
 *  pointer's position over the whole map decides the hovered tile (hoverAt), not each tile's own enter and
 *  leave, which a growing tile and its shrinking neighbours would set off back and forth. */
function Heatmap({ nodes, color, path, coin }: { nodes: readonly Node[]; color: Color; path: readonly string[]; coin: string | null }) {
  const [ref, { width, height }] = useSize();
  const [hovered, setHovered] = useState<number | null>(null), phone = usePhone();
  const tiles = useMemo(() => layout(nodes, width, height), [nodes, width, height]);
  const shown = useMemo(() => (hovered === null ? tiles : ripple(tiles, hovered, width, height)), [tiles, hovered, width, height]);
  const areas = tiles.map((t) => t.width * t.height);
  const frame = { width, height, maxArea: Math.max(...areas, 0), minArea: Math.min(...areas, Infinity) };
  const pick = (n: Node) => { const next = into(path, n); setHovered(null); if (next) openPath(next); else marketCoin.set(n.coins[0]!.symbol); };
  const point = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top;
    setHovered((h) => hoverAt(tiles, shown, h, x, y));
  };
  return (
    <div ref={ref} className="relative mx-2 mb-2 min-h-0 flex-1" onMouseMove={phone ? undefined : point} onMouseLeave={() => setHovered(null)}>
      {shown.map((t, i) => (
        <HeatTile key={`${t.data.kind}:${t.data.name}`} tile={t} frame={frame} color={color} hovered={i === hovered}
                  selected={t.data.kind === "coin" && t.data.coins[0]?.symbol === coin} onPick={() => pick(t.data)} />
      ))}
    </div>
  );
}

/** The Market page, in the editor's island: the whole perpetual market as a heatmap one level at a time,
 *  All showing the sectors, a sector its sub-sectors or coins, a sub-sector its coins (the unreadable
 *  tail folded into "+N more"). The island's
 *  header has the path, what the tiles' area and colour follow, and the colour scale; its foot names the
 *  sources, as CoinGecko asks. */
export function MarketPage() {
  const service = useOverviewService(), snapshot = useSnapshot();
  const { path, coin, size, color } = useMarketView();
  const nodes = useMemo(() => (snapshot ? level(snapshot, path, size, color) : []), [snapshot, path, size, color]);
  const labels = useMemo(() => path.map((p, i) => (p === MORE && snapshot ? level(snapshot, path.slice(0, i), size, color).at(-1)?.name ?? "More" : p)),
                         [snapshot, path, size, color]);
  const count = useMemo(() => (snapshot ? coinsAt(snapshot, path, size).length : 0), [snapshot, path, size]);
  const phone = usePhone();
  if (service === "absent") return <Empty title="Market data is not served by this IDE" />;
  if (!snapshot) return service === "offline"
    ? <Empty title="Market data offline">The overview service does not answer; this page reconnects on its own.</Empty>
    : <Empty title="Reading the market…" />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The island's 12px inset less a breadcrumb's own 8px padding, so the first crumb's text sits on the inset. */}
      <div className={`flex shrink-0 items-center gap-x-3 pr-3 pl-1 text-dense ${phone ? "flex-wrap py-1" : "h-(--header-h)"}`}>
        <Breadcrumbs items={crumbs(path, labels)} />
        <span className="shrink-0 whitespace-nowrap text-fg-faint">{plural(nodes.length, path.length ? "tile" : "sector")} · {plural(count, "contract")}</span>
        <span className={`flex items-center gap-3 ${phone ? "w-full flex-wrap pl-0.5 [&>[aria-label='Colour_scale']]:w-full [&>[aria-label='Colour_scale']]:pl-1.5" : "ml-auto"}`}>
          <Choice<Size> name="Size" options={SIZES} value={size} onChange={marketSize.set} />
          <Choice<Color> name="Colour" options={COLORS} value={color} onChange={marketColor.set} />
          <HeatLegend color={color} />
        </span>
      </div>
      {nodes.length ? <Heatmap nodes={nodes} color={color} path={path} coin={coin} />
        : <Empty title="No coins at this level">The snapshot has none here; go back to All.</Empty>}
      <p className={`shrink-0 px-3 pb-1.5 text-small text-fg-faint ${phone ? "" : "text-right"}`}>Prices, open interest and funding: Binance · Other exchanges: Bybit, OKX, Bitget, Gate, Hyperliquid · Market cap and categories: CoinGecko</p>
    </div>
  );
}
