// The page's second level: sub-sectors of the larger sectors, each a list of CoinGecko categories (no free
// source has a category tree, so this table is ours). A coin goes to the first sub-sector of its sector
// whose categories hold it; one in none goes to the sector's rest. A coin Binance gives no tag (Other)
// first takes the first sector here whose categories hold it.
import { SECTORS } from "./universe.ts";

type Table = readonly (readonly [string, readonly string[]])[];
export const SUBSECTORS: Readonly<Record<string, Table>> = {
  DeFi: [["Perpetuals", ["decentralized-perpetuals"]], ["Derivatives", ["decentralized-derivatives", "synthetic"]],
         ["DEX", ["decentralized-exchange"]], ["Lending", ["lending-borrowing"]],
         ["Liquid staking", ["liquid-staking", "liquid-staking-governance-tokens", "liquid-restaking-governance-token", "restaking"]],
         ["Yield", ["yield-farming", "yield-aggregator", "yield-optimizer", "yield-tokenization"]]],
  Meme: [["Dog", ["dog-themed-coins"]], ["Frog", ["frog-themed-coins"]], ["Cat", ["cat-themed-coins"]], ["AI Meme", ["ai-meme-coins"]],
         ["Celebrity", ["celebrity-themed-coins"]], ["Solana Meme", ["solana-meme-coins"]]],
  AI: [["AI Agents", ["ai-agents", "ai-agent-launchpad", "ai-framework"]], ["AI Applications", ["ai-applications"]], ["DePIN", ["depin"]]],
  Infrastructure: [["Oracle", ["oracle"]], ["Storage", ["data-storage"]], ["Interoperability", ["interoperability", "cross-chain-communication"]],
                   ["Zero knowledge", ["zero-knowledge-zk"]], ["DePIN", ["depin"]], ["Modular", ["data-availability", "modular-blockchain"]]],
  "Gaming & NFT": [["Gaming", ["gaming", "gaming-platform", "gaming-blockchains", "on-chain-gaming"]], ["Metaverse", ["metaverse"]],
                   ["NFT", ["non-fungible-tokens-nft"]]],
  Other: [["Exchange tokens", ["centralized-exchange-token-cex", "exchange-based-tokens"]], ["Prediction markets", ["prediction-markets"]],
          ["SocialFi", ["socialfi", "decentralized-social-media-desoc"]], ["Launchpads", ["launchpad"]], ["Sports", ["sports", "sports-games"]],
          ["DeSci", ["decentralized-science-desci"]]],
};
/** Every category the table names, each once: what the daily membership pass asks CoinGecko for. */
export const CATEGORIES = [...new Set(Object.values(SUBSECTORS).flatMap((t) => t.flatMap(([, cs]) => cs)))];

/** A sector splits once it holds this many coins; a smaller sub-sector folds into the rest. */
const MIN_SECTOR = 25, MIN_SUBSECTOR = 2;
export const rest = (sector: string) => (sector === "Other" ? "Unsorted" : `Other ${sector}`);

export type Place = { sector: string; subsector: string | null };

/** Each coin's sector and sub-sector, `categories` holding each CoinGecko id's categories. A sector that is
 *  too small, has no table or would come out as a single sub-sector has none. */
export function place(coins: readonly { symbol: string; sector: string; id: string | undefined }[],
                      categories: ReadonlyMap<string, ReadonlySet<string>>): Map<string, Place> {
  const out = new Map<string, Place>();
  for (const c of coins) {
    const of = categories.get(c.id ?? "") ?? new Set<string>();
    const hit = (sector: string) => SUBSECTORS[sector]?.find(([, cs]) => cs.some((x) => of.has(x)))?.[0] ?? null;
    const moved = c.sector === "Other" ? SECTORS.find((s) => s !== "Other" && hit(s)) : undefined;
    out.set(c.symbol, moved ? { sector: moved, subsector: hit(moved) } : { sector: c.sector, subsector: hit(c.sector) });
  }
  for (const sector of SECTORS) {
    const members = [...out.values()].filter((p) => p.sector === sector);
    if (!SUBSECTORS[sector] || members.length < MIN_SECTOR) { for (const p of members) p.subsector = null; continue; }
    const count = new Map<string | null, number>();
    for (const p of members) count.set(p.subsector, (count.get(p.subsector) ?? 0) + 1);
    for (const p of members) p.subsector = p.subsector !== null && count.get(p.subsector)! >= MIN_SUBSECTOR ? p.subsector : rest(sector);
    if (new Set(members.map((p) => p.subsector)).size < 2) for (const p of members) p.subsector = null;
  }
  return out;
}
