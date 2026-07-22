-- owner: policy-risk/runtime-policy-compiler
-- physical target: data/policy_registry.db
-- mode: append snapshot; approved strategy refs are upserted by policy owner

CREATE TABLE IF NOT EXISTS policy_snapshot (
  policy_hash   TEXT PRIMARY KEY,
  source_hash   TEXT NOT NULL,
  profile       TEXT,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approved_strategy_ref (
  strategy_ref  TEXT PRIMARY KEY,
  strategy_id   TEXT NOT NULL,
  policy_hash   TEXT NOT NULL,
  status        TEXT NOT NULL,
  source_path   TEXT NOT NULL,
  source_hash   TEXT NOT NULL,
  approved_at   TEXT,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (policy_hash) REFERENCES policy_snapshot(policy_hash)
);

CREATE INDEX IF NOT EXISTS idx_approved_strategy_status ON approved_strategy_ref(status, updated_at DESC);
