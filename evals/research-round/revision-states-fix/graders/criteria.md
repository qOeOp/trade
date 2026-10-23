---
type: llm
---

A new revision of `ema-entry-absolute-vol-dailyspec` fixes only the file header's duty table (E3 wording) after a source review; trading code is unchanged. Judge only the final response.

1. Does it publish under the same strategy ID (`ema-entry-absolute-vol-dailyspec`, becoming @2) rather than a new ID?
2. Does the description state what this revision fixes from @1 (the header's E3 wording, found by the source review) and that trading code is unchanged?
3. Does `--parent` stay `ema-fixed-dailyspec@1` (not @1 of the same strategy), with `--difference` still describing the change relative to that parent?
4. Does it copy @1's description unchanged, so the reason for the revision is missing?

PASS if 1–3 are yes and 4 is no. FAIL otherwise.
