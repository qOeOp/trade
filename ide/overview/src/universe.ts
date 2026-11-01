// The coins the Market page draws: Binance USDT-margined perpetuals in trading with a coin underlying,
// stablecoins left out by the market database's own rule (market/universe.py), each in one sector merged
// from the contract's Binance tag (`underlyingSubType`). A contract with no tag is in Other.

export type Contract = { symbol: string; base: string; sector: string };

/** The sectors in the page's order; Other is always last. */
export const SECTORS = ["Layer 1", "PoW", "DeFi", "Meme", "AI", "Infrastructure", "Layer 2", "Gaming & NFT", "Payments", "RWA", "Other"];
const GROUP: Record<string, string> = {
  "Layer-1": "Layer 1", "Layer-2": "Layer 2", DeFi: "DeFi", AI: "AI", Meme: "Meme", Chinese: "Meme",
  Infrastructure: "Infrastructure", Storage: "Infrastructure", Gaming: "Gaming & NFT", Metaverse: "Gaming & NFT",
  NFT: "Gaming & NFT", PoW: "PoW", Payment: "Payments", RWA: "RWA",
};
const GENERIC = new Set(["Crypto", "Alpha"]);
const STABLECOINS = new Set(["USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD"]);

type ExchangeSymbol = {
  symbol: string; baseAsset: string; quoteAsset: string; contractType: string; status: string;
  underlyingType?: string; underlyingSubType?: string[];
};

export function sectorOf(tags: readonly string[] = []): string {
  const tag = tags.find((t) => !GENERIC.has(t));
  return (tag && GROUP[tag]) || "Other";
}

/** The contracts of `GET /fapi/v1/exchangeInfo`, in its order. */
export function contracts(info: { symbols: ExchangeSymbol[] }): Contract[] {
  return info.symbols
    .filter((s) => s.contractType === "PERPETUAL" && s.status === "TRADING" && s.quoteAsset === "USDT"
      && s.underlyingType === "COIN" && !STABLECOINS.has(s.baseAsset))
    .map((s) => ({ symbol: s.symbol, base: s.baseAsset, sector: sectorOf(s.underlyingSubType) }));
}
