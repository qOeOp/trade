// The paper runs the Runs page draws besides the stream it follows (paperStream.ts): the earlier runs of
// the shown run's chain (model/chain.ts), for it to join before the run it follows (model/joined.ts), and
// every run of the version's other chains (stretches.ts). A sealed run's stream sends everything once and
// then `end`: it is read once a run and contract (null: the Account view's, with every contract's closes)
// and kept for the page's life, never asked again. A run still going is read as far as its first readings
// (its stream would never end) and kept as it was then, until it is sealed and read again whole.
import { useEffect, useMemo } from "react";
import { streamUrl, type JournalLine, type PaperRun } from "../lib/paperApi";
import type { Piece } from "../model/joined";
import { atom, useAtom } from "./atom";

const loaded = new Map<string, Piece>();
const loading = new Set<string>();
const done = atom(0);  // counts the runs read, so the page reads again as each arrives
const key = (run: PaperRun, symbol: string | null) => `${run.paper_id}:${symbol ?? ""}:${run.state === "sealed" ? "sealed" : "going"}`;

function load(run: PaperRun, symbol: string | null): void {
  const k = key(run, symbol), paperId = run.paper_id;
  if (loaded.has(k) || loading.has(k)) return;
  loading.add(k);
  const events = new EventSource(streamUrl(paperId, symbol));
  let piece: Piece;
  const data = <T,>(event: Event) => JSON.parse((event as MessageEvent).data) as T;
  const keep = (found: Piece) => { events.close(); loading.delete(k); loaded.set(k, found); done.set(done.get() + 1); };
  // A reconnect sends it all again.
  events.onopen = () => { piece = { paperId, lines: [], bars: [], closes: {}, readings: null, seal: null, failures: [] }; };
  events.addEventListener("lines", (e) => { for (const l of data<JournalLine[]>(e)) (l.kind === "bar" ? piece.bars : piece.lines).push(l); });
  events.addEventListener("closes", (e) => { for (const [s, found] of Object.entries(data<Piece["closes"]>(e))) piece.closes[s] = [...(piece.closes[s] ?? []), ...found]; });
  events.addEventListener("failures", (e) => { piece.failures = data(e); });
  events.addEventListener("readings", (e) => { piece.readings = data(e); if (run.state !== "sealed") keep(piece); });
  events.addEventListener("end", (e) => keep({ ...piece, seal: data(e) }));
}

/** The runs of `runs` read so far as their streams of `symbol` give them, by paper id. */
export function usePieces(runs: readonly PaperRun[], symbol: string | null): ReadonlyMap<number, Piece> {
  const n = useAtom(done), keys = runs.map((r) => key(r, symbol)).join();
  useEffect(() => { for (const r of runs) load(r, symbol); }, [keys]);
  return useMemo(() => new Map(runs.flatMap((r) => { const p = loaded.get(key(r, symbol)); return p ? [[r.paper_id, p] as const] : []; })), [n, keys]);
}

/** The runs `runs` (oldest first) as their streams of `symbol` give them, once every one is read; null
 *  until then, so the page shows its own run alone meanwhile, never part of the chain. */
export function useEarlier(runs: readonly PaperRun[], symbol: string | null): Piece[] | null {
  const found = usePieces(runs, symbol);
  return useMemo(() => (runs.every((r) => found.has(r.paper_id)) ? runs.map((r) => found.get(r.paper_id)!) : null), [found]);
}
