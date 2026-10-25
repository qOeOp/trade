// The paper daemon (python -m cli.main paper serve) under /api/paper, reached through the page's own
// server. Its refusals are { code, message }, as the product's are. A POST carries the token the page's
// server put in the page, without which that server refuses it.
import { ApiError } from "./agentApi";

export type RunState = "running" | "stopping" | "ended" | "unsealed" | "sealed";
/** What a seal computes, from the journal so far (paper/serve.py live_readings). */
export type Live = {
  total_return: number | null; max_drawdown: number; final_equity_usdt: string | null; funding_usdt: string;
  fills: number; orders_submitted: number; positions_closed: number; missing_bars: number; late_bars: number;
  protection_gaps: number; started_ns: number | null; bars: number; last_bar_ns: number | null;
  starting_balance_usdt: string; equity: [number, number][];
};
/** The stored seal.json (ledger/paper.py readings). */
export type Seal = {
  status: "complete" | "invalid"; reasons: string[]; total_return: number | null; max_drawdown: number;
  final_equity_usdt: string | null; fills: number; started_ns: number | null; stopped_ns: number | null;
  stop_reason: string | null; daily_returns: [string, number][]; positions_closed: number;
};
export type PaperRun = {
  paper_id: number; candidate: string | null; source_sha256: string; symbols: string[]; state: RunState;
  created_at: string; image_ref: string; market_commit: string; config: Record<string, unknown>;
  status: "complete" | "invalid" | null; reasons: string[] | null; total_return: number | null; max_drawdown: number | null;
  live?: Live; seal?: Seal;
};
export type Listing = { runs: PaperRun[]; running: number; limit: number; starting: string[] };

/** One journal line (engine/paper.py): its kind, wall clock and the kind's own fields. */
export type JournalLine = { kind: string; wall_ns: number; [field: string]: unknown };
export type OpenOrder = {
  client_order_id: string; instrument_id: string; side: string; type: string; quantity: string;
  price: string; trigger_price: string; reduce_only: boolean;
};
export type OpenPosition = {
  position_id: string; instrument_id: string; signed_qty: string; avg_px_open: string; mark: string | null;
  unrealized_pnl: string | null; realized_pnl: string;
};
/** state.json: the account at the last minute, with its open positions and working orders. */
export type PaperState = {
  minute_ns: number; balance_total: string | null; balance_free: string | null; unrealized_pnl: string | null;
  positions: OpenPosition[]; orders: OpenOrder[];
};

const token = () => document.querySelector<HTMLMetaElement>('meta[name="trade-paper-token"]')?.content ?? "";

/** One JSON request to the paper daemon; throws its refusal as an ApiError. */
export async function paperApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/paper${path}`, {
      method: init.method ?? "GET", cache: "no-store",
      headers: init.method === "POST" ? { "content-type": "application/json", "x-trade-paper-token": token() } : undefined,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new ApiError("PAPER_UNAVAILABLE", String(error));
  }
  const body = await response.json().catch(() => ({ code: "PAPER_FAILED", message: `${response.status} ${response.statusText}` }));
  if (!response.ok) throw new ApiError(body.code ?? "PAPER_FAILED", body.message ?? "");
  return body as T;
}

export const streamUrl = (paperId: number, symbol: string | null) =>
  `/api/paper/runs/${paperId}/stream${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`;

/** A Nautilus money or quantity text ("99990.12 USDT", "0.010") as a number. */
export const amount = (value: unknown): number | null => {
  if (value == null) return null;
  const n = Number(String(value).split(" ")[0]);
  return Number.isFinite(n) ? n : null;
};

/** A price as text without binary noise (Nautilus's average prices are floats: 86396.99999999999 → 86397). */
export const priceText = (value: unknown): string => {
  const n = amount(value);
  return n == null ? String(value ?? "") : String(Number(n.toPrecision(12)));
};

/** BTCUSDT-PERP.BINANCE → BTCUSDT. */
export const symbolOf = (instrument: unknown) => String(instrument ?? "").split("-")[0] ?? "";
