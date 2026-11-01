// The earlier runs of the chain the Paper page shows (model/chain.ts), for it to join before the run it
// follows (model/joined.ts). Each is sealed, so its stream sends everything once and then `end`: it is read
// once a run and contract (null: the Account view's, with every contract's closes) and kept for the page's
// life, never asked again.
import { useEffect, useMemo } from "react";
import { streamUrl, type JournalLine } from "../lib/paperApi";
import type { Piece } from "../model/joined";
import { atom, useAtom } from "./atom";

const loaded = new Map<string, Piece>();
const loading = new Set<string>();
const done = atom(0);  // counts the runs read, so the page reads again as each arrives
const key = (paperId: number, symbol: string | null) => `${paperId}:${symbol ?? ""}`;

function load(paperId: number, symbol: string | null): void {
  const k = key(paperId, symbol);
  if (loaded.has(k) || loading.has(k)) return;
  loading.add(k);
  const events = new EventSource(streamUrl(paperId, symbol));
  let piece: Piece;
  const data = <T,>(event: Event) => JSON.parse((event as MessageEvent).data) as T;
  // A reconnect sends it all again.
  events.onopen = () => { piece = { paperId, lines: [], bars: [], closes: {}, readings: null, seal: null, failures: [] }; };
  events.addEventListener("lines", (e) => { for (const l of data<JournalLine[]>(e)) (l.kind === "bar" ? piece.bars : piece.lines).push(l); });
  events.addEventListener("closes", (e) => { for (const [s, found] of Object.entries(data<Piece["closes"]>(e))) piece.closes[s] = [...(piece.closes[s] ?? []), ...found]; });
  events.addEventListener("failures", (e) => { piece.failures = data(e); });
  events.addEventListener("readings", (e) => { piece.readings = data(e); });
  events.addEventListener("end", (e) => {
    events.close();
    loading.delete(k);
    loaded.set(k, { ...piece, seal: data(e) });
    done.set(done.get() + 1);
  });
}

/** The runs `paperIds` (oldest first) as their streams of `symbol` give them, once every one is read;
 *  null until then, so the page shows its own run alone meanwhile, never part of the chain. */
export function useEarlier(paperIds: readonly number[], symbol: string | null): Piece[] | null {
  const n = useAtom(done), ids = paperIds.join();
  useEffect(() => { for (const id of paperIds) load(id, symbol); }, [ids, symbol]);
  return useMemo(() => {
    const found = paperIds.map((id) => loaded.get(key(id, symbol)));
    return found.every((p) => p !== undefined) ? (found as Piece[]) : null;
  }, [n, ids, symbol]);
}
