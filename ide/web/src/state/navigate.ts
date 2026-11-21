// Going from one page to another to show something: a version link (an Agent answer, the command palette)
// shows the version on the canvas, from any page; a replay picked in Details shows its backtest on the Runs page.
import { toolPage } from "../model/toolScope";
import { showLineage } from "./editors";
import { select } from "./selection";
import { shell, showRunsPage } from "./shell";
import { chooseTrial } from "./stage";

/** Selects `id` and brings it into view on the canvas, leaving the Market, Runs or History page for it. */
export function showVersion(id: string): void {
  select(id, { reveal: true });
  if (toolPage(shell.get().last.left) !== "research") showLineage();
}

/** Shows the backtest of replay `trial` of the selected version on the Runs page. */
export function showTrial(trial: number): void {
  chooseTrial(trial);
  showRunsPage();
}
