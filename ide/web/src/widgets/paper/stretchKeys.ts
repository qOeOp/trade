// The keys of a Runs page chart, once it has the focus (a click on it gives it): `[` and `]` show the
// stretch before or after the shown one without moving the view, stopping at either end (live is not
// one); `F` fits the view to the shown stretch, ⇧F to all of them.
import type { PaperRun } from "../../lib/paperApi";
import { chooseRun, chooseStage } from "../../state/stage";

/** Shows a stretch: its chain's latest run, or the backtest (no run). */
export const showStretch = (s: { run: PaperRun | null }) => (s.run ? chooseRun(s.run) : chooseStage("backtest"));

/** Acts on `key` over `stretches`, `shown` the index of the one shown (-1: none); whether the key was one
 *  of these. */
export function stretchKey(key: string, stretches: readonly { run: PaperRun | null }[], shown: number, fit: (k: number) => void, whole: () => void): boolean {
  if (key === "[" || key === "]") {
    const next = stretches[shown + (key === "]" ? 1 : -1)];
    if (shown >= 0 && next) showStretch(next);
  } else if (key === "f") { if (shown >= 0) fit(shown); }
  else if (key === "F") whole();
  else return false;
  return true;
}
