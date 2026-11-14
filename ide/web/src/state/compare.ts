// A sealed run's comparison with its replay (python -m cli.main paper compare, run by the paper
// daemon): the latest one of the run the Runs page shows, read when the run is picked and every few
// seconds while one is running.
import { ApiError } from "../lib/transport";
import { paperApi } from "../lib/paperApi";
import { atom, useAtom } from "./atom";

const POLL_MS = 3000;

/** An order pair's first difference: its stage and class (replay/comparison.py _row). */
export type Stage = "decision" | "fill" | "fee" | "funding";
export type RowClass = "same" | "time" | "type" | "quantity" | "price" | "amount" | "run_only" | "replay_only";
export type Cause = "missing_bar" | "late_bar" | "bar_mismatch" | "warmup" | "contract_terms" | "window_end" | "unexplained" | "consequence";
type Fill = { ts: string; ts_ns: number; qty: string; px: string; commission: string };
type OrderSide = { order: string; type: string; init: string; init_ns: number; qty: string; price: string | null; trigger: string | null; status: string; fill: Fill | null };
export type OrderRow = {
  role: string; side: "BUY" | "SELL"; stage: Stage | null; class: RowClass; run: OrderSide | null; replay: OrderSide | null;
  decision_delay_ms?: number; delay_ms?: number; price_bps?: number;
};
/** An entry order with its position's exits on either side (replay/comparison.py compare_group); `first` is the
 *  order row of its first difference (null for funding). */
export type Group = {
  instrument: string; side: "BUY" | "SELL"; at: string; at_ns: number; orders: OrderRow[];
  funding: { run: string | null; replay: string | null };
  class: "same" | "differs" | "run_only" | "replay_only"; stage: Stage | null; first: number | null;
  cause?: Cause; look_ahead_suspect?: boolean; follows?: string;
  evidence?: { missing_bars: number; late_bars: number; early_bars: number; early_lead_ms: string | null; differing_bars: number; first: string | null; warmup: boolean; terms: string[] };
};
/** The group counts are null when the replay wrote no order events. */
type Summary = {
  run_orders: number; run_fills: number; replay_orders: number | null; replay_fills: number | null; groups: number | null;
  same: number | null; differs: number | null; run_only: number | null; replay_only: number | null; consequences: number | null;
  look_ahead_suspects: number | null; missing_bars: number; late_bars: number; early_bars: number; differing_bars: number;
  warmup_differs: number; terms_differ: number; equity_max_difference: string | null;
};
/** A contract's bars: complete counts, and the first of each kind listed. */
type ContractBars = { archive: number; live: number; missing_bars: number; late_bars: number; early_bars: number;
                      differing_bars: number; missing: string[]; late: string[]; early: { close: string; lead_ms: string }[]; live_only: string[];
                      differing: { close: string; fields: Record<string, [string, string]> }[] };
/** comparison.json (run-comparison@2026-11-12); `groups` is null when the replay wrote no order events. */
type Result = {
  kind: "paper" | "live"; paper_id?: number; window: { start: string; end: string }; market_day: string; image_ref: string;
  replay: { status: "passed" | "invalid"; problems: { code?: string; message?: string }[] };
  summary: Summary; groups: Group[] | null;
  inputs: Record<string, { bars: ContractBars; warmup: { same: boolean } | null; terms: { differs: string[]; fees: string[] } | null }>;
  equity: { run: [number, string][]; replay: [number, string][] };
};
export type Comparison = {
  paper_id: number; state: "none" | "comparing" | "failed" | "done";
  error?: { code: string; message: string }; result?: Result;
};

const comparison = atom<Comparison | null>(null);
export const useComparison = () => useAtom(comparison);

let timer = 0, followed: number | null = null;

async function read(paperId: number): Promise<void> {
  window.clearTimeout(timer);
  try {
    const found = await paperApi<Comparison>(`/runs/${paperId}/compare`);
    if (followed !== paperId) return;
    comparison.set(found);
    if (found.state === "comparing") timer = window.setTimeout(() => void read(paperId), POLL_MS);
  } catch (error) {
    if (followed !== paperId) return;
    comparison.set({ paper_id: paperId, state: "failed", error: error instanceof ApiError ? { code: error.code, message: error.message } : { code: "PAPER_FAILED", message: String(error) } });
  }
}

/** Follows the latest comparison of `paperId` (null, or a run not sealed yet: none). */
export function followComparison(paperId: number | null): void {
  if (followed === paperId) return;
  followed = paperId;
  window.clearTimeout(timer);
  comparison.set(null);
  if (paperId !== null) void read(paperId);
}

/** Replays a sealed run on the archive and compares it; the result is read back as it lands. */
export async function compare(paperId: number): Promise<void> {
  comparison.set({ paper_id: paperId, state: "comparing" });
  try {
    await paperApi(`/runs/${paperId}/compare`, { method: "POST", body: {} });
  } catch (error) {
    comparison.set({ paper_id: paperId, state: "failed", error: error instanceof ApiError ? { code: error.code, message: error.message } : { code: "PAPER_FAILED", message: String(error) } });
    return;
  }
  await read(paperId);
}
