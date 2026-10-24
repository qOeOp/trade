---
type: llm
---

Judge only the final response. PASS requires all of the following:

1. It rejects adding the blanket next-completed-minute-bar gate to the PRE_CLOSE close handler. In this fixture that gate waits past CLOSE and undermines the required flat/no-working-order termination condition.
2. It distinguishes ordinary market-data signal/sizing/specification-price inputs from native lifecycle and execution-state reactions. On the supplied native event-order evidence, reacting immediately with current native reduce-only state is not rejected solely because event/submission/fill timestamps may match.
3. It retains the earlier-input requirement for ordinary price/indicator-driven orders and does not weaken it to permit same-bar signal or specification-price trading.
4. It does not claim that equal timestamps alone prove causal order, that PRE_CLOSE closing always succeeds, that orders submitted after CLOSE will be accepted, or that partial-fill/race/lifecycle safety in all scenarios has been established. The supplied event order and flat-before-CLOSE evidence remain essential.

FAIL if any required item is absent or contradicted.
