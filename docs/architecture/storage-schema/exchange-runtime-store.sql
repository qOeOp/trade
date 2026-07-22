-- owner: exchange-gateway
-- physical target: data/exchange_runtime.db
-- mode: append-only audit for external side effects

CREATE TABLE IF NOT EXISTS exchange_command (
  command_id       TEXT PRIMARY KEY,
  idempotency_key  TEXT NOT NULL UNIQUE,
  market           TEXT NOT NULL,
  symbol           TEXT,
  command_type     TEXT NOT NULL,
  client_order_id  TEXT,
  requested_by_ref TEXT NOT NULL,
  request_json     TEXT NOT NULL CHECK(json_valid(request_json)),
  status           TEXT NOT NULL CHECK(status IN ('planned', 'submitted', 'confirmed', 'failed', 'cancelled')),
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exchange_result (
  result_id       TEXT PRIMARY KEY,
  command_id      TEXT NOT NULL,
  exchange_ref    TEXT,
  result_json     TEXT NOT NULL CHECK(json_valid(result_json)),
  confirmed_json  TEXT CHECK(confirmed_json IS NULL OR json_valid(confirmed_json)),
  received_at     TEXT NOT NULL,
  FOREIGN KEY (command_id) REFERENCES exchange_command(command_id)
);

CREATE TABLE IF NOT EXISTS exchange_snapshot_ref (
  snapshot_id    TEXT PRIMARY KEY,
  snapshot_kind  TEXT NOT NULL,
  symbol         TEXT,
  account_scope  TEXT,
  body_ref       TEXT NOT NULL,
  content_hash   TEXT,
  captured_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exchange_command_client_order ON exchange_command(client_order_id);
CREATE INDEX IF NOT EXISTS idx_exchange_result_command ON exchange_result(command_id);
CREATE INDEX IF NOT EXISTS idx_exchange_snapshot_symbol ON exchange_snapshot_ref(symbol, captured_at DESC);
