# L3 market response: what is legitimate

L3 asks whether the market moves as the mechanism predicts and what happened to the strategy's plans
during their native lifetime. It is a market and fill-model diagnostic, never a trading result. Run it
as your own preregistered `diagnostic` attempt; keep the reader in an external recipe with the
attempt's evidence.

## Market response after an event

- Measure from the event time over preregistered horizons, in price or volatility units.
- Compare with a preregistered reference: unconditional, random times, or the opposite side.
- Report the difference and its uncertainty. A response indistinguishable from the reference closes
  this operational definition only.

## Plan lifecycle (from a sealed run)

Use only:

- the sealed `orders.csv` (parent submission time, native end of life, entry and take-profit prices,
  stop `trigger_price`, tags, status);
- the same five-minute LAST Catalog, after checking its input identity against the seal. If it does
  not match, report "unavailable".

Observe each parent only until its native end of life. Count by strategy tag × native status:

- entry price touched but not filled (a fill-model diagnostic);
- while unfilled, price first reached the take-profit level;
- both levels touched within one bar: report separately, never order them.

For filled parents, cite which native child filled; do not recompute. Keep parents still `ACCEPTED`
at the end and partial fills as their own groups. Report the share of same-bar ambiguity first: if it
is large, say that five-minute data cannot answer the question.

## Never

- Treat a price touch as a Nautilus fill, or a first touch as an exit. Price touch is not a fill; do
  not invent intrabar paths.
- Output R multiples, USDT, win rates or expectancy, or compare touch rates with a breakeven point:
  breakeven holds only for entered positions, not from submission time.
- Read the path after a parent was cancelled or expired.

A lifecycle result is a lead, not a conclusion. If unfilled plans often reached the take-profit
level while filled ones did not, the next step is a native experiment on entry execution (trigger
type, depth, time in force), not a new signal.
