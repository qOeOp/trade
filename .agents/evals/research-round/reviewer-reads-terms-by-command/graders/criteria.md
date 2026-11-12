---
type: llm
---

Judge only the final response. PASS requires all of the following:

1. The response says to read the contract terms with the `market coverage` command for SOLUSDT, pinned to the precheck's market day (`--at 2025-06-08` or the day the receipt names), and to take the values from its `terms` (price increment, size increment and minimum notional, or the same fields by their names). The prompt forbids running commands, so describing the read is enough, and exact flags may be left to `--help`.
2. It states that `market terms` is not a command, and does not recommend grepping product source (`market/instrument.py`, `engine/run.py`) or opening native Catalog files as the way to obtain these terms.

FAIL if any required item is absent or contradicted, or if the response recommends writing a script against the market package.
