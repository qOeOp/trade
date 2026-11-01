import { useWidget, useView } from "../../model/view";
import type { LineageWidget } from "../../model/types";
import { backtestNote, useBacktest } from "../../state/backtest";
import { usePaperService } from "../../state/paper";
import { useRunData } from "../../state/runData";
import { useShown } from "../../state/shown";
import { ChartCard } from "./ChartCard";

const Empty = ({ children }: { children: string }) => <p className="grid h-full place-items-center text-dense text-fg-faint">{children}</p>;

/** What the page says while the page's server has a daemon that does not answer: the runs are not gone,
 *  and nothing is asked of the user, who may have no shell on the machine; the deployment restarts it. */
function Offline() {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md text-center text-dense">
        <p className="font-semibold text-fg">Paper daemon offline</p>
        <p className="mt-2 text-balance text-fg-muted">Runs keep going in their containers. One that ends is sealed when the daemon is back, and this page reconnects on its own.</p>
      </div>
    </div>
  );
}

/** The Runs page, in the editor's island: the selected version's chart (state/shown.ts), its paper run
 *  picked in the main toolbar. The chart picks what the Trades window follows: a contract, or Equity
 *  for all of them; until the user picks, it opens on a contract holding a position, else on Equity.
 *  A version with no paper run shows its backtest alone. Details and the Trades window describe the stage
 *  shown. */
export function RunsPage() {
  const service = usePaperService();
  const { version, trial, run, stage } = useShown(), backtest = useBacktest();
  const data = useRunData();
  const view = useView();
  const lineage = useWidget<LineageWidget>("lineage@2");
  const t = view.targets ?? lineage?.targets ?? null;
  const targets = { limit: t?.max_drawdown ?? null, annual: t?.annual_return ?? null };

  const card = { version, targets, trial: trial?.trial_id ?? null, backtest, testing: stage === "backtest" };
  if (service === "offline") return <Offline />;
  if (!run || !data || data.run.paper_id !== run.paper_id) {
    if (version === null) return <Empty>Pick a version in the lineage, or a run in the toolbar</Empty>;
    if (run && (service === "checking" || !data)) return <Empty>Reading the paper runs…</Empty>;
    const paper = service === "absent" ? "Paper runs are not served by this IDE" : service === "checking" ? null : "No paper run · ▶ to start";
    if (!trial) return <Empty>{paper && service !== "absent" ? "Nothing to draw: no research run and no paper run" : paper ?? "Reading the paper runs…"}</Empty>;
    if (backtest?.kind !== "ready" || backtest.b.starting === null) return <Empty>{[backtestNote(backtest, trial.trial_id), paper].filter(Boolean).join(" · ")}</Empty>;
    return (
      <div className="@container/page grid h-full min-h-0">
        <ChartCard {...card} run={null} view="equity" s={null} a={null} fills={[]} stretches={[]} paper={paper} />
      </div>
    );
  }
  return (
    <div className="@container/page grid h-full min-h-0">
      <ChartCard {...card} run={run} view={data.view} s={data.s} a={data.a} fills={data.fills} stretches={data.stretches} paper={null} />
    </div>
  );
}
