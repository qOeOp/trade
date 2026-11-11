# Readiness

Read coverage facts, imported quotes included, with `market coverage` at the line's pinned commit
(`--help` for its output).

Before gathering evidence or asking the user about a coverage anomaly or inferred quotes, write
which decision the result could change (execution environment, contracts or a liquidation
claim) and what result would suffice. When none, report what you know and continue, or hand the
choice back in one sentence. Never invent data, thresholds or scope; never choose a contract
removal, replacement input or changed commit yourself, or recommend one because an anomaly
coincides with losses; never offer evidence that cannot be obtained.

## Contents

- Coverage disposition
- Before replay and on new data
- Inferred quotes and low activity

## Coverage disposition

When reporting any coverage anomaly, include the parts below in the final answer, even when the
user asks only how to record it or what to do next. A diagnosis or a plan to inspect positions is
not a substitute for the disposition.

1. **Facts and block.** Separate LAST gaps, MARK gaps, zero-volume minutes and missing funding.
   Identify the market commit, contracts, UTC intervals and counts the evidence gives; say the
   causes are unproven, and give the replay's fixed treatment of each (`market coverage`'s
   `interpretation`) instead of calling the effect unknown. Zero-volume minutes are the exchange's
   record. Distinguish a known missing input from a refused `market coverage` read or missing
   verification.
2. **Runnable range.** Explicitly state what coverage supports under the pinned inputs, by
   contract and interval, and whether the full selected universe and development period can be
   confirmed. Give the supported range even when narrower, as information for the user, not a
   chosen new scope. If only a gap is known, the periods outside it are only free of that specific
   gap, conditional on other coverage; label that limitation.
3. **Resumption state.** State the line, candidate, pinned inputs and existing registrations or
   runs retained for resuming; do not consume a registration, overwrite a run or write a new line
   while presenting options. Missing coverage does not make the candidate failed or the line invalid.
4. **User choice.** Ask only about an anomaly that would stop or distort the replay: a gap the
   replay's treatment above fails the run on or leaves unvalued (a MARK gap beyond the carry where a
   position may be open), missing funding after the trading start, a missing month or a refused
   `market coverage` read, or a gap on an input value the strategy reads (for example a warm-up
   close an indicator uses, or a whole bar of its decision timeframe). For any other, say where it lies, report parts 1–3 and continue.
   When asking, end with a direct question choosing how to resolve the data/scope block: keeping
   the selection while obtaining or verifying the missing source evidence (only under a pinned
   commit the market holds), or a new line on contracts the market covers (research-start); keep
   the options already offered unless new evidence rules one out. Follow a market refusal's `next_actions`;
   replacing stored history or the product's quote rule (quotes from another source) needs the
   user's authority. Quotes missing for a month whose bars the market holds come in through
   `market import-quotes`: list it beside
   the runnable ranges. Each month is one write to the market directory, the user's decision; the
   line's pinned commit reads it once imported and does not move, so it needs no new line record.
   Make unknown ranges conditional on first obtaining coverage. A question about writing records, permission to inspect,
   approving a product change, or which investigation to start does not replace this data/scope
   choice. Do not present filling with zero, interpolation or other invented data as an option to
   fix the gap.

## Before replay and on new data

- Before a replay, check four things: no gate stops the line (SKILL.md); the runtime reference
  resolves to exactly one image; the market has every month of the development window;
  every contract's coverage can be read. Report any missing item through the coverage disposition
  above.
- For a source that reads open interest or long/short ratios (`--metrics`), also read
  `coverage[].metrics`: a month of the trading window with no file refuses the replay
  (`METRICS_MISSING`) and is a missing month in the disposition above. Missing days and rows and empty
  ratios are input facts. Report them by contract and month beside the ratio the source reads; months where that
  ratio is mostly empty are a gap on an input value the strategy reads (part 4 above).
- `deploy/compose.yaml`'s `market-import` service imports without asking; the user
  authorized it. It keeps bars through the last closed day, and for its contracts the metrics daily
  and the aggTrades and quotes of each closed month; its status file's `kinds` names them (`bars`'s
  `scope`, each other kind by contract). For what it keeps, never offer a manual import: read the
  service's health (`docker compose -f deploy/compose.yaml ps market-import`) and its status file,
  and report a gap with the state there (`waiting`, `lagging`, or `stopped` with its refusal; months
  it `skipped` are archive gaps no import fills). Other contracts and kinds, and months before its
  range, are supplied through `market import`, `market import-quotes` or
  `market import-metrics`, a write the user decides, as in part 4, except bars in a month the market
  holds: `MONTH_EXISTS` whichever `--symbols`, and no command adds them, so name the contracts
  `market coverage` holds.
- Before the first replay of a line or of a session, check the checkout again as at the start
  (SKILL.md): `HEAD` is the current `origin/main` and the working tree is clean.

## Inferred quotes and low activity

Coverage and import diagnostics establish input availability and integrity, not suitability for
liquidation research. In the aggTrades model, each bid or ask is carried until a trade updates it
(or a crossing forces the stale side one tick away). Sparse trades can leave an old inferred price;
the resulting liquidation error can go either way. Minute decisions do not validate intraminute
liquidation inputs. A native replay passing does not establish that those inputs represent the book.

- Judge suitability by research-round's execution rule: the source's designed distance to
  liquidation against the measured error of the inferred quotes.
- Name the actual contract, UTC period and intended use (including leverage/exposure and the
  liquidation scenarios), with the pinned market commit, quote rule and runtime identified. Do not
  extend BTC evidence, a sampled day or an earlier period to other contracts, unsampled periods or
  a different use. Reuse evidence only within its demonstrated scope; low activity alone is not a
  blanket ban or a reason to repeat a completed, applicable comparison.
- Use independent observed bid/ask evidence where available: report its source, time semantics,
  coverage and discrepancies. In matched native replays, change only the quote input and compare
  liquidation occurrence, timing, price and account results; no liquidation in the sample validates
  nothing outside it. Record the readings with their source identity (URL, checksum, coverage,
  alignment rule, market commit and quote rule) in an evidence bundle (`evidence add`), never an
  original a public archive serves by checksum or one whose terms forbid redistribution.
- Trade-gap p99/max and activity are diagnostics, not an acceptance threshold. Do not invent a
  freshness cutoff, classify a contract as safe from an uncalibrated number, expire quotes or
  synthesize replacements to make the comparison pass.
- Missing suitability evidence limits liquidation claims; it does not block the replay. Report the
  exact contract/interval/use that is unverified, what was actually checked and which liquidation
  claims it prevents, and continue with the claims the evidence supports. Keep technically
  runnable coverage separate from demonstrated suitability; do not label a data evidence gap as
  candidate failure or silently mark existing product measures ineligible.
