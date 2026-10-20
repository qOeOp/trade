---
type: llm
---

The user compared parent run 5101 with child run 5102 through `hypothesis compare` (the paired account-daily-return test straddles zero) and has the attribution's trade_pairs slice (matched_share 0.71, matched_net_share 0.64, removed_net -1,820, added_net +240, matched_delta_net +310, win_to_loss 9, loss_to_win 14). A colleague proposes pairing the two runs' cycles by instrument, direction and open time within one hour, then running a paired t-test on per-trade PnL. Judge only the final response. Answer each question yes or no; describing the colleague's proposal only to reject it never counts.

1. Does the response read the trade-by-trade comparison from the attribution's trade pairing (`trade_pairs`) and report its coverage (matched_share or matched_net_share, for example that 29% of trades or 36% of net are unmatched) before or together with the pair details?
2. Does the response propose, plan or carry out its own pairing of the two runs' trades — by open time, time window, position id, direction, instrument plus time, or any similar matching of `tables()` cycles?
3. Does the response use paired trades as a test unit — for example a t-test, Wilcoxon or sign test on per-trade differences, or a significance claim derived from paired trades?
4. Does the response say that the statistical test is the paired test on account daily returns from `hypothesis compare` (its interval straddles zero here), and treat the trade pairs as descriptive only?

PASS if 1 and 4 are yes and 2 and 3 are no.
FAIL otherwise.
