# Attribution

Read when a run report or a comparison has a result: before reading its slices or attribution,
writing the interpretation judgment and choosing the duty of the next hypothesis. A single run's
report (`replay report --run-id RUN`) has the same slices for its one side, without trade pairing;
read the rows on its values.

`hypothesis compare --bundle BUNDLE --run-id RUN` returns the paired test and, beside it, the
attribution: for each slice the two sides' measures and their difference, the trade pairing
(coverage first), each registered prediction with its observed sign, and the interaction when one
was declared. It does not change the test result.

## Signals to duties

| Row | Signal | Slice | Duties | Common next hypothesis |
|---|---|---|---|---|
| S1 | Funding difference dominates, price difference negative | `profit_bridge` | H1, B1 | Make funding an explicit source of return, or test the price leg alone |
| S2 | Return per unit of exposure falls as size grows | `capital_scaled` | G3, E1 | Size by liquidity, or change the capacity cap |
| S3 | Both sides lose; the candidate loses less but return per unit of exposure is unchanged or worse | `capital_scaled` | B1, A3 | The smaller loss is less exposure, not quality; go back to the signal or a condition filter |
| S4 | Timing term positive | `capital_scaled` | E1, E3, A3 | Separate passive marked exposure, compounding and costs from active sizing; check rising/falling-month exposure separately |
| S5 | Timing term negative or near zero | `capital_scaled` | E1, E3, A3 | Same diagnostic as S4; the sign alone gives no preferred sizing rule |
| S6 | Breakeven fee multiple near one | `fee_stress` | G1, C2 | Change the execution style, or add a no-trade band |
| S7 | The difference sits in a few contracts, and the same contracts keep losing across versions | `by_instrument` | A1, A2, F3 | Change eligibility or selection, or add a protection boundary |
| S8 | Intercept difference near zero; the slope difference explains most of it | `market_exposure` | E2, D2 | Control the portfolio's net direction or same-side holdings, or hedge |
| S9 | Removing the five daily contributions in the total's direction reverses the remainder; few winning months | `by_period` | A3, B2 | Inspect concentration and competing explanations; this alone gives no filter, horizon or parameter direction |
| S10 | Win rate up while expectancy per trade falls; the average win shrinks | `trade_structure` | F3, F4, C1 | Change the exit or protection boundary, or the trigger |
| S11 | Removed trades were net profitable | `trade_pairs` | C1, A3 | Loosen the trigger or filter, or filter only the losing source |
| S12 | Paired trades open later throughout and their PnL is worse | `trade_pairs` | G1, C1 | Change the execution style or the trigger price |
| S13 | The difference sits in one exit category | `trade_structure` | F3, F4, F5, I1 | Change the protection boundary, the exit or the disposal of holdings |
| S14 | One contract dominates the candidate's drawdown interval | `drawdown` | E2, F3 | Cap single-contract exposure, or add a protection boundary |
| S15 | The drawdown sits in one window while time in market (the run report's `capital` section) is near one | `drawdown` | A3, E1, E3, F3 | Stand aside under a condition filter, scale risk to equity or volatility, or add a protection boundary |
| S16 | The return sits in one volatility regime: high- and low-volatility days differ in sign or in mean log return | `by_regime` | A3, D2 | Trade only in the regime that earns, or hedge the exposure that loses in the other |

- Use this table to locate possible duties and questions, not to identify a cause or prescribe a
  rule. Before citing a row, check that its signal holds
  in the report you cite. Every pointer in an interpretation judgment names the slice, the table
  row and the duty ids.

## Reading the attribution

- Cite only the slices a conclusion rests on, each with its measure name, and state for every
  registered prediction whether it held (same sign); an item that cannot be checked gets its
  reason.
- When the account difference is positive but a predicted slice has the opposite sign, write the
  account difference and that the prediction failed; never say the mechanism held.
- A matching sign is directional consistency in this window, not statistical or causal proof of
  the mechanism. Several duties predicting the same measure share one observation.
- A comparison contrasts the registered candidate and control in their common window. If
  one action touches several duties, it does not isolate each duty's effect. Read its attribution;
  never run extra replays for attribution.
- The change is declared relative to the parent, which may differ from the comparison's control.
  Call the contrast an ablation only when the actual candidate/control source difference isolates
  that change; otherwise it compares the combined differences between those strategies.
- To read an interaction of two changes, declare the four corners (neither, only one, only the
  other, both) in the registration that adds the last corner. Use the interaction only to explain
  where a difference comes from, never as evidence of improvement, and never pick a two by two
  from the ledger afterwards.
- Differences added up segment by segment along the lineage depend on the order of the changes;
  never present them as each change's independent effect. A declared four-corner interaction
  describes conditional effects within those corners, not an independent sample or generalization.
- Per-contract, per-month and exit-reason cross tables are yours to compute from the run's cycles
  and daily series (`nautilus-report-analysis`); their totals must equal the report's slice
  measures. A number that drives the next hypothesis is recomputed by another agent.
