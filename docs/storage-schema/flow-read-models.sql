-- owner: portfolio-execution-state/flow-projector
-- physical: derived in memory today; optional cache table later
-- mode: derived

CREATE TABLE IF NOT EXISTS flow_projection_cache (
  chain_id        TEXT PRIMARY KEY,
  source_max_time TEXT NOT NULL,
  source_event_count INTEGER NOT NULL,
  projection_json TEXT NOT NULL CHECK(json_valid(projection_json)),
  rebuilt_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flow_projection_rebuilt_at ON flow_projection_cache(rebuilt_at);
