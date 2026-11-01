import type { Candidate, Targets, Trial } from "../../model/types";
import { meets } from "../../model/semantics";
import { useRunData } from "../../state/runData";
import { useOnRunsPage } from "../../state/shell";
import { useShown } from "../../state/shown";
import { MetricStrip } from "../../components/MetricStrip";
import { Targets as PaperTargets } from "../paper/Targets";

const percent = { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const two = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const DAY_MS = 86_400_000;
const ANNUAL_DAYS = 30;  // a paper run's return is annualized once it has run this long

type Values = Pick<Trial, "annual_return" | "max_drawdown" | "sharpe" | "win_rate"> & { annualNote?: string };

/** Annual return, max drawdown, Sharpe and win rate, the first two against the line's targets. */
function Strip({ of, targets }: { of: Values; targets: Targets | null }) {
  return (
    <MetricStrip items={[
      { label: "Annual return", value: of.annual_return, note: of.annualNote, format: percent, tone: meets(of.annual_return, targets?.annual_return, true) === false ? "misses" : "fg" },
      { label: "Max drawdown", value: of.max_drawdown, format: percent, tone: meets(of.max_drawdown, targets?.max_drawdown, false) === false ? "misses" : "fg" },
      { label: "Sharpe", value: of.sharpe, format: two },
      { label: "Win rate", value: of.win_rate, format: percent },
    ]} />
  );
}

const Name = ({ children }: { children: string | null }) => <p className="mb-1 text-small text-fg-faint">{children}</p>;

/** The readings in the selected version's card: on the graph page its last research run's; on the Runs
 *  page the stage the page shows (state/shown.ts), named above them, with its own figures: the backtest's
 *  research run, or the paper run's chain (its annual return once it has run 30 days; no Sharpe) with
 *  it against the line's targets under them. Nothing for live trading. */
export function Readings({ c, targets }: { c: Candidate; targets: Targets | null }) {
  const runsPage = useOnRunsPage(), { stage, trial, run, name } = useShown(), data = useRunData();
  if (!runsPage) return <Strip of={(c.trials ?? []).filter((t) => t.purpose === "research").at(-1) ?? {}} targets={targets} />;
  if (stage === "backtest") return <><Name>{name}</Name><Strip of={trial ?? {}} targets={targets} /></>;
  if (stage !== "paper") return null;
  const a = data && data.run.paper_id === run?.paper_id ? data.a : null, stats = a ? data!.stats : null;
  const days = a?.start == null ? 0 : (a.end - a.start) / DAY_MS;
  const annual = a?.ret != null && days >= ANNUAL_DAYS ? (1 + a.ret) ** (365 / days) - 1 : null;
  const values: Values = { annual_return: annual, annualNote: a?.start != null && days < ANNUAL_DAYS ? `Sample too short · ${Math.floor(days)} d` : undefined,
                           max_drawdown: a?.maxDrawdown ?? null, sharpe: null, win_rate: stats?.winRate ?? null };
  const limits = { limit: targets?.max_drawdown ?? null, annual: targets?.annual_return ?? null };
  return (
    <>
      <Name>{name}</Name>
      <Strip of={values} targets={targets} />
      {a && <div className="border-t border-line-strong pb-3 pt-2.5"><PaperTargets a={a} targets={limits} /></div>}
    </>
  );
}
