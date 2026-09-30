# Research Intent: evolved line-based entries, developed blind to the holdout (TrialFamily combo-v2)

Registered 2026-09-30, before the harness, the development data or any candidate existed.

## Question

A horizontal zone, a trend line, a Fibonacci level or multi-timeframe confluence has shown no edge on its own. Does a
line-based entry that combines them with volume, candle patterns, indicators and indicator divergences hold on coins
the developer never saw?

## Roles and data custody

- **Developer:** a subagent. It may iterate without limit on the development data only: BTC/USD (Bitstamp) and
  ETH/USDT (Binance), hourly bars with volume, from 2017 to 2026-09. It delivers at most three frozen candidates as
  Python functions for `combo/harness.py`, with its development evidence. It never reads, downloads or derives
  anything from the holdout coins, and never sees holdout results.
- **Evaluator:** the main agent. It builds the holdout data only after the candidates are frozen and scores each
  frozen candidate on the holdout exactly once. Nothing is re-tuned after that.
- **Custody limits:** both run in one container, so the separation rests on instructions and file custody, not on a
  hard sandbox. The holdout files do not exist until the candidates are frozen.
- **Holdout:** the 15 coins of altcoins-v1: BNB, XRP, ADA, SOL, DOGE, LTC, TRX, LINK, DOT, AVAX, BCH, ETC, XLM, ATOM
  and FIL, against USDT from Binance hourly klines with volume, from listing to 2026-09. Only the breakout B1 was ever
  scored on them; no line-based entry was.

## What a candidate is

A function of the bars up to a signal bar's close (1h, 4h and daily bars with volume). It returns signals: signal
time, side, stop price, target price, and a time limit of at most 60 4h bars. A candidate must be line-based: its entry
must rest on a horizontal level, a trend line, a channel or a Fibonacci level. Volume, indicators, divergences, candle
patterns, timeframe confluence and learned models may filter or rank those entries. A breakout of a prior extreme
without such a level does not count. That is B1, already scored on the holdout.

## Fill model (harness)

Entry at the next 4h open after the signal; stop first when stop and target share a bar; the target counts from the
bar after entry; time exit at the close; 0.06% per side; every signal scored on its own.

## Checks before scoring

- **Look-ahead:** each candidate is recomputed on the data cut at five dates. Every signal before a cut must be
  identical, or the candidate is rejected unscored.
- **Frequency:** at least 100 signals on the development data.

## Decision

- **Control:** for each holdout signal, 20 random entries in the same coin and year, on the same side, with the same
  stop distance in ATR and the same target in R.
- **Pass:** a candidate holds when its pooled avgR minus control has an interval above zero. The interval is a coin-
  then-signal bootstrap at 98.3%, two-sided (Bonferroni for three candidates).
- **Also reported:** avgR against the unfiltered zone-touch base on the same coins.
- **Otherwise:** if no candidate holds, the family stops. Rule-based line entries with these ingredients then have no
  edge on 4h crypto that a blind developer could find.
