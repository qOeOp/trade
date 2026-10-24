// The view model (research-graph-view/1) as research_graph/layout.py writes it; the lineage is lineage/2.

export type Status = "recommended" | "meets_targets" | "below_targets" | "masked" | "precheck_failed" | "unrun";
export type Prediction = "held" | "failed" | "mixed" | "none";
export type Role = "recommended" | "kept_reference" | "superseded" | "masked" | "precheck_failed" | "unrun";
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
  status?: Role | null;
  status_class: Status;
  prediction_class: Prediction;
};

export type LineageNode = {
  id: string;
  row: number;
  x: number | null;
  status: Status;
  role: Role;
  prediction: Prediction;
  change?: string | null;
  reading: { annual_return: number | null; max_drawdown: number | null };
};


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
  trail: { candidate: string; row: number; x0: number | null; x1: number | null; judgments: (number | null)[] }[];
};

export type ProgressWidget = Widget & {
  targets: Targets | null;
  axis: { min: number; max: number; scope_start: number | null };
  points: { id: string; trial_id: number; annual_return: number | null; max_drawdown?: number | null; eligible: boolean | null }[];
  recommended: string[];
};

export type ScatterWidget = Widget & {
  targets: Targets | null;
  points: { id: string; trial_id: number; annual_return: number; max_drawdown: number; eligible: boolean | null; status: Status }[];
};

export type TableRow = {
  id: string; parent?: string | null; role?: Role | null; status: Status; prediction: Prediction;
  first_trial: number | null; runs: number;
  annual_return?: number | null; max_drawdown?: number | null; sharpe?: number | null; win_rate?: number | null;
};
export type TableWidget = Widget & { targets: Targets | null; rows: TableRow[] };

export type NotesWidget = Widget & { items: string[] };
export type DetailWidget = Widget & { default: string | null; items: Candidate[] };

export type View = {
  format: string;
  source: "ledger" | "session";
  scope?: { ledger_commit?: string | null; start?: string | null; end?: string | null } | null;
  line: { bundle: string; start?: string | null; window?: string[] | null; market_commit?: string | null };
  targets: Targets | null;
  counts: { candidates: number; research_runs: number };
  widgets: Widget[];
};
