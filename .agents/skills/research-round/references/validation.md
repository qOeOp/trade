# Out-of-sample validation

Read only after the user asks for out-of-sample validation. The user names three things: the
candidate (`strategy_id@revision`, not necessarily the recommended one), the window and the
universe rule. Register it with `validation registration`, run it with `replay run --validation
ID` and read it with `validation report`, as their `--help` describes.

- Before suggesting a window, tell the user how concentrated the candidate's development PnL is
  (one year, a few days, a few contracts) and its capital use, each with the identity of the
  reading, then suggest a window length from its plan frequency so that one interval can resolve
  an effect.
- Report the result as it is and go to the user as soon as it exists. Whatever it shows, do not
  register another window or universe, do not pick among several validations of one candidate,
  and never put development measures in place of out-of-sample ones.
- State that the measures approximate live trading and in which direction: simulated fills, a
  limit fills only when traded through (conservative), no slippage and market orders not limited
  by volume (optimistic); name the execution style the result rests on, and give the window length
  and the effect it could resolve. A short window can refute an obvious failure, never establish a
  high return.
