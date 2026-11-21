// What the page shows, as each question to the Agent carries it (ide/agent/src/chat.ts Context): the page, the
// version selected with its line and the ledger commit drawn; on Runs the stage and its paper or Live run; and the
// coin picked, the chart's contract on Runs (not Equity) or the coin open on Market.
import type { Shown } from "./runSelection";
import type { ToolPage } from "./toolScope";

export type AgentContext = {
  page: ToolPage; version: string | null; line: string | null; ledger_commit: string | null;
  stage: "backtest" | "paper" | "live" | null; paper_run: number | null; live_run: string | null; coin: string | null;
};

export function agentContext(page: ToolPage, view: Pick<AgentContext, "version" | "line" | "ledger_commit">,
                             shown: Pick<Shown, "stage" | "run" | "liveRun">, coin: { chart: string | null; market: string | null }): AgentContext {
  const stage = page === "runs" ? shown.stage : null;
  return { page, ...view, stage,
    paper_run: stage === "paper" ? shown.run?.paper_id ?? null : null,
    live_run: stage === "live" ? shown.liveRun?.id ?? null : null,
    coin: page === "market" ? coin.market : page === "runs" && stage !== "live" && coin.chart !== "equity" ? coin.chart : null };
}
