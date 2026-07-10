# Trade Flow Contract

## Owns

- Local `trade.db` event flow and projections
- Observe, dry-run, shadow, live-small orchestration
- Recovery and reconcile event drafts
- Strategy review, evidence sync, promotion gates, and automation planning

## Delegates

- Strategy R&D, replay, panel, and benchmark work to `modules/research/strategy-rd`
- Artifact catalog, query, stale scan, and GC work to `modules/ops/artifact-catalog`
- Exchange reads/writes to atomic `modules/binance/*` tools
- Deterministic hard guards to `modules/guards/plan-preflight`

## Forbidden

- Owning Binance endpoint details
- Owning new R&D experiment logic
- Owning catalog / GC implementation
