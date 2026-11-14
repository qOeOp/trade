// The view model (research-graph-view) as research_graph/layout.py writes it.

type Status = "recommended" | "meets_targets" | "below_targets" | "masked" | "precheck_failed" | "unrun";
export type Prediction = "held" | "failed" | "mixed" | "none";
export type Role = "recommended" | "superseded" | "masked" | "precheck_failed" | "unrun";
export type Targets = { max_drawdown?: number | null; annual_return?: number | null };

export type Trial = {
  trial_id: number;
  purpose: string;
  status?: string | null;
  annual_return?: number | null;
  max_drawdown?: number | null;
  sharpe?: number | null;
  plan_win_rate?: number | null;
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
  predictions?: { measure?: string | null; direction?: string | null; reason?: string | null; outcome?: string | null }[] | null;
  registration?: string | null;
  trials?: Trial[] | null;
  comparison?: {
    vs_trial?: number | null;
    mean_daily_log_difference?: number | null;
    detectable?: number | null;
    intervals_cross_zero?: boolean | null;
    summary?: string | null;
  } | null;
  reviews?: { verdict?: string | null; at?: string | null; checks?: { name: string; status?: string | null; note?: string | null }[] }[] | null;
  interpretation?: string | null;
  status?: Role | null;
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
  trials: number[];
  reading: { annual_return: number | null; max_drawdown: number | null };
};


export type Widget = { type: string } & Record<string, unknown>;

export type SummaryWidget = Widget & {
  targets: Targets | null;
  /** The version the latest recommendation judgment names, which may since have lost its evidence: `status` is its
   *  standing now (`masked` when its latest research run is no longer eligible). */
  recommended: string | null;
  status: Status | null;
  reading: { annual_return: number | null; max_drawdown: number | null; sharpe: number | null; plan_win_rate: number | null } | null;
  recommendations: number;
  recommendations_unchanged: number;
  runs_since_recommendation_changed: number;
  versions: number;
  research_runs: number;
  trial_counts?: { research_trials: number; all_purpose_trials: number; sweep_variants: number; undeclared_sweeps: number[]; trials_with_sweeps: number } | null;
  masked_runs: number;
  /** The latest priority judgment: the next direction the research takes. */
  priority?: { at: string | null; ref: string; text: string } | null;
};

export type LineageWidget = Widget & {
  targets: Targets | null;
  axis: { max: number; scope_start: number | null };
  rows: { id: string; row: number }[];
  nodes: LineageNode[];
  edges: { from: string; to: string }[];
  revisions: { from: string; to: string }[];
  trail: { candidate: string; x0: number | null; judgments: (number | null)[] }[];
  /** Priority judgments recording a decision the Agent made for the user: a change of approach, a delegated line decision. */
  decisions: { x: number; kind: "approach_change" | "line_decision"; at: string; ref: string | null; text: string | null }[];
  trials: { trial_id: number; x: number; candidate: string; purpose: string }[];
};

export type ProgressWidget = Widget & {
  targets: Targets | null;
  axis: { scope_start: number | null };
  points: { id: string; trial_id: number; x: number; annual_return: number; max_drawdown?: number | null }[];
  recommended: string[];
};

export type ScatterWidget = Widget & {
  targets: Targets | null;
  points: { id: string; trial_id: number; annual_return: number; max_drawdown: number; eligible: boolean | null; status: Status }[];
};

export type TableRow = {
  id: string; parent?: string | null; role?: Role | null; status: Status; prediction: Prediction;
  first_trial: number | null; runs: number;
  annual_return?: number | null; max_drawdown?: number | null; sharpe?: number | null; plan_win_rate?: number | null;
};
export type TableWidget = Widget & { targets: Targets | null; rows: TableRow[] };

export type NotesWidget = Widget & { items: string[] };
export type DetailWidget = Widget & { default: string | null; items: Candidate[] };
/** A version's registered strategy source (null when the graph does not hold it) and its parent in the graph. */
export type SourceItem = { id: string; parent: string | null; source: string | null };
export type SourcesWidget = Widget & { items: SourceItem[] };

export type View = {
  format: string;
  source: "ledger" | "session";
  scope?: { ledger_commit?: string | null; start?: string | null; end?: string | null; build?: string | null; drawn_commit?: string | null; market_unread?: string | null } | null;
  line: { name: string; start?: string | null; window?: string[] | null; market_day?: string | null;
          /** The gates the next registration of the line would meet: its line-record gates only; `research state` gives the runtime and market-day gates. */
          gates?: { code: string; message: string }[] };
  targets: Targets | null;
  widgets: Widget[];
};
