export const HELP_TEXT = `Usage:
  ./scripts/main.ts --db ./data/trade.db --init
  ./scripts/main.ts --db ./data/trade.db --track slow
  ./scripts/main.ts --db ./data/trade.db --track fast
  ./scripts/main.ts --db ./data/trade.db --append-order-fill --json '{"chain_id":"...","body_json":{...}}'
  ./scripts/main.ts --db ./data/trade.db --append-review --json '{"chain_id":"...","body_json":{"strategy_ref":"...","outcome":"win","pnl_r":1,"thesis_held":true,"key_lesson":"...","promote_to_strategy":false}}'
  ./scripts/main.ts --db ./data/trade.db --record-execution --json '{"preflight_result":{"verdict":"armable"},"execution_contract_input":{...},"execution_result":{...}}'
  ./scripts/main.ts --db ./data/trade.db --run --mode dry-run --json '{"plan":{...},"observe":{...},"execution_contract_input":{...}}'
  ./scripts/main.ts --db ./data/trade.db --run --mode shadow --json '{"plan":{...},"observe":{...},"execution_contract_input":{...}}'
  ./scripts/main.ts --load-runtime --trading-config ./profile/trading-config.json --strategies-dir .agents/skills/trade-flow/strategies
  ./scripts/main.ts --build-observe --json '{"chain_id":"...","symbol":"BTCUSDT",...}'
  ./scripts/main.ts --observe-from-skills --json '{"repoRoot":"/repo","chain_id":"...","symbol":"BTCUSDT",...}'
  ./scripts/main.ts --replay-strategy --manifest ./data/ohlcv/BTCUSDT/manifest.json --strategy-id S-BTC-4H-TREND-PULLBACK
  ./scripts/main.ts --strategy-rnd-batch --json '{"manifest_path":"./data/ohlcv/BTCUSDT/manifest.json","candidates":[...]}'
  ./scripts/main.ts --strategy-rnd-loop --json '{"manifest_path":"./data/ohlcv/BTCUSDT/manifest.json","indicator_report_path":"...","factor_discover":true,"factor_compose":true,"candidates":[...]}'
  ./scripts/main.ts --strategy-rnd-campaign --json '{"campaign_id":"...","max_total_trials":10,"hypotheses":[...]}'
  ./scripts/main.ts --strategy-panel-rnd --json '{"datasets":[...],"candidates":[...]}'
  ./scripts/main.ts --strategy-benchmark --json '{"datasets":[...]}'
  ./scripts/main.ts --strategy-calibration-suite --json '{"datasets":[...]}'
  ./scripts/main.ts --strategy-signal --json '{"manifest_path":"...","entry_price":60000,"candidate":{...}}'
  ./scripts/main.ts --catalog-init --catalog-db ./data/data_catalog.db
  ./scripts/main.ts --catalog-scan --catalog-db ./data/data_catalog.db --catalog-root ./data --catalog-root ./tmp
  ./scripts/main.ts --catalog-query --catalog-db ./data/data_catalog.db --json '{"symbol":"BTCUSDT","limit":20}'
  ./scripts/main.ts --catalog-stale --catalog-db ./data/data_catalog.db --catalog-root ./data --retention-hours 168
  ./scripts/main.ts --catalog-gc --catalog-db ./data/data_catalog.db --catalog-root ./tmp --retention-hours 168 --yes
  ./scripts/main.ts --run-shadow-from-skills --json '{"repoRoot":"/repo","chain_id":"...","symbol":"BTCUSDT",...}'
  ./scripts/main.ts --run-live-small --yes --json '{"repoRoot":"/repo","plan":{...},"observe":{...},"execution_contract_input":{...}}'
  ./scripts/main.ts --db ./data/trade.db --recover-flow --chain-id <chain_id>
  ./scripts/main.ts --db ./data/trade.db --reconcile-flow --chain-id <chain_id> --json '{"data":{"openOrders":...}}'
  ./scripts/main.ts --db ./data/trade.db --reconcile-from-skills --chain-id <chain_id> --json '{"repoRoot":"/repo","symbol":"BTCUSDT"}'
  ./scripts/main.ts --db ./data/trade.db --apply-reconcile --yes --json '{"can_reconcile":true,"drafts":[...]}'
  ./scripts/main.ts --db ./data/trade.db --cron-recover-from-skills --chain-id <chain_id> --json '{"repoRoot":"/repo","symbol":"BTCUSDT","apply_reconcile":false}'
  ./scripts/main.ts --artifact-gc --artifact-root ./tmp/artifacts --retention-hours 168 --ephemeral-retention-hours 24
  ./scripts/main.ts --append-strategy-evidence --strategy <strategy.md> --catalog-db ./data/data_catalog.db --json '{"kind":"shadow","stats":{...}}'
  ./scripts/main.ts --strategy-review --strategy <strategy.md> --catalog-db ./data/data_catalog.db
  ./scripts/main.ts --strategy-promote --strategy <strategy.md> --catalog-db ./data/data_catalog.db --to shadow --yes
  ./scripts/main.ts --db ./data/trade.db --strategy-cycle --strategy <strategy.md> --catalog-db ./data/data_catalog.db --to live-small

Key flags:
  response schema         ./schemas/script-response.schema.json; only the outer envelope is stable
  --db <path>              SQLite trade.db path. Default: ./data/trade.db
  --init                   Initialize plan_event schema
  --track <slow|fast>      Dry-run one cron track summary; does not execute or write events
  --append-order-fill      Append one order_fill event
  --append-review          Append one strategy review event with minimum outcome fields
  --record-execution       Compile contract and append audited order_fill from an execute-skill result
  --run                    Run one orchestrated flow step
  --mode <dry-run|shadow>  Execution mode for --run
  --load-runtime           Load trading config, runtime policy, account config compatibility, and strategy files
  --build-observe          Build an observe event from account / market projections
  --observe-from-skills    Call read-only snapshot skills and build an observe event
  --replay-strategy        Replay a draft strategy against manifest OHLCV
  --strategy-rnd-batch     Run a predeclared bounded R&D candidate batch; never auto-promotes
  --strategy-rnd-loop      Run one R&D loop iteration, writing artifact + catalog DB ledger; never auto-promotes
  --strategy-rnd-campaign  Run bounded hypotheses through discovery and non-overlapping external validation
  --strategy-panel-rnd     Evaluate fixed candidates across at least three assets
  --strategy-benchmark     Calibrate the R&D pipeline with one fixed multi-asset trend benchmark
  --strategy-calibration-suite Run fixed known-edge calibration baselines; never auto-promotes
  --strategy-signal        Evaluate one R&D candidate on the latest closed candle; never executes
  --catalog-init           Initialize data_catalog.db schema
  --catalog-scan           Index run, dataset, artifact, R&D, and evidence metadata without moving payload files
  --catalog-query          Query catalog metadata by path, artifact_id, symbol, or strategy_id
  --catalog-stale          Report stale catalog artifacts; dry-run only, never deletes files
  --catalog-gc             Delete stale catalog candidates only when --yes is provided
  --run-shadow-from-skills Call read-only snapshot skills, build observe, then record shadow execution
  --run-live-small         Execute one live-small main entry through binance-order-place
  --recover-flow           Reduce local plan_event history for one flow
  --reconcile-flow         Compare local flow state with a Binance account snapshot and return reconcile drafts
  --reconcile-from-skills  Call read-only account snapshot with history, then return reconcile drafts
  --apply-reconcile        Append source=reconcile drafts returned by reconcile step
  --cron-recover-from-skills Run local reduce + read-only reconcile; optionally apply local reconcile drafts
  --artifact-gc           Report or delete stale unreferenced artifact files
  --append-strategy-evidence Append replay/shadow/live-small evidence to data_catalog.db
  --strategy-review       Build one strategy iteration report from catalog evidence and optional DB reviews
  --strategy-promote      Dry-run or apply strategy status transition
  --strategy-cycle        Sync DB reviews into shadow evidence, review, then optional promotion dry-run/apply
  --chain-id <chain_id>    Flow id for recovery / reconcile
  --yes                    Required for --run-live-small / --apply-reconcile
  --strategy <path>        Strategy markdown path for iteration commands
  --ledger <path>          Deprecated legacy JSONL path; use --catalog-db for current storage
  --to <status>            Target status for --strategy-promote
  --artifact-root <path>   Artifact root for explicit GC or R&D output; R&D defaults to ./tmp/artifacts/strategy-rnd
  --catalog-db <path>      SQLite data catalog path. Default: ./data/data_catalog.db
  --catalog-root <path>    Directory scanned by --catalog-scan or filtered by --catalog-stale; repeatable. Default: ./data
  --retention-hours <n>    Artifact GC age threshold. Default: 168
  --ephemeral-retention-hours <n> Shorter GC threshold for tmp/cache/scratch dirs. Default: min(24, retention)
  --trading-config <path>  JSON trading config path. Default: ./profile/trading-config.json
  --account-config <path>  Legacy JSON account config path used as fallback compatibility input
  --strategies-dir <path>  Strategy markdown directory
  --manifest <path>        OHLCV manifest for --replay-strategy
  --strategy-id <id>       Strategy id for --replay-strategy
  --timeframe <tf>         Timeframe for --replay-strategy. Default: strategy default
  --max-hold-bars <n>      Max bars to hold in replay
  --reward-risk <n>        Target R multiple in replay
  --fee-bps <n>            Round-trip side fee estimate in bps per side for replay
  --slippage-bps <n>       Slippage estimate in bps per side for replay
  --funding-bps-per-8h <n> Adverse funding stress in bps per 8h held
  --oos-split <ratio>      Replay anti-overfit OOS split ratio. Example: 0.3
  --anti-overfit-stage <stage> Replay proof stage: selection_validation, external_validation, or locked_holdout
  --trial-count <n>        Number of predeclared strategy trials represented by this replay
  --parameter-count <n>    Number of active strategy parameters represented by this replay
  --input <path>           JSON event input
  --json <json>            Inline JSON event input
  --help                   Show this help
`
