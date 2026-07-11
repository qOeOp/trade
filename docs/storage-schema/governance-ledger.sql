-- owner: governance-review-compliance/strategy-review
-- physical target: data/governance.db
-- mode: append-only evidence and promotion decisions

CREATE TABLE IF NOT EXISTS governance_evidence (
  evidence_id   TEXT PRIMARY KEY,
  strategy_id   TEXT NOT NULL,
  setup_id      TEXT,
  evidence_kind TEXT NOT NULL,
  source_ref    TEXT NOT NULL,
  policy_hash   TEXT,
  content_hash  TEXT,
  body_json     TEXT NOT NULL CHECK(json_valid(body_json)),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promotion_decision (
  decision_id      TEXT PRIMARY KEY,
  strategy_id      TEXT NOT NULL,
  from_status      TEXT,
  to_status        TEXT NOT NULL,
  verdict          TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL CHECK(json_valid(evidence_refs_json)),
  reason_json      TEXT CHECK(reason_json IS NULL OR json_valid(reason_json)),
  decided_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS closed_flow_review (
  review_id    TEXT PRIMARY KEY,
  chain_id     TEXT NOT NULL,
  strategy_id  TEXT,
  setup_id     TEXT,
  outcome      TEXT,
  pnl_r        REAL,
  review_ref   TEXT NOT NULL,
  body_json    TEXT NOT NULL CHECK(json_valid(body_json)),
  reviewed_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_batch (
  batch_id      TEXT PRIMARY KEY,
  status        TEXT NOT NULL,
  input_refs_json TEXT NOT NULL CHECK(json_valid(input_refs_json)),
  summary_json  TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_governance_evidence_strategy ON governance_evidence(strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promotion_decision_strategy ON promotion_decision(strategy_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_closed_flow_review_chain ON closed_flow_review(chain_id);
