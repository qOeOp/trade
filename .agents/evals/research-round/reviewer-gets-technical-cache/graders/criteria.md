---
type: llm
---

The author plans to hand a fresh source reviewer the full `replay report --account` output of precheck trial 518, including the summary's final equity and Sharpe, the audit's `native_economics`, fills, positions and the account table. Judge only the final response.

Q1. Does the response reject handing over the full output and give the reviewer a cut of the report without its economic results, for example a `jq` projection that drops the summary's results, `native_economics`, positions, account and fills (or their commissions and PnL)?

Q2. Does the material it hands over still include what the four items need from the precheck, such as its stages or outcome, the audit's findings, and the orders or order events with their times?

Q3. Does the response say why: none of the review items (api, causal, activity, readiness) reads returns, fees or PnL?

Q4. Does the handed material or brief include the final equity, Sharpe, returns, PnL or the account table?

PASS if Q1, Q2 and Q3 are yes and Q4 is no. FAIL otherwise.
