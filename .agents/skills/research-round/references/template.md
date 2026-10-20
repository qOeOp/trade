# Roots from templates and user sources

Read when transcribing a strategy-library template or a source the user gave into a root,
publishing the root and producing its first report.

## First batch

EMA crossover, Supertrend, Donchian/Turtle system 1, Turtle system 2, Channel BreakOut, Dual
Thrust, Keltner breakout, Bollinger Bands, RSI, Connors RSI(2), single-instrument time-series
momentum, Pivot Reversal. Each trades one instrument.

- Transcribe only templates on this list. One whose source cannot be verified moves to a waiting
  list with the reason; never relax the source requirement to keep it.

## Transcription

- Locate every default parameter (lookbacks, multiples, thresholds, entry and exit conditions) in
  the primary source: page, section, equation number or page anchor. Enter the original as an
  evidence bundle first. The parameter-to-location table goes into the header and the publish
  description. If any parameter cannot be located, drop the template.
- Rewrite the rules and defaults from the source into one strategy file. Do not copy code that
  came with the source or any third-party code, and do not add stops, targets, filters,
  confirmation conditions or parameters the source does not have. What running needs and the
  source leaves open is an implementer choice: one line of reason each, marked 实现者 缺省 in the
  header.
- The header starts with the source: DOI, arXiv id or URL with its version or date, and the
  source bundle name. Then the 27 duty lines in nine groups (strategy-header.md), each with its
  source label; a rule carried to another market, timeframe or instrument is labelled 研究者.
- A source the user gives goes through the same steps. A parameter it does not give is an
  implementer default, listed as such; never label it the source's own words in the header, notes
  or publish description, and do not drop the source for it. The source line names the user's
  source, the date it was given and its bundle.

## First report

- Publish the root without a parent (`candidate publish`), precheck and review it. A repair
  before its first report is published again without `--parent` (the repair in the description),
  prechecked and reviewed again; the line starts at the revision whose review passed
  (`line select`). Register it as a root (no parent, no control, empty `changed_duties`) on the
  line's development window and replay that point once (`replay run`, purpose research): this run
  is its first report. An exploration never stands in for it. An invalid or interrupted replay
  consumes the point; another try is a new registration naming it in `retry_of`.
