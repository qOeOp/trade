# Trade Flow Contract

## Owns

- Local `trade.db` event flow and projections
- Observe, dry-run, shadow, live-small orchestration
- Recovery and reconcile event drafts
- Automation planning

## Delegates

- Strategy R&D, replay, panel, benchmark, and RD memory work to atomic `modules/research/*` tools
- Strategy evidence, review, and promotion gates to `modules/governance/strategy-review`
- Artifact catalog, query, stale scan, and GC work to `modules/ops/artifact-catalog`
- Exchange reads/writes to atomic `modules/binance/*` tools
- Deterministic hard guards to `modules/guards/plan-preflight`

## Forbidden

- Owning Binance endpoint details
- Owning new R&D experiment logic
- Owning strategy review / promotion implementation
- Owning catalog / GC implementation
