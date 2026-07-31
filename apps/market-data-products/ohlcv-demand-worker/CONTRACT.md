# OHLCV Demand Worker Contract

## Owns

- One long-running public-data worker that reconciles selected `ohlcv` demand subscriptions against owner-issued canonical-candle coverage audits.
- Timeframe-aligned closed-candle targets、leading/interior/trailing gap detection、bounded gap-fill jobs、retry/backoff and a redacted latest state.

## Boundaries

- Reads demand and coverage only through `market-data-store`; writes candles only through the existing `ohlcv-fetch` owner path.
- A demand is neither coverage nor freshness evidence. Completion requires a subsequent self-hashed owner audit with zero gaps.
- The worker accepts no endpoint、command、output path、credential or exchange-write control. It never starts/stops L2, chooses markets, forms strategy intent, writes `trade.db`, or grants economic authority.
- One cycle and one fetch are bounded; failure is retried from the unchanged canonical watermark and cannot skip a gap silently.
