# Trade Flow Contract

## Owns

- Local `trade.db` event flow and projections
- Observe, dry-run, shadow, live-small orchestration
- Recovery and reconcile event drafts
- Automation planning

## Delegates

- Strategy R&D, replay, panel, benchmark, and RD memory work to atomic `modules/research-strategy-development/*` tools
- Strategy evidence, review, and promotion gates to `modules/governance-review-compliance/strategy-review`
- Artifact catalog, query, stale scan, and GC work to `modules/artifact-knowledge/artifact-catalog`
- Exchange private account/order reads and authorized writes to `modules/exchange-gateway/*` tools
- Market data reads to `modules/market-data-products/*` tools
- Deterministic hard guards to `modules/live-execution-control/plan-preflight`

## Forbidden

- Owning Binance endpoint details
- Owning new R&D experiment logic
- Owning strategy review / promotion implementation
- Owning catalog / GC implementation
