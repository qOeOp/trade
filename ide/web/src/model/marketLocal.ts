// The contracts the market directory holds bars of (`/api/market/local`, from `market coverage`), so the Market page
// marks what a replay can run on here. Read-time only: nothing is stored.

/** One held contract: its first and last LAST bar's open time (Unix ms). */
export type LocalContract = { symbol: string; first_open_ms: number; last_open_ms: number };
/** The server's answer: the market day read and its held contracts. */
export type LocalReply = { market_day: string; contracts: LocalContract[] };

/** The held contracts by symbol. */
export const heldBy = (reply: LocalReply): Map<string, LocalContract> => new Map(reply.contracts.map((c) => [c.symbol, c]));

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** What a held contract's mark says: the days its bars span, at the market day read. */
export const heldWords = (c: LocalContract, marketDay: string): string =>
  `Local market (${marketDay}): bars from ${day(c.first_open_ms)} to ${day(c.last_open_ms)}, so a replay can run on it here`;

/** How many of `symbols` the market directory holds bars of; null while unknown. */
export const heldCount = (held: ReadonlyMap<string, LocalContract> | null, symbols: readonly string[]): number | null =>
  held ? symbols.filter((s) => held.has(s)).length : null;
