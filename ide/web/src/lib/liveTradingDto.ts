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
/** A source's replay evidence as the serving control reads it ahead of preparation (live/control.py Evidence);
 *  absent from an older control or one not serving. Preparation checks it again. */
export type LiveEvidenceReadDto = {
  state: "checking" | "found" | "missing" | "unknown";
  replays: { trial_id: number; starting_balance_usdt: string }[]; tolerance: string;
};
export type LiveSourceDto = {
  source_id: string; candidate: string; source_sha256: string; entry_class: string; purpose: "natural" | "controlled";
  evidence?: LiveEvidenceReadDto;
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
  config: { budget_usdt: string | null; max_loss_usdt: string | null; duration_seconds: string | null; leverage: string | null };
  host: { state: string | null; mode: "preflight" | "run" | "reconcile" | null; account_owned: boolean | null; exit_code: number | null };
  stop_requested: boolean | null;
  terminal: { event: "clean_stop" | "reconciled_flat" | "venue_flat" | "reconcile_stopped" | "unresolved"; observed_ns: string | null; source_failed: boolean | null; event_ref: { source: string; cursor: string } } | null;
  custody: { released: boolean | null; release_reason: "never_armed" | "native_and_venue_flat" | "venue_flat" | null; archived: boolean | null };
  account: {
    observation_ref: { source: string; cursor: string }; observed_ns: string | null; can_trade: boolean | null;
    hedge_mode: boolean | null; multi_assets: boolean | null; usdt_wallet: string | null; usdt_available: string | null; venue_flat: true | null;
  } | null;
  orders: LiveEventRow[] | null; positions: LiveEventRow[] | null; event_limit: 200; evidence: LiveEvidenceDto[]; complete: boolean;
  /** The run's result at each minute's first mark and when it stopped, [minute_ns, result] (live/views.py); absent from an older service. */
  minute_results?: [string, string | null][] | null;
  purpose?: "natural" | "controlled" | null;
  /** Interruptions and starts again of the same run (live/views.py _restarts); absent from an older service. */
  restarts?: { event: string; observed_ns: string; held: boolean | null }[] | null;
  review?: LiveReviewDto | null; review_error?: { code: string } | null;
};
export type LiveHomeDto = {
  availability: "ready"; write_enabled: boolean; maintenance_enabled: boolean; write_reason: string | null;
  sources: LiveSourceDto[]; credentials: LiveCredentialDto[]; runs: LiveRunDto[];
  /** The contracts a run trades (the Live settings); absent from an older control. */
  symbols?: string[];
  defaults: { budget_usdt: string; max_loss_usdt: string; duration_seconds: number; leverage: string };
  /** Telegram notification status (protocol 2); never the bot token or chat. */
  notify?: LiveNotifyDto;
};
type LiveNotifyDto = { configured: boolean; last_sent_ns: string | null; last_error: { code: string; at_ns: string | null } | null; dropped: number };
