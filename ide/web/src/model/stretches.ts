// A version's paper runs as the Runs page's chart draws them: one stretch, each chain of them (chain.ts)
// joined as one account (joined.ts) and the chains, in the order they started, joined again as one: the
// time between two chains, when no run ran, a gap inside the stretch as a chain's offline time is ("idle").
// An invalid chain's evidence is untrusted, so nothing joins onto it: it is a stretch alone, and the chains
// after it another. A chain that starts before the one before it ended starts a stretch of its own (the
// equity chart leaves it out). A chain is left out until all its runs are read.
import type { JournalLine, PaperRun } from "../lib/paperApi";
import { ending } from "./ending";
import { joined, type Piece } from "./joined";

/** A stretch: its runs (oldest first), them joined as one account, whether it is shown, and the run a
 *  click on it shows (the shown one when it holds it, else its latest). */
export type Stretch = { chain: readonly PaperRun[]; piece: Piece; selected: boolean; run: PaperRun };
type Group = { runs: PaperRun[]; pieces: Piece[]; mine: boolean };

const invalid = (runs: readonly PaperRun[]) => runs.at(-1)!.status === "invalid";
const first = (p: Piece) => p.readings?.equity[0]?.[0] ?? null, last = (p: Piece) => p.readings?.equity.at(-1)?.[0] ?? null;

/** The line joined writes between chain `stopped` and the next as a chain's restart, as the time no run ran. */
function idle(l: JournalLine, stopped: Piece): JournalLine {
  const end = ending({ status: stopped.status ?? null, seal: stopped.seal });
  return { ...l, gap: "idle", lead: end.gap === "paused" ? `${end.word} ${end.lead}` : end.lead, resumed: "next run" };
}

/** The stretches of `chains` (oldest first), each run's piece in `pieces` by id, the chain whose latest run
 *  is `shown` as `own` has it once joined (null: as its pieces give it), selected when `selectable`. */
export function stretchesOf(chains: readonly (readonly PaperRun[])[], pieces: ReadonlyMap<number, Piece>, own: Piece | null, shown: PaperRun | undefined, selectable: boolean): Stretch[] {
  const groups: Group[] = [];
  for (const c of chains) {
    const mine = c.at(-1)!.paper_id === shown?.paper_id, found = c.map((r) => pieces.get(r.paper_id));
    if (!(mine && own) && found.some((p) => p === undefined)) continue;
    const piece = mine && own ? own : joined(found.slice(0, -1).map((p, k) => ({ ...p!, status: c[k]!.status })), found.at(-1)!);
    const g = groups.at(-1), before = g?.pieces.at(-1), end = before && last(before), start = first(piece);
    const joins = g && !invalid(g.runs) && !invalid(c) && (end == null || start == null || start > end);
    if (joins) { g.runs.push(...c); g.pieces.push({ ...piece, status: c.at(-1)!.status }); g.mine ||= mine; }
    else groups.push({ runs: [...c], pieces: [{ ...piece, status: c.at(-1)!.status }], mine });
  }
  return groups.map(({ runs, pieces: all, mine }) => {
    // The restarts joined wrote between two chains: from one chain's latest run to the next's.
    const joint = joined(all.slice(0, -1), all.at(-1)!), seams = new Map(all.slice(1).map((p, k) => [p.paperId, all[k]!]));
    const lines = joint.lines.map((l) => {
      const stopped = l.kind === "restart" ? seams.get(Number(l.started)) : undefined;
      return stopped && stopped.paperId === Number(l.stopped) ? idle(l, stopped) : l;
    });
    return { chain: runs, piece: { ...joint, lines }, selected: mine && selectable, run: mine && shown ? shown : runs.at(-1)! };
  });
}
