import { useWidget, useView } from "../../model/view";
import type { LineageWidget } from "../../model/types";
import { backtestNote, useBacktest } from "../../state/backtest";
import { usePaperService } from "../../state/paper";
import { useAtom } from "../../state/atom";
import { useRunData } from "../../state/runData";
import { paperTab } from "../../state/stage";
import { useShown } from "../../state/shown";
import { Typing } from "../../components/Typing";
import { ChartCard } from "./ChartCard";

// The page's one line when there is no chart to draw, typing itself out while it is being read (Typing).
const Empty = ({ children, busy = false }: { children: string; busy?: boolean }) => <div className="grid h-full place-items-center"><Typing text={children} busy={busy} className="text-dense text-fg-faint" /></div>;

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
 *  A version with no paper run shows its backtest alone, on Equity or a contract it traded. Details and
 *  the Trades window describe the stage shown. */
export function RunsPage() {
  const service = usePaperService();
  const { version, trial, run, stage } = useShown(), backtest = useBacktest();
  const data = useRunData(), tab = useAtom(paperTab);
  const view = useView();
  const lineage = useWidget<LineageWidget>("lineage@2");
  const t = view.targets ?? lineage?.targets ?? null;
  const targets = { limit: t?.max_drawdown ?? null, annual: t?.annual_return ?? null };

  const card = { version, targets, trial: trial?.trial_id ?? null, backtest, testing: stage === "backtest" };
  if (service === "offline") return <Offline />;
  if (!run || !data || data.run.paper_id !== run.paper_id) {
    if (version === null) return <Empty>Pick a version in the lineage, or a run in the toolbar</Empty>;
    if (run && (service === "checking" || !data)) return <Empty busy>Reading the paper runs…</Empty>;
    // A version with no paper run says nothing of it: the toolbar's ▶ already offers one.
    const paper = service === "absent" ? "Paper runs are not served by this IDE" : null;
    if (!trial) return <Empty busy={service === "checking"}>{service === "checking" ? "Reading the paper runs…" : paper ?? "Nothing to draw: no research run and no paper run"}</Empty>;
    if (backtest?.kind !== "ready" || backtest.b.starting === null) return <Empty busy={backtest?.kind === "reading"}>{[backtestNote(backtest, trial.trial_id), paper].filter(Boolean).join(" · ")}</Empty>;
    return (
      <div className="@container/page grid h-full min-h-0">
        <ChartCard {...card} run={null} view={backtest.b.cycles.some((c) => c.symbol === tab) ? tab! : "equity"} s={null} a={null} fills={[]} stretches={[]} paper={paper} />
      </div>
    );
  }
  return (
    <div className="@container/page grid h-full min-h-0">
      <ChartCard {...card} run={run} view={data.view} s={data.s} a={data.a} fills={data.fills} stretches={data.stretches} paper={null} />
    </div>
  );
}
