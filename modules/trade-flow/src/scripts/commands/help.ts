export const HELP_TEXT = `Usage:
  bun src/scripts/main.ts --db ./data/trade.db --init
  bun src/scripts/main.ts --db ./data/trade.db --track slow
  bun src/scripts/main.ts --db ./data/trade.db --track fast
  bun src/scripts/main.ts --db ./data/trade.db --append-order-fill --json '{"chain_id":"...","body_json":{...}}'
  bun src/scripts/main.ts --db ./data/trade.db --append-review --json '{"chain_id":"...","body_json":{"strategy_ref":"...","outcome":"win","pnl_r":1,"thesis_held":true,"key_lesson":"...","promote_to_strategy":false}}'
  bun src/scripts/main.ts --db ./data/trade.db --record-execution --json '{"preflight_result":{"verdict":"armable"},"execution_contract_input":{...},"execution_result":{...}}'
  bun src/scripts/main.ts --db ./data/trade.db --run --mode dry-run --json '{"plan":{...},"observe":{...},"execution_contract_input":{...}}'
  bun src/scripts/main.ts --db ./data/trade.db --run --mode shadow --json '{"plan":{...},"observe":{...},"execution_contract_input":{...}}'
  bun src/scripts/main.ts --load-runtime --trading-config ./profile/trading-config.json --strategies-dir ./strategies
  bun src/scripts/main.ts --build-observe --json '{"chain_id":"...","symbol":"BTCUSDT",...}'
  bun src/scripts/main.ts --observe-from-tools --json '{"repoRoot":"/repo","chain_id":"...","symbol":"BTCUSDT",...}'
  bun src/scripts/main.ts --db ./data/trade.db --automation-cycle --json '{"slow_interval_minutes":240,"rd_trackers":[...]}'
  bun src/scripts/main.ts --run-shadow-from-tools --json '{"repoRoot":"/repo","chain_id":"...","symbol":"BTCUSDT",...}'
  bun src/scripts/main.ts --run-live-small --yes --json '{"repoRoot":"/repo","plan":{...},"observe":{...},"execution_contract_input":{...}}'
  bun src/scripts/main.ts --db ./data/trade.db --recover-flow --chain-id <chain_id>
  bun src/scripts/main.ts --db ./data/trade.db --reconcile-flow --chain-id <chain_id> --json '{"data":{"openOrders":...}}'
  bun src/scripts/main.ts --db ./data/trade.db --reconcile-from-tools --chain-id <chain_id> --json '{"repoRoot":"/repo","symbol":"BTCUSDT"}'
  bun src/scripts/main.ts --db ./data/trade.db --apply-reconcile --yes --json '{"can_reconcile":true,"drafts":[...]}'
  bun src/scripts/main.ts --db ./data/trade.db --cron-recover-from-tools --chain-id <chain_id> --json '{"repoRoot":"/repo","symbol":"BTCUSDT","apply_reconcile":false}'

Key flags:
  response schema         ./schemas/script-response.schema.json; only the outer envelope is stable
  --db <path>              SQLite trade.db path. Default: ./data/trade.db
  --init                   Initialize plan_event schema
  --track <slow|fast>      Dry-run one cron track summary; does not execute or write events
  --append-order-fill      Append one order_fill event
  --append-review          Append one strategy review event with minimum outcome fields
  --record-execution       Compile contract and append audited order_fill from an execute-tool result
  --run                    Run one orchestrated flow step
  --mode <dry-run|shadow>  Execution mode for --run
  --load-runtime           Load trading config, runtime policy, account config compatibility, and strategy files
  --build-observe          Build an observe event from account / market projections
  --observe-from-tools    Call read-only snapshot tools and build an observe event
  --automation-cycle       Build a single-entry automation supervisor plan with subagent fanout and cadence gates
  --run-shadow-from-tools Call read-only snapshot tools, build observe, then record shadow execution
  --run-live-small         Execute one live-small main entry through binance-order-place
  --recover-flow           Reduce local plan_event history for one flow
  --reconcile-flow         Compare local flow state with a Binance account snapshot and return reconcile drafts
  --reconcile-from-tools  Call read-only account snapshot with history, then return reconcile drafts
  --apply-reconcile        Append source=reconcile drafts returned by reconcile step
  --cron-recover-from-tools Run local reduce + read-only reconcile; optionally apply local reconcile drafts
  --chain-id <chain_id>    Flow id for recovery / reconcile
  --yes                    Required for --run-live-small / --apply-reconcile
  --trading-config <path>  JSON trading config path. Default: ./profile/trading-config.json
  --account-config <path>  Legacy JSON account config path used as fallback compatibility input
  --strategies-dir <path>  Strategy markdown directory
  --input <path>           JSON event input
  --json <json>            Inline JSON event input
  --help                   Show this help
`
