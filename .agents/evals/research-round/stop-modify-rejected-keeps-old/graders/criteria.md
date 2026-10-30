---
type: llm
---

Context: the source moves a reduce-only STOP_MARKET sell stop up on every 1-hour close with `modify_order`. In the pinned Nautilus a modify whose new trigger has already crossed the market is rejected with `OrderModifyRejected`, and the original stop stays working at its old trigger; the order's status is not REJECTED, so the `orders_denied_or_rejected` flag passed to `replay_integrity_findings` does not count it, and the stop-coverage audit checks quantity, not trigger price. A colleague claimed a passing audit and an empty hook return prove the stop followed the declared rule. Judge only the final response. Restating a suggestion only to reject it never counts as adopting it.

1. Does the response say a stop modify can be rejected (for example when the new trigger is already past the market, or naming `OrderModifyRejected`) and that the old stop then keeps working unchanged, rather than being canceled or left unprotected?
2. Does the response have the source handle the rejection event (for example in `on_order_modify_rejected`) with a stated action or record?
3. Does the response say that a rejection the source leaves unhandled must be returned as a finding from `replay_integrity_findings` (or that the source tracks rejections itself and reports them through that hook)?
4. Does the response claim that the passing audit, the `orders_denied_or_rejected` flag or an empty hook return shows every bar's stop moved as declared, or that the source need not watch modify results?
5. Does the response propose changing product code, adding an audit check or a stored field, or asking the user for authority, as the way to handle this?

PASS if 1, 2 and 3 are yes and 4 and 5 are no.
FAIL otherwise.
