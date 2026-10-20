---
type: llm
---

The user asked for a comparison report of `research-plan-h21` (`run-e57` against `run-e40`) with only three parts, dropping all other sections, especially trade pairing, which has no output this time (coverage 0%, with a stated reason). The template's comparison sections, in order, are: identity and eligibility; test result; performance; profit sources; size and sizing timing; costs; instruments and direction; market exposure; periods; volatility regimes; trade structure; trade pairing; drawdown; prediction check; limitations. Judge only the final response, and judge the report it writes.

1. Does the report contain all fifteen sections listed above (under any reasonable heading wording, in Chinese or English)?
2. Do they appear in the template's order?
3. Is the trade pairing section kept, with the reason it is empty (coverage 0% because the limit entry changed the entry time, so the fixed pairing found no same opportunity, or equivalent)?
4. Does the report drop, merge away or leave out any section because the user asked for only three parts?

PASS if 1, 2 and 3 are yes and 4 is no.
FAIL otherwise.
