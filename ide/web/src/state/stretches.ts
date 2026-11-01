// What the Runs page's chart draws of the shown version (state/shown.ts): each chain of its paper runs
// (model/chain.ts) one stretch, in the order they started, joined as one account (model/joined.ts); the
// shown run's chain as the stream the page follows has it, once joined, the others as their own streams
// gave them (paperChain.ts). A run that declares no version of this line is a stretch alone. A chain is
// left out until all its runs are read.
import { useMemo } from "react";
import type { PaperRun } from "../lib/paperApi";
import { chainsOf } from "../model/chain";
import { joined, type Piece } from "../model/joined";
import { usePaperRuns } from "./paper";
import { usePieces } from "./paperChain";
import { useShown } from "./shown";

export type Stretch = { chain: readonly PaperRun[]; piece: Piece; selected: boolean };

/** The stretches of contract `symbol` (null: the Account view's), `own` the shown chain joined. */
export function useStretches(own: Piece | null, symbol: string | null): Stretch[] {
  const { version, chain } = useShown();
  const listing = usePaperRuns();
  const chains = useMemo(() => (version === null ? (chain.length ? [chain] : []) : chainsOf(version, listing?.runs ?? [])), [version, chain, listing]);
  const pieces = usePieces(useMemo(() => chains.flat(), [chains]), symbol);
  const shown = chain.at(-1)?.paper_id;
  return useMemo(() => chains.flatMap((c) => {
    const selected = c.at(-1)!.paper_id === shown;
    if (selected && own) return [{ chain: c, piece: own, selected }];
    const found = c.map((r) => pieces.get(r.paper_id));
    if (found.some((p) => p === undefined)) return [];
    const piece = joined(found.slice(0, -1).map((p, k) => ({ ...p!, status: c[k]!.status })), found.at(-1)!);
    return [{ chain: c, piece, selected }];
  }), [chains, pieces, own, shown]);
}
