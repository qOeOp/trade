import { change, price, usd } from "../../lib/format";
import type { Global } from "../../model/market";
import { KeyValues } from "../../components/KeyValues";
import { Section } from "../../components/Section";
import { Tip } from "../../components/Tip";
import { Signed } from "./CoinDetails";

/** Blockchaincenter's thresholds: three in four beating Bitcoin is an altcoin season, one in four a Bitcoin
 *  season; between them the row says what the share counts, and its tooltip always does. */
const season = (index: number) => (index >= 75 ? "altcoin season" : index <= 25 ? "Bitcoin season" : null);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const faint = (text: string) => <span className="text-fg-faint">{text}</span>;

/** The whole market at the All level: its size and mood, Bitcoin's premiums over Binance (spreads, so in
 *  the text colour, not profit's or loss's), Bitcoin options, and the sources under them. */
export function GlobalMarket({ g }: { g: Global }) {
  const s = g.altseason, o = g.options;
  return (
    <>
      <Section title="Overview">
        <KeyValues labels="fixed" items={[
          ["Total market cap", g.marketCap === null ? null : <>{usd(g.marketCap)} <Signed x={g.marketCapChange24h}>{change(g.marketCapChange24h)}</Signed> {faint("24h")}</>],
          ["BTC dominance", g.btcShare === null ? null : `${g.btcShare.toFixed(1)}%`],
          ["USD stablecoins", g.stablecoins && <>{usd(g.stablecoins.supply)} <Signed x={g.stablecoins.change7d}>{change(g.stablecoins.change7d)}</Signed> {faint("7d")}</>],
          ["Fear & Greed", g.fearGreed && <>{g.fearGreed.value} {faint(g.fearGreed.label)}</>],
          ["Altcoin season", s && (
            <Tip content={`The share of the ${s.coins} largest coins by market cap, stablecoins and BTC left out, that rose more than BTC over 90 days. At 75% or more it is an altcoin season, at 25% or less a Bitcoin season.`}>
              <span>{s.index}% {faint(season(s.index) ?? `of top ${s.coins} beat BTC, 90d`)}</span>
            </Tip>
          )],
        ]} />
      </Section>
      <Section title="Premiums" aside="BTC vs Binance USDT">
        <KeyValues labels="fixed" items={[
          ["Coinbase", g.coinbasePremium === null ? null : <Tip content="Coinbase's BTC-USD in Tether at Kraken's USDT/USD, over Binance's BTCUSDT"><span>{change(g.coinbasePremium, 3)}</span></Tip>],
          ["Korea (Upbit)", g.koreaPremium === null ? null : <Tip content="Upbit's KRW-BTC in Tether at its KRW-USDT, over Binance's BTCUSDT"><span>{change(g.koreaPremium, 3)}</span></Tip>],
        ]} />
      </Section>
      <Section title="Bitcoin options" aside="Deribit">
        <KeyValues labels="fixed" items={[
          ["Open interest", o && usd(o.oi)],
          ["Put/call OI", o?.putCall == null ? null : o.putCall.toFixed(2)],
          ["Max pain", o?.maxPain && <>${price(o.maxPain.strike)} {faint(`expiry ${day(o.maxPain.expiry)}`)}</>],
          ["DVOL", g.dvol === null ? null : g.dvol.toFixed(1)],
        ]} />
      </Section>
      <p className="px-1 text-small text-fg-faint">CoinGecko · DefiLlama · Fear &amp; Greed by alternative.me · Coinbase, Upbit, Kraken and Binance spot · Deribit</p>
    </>
  );
}
