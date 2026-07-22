# Trade Flow Contract

## Owns

- Automation cycle planning and job-graph routing
- Suite CLI parameter, response, permission, and owner-handoff semantics
- Thin observe, execution, recovery, and runtime façades

## Delegates

- `trade.db` event ownership and flow projections to `modules/portfolio-execution-state/*`
- Observe building and market/account projection to `modules/live-decision-planning/*`
- Dry-run, shadow, live-small, execution recording, reconcile, and recovery behavior to `modules/live-execution-control/*`
- Strategy R&D, replay, panel, benchmark, and RD memory work to atomic `modules/research-strategy-development/*` tools
- Strategy evidence, review, and promotion gates to `modules/governance-review-compliance/strategy-review`
- Artifact catalog, query, stale scan, and GC work to `modules/artifact-knowledge/artifact-catalog`
- Exchange private account/order reads and authorized writes to `modules/exchange-gateway/*` tools
- Market data reads to `modules/market-data-products/*` tools
- Deterministic hard guards to `modules/live-execution-control/plan-preflight`

## Forbidden

- Owning Binance endpoint details
- Owning `trade.db` schema, projection, execution, or recovery algorithms
- Owning new R&D experiment logic
- Owning strategy review / promotion implementation
- Owning catalog / GC implementation
