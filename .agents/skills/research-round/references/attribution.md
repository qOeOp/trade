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
| S4 | Timing term positive: large exposure in rising months, small in falling months | `capital_scaled` | E3, A3 | Keep and refine the rule that adjusts size to the market |
| S5 | Timing term negative or near zero | `capital_scaled` | E3, A3 | Add a rule that adjusts size to the market or volatility |
| S6 | Breakeven fee multiple near one | `fee_stress` | G1, C2 | Change the execution style, or add a no-trade band |
| S7 | The difference sits in a few contracts, and the same contracts keep losing across versions | `by_instrument` | A1, A2, F3 | Change eligibility or selection, or add a protection boundary |
| S8 | Intercept difference near zero; the slope difference explains most of it | `market_exposure` | E2, D2 | Control the portfolio's net direction or same-side holdings, or hedge |
| S9 | Without the best five days the remaining difference flips sign; few winning months | `by_period` | A3, B2 | Add a condition filter, or change the forecast horizon |
| S10 | Win rate up while expectancy per trade falls; the average win shrinks | `trade_structure` | F3, F4, C1 | Change the exit or protection boundary, or the trigger |
| S11 | Removed trades were net profitable | `trade_pairs` | C1, A3 | Loosen the trigger or filter, or filter only the losing source |
| S12 | Paired trades open later throughout and their PnL is worse | `trade_pairs` | G1, C1 | Change the execution style or the trigger price |
| S13 | The difference sits in one exit category | `trade_structure` | F3, F4, F5, I1 | Change the protection boundary, the exit or the disposal of holdings |
| S14 | One contract dominates the candidate's drawdown interval | `drawdown` | E2, F3 | Cap single-contract exposure, or add a protection boundary |
| S15 | The drawdown sits in one window while time in market (the run report's `capital` section) is near one | `drawdown` | A3, E1, E3, F3 | Stand aside under a condition filter, scale risk to equity or volatility, or add a protection boundary |
| S16 | The return sits in one volatility regime: high- and low-volatility days differ in sign or in mean log return | `by_regime` | A3, D2 | Trade only in the regime that earns, or hedge the exposure that loses in the other |

- Map what the slices show to duties with this table and take its next hypothesis as the usual
  starting point; the code does not enforce it. Before citing a row, check that its signal holds
  in the report you cite. Every pointer in an interpretation judgment names the slice, the table
  row and the duty ids.

## Reading the attribution

- Cite only the slices a conclusion rests on, each with its measure name, and state for every
  registered prediction whether it held (same sign); an item that cannot be checked gets its
  reason.
- When the account difference is positive but a predicted slice has the opposite sign, write the
  account difference and that the prediction failed; never say the mechanism held.
- A single-change comparison is the ablation of that duty. Read its attribution; never run extra
  replays for attribution.
- To read an interaction of two changes, declare the four corners (neither, only one, only the
  other, both) in the registration that adds the last corner. Use the interaction only to explain
  where a difference comes from, never as evidence of improvement, and never pick a two by two
  from the ledger afterwards.
- Differences added up segment by segment along the lineage depend on the order of the changes;
  never present them as each change's independent effect. An independent effect cites a declared
  interaction.
- Per-contract, per-month and exit-reason cross tables are yours to compute from the run's cycles
  and daily series (`nautilus-report-analysis`); their totals must equal the report's slice
  measures. A number that drives the next hypothesis is recomputed by another agent.
