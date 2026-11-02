import { change, price, usd } from "../../lib/format";
import type { Global } from "../../model/market";
import { KeyValues } from "../../components/KeyValues";
import { Section } from "../../components/Section";
import { Signed } from "./CoinDetails";

/** Blockchaincenter's thresholds: three in four beating Bitcoin is an altcoin season, one in four a Bitcoin
 *  season; between them the row says what the share counts. */
const season = (index: number) => (index >= 75 ? "altcoin season" : index <= 25 ? "Bitcoin season" : null);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const faint = (text: string) => <span className="text-fg-faint">{text}</span>;

/** The whole market at the All level: its size and mood, Bitcoin's premiums over Binance, and Bitcoin options. */
export function GlobalMarket({ g }: { g: Global }) {
  const s = g.altseason, o = g.options;
  return (
    <>
      <Section title="Market" aside="CoinGecko · DefiLlama · alternative.me">
        <KeyValues labels="fixed" items={[
          ["Market cap", g.marketCap === null ? null : <>{usd(g.marketCap)} <Signed x={g.marketCapChange24h}>{change(g.marketCapChange24h)}</Signed></>],
          ["Bitcoin share", g.btcShare === null ? null : `${g.btcShare.toFixed(1)}%`],
          ["USD stablecoins", g.stablecoins && <>{usd(g.stablecoins.supply)} <Signed x={g.stablecoins.change7d}>{change(g.stablecoins.change7d)}</Signed> {faint("7d")}</>],
          ["Fear & Greed", g.fearGreed && <>{g.fearGreed.value} {faint(g.fearGreed.label)}</>],
          ["Altcoin season", s && <>{s.index}% {faint(season(s.index) ?? `of top ${s.coins} beat BTC, 90d`)}</>],
        ]} />
      </Section>
      <Section title="Premiums" aside="BTC over Binance">
        <KeyValues labels="fixed" items={[
          ["Coinbase", g.coinbasePremium === null ? null : <Signed x={g.coinbasePremium}>{change(g.coinbasePremium, 3)}</Signed>],
          ["Korea (Upbit)", g.koreaPremium === null ? null : <Signed x={g.koreaPremium}>{change(g.koreaPremium, 3)}</Signed>],
        ]} />
      </Section>
      <Section title="Bitcoin options" aside="Deribit">
        <KeyValues labels="fixed" items={[
          ["Open interest", o && usd(o.oi)],
          ["Put / call", o?.putCall == null ? null : o.putCall.toFixed(2)],
          ["Max pain", o?.maxPain && <>${price(o.maxPain.strike)} {faint(`expiry ${day(o.maxPain.expiry)}`)}</>],
          ["DVOL", g.dvol === null ? null : g.dvol.toFixed(1)],
        ]} />
      </Section>
    </>
  );
}
