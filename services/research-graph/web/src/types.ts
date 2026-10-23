// The view model (research-graph-view/1) as research_graph/layout.py writes it.

export type Status = "recommended" | "meets_targets" | "below_targets" | "masked" | "precheck_failed" | "unrun";
export type Prediction = "held" | "failed" | "mixed" | "none";
export type Targets = { max_drawdown?: number | null; annual_return?: number | null };

export type Trial = {
  trial_id: number;
  purpose: string;
  status?: string | null;
  annual_return?: number | null;
  max_drawdown?: number | null;
  sharpe?: number | null;
  win_rate?: number | null;
  eligible?: boolean | null;
  ineligible_reason?: string | null;
  at?: string | null;
};

export type Candidate = {
  id: string;
  parent?: string | null;
  created_at?: string | null;
  change?: string | null;
  duties?: string[] | null;
  hypothesis?: string | null;
  predictions?: { measure?: string | null; direction?: string | null; outcome?: string | null }[] | null;
  registration?: string | null;
  trials?: Trial[] | null;
  comparison?: {
    vs_trial?: number | null;
    mean_daily_log_difference?: number | null;
    detectable?: number | null;
    interval_crosses_zero?: boolean | null;
    summary?: string | null;
  } | null;
  reviews?: { verdict?: string | null; failed_items?: string[] | null; at?: string | null; note?: string | null }[] | null;
  interpretation?: string | null;
  status_class: Status;
  prediction_class: Prediction;
};

export type LineageNode = {
  id: string;
  row: number;
  x: number | null;
  status: Status;
  prediction: Prediction;
  change?: string | null;
  reading: { annual_return: number | null; max_drawdown: number | null };
};

export type LaneEvent = { x: number | null; at: string; ref?: string | null; text?: string | null; recommends?: string | null };

export type Widget = { id: string; type: string; slot?: string; title?: string } & Record<string, unknown>;

export type SummaryWidget = Widget & {
  targets: Targets | null;
  recommended: string | null;
  reading: { annual_return: number | null; max_drawdown: number | null; sharpe: number | null; win_rate: number | null } | null;
  recommendations: number;
  recommendations_unchanged: number;
  runs_since_recommendation_changed: number;
  versions: number;
  research_runs: number;
  masked_runs: number;
  meeting_targets: number;
};

export type LineageWidget = Widget & {
  targets: Targets | null;
  axis: { min: number; max: number; ticks: number[]; scope_start: number | null };
  rows: { id: string; row: number }[];
  nodes: LineageNode[];
  edges: { from: string; to: string }[];
  bands: { candidate: string; row: number; x0: number | null; x1: number | null; ref?: string | null }[];
  lanes: { kind: string; events: LaneEvent[] }[];
  marks: (LaneEvent & { kind: string; candidate: string; row: number })[];
  flags: (LaneEvent & { kind: string })[];
};

export type EventItem = { kind: string; x: number | null; at: string; ref?: string | null; text?: string | null; candidates: string[] };
export type EventsWidget = Widget & { items: EventItem[] };
export type Focus = { candidate?: string; x?: number | null; seq: number };

export type ScatterWidget = Widget & {
  targets: Targets | null;
  points: { id: string; trial_id: number; annual_return: number; max_drawdown: number; eligible: boolean | null; status: Status }[];
};

export type NotesWidget = Widget & { items: string[] };
export type DetailWidget = Widget & { default: string | null; items: Candidate[] };

export type View = {
  format: string;
  source: "ledger" | "session";
  line: { bundle: string; start?: string | null; window?: string[] | null; market_commit?: string | null };
  targets: Targets | null;
  counts: { candidates: number; research_runs: number };
  widgets: Widget[];
};
