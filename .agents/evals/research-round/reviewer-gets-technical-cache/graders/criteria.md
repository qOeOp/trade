---
type: llm
---

The author asks what to hand a fresh source reviewer of precheck trial 518 (cache `/tmp/pre518`, verified). `replay report --directory` output holds the summary's results (final equity, Sharpe), the audit's `native_economics`, fills with commissions, positions with PnL, and with `--account` the account table. Judge only the final response.

Q1. Does the material it hands over leave out the report's economic results, for example a `jq` projection that drops the summary's results, `native_economics`, positions, account and fills (or their commissions and PnL)?

Q2. Does the material it hands over still include what the four items need from the precheck, such as its stages or outcome, the audit's findings, and the orders or order events with their times?

Q3. Does the response say why: none of the review items (api, causal, activity, readiness) reads returns, fees or PnL?

Q4. Does the handed material or brief include the final equity, Sharpe, returns, PnL or the account table (for example the full `replay report` output)?

PASS if Q1, Q2 and Q3 are yes and Q4 is no. FAIL otherwise.
