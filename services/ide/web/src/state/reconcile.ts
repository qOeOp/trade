// A sealed run's reconciliation against its replay (python -m cli.main paper reconcile, run by the paper
// daemon): the latest one of the run the Paper page shows, read when the run is picked and every few
// seconds while one is running.
import { ApiError } from "../lib/agentApi";
import { paperApi } from "../lib/paperApi";
import { atom, useAtom } from "./atom";

const POLL_MS = 3000;

export type FillClass = "same" | "price" | "quantity" | "time" | "paper_only" | "replay_only";
export type Cause = "live_gap" | "bar_mismatch" | "window_end" | "unexplained";
export type FillSide = { order: string; ts: string; ts_ns: number; qty: string; px: string; commission: string };
/** One order's fill on either side (paper/reconcile.py classify). */
export type Matched = {
  class: FillClass; instrument: string; side: "BUY" | "SELL"; role: string; paper: FillSide | null; replay: FillSide | null;
  delay_ms?: number; price_bps?: number; cause?: Cause; look_ahead_suspect?: boolean;
  evidence?: { missing_bars: number; differing_bars: number; first: string | null };
};
export type Summary = {
  paper_fills: number; replay_fills: number; same: number; price: number; quantity: number; time: number;
  paper_only: number; replay_only: number; look_ahead_suspects: number; missing_bars: number; differing_bars: number;
  late_bars: number; equity_max_difference: string | null;
};
export type ContractBars = { archive: number; live: number; late: number; missing: string[]; live_only: string[];
                             differing: { close: string; fields: Record<string, [string, string]> }[] };
/** reconcile.json (paper-reconcile@2026-10-26). */
export type Result = {
  paper_id: number; window: { start: string; end: string }; market_commit: string; image_ref: string;
  replay: { status: "passed" | "invalid"; problems: { code?: string; message?: string }[] };
  summary: Summary; fills: Matched[]; bars: Record<string, ContractBars>;
  equity: { paper: [number, string][]; replay: [number, string][] };
};
export type Reconciliation = {
  paper_id: number; state: "none" | "reconciling" | "failed" | "done";
  error?: { code: string; message: string }; result?: Result;
};

export const reconciliation = atom<Reconciliation | null>(null);
export const useReconciliation = () => useAtom(reconciliation);

let timer = 0, followed: number | null = null;

async function read(paperId: number): Promise<void> {
  window.clearTimeout(timer);
  try {
    const found = await paperApi<Reconciliation>(`/runs/${paperId}/reconcile`);
    if (followed !== paperId) return;
    reconciliation.set(found);
    if (found.state === "reconciling") timer = window.setTimeout(() => void read(paperId), POLL_MS);
  } catch (error) {
    if (followed !== paperId) return;
    reconciliation.set({ paper_id: paperId, state: "failed", error: error instanceof ApiError ? { code: error.code, message: error.message } : { code: "PAPER_FAILED", message: String(error) } });
  }
}

/** Follows the latest reconciliation of `paperId` (null, or a run not sealed yet: none). */
export function followReconciliation(paperId: number | null): void {
  if (followed === paperId) return;
  followed = paperId;
  window.clearTimeout(timer);
  reconciliation.set(null);
  if (paperId !== null) void read(paperId);
}

/** Replays a sealed run on the archive and compares it; the result is read back as it lands. */
export async function reconcile(paperId: number): Promise<void> {
  reconciliation.set({ paper_id: paperId, state: "reconciling" });
  try {
    await paperApi(`/runs/${paperId}/reconcile`, { method: "POST", body: {} });
  } catch (error) {
    reconciliation.set({ paper_id: paperId, state: "failed", error: error instanceof ApiError ? { code: error.code, message: error.message } : { code: "PAPER_FAILED", message: String(error) } });
    return;
  }
  await read(paperId);
}
