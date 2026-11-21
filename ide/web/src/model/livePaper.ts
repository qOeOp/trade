// The launch page's Paper reconciliation row (live/reconcile.py): preparing a run is refused LIVE_PAPER_UNRECONCILED
// until the serving Live control, comparing in the background, holds a sealed Paper run of the candidate's source on
// these contracts that matches its replay. The page asks the same control and says where that comparison stands.
import type { LaunchRow } from "./liveLaunch";
import type { LivePaperRead } from "./liveTrading";

const LABEL = "Paper reconciliation", SOURCE = "Paper runs, compared by the Live service";
/** The control's reasons as sentences: "no sealed … code" → "No sealed … code." */
const said = (reasons: readonly string[]) => reasons.map((r) => `${r.charAt(0).toUpperCase()}${r.slice(1)}${/[.?!]$/.test(r) ? "" : "."}`).join(" ");

/** The row for `paper` (null until a found candidate has valid contracts: then `waiting` and `missing` say why). */
export function paperRow(paper: LivePaperRead | null, waiting: boolean, missing: string): LaunchRow {
  if (!paper) return { id: "paper", label: LABEL, value: null, source: SOURCE, editable: false, required: true, mark: waiting ? "wait" : "fail", reason: missing };
  const { state, paperId, reasons } = paper;
  return { id: "paper", label: LABEL, source: SOURCE, editable: false, required: true,
    value: state === "reconciled" ? `Paper ${paperId}` : state === "unreconciled" ? "None" : null,
    mark: state === "reconciled" ? "pass" : state === "unreconciled" ? "fail" : "wait",
    reason: state === "reconciled" ? "This sealed Paper run of the source on these contracts matches its replay."
      : state === "unreconciled" ? `${said(reasons)} Run the candidate in Paper on these contracts; once it is sealed and the market covers it, Live compares it again.`
      : state === "checking" ? `Checking: Live is comparing this source's Paper runs with their replay. Check account opens once one matches.${reasons.length ? ` ${said(reasons)}` : ""}`
      : "The Live service did not answer just now. It is asked again in a moment." };
}

/** What the account check waits for on the Paper side, or null once a run reconciles. */
export const paperBlocker = (paper: LivePaperRead | null): string | null =>
  paper?.state === "reconciled" ? null : paper?.state === "unreconciled" ? "Needs a reconciled Paper run first (Strategy)." : "Waiting for the Paper reconciliation (Strategy).";
