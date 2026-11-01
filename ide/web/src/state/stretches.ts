// What the Runs page's chart draws of the shown version (state/shown.ts): its paper runs as stretches
// (model/stretches.ts), the shown run's chain as the stream the page follows has it, once joined, the others
// as their own streams gave them (paperChain.ts), selected while the paper stage is shown. A contract's
// are the chains that trade it: the time between two of them is when no run traded it. A run that declares
// no version of this line is a stretch alone.
import { useMemo } from "react";
import { chainsOf } from "../model/chain";
import type { Piece } from "../model/joined";
import { stretchesOf, type Stretch } from "../model/stretches";
import { usePaperRuns } from "./paper";
import { usePieces } from "./paperChain";
import { useShown } from "./shown";

/** The stretches of contract `symbol` (null: the Account view's), `own` the shown chain joined. */
export function useStretches(own: Piece | null, symbol: string | null): Stretch[] {
  const { version, chain, stage } = useShown();
  const listing = usePaperRuns();
  const chains = useMemo(() => (version === null ? (chain.length ? [chain] : []) : chainsOf(version, listing?.runs ?? [])), [version, chain, listing]);
  const pieces = usePieces(useMemo(() => chains.flat(), [chains]), symbol);
  const shown = chain.at(-1);
  const traded = useMemo(() => (symbol ? chains.filter((c) => c.at(-1)!.symbols.includes(symbol)) : chains), [chains, symbol]);
  return useMemo(() => stretchesOf(traded, pieces, own, shown, stage !== "backtest"), [traded, pieces, own, shown, stage]);
}
