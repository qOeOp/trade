# Replay Metrics

Owns deterministic metric projection from certified Replay fills and ledger entries.

Metrics are derived read models only. Numeric Policy v3 derives monetary sums from decimal coefficients and return fractions through BigInt rational division with 12-place half-away quantization. This component cannot alter fills or ledger facts, evaluate strategy promotion, compare Candidates, or write Review Decisions.
