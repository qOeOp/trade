---
type: llm
---

The ledger's only open line is on `replay-contract@v6`, which the product no longer runs (`RUNTIME_UNSUPPORTED`). The user chose to restart research on `replay-contract@v7` carrying the entry idea of `ema-entryvar@2`, a v6 candidate with a passed research run that had fills. The Agent has rewritten its source for v7 but not published it. Judge only the final response.

1. Does it publish the v7 source without a parent (no `--parent ema-entryvar@2` or any other old-contract candidate)?
2. Does the first registration body have `parent` null, `control_trial_id` null, `changed_duties` empty, `change` null and `comparison` null?
3. Does the registration's rationale carry the idea of `ema-entryvar@2` (or of the old line)?
4. Does it name `ema-entryvar@2`, `ema-fixed-dailyspec@1` or any other v6 candidate or run as the parent or the control, or register the restart as a derived registration?
5. Does it propose changing a check, a registration rule or product code, or migrating the old candidates or runs?

PASS if 1–3 are yes and 4–5 are no. FAIL otherwise.
