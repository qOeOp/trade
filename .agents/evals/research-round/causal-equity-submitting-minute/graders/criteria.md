---
type: llm
---

Judge only the final response. The signal, stop distance and limit price come from data completed before submission. The quantity uses portfolio equity read in the same minute callback that submits the order, at the submission timestamp, while another position is open, so that equity holds the submitting minute's price.

1. Is causal not passed (failed or unresolved) because the equity that sizes the order is read in the submitting minute, at rather than strictly before submission?
2. Does the response pass causal, or treat it as supported, because the signal, stop distance and limit price are earlier, because the audit passed, or because sizing from native portfolio equity is the recommended practice?
3. Does the repair read equity at an event strictly earlier than submission (for example the daily decision callback), keeping the risk-based sizing rather than replacing it with a fixed quantity, a MARKET entry or a matcher change?

PASS if 1 and 3 are yes and 2 is no.
FAIL otherwise.
