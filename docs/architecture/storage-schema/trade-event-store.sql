-- owner: portfolio-execution-state/event-store
-- physical: data/trade.db
-- mode: append-only

CREATE TABLE IF NOT EXISTS plan_event (
  event_key   TEXT PRIMARY KEY,
  chain_id    TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK(kind IN ('observe', 'order_fill', 'review')),
  body_json   TEXT NOT NULL CHECK(json_valid(body_json)),
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chain_time ON plan_event(chain_id, created_at);
CREATE INDEX IF NOT EXISTS idx_kind_chain ON plan_event(kind, chain_id);
CREATE INDEX IF NOT EXISTS idx_obs_symbol ON plan_event(json_extract(body_json, '$.symbol')) WHERE kind = 'observe';
