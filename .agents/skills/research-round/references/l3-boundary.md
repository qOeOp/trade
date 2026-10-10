# L3 market response

A market and fill-model diagnostic, never a trading result. Run it as a preregistered `diagnostic`
attempt with its reader retained as evidence.

## After an event

Measure from the event time over preregistered horizons, in price or volatility units, against a
preregistered reference (unconditional, random times or the opposite side). A response
indistinguishable from the reference closes that definition only.

## Plan lifecycle

- Inputs: the sealed orders (submission time, native end of life, entry and target prices, stop
  trigger) and the bars whose input identity matches the seal; otherwise report "unavailable".
- Read the source's cancel and retire rules first. If a price condition ends a parent's life, count
  the ending bar as its own group instead of dropping it.
- Count by tag × native status: entry touched but not filled; target level reached while unfilled;
  both in one bar (report separately, never order them).
- For filled parents, cite which native child filled. Report same-bar ambiguity first; if it is
  large, the bar size cannot answer the question.

## Never

- Treat a touch as a fill or a first touch as an exit, or invent an intrabar path (a stop-first or
  even split is one).
- Output R multiples, money, win rates or expectancy from touches, or compare touch rates with a
  breakeven point.
- Read the path after a parent was cancelled or expired.
