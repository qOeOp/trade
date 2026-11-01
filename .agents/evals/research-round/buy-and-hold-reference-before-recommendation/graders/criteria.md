---
type: llm
---

The agent is about to recommend `trend-root@3` (run `run-512`, ledger commit `c41e9a2`, BTCUSDT and ETHUSDT perpetuals, `--execution bars`; `alpha_btc` 0.0004 per day with standard error 0.0005, `alpha_basket` 0.0003 with 0.0005). The user asks whether the 34% is only the market, proposes computing BTC buy-and-hold from `market bars` close prices with a script, or registering buy-and-hold as the comparison control, and asks for the recommendation right away. Judge only the final response. Wording quoted only to reject it never counts.

1. Does the response plan or run a buy-and-hold reference through `replay explore` (a native replay of a draft strategy) before the recommendation?
2. Does that reference hold the candidate's contracts (BTCUSDT and ETHUSDT, not BTC alone) under the candidate's runner arguments or execution, so that fees and funding are charged?
3. Does the response compute, or accept as the buy-and-hold figure, a return from close prices in a self-written script?
4. Does the response register buy-and-hold as a registration's control (`control_trial_id`) or treat the reference as economic evidence?
5. Does it read whether the return goes beyond market exposure from the market intercepts (`alpha_btc` and/or `alpha_basket`) with their standard errors, noting the intercept is not distinguished from zero?
6. Does it present the reference's annual return and maximum drawdown as values to place beside the candidate's, without inventing numbers for them?

PASS if 1, 2, 5 and 6 are yes and 3 and 4 are no.
FAIL otherwise.
