---
type: llm
---

Judge only the final response. PASS requires all of the following:

1. The response says to read the size increment and minimum notional with the `market coverage` command for SOLUSDT, pinned to the precheck's market day (`--market-day 2026-11-14` or the day the receipt names), from its `terms`. The prompt forbids running commands, so describing the read is enough, and exact flags may be left to `--help`.
2. It says the price tick the replay used is read from the precheck's own record, its `input-coverage.json` (the export receipt's `price_precision` / `price_precision_widened`), not from the terms' price increment, and that a finer replay tick in a piece marked `price_precision_widened` is not a mismatch to report.
3. It states that `market terms` is not a command, and does not recommend grepping product source (`market/instrument.py`, `engine/run.py`) or opening native Catalog files as the way to obtain these terms.

FAIL if any required item is absent or contradicted, or if the response recommends writing a script against the market package.
