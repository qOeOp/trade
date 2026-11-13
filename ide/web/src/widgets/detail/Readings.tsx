import { DAY_MS } from "../../lib/time";
import type { Candidate, Targets } from "../../model/types";
import { ANNUAL_DAYS, annualized, neededReturn, pace, type Account, type TradeStats } from "../../model/account";
import { useBacktest } from "../../state/backtest";
import { useRunData } from "../../state/runData";
import { useOnRunsPage } from "../../state/shell";
import { useShown } from "../../state/shown";
import { stageName } from "../../model/stage";
import { Eased } from "../../components/Eased";
import { useHeld } from "../../components/hooks/useHeld";
import { Board, type Facts } from "./ReadingsBoard";


// What a max drawdown is measured on: a sealed run's equity marked at bar closes, a paper run's minute snapshots.
const SEALED = "Measured on mark-to-market equity at bar closes", MINUTES = "Measured on the account's minute snapshots";

type Values = { annual: number | null | undefined; short?: number; maxDrawdown: number | null | undefined; sharpe: number | null | undefined; winRate: number | null | undefined; plans?: true };

/** Every reading of one stage in one card: its three targets (the max drawdown against the limit, the
 *  return against what the minimum annual return asks for by now, never annualized, and the annual
 *  return against that minimum), then its ratios, its trades in USDT and its time in the market. On the
 *  Runs page (`full`) every reading keeps its place before its report or account (`a`, `stats`) is read;
 *  `stale` ones are the last stage's, held unseen so the card keeps its height while the next report is
 *  read, and nothing of them shows on this stage's figures. `ended`: the drawdown is read at the end of
 *  what was run (a backtest's window), not when last seen. */
function Readout({ of, targets, basis, full = false, a: held = null, stats: t = null, stale = false, ended = false }: {
  of: Values; targets: Targets | null; basis: string; full?: boolean; a?: Account | null; stats?: TradeStats | null; stale?: boolean; ended?: boolean;
}) {
  const minimum = targets?.annual_return ?? null;
  const needed = minimum === null || !held ? null : neededReturn(minimum, held.start, held.end);
  const { ahead, usdt } = pace(held?.ret, needed, held?.starting ?? 0);
  const fresh = stale ? null : held;
  const facts: Facts = {
    basis, limit: targets?.max_drawdown ?? null, minimum, mdd: of.maxDrawdown, annual: of.annual, short: of.short, sharpe: of.sharpe,
    winRate: of.winRate, plans: of.plans,
    account: held || full ? { ret: held?.ret, needed, ahead, usdt,
                              dd: !fresh ? null : fresh.drawdown ?? "stop", ended, stale } : undefined,
    stats: t || full ? { pf: t?.profitFactor, avgWin: t?.avgWin, avgLoss: t?.avgLoss, perTrade: t?.perTrade, hold: t?.hold,
                         inMarket: t?.inMarket, streak: t?.streak, stale } : undefined,
  };
  return <Board f={facts} />;
}

const Name = ({ children }: { children: string | null }) => <p className="mb-1 text-small text-fg-faint">{children}</p>;

/** The readings in the selected version's card: on the graph page its backtest's (the Runs page's, unnamed),
 *  named, or its last research run's for a version not shown there; on the Runs page the stage the page shows
 *  (state/shown.ts), named above them, with its own figures: the backtest's research run and, once its
 *  report is read, its account and trades (the last backtest's stay, unseen, while the next report is read),
 *  or the paper run's (its annual return once it has run 30 days; no Sharpe). */
export function Readings({ c, targets }: { c: Candidate; targets: Targets | null }) {
  const runs = useOnRunsPage(), { version, trial } = useShown();
  if (runs) return <StageReadings targets={targets} />;
  if (version === c.id && trial) return <><Name>{stageName("backtest", trial, null)}</Name><Tested targets={targets} /></>;
  const t = (c.trials ?? []).filter((x) => x.purpose === "research").at(-1);
  return <Readout of={{ annual: t?.annual_return, maxDrawdown: t?.max_drawdown, sharpe: t?.sharpe, winRate: t?.plan_win_rate, plans: true }} targets={targets} basis={SEALED} />;
}

/** The shown backtest's readings: its research run's figures and, once its report is read, its account and trades. */
function Tested({ targets }: { targets: Targets | null }) {
  const { stage, trial } = useShown(), backtest = useBacktest(), runs = useOnRunsPage(), testing = stage === "backtest" || !runs;
  const ready = testing && backtest?.kind === "ready" && backtest.b.account ? { a: backtest.b.account, stats: backtest.b.stats } : null;
  const tested = useHeld(ready, testing && backtest?.kind === "reading");
  return <Eased>
    <Readout of={{ annual: trial?.annual_return, maxDrawdown: trial?.max_drawdown, sharpe: trial?.sharpe, winRate: trial?.plan_win_rate, plans: true }} targets={targets}
             basis={SEALED} full a={tested?.a} stats={tested?.stats} stale={!ready} ended />
  </Eased>;
}

function StageReadings({ targets }: { targets: Targets | null }) {
  const { stage, run, name } = useShown(), data = useRunData();
  if (stage === "backtest") return <><Name>{name}</Name><Tested targets={targets} /></>;
  if (stage !== "paper") return null;
  const a = data && data.run.paper_id === run?.paper_id ? data.a : null, stats = a ? data!.stats : null;
  const days = a?.start == null ? 0 : (a.end - a.start) / DAY_MS;
  const annual = annualized(a?.ret, days);
  return (
    <>
      <Name>{name}</Name>
      <Readout of={{ annual, short: a?.start != null && days < ANNUAL_DAYS ? days : undefined, maxDrawdown: a?.maxDrawdown ?? null, sharpe: null, winRate: stats?.winRate ?? null }}
               targets={targets} basis={MINUTES} full a={a} stats={stats} />
    </>
  );
}
