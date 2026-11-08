import type { Candidate, Targets } from "../../model/types";
import { neededReturn, type Account, type TradeStats } from "../../model/account";
import { meets } from "../../model/semantics";
import { span } from "../../model/trades";
import { signed } from "../../lib/paperApi";
import { useBacktest } from "../../state/backtest";
import { useRunData } from "../../state/runData";
import { useOnRunsPage } from "../../state/shell";
import { useShown } from "../../state/shown";
import { pnlClass } from "../../theme/roles";
import { Eased } from "../../components/Eased";
import { useHeld } from "../../components/hooks/useHeld";
import { Missing } from "../../components/Missing";
import { Board, type Cell, type Tile } from "./ReadingsBoard";

const DAY_MS = 86_400_000;
const ANNUAL_DAYS = 30;  // a paper run's return is annualized once it has run this long

// What a max drawdown is measured on: a sealed run's equity marked at bar closes, a paper run's minute snapshots.
const SEALED = "Measured on mark-to-market equity at bar closes", MINUTES = "Measured on the account's minute snapshots";

const pct = (n: number, digits = 2) => `${(Math.abs(n) * 100).toFixed(digits)}%`;
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
const show = (n: number | null | undefined, text: (n: number) => string) => (n == null ? <Missing /> : text(n));

type Values = { annual: number | null | undefined; short?: number; maxDrawdown: number | null | undefined; sharpe: number | null | undefined; winRate: number | null | undefined };

/** Every reading of one stage in one card: its three targets (the max drawdown against the limit, the
 *  return against what the minimum annual return asks for by now, never annualized, and the annual
 *  return against that minimum), then its ratios, its trades in USDT and its time in the market. On the
 *  Runs page (`full`) every reading keeps its place before its report or account (`a`, `stats`) is read;
 *  `stale` ones are the last stage's, held unseen so the card keeps its height while the next report is
 *  read, and nothing of them shows on this stage's figures. "Now" is the end of what was run when that
 *  is given (`ended`: a backtest's window). */
function Readout({ of, targets, basis, full = false, a: held = null, stats: heldStats = null, stale = false, ended = null }: {
  of: Values; targets: Targets | null; basis: string; full?: boolean; a?: Account | null; stats?: TradeStats | null; stale?: boolean; ended?: string | null;
}) {
  const a = stale ? null : held, stats = stale ? null : heldStats, shape = held ?? (full ? null : undefined);
  const limit = targets?.max_drawdown ?? null, minimum = targets?.annual_return ?? null;
  const mdd = of.maxDrawdown, dd = a ? a.drawdown : null;
  const needed = minimum === null || !held ? null : neededReturn(minimum, held);
  // Ahead by the difference of the two figures as shown, so the notes add up on screen.
  const shown = (n: number) => Math.round(n * 1e4) / 1e4;
  const ahead = needed === null || held?.ret == null ? null : shown(held.ret) - shown(needed);
  const tiles: Tile[] = [
    { name: "Max drawdown", tip: basis, value: show(mdd, pct), context: limit === null ? undefined : `of ${pct(limit, 0)} limit`,
      track: limit === null || mdd == null ? undefined : { used: mdd / limit, now: (dd ?? mdd) / limit },
      verdict: meets(mdd, limit, false), says: ["Within limit", "Over limit"],
      notes: !a || mdd == null ? undefined : [dd === null ? "At the stop" : ended ? `${pct(dd)} below the peak at ${ended}`
        : dd < mdd - 1e-4 ? `Last seen ${pct(dd)} below the peak` : "At its worst when last seen"] },
    ...shape !== undefined ? [{ name: "Return", value: show(held?.ret, (n) => `${sign(n)}${pct(n)}`), context: needed === null ? undefined : `needs ${sign(needed)}${pct(needed)}`,
      verdict: ahead === null ? null : ahead >= 0, says: ["On pace", "Behind pace"] as const, stale,
      notes: ahead === null || !held ? undefined : [`${signed(ahead * 100)} pt`, `${signed(ahead * held.starting, 0)} USDT`] }] : [],
    { name: "Annual return", value: show(of.annual, (n) => `${sign(n)}${pct(n)}`), context: minimum === null ? undefined : `min ${pct(minimum, 0)} a year`,
      verdict: meets(of.annual, minimum, true), says: ["Meets", "Misses"], notes: of.short != null ? [`Too short: ${Math.floor(of.short)} of ${ANNUAL_DAYS} days`] : undefined },
  ];
  const usdt = (n: number | null | undefined) => (n == null ? <Missing /> : <span className={pnlClass(n)}>{signed(n)}</span>);
  const t = heldStats ?? (full ? null : undefined);
  const cells: Cell[] = [
    { name: "Sharpe", value: show(of.sharpe, (n) => `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`) },
    ...t !== undefined ? [{ name: "Profit factor", value: show(t?.profitFactor, (n) => n.toFixed(2)), stale }] : [],
    { name: "Win rate", value: show(of.winRate ?? stats?.winRate, pct) },
    ...t !== undefined ? [
      { name: "Average win", value: usdt(t?.avgWin) }, { name: "Average loss", value: usdt(t?.avgLoss) }, { name: "Per trade", value: usdt(t?.perTrade) },
      { name: "Average hold", value: show(t?.hold, span) }, { name: "In market", value: show(t?.inMarket, pct) },
      { name: "Losing streak", value: t ? <>{t.streak}<span className="text-fg-faint"> {t.streak === 1 ? "trade" : "trades"}</span></> : <Missing /> },
    ].map((c) => ({ ...c, stale })) : [],
  ];
  return <Board tiles={tiles} cells={cells} />;
}

const Name = ({ children }: { children: string | null }) => <p className="mb-1 text-small text-fg-faint">{children}</p>;

/** The readings in the selected version's card: on the graph page its last research run's; on the Runs
 *  page the stage the page shows (state/shown.ts), named above them, with its own figures: the backtest's
 *  research run and, once its report is read, its account and trades (the last backtest's stay, unseen,
 *  while the next report is read), or the paper run's (its annual return once it has run 30 days; no Sharpe). */
export function Readings({ c, targets }: { c: Candidate; targets: Targets | null }) {
  if (useOnRunsPage()) return <StageReadings targets={targets} />;
  const t = (c.trials ?? []).filter((x) => x.purpose === "research").at(-1);
  return <Readout of={{ annual: t?.annual_return, maxDrawdown: t?.max_drawdown, sharpe: t?.sharpe, winRate: t?.win_rate }} targets={targets} basis={SEALED} />;
}

export function StageReadings({ targets }: { targets: Targets | null }) {
  const { stage, trial, run, name } = useShown(), data = useRunData(), backtest = useBacktest();
  const ready = stage === "backtest" && backtest?.kind === "ready" && backtest.b.account ? { a: backtest.b.account, stats: backtest.b.stats } : null;
  const tested = useHeld(ready, stage === "backtest" && backtest?.kind === "reading");
  if (stage === "backtest") {
    return <><Name>{name}</Name><Eased>
      <Readout of={{ annual: trial?.annual_return, maxDrawdown: trial?.max_drawdown, sharpe: trial?.sharpe, winRate: trial?.win_rate }} targets={targets}
               basis={SEALED} full a={tested?.a} stats={tested?.stats} stale={!ready} ended="the end" />
    </Eased></>;
  }
  if (stage !== "paper") return null;
  const a = data && data.run.paper_id === run?.paper_id ? data.a : null, stats = a ? data!.stats : null;
  const days = a?.start == null ? 0 : (a.end - a.start) / DAY_MS;
  const annual = a?.ret != null && days >= ANNUAL_DAYS ? (1 + a.ret) ** (365 / days) - 1 : null;
  return (
    <>
      <Name>{name}</Name>
      <Readout of={{ annual, short: a?.start != null && days < ANNUAL_DAYS ? days : undefined, maxDrawdown: a?.maxDrawdown ?? null, sharpe: null, winRate: stats?.winRate ?? null }}
               targets={targets} basis={MINUTES} full a={a} stats={stats} />
    </>
  );
}
