---
type: llm
---

Judge only the final response. PASS requires all of the following:

1. The response reads the contract terms with the `market coverage` command for SOLUSDT, pinned to the precheck's market commit (`--at 7f3c9a1e2b4d` or the commit the receipt names) over the trading window, and takes the values from its `terms` (price increment, size increment and minimum notional, or the same fields by their names).
2. It states that `market terms` is not a command, and does not recommend grepping product source (`market/instrument.py`, `engine/run.py`) or opening native Catalog files as the way to obtain these terms.

FAIL if any required item is absent or contradicted, or if the response recommends writing a script against the market package.
