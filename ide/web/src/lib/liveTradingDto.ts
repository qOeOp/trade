/** Frozen HTTP projections. Native event rows are observations, never a browser order ledger. */
export type LiveRequest = {
  request_id: string; action: string; target: { run_id?: string; credential_ref?: string };
  outcome: "pending" | "effect_recorded" | "refused" | "outcome_unknown";
  event_ref?: { source: string; cursor: string }; code?: string;
};
export type LiveReply<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string }; request_id?: string };
export type LiveWriteReply = { request: LiveRequest; run_id?: string; credential_ref?: string };
type LiveCredentialDto = {
  credential_ref: string; observed_ns: string; selected: boolean; removed: boolean; available: boolean; referenced_runs: string[];
};
/** A candidate's replay evidence on chosen contracts at the research head, as the serving control reads it ahead of
 *  preparation (live/control.py Evidence, GET /candidates/<id>/<rev>/evidence/<SYM,SYM>). Preparation checks it again. */
export type LiveEvidenceReadDto = {
  state: "checking" | "found" | "missing" | "unknown";
  replays: { trial_id: number; starting_balance_usdt: string }[]; tolerance: string; research_at: string;
};
/** The candidate at the research head as a run of it would be prepared now (live/control.py candidate,
 *  GET /candidates/<id>/<rev>), and the contracts of its last research replay, which the page offers. */
export type LiveCandidateDto = {
  candidate: string; research_at: string; source_sha256: string; entry_class: string; last_symbols: string[] | null;
};
type LiveEvidenceDto = {
  source: string; cursor: string | null; observed_ns: string | null; read_ns: string; complete: boolean;
  state: "complete" | "missing" | "invalid" | "changed" | "unknown";
};
export type LiveEventRow = {
  event_type: string; observed_ns: string | null; event_ref: { source: string; cursor: string };
  client_order_id?: string | null; venue_order_id?: string | null; position_id?: string | null;
  instrument_id?: string | null; opening_order_id?: string | null; closing_order_id?: string | null; trade_id?: string | null;
  quantity?: string | null; last_qty?: string | null; last_px?: string | null; price?: string | null; trigger_price?: string | null;
  avg_px_open?: string | null; avg_px_close?: string | null; signed_qty?: string | null; peak_quantity?: string | null;
  realized_return?: string | null; ts_event?: string | null; ts_init?: string | null; ts_opened?: string | null; ts_closed?: string | null;
  order_side?: "BUY" | "SELL" | null; side?: "LONG" | "SHORT" | "FLAT" | null; order_type?: string | null; time_in_force?: string | null;
};
type Candidate = { strategy_id: string | null; revision: string | null };
export type LiveReviewDto = {
  research_at: string; candidate: Omit<Candidate, "revision"> & { revision: string | number | null }; source_sha256: string; entry_class: string;
  evidence: readonly { trial_id: number; starting_balance_usdt: string; image_ref: string }[];
  validations: readonly Record<string, unknown>[]; validation_note: string;
};
export type LiveRunDto = {
  run_id: string; source: { source_sha256: string | null; entry_class: string | null }; candidate: Candidate;
  runtime: { digest: string | null; platform: "linux/amd64" | "linux/arm64" | null }; symbols: string[] | null;
  config: { drawdown_brake: string | null; duration_seconds: string | null; leverage: string | null };
  host: { state: string | null; mode: "preflight" | "run" | "reconcile" | null; account_owned: boolean | null; exit_code: number | null };
  stop_requested: boolean | null;
  terminal: { event: "clean_stop" | "reconciled_flat" | "venue_flat" | "reconcile_stopped" | "unresolved"; observed_ns: string | null; source_failed: boolean | null; event_ref: { source: string; cursor: string } } | null;
  custody: { released: boolean | null; release_reason: "never_armed" | "native_and_venue_flat" | "venue_flat" | null; archived: boolean | null };
  account: {
    observation_ref: { source: string; cursor: string }; observed_ns: string | null; can_trade: boolean | null;
    hedge_mode: boolean | null; multi_assets: boolean | null; usdt_wallet: string | null; usdt_available: string | null; venue_flat: true | null;
  } | null;
  orders: LiveEventRow[] | null; positions: LiveEventRow[] | null; event_limit: 200; evidence: LiveEvidenceDto[]; complete: boolean;
  /** The equity the run armed with, its highest equity and the drawdown brake once it fired (engine/live_brake.py). */
  brake: { start: string | null; peak: string | null; fired: { equity: string | null; peak: string | null; drawdown: string | null; observed_ns: string | null } | null } | null;
  /** The run's result at each minute's first mark and when it stopped, [minute_ns, result] (live/views.py). */
  minute_results: [string, string | null][] | null;
  /** Interruptions and starts again of the same run (live/views.py _restarts). */
  restarts: { event: string; observed_ns: string; held: boolean | null }[] | null;
  /** The entry gate's events (live/views.py _gate): when entries closed, why, and when they reopened. */
  gate: { event: string; observed_ns: string; reasons: string[]; socket: string | null; status: string | null }[] | null;
  /** The control's hourly checks of the run's key that failed, and a pass after one (live/views.py _key_checks). */
  key_checks: { event: "key_check_failed" | "key_check_passed"; code: string | null; observed_ns: string }[] | null;
  /** The control's latest daily comparison with a replay (live/daily.py). */
  compare: LiveCompareDto | null;
  review?: LiveReviewDto | null; review_error?: { code: string } | null;
};
export type LiveCompareDto = {
  day: string; state: "running" | "done" | "waiting" | "failed" | "empty"; code?: string | null; failures?: number;
  unexplained_count?: number; unexplained_week?: number; measures?: { groups?: number } | null;
};
export type LiveHomeDto = {
  availability: "ready"; write_enabled: boolean; maintenance_enabled: boolean; write_reason: string | null;
  credentials: LiveCredentialDto[]; runs: LiveRunDto[];
  /** A run's settings as the page starts them: no duration runs until stopped; the brake can only be tighter; the
   *  leverage is the user's to change, and must equal each contract's at Binance. */
  defaults: { drawdown_brake: string; duration_seconds: number | null; leverage: string };
  /** Telegram notification status; never the bot token or chat. */
  notify: LiveNotifyDto;
};
type LiveNotifyDto = { configured: boolean; last_sent_ns: string | null; last_error: { code: string; at_ns: string | null } | null; dropped: number };
