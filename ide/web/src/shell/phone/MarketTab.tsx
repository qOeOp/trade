import { useMemo } from "react";
import { PhonePage } from "../../components/PhoneBar";
import { PhoneHeading, PhoneTable, Side } from "../../components/PhoneParts";
import { HeatLegend } from "../../components/HeatLegend";
import { HeatTile } from "../../components/HeatTile";
import { KeyValues } from "../../components/KeyValues";
import { Section } from "../../components/Section";
import { useNow } from "../../components/hooks/useNow";
import { useSize } from "../../components/hooks/useSize";
import { change, funding, price, usd } from "../../lib/format";
import { fixed } from "../../lib/paperApi";
import { level, type Coin, type Snapshot } from "../../model/market";
import { liveHeld, paperHeld, type Held } from "../../model/phoneRuns";
import { layout } from "../../model/treemap";
import { ACTIVE } from "../../model/chain";
import { useLiveTrading } from "../../state/liveTrading";
import { useOverviewService, useSnapshot } from "../../state/market";
import { usePaperRuns } from "../../state/paper";
import { pnlClass } from "../../theme/roles";
import { ago } from "./RunCards";
import { PhoneTop } from "./PhoneTop";

const FIXED = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
type Yours = { where: string; held: Held };

/** The sectors at the All level, one level only: the desktop heatmap's tiles, colour and scale; no drill-down. */
function Sectors({ snapshot }: { snapshot: Snapshot }) {
  const [ref, { width }] = useSize(), height = Math.round(width * 0.8);
  const nodes = useMemo(() => level(snapshot, [], "marketCap", "change24h"), [snapshot]);
  const tiles = useMemo(() => layout(nodes, width, height), [nodes, width, height]);
  const areas = tiles.map((t) => t.width * t.height), frame = { width, height, maxArea: Math.max(...areas, 0), minArea: Math.min(...areas, Infinity) };
  return (
    <div className="px-3 pb-2">
      <div className="pb-2"><HeatLegend color="change24h" /></div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {tiles.map((t) => <HeatTile key={t.data.name} tile={t} frame={frame} color="change24h" hovered={false} selected={false} opens={false} onPick={() => undefined} />)}
      </div>
    </div>
  );
}

/** The coins in the prices: those the runs going now trade, then BTC, ETH and SOL; a fixed list. */
function coinsOf(snapshot: Snapshot, traded: readonly string[]): Coin[] {
  const wanted = [...new Set([...traded, ...FIXED])];
  return wanted.flatMap((s) => snapshot.coins.find((c) => c.symbol === s) ?? []);
}

/** The Market tab: the desktop Overview card's three rows, the prices of a few contracts with what the runs hold of
 *  them, and the sectors' heatmap. */
export function MarketTab() {
  const service = useOverviewService(), snapshot = useSnapshot(), now = useNow(10_000);
  const live = useLiveTrading().view.runs.filter((r) => !r.ended), paper = (usePaperRuns()?.runs ?? []).filter((r) => ACTIVE.has(r.state));
  const yours = useMemo(() => [
    ...live.flatMap((r) => liveHeld(r).map((held): Yours => ({ where: "Live", held }))),
    ...paper.flatMap((r) => paperHeld(r).map((held): Yours => ({ where: `Paper ${r.paper_id}`, held }))),
  ], [live, paper]);
  const traded = [...live.flatMap((r) => r.symbols ?? []), ...paper.flatMap((r) => r.symbols)];
  const updated = snapshot?.sources.quotes?.updated ? Date.parse(snapshot.sources.quotes.updated) : null;
  const g = snapshot?.global;
  return (
    <>
      <PhoneTop title="Market" aside={updated !== null && Number.isFinite(updated) ? `Updated ${ago(updated, now)} ago` : undefined} />
      <PhonePage>
        {!snapshot ? <p className="p-4 text-dense text-fg-faint">{service === "absent" ? "Market data is not served by this IDE." : service === "offline" ? "Market data offline. This page reconnects on its own." : "Reading the market…"}</p> : <>
          {g && <div className="px-3 pt-3 text-dense"><Section title="Overview">
            <KeyValues labels="fixed" items={[
              ["Total market cap", g.marketCap === null ? null : <>{usd(g.marketCap)} <span className={pnlClass(g.marketCapChange24h)}>{change(g.marketCapChange24h)}</span> <span className="text-fg-faint">24h</span></>],
              ["BTC dominance", g.btcShare === null ? null : `${g.btcShare.toFixed(1)}%`],
              ["Fear & Greed", g.fearGreed && <>{g.fearGreed.value} <span className="text-fg-faint">{g.fearGreed.label}</span></>],
            ]} />
          </Section></div>}
          <PhoneHeading title="Prices" aside="Binance perpetuals" />
          <PhoneTable head={["Coin", "Price", "24h", "Funding"]} rows={coinsOf(snapshot, traded).flatMap((c) => {
            const mine = yours.filter((y) => y.held.symbol === c.symbol);
            const row = [c.base, price(c.price), <span className={pnlClass(c.change24h)}>{change(c.change24h)}</span>, <span className={pnlClass(c.funding)}>{funding(c.funding)}</span>];
            return mine.length ? [row, [<span className="text-small font-normal text-fg-faint">Yours: {mine.map((y, i) => <span key={i}>{i ? " · " : ""}{y.where} <Side long={y.held.long} word={y.held.long ? "long" : "short"} /> {fixed(y.held.qty)}</span>)}</span>]] : [row];
          })} />
          <PhoneHeading title="Sectors" aside="24h · by market cap" />
          <Sectors snapshot={snapshot} />
          <p className="px-3 pb-4 text-small text-fg-faint">Prices and funding: Binance · Market cap and categories: CoinGecko. Coins, news and drill-down are on the desktop.</p>
        </>}
      </PhonePage>
    </>
  );
}
