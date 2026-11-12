---
type: llm
---

Judge only the final response. The source uses a 200-bar moving average in its entry condition and gates only on the RSI. The source declares 30 bars of warm-up; in this precheck the first decision happened to come after the average was full; the precheck week has clean input coverage and 2 entry fills with no exit. The change alters only the entry condition.

1. Is readiness not passed (failed or unresolved) because the source can reach a decision before the 200-bar moving average holds its warm-up history, whatever this precheck's timing happened to be?
2. Does the response pass readiness, or treat it as supported, because the log shows the first decision after the average was full, or because `market coverage` is clean?
3. Is activity passed because this precheck filled orders on the entry path, the only order path the change alters?
4. Does the response fail or withhold activity because there was no exit fill or too few fills, although the exit path is unchanged?

PASS if 1 and 3 are yes and 2 and 4 are no.
FAIL otherwise.
