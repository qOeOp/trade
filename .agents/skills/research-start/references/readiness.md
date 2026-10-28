# Readiness

Read before the first replay of a line or of a session, whenever coverage or lifecycle receipts show a gap,
zero-volume minutes or missing funding (including after a completed replay), when a new month
arrives, and before inferred quotes are used for a new contract, period or liquidation scenario.
Read coverage facts, imported quotes included, with `market coverage` at the line's pinned commit
(`--help` for its output).
A completed replay does not discharge the coverage-reporting duties below.

Before gathering evidence or asking the user about a coverage anomaly or inferred quotes, write
which decision the result could change (execution environment, window, contracts or a
liquidation claim) and what result would suffice. When none, report what you know and continue,
or hand the choice back in one sentence. Never invent data, thresholds or scope, and never offer
evidence that cannot be obtained.

## Contents

- Coverage disposition
- Before replay and on new data
- Inferred quotes and low activity

## Coverage disposition

When reporting any coverage anomaly, include the parts below in the final answer, even when the
user asks only how to record it or what to do next. A diagnosis or a plan to inspect positions is
not a substitute for the disposition.

1. **Facts and block.** Separate LAST gaps, MARK gaps, zero-volume minutes and missing funding
   (`funding.missing_settlements`, against the contract's own `funding.spacing`).
   Identify the market commit, contracts, UTC intervals and counts the evidence gives; say the
   causes are unproven, and give the replay's fixed treatment of each (`market coverage`'s
   `interpretation`) instead of calling the effect unknown. Zero-volume minutes are the exchange's
   record. Distinguish a known missing input from an unreadable receipt or missing verification.
   Do not infer a new product refusal or change a sealed run's eligibility.
2. **Runnable range.** Explicitly state what coverage supports under the pinned inputs, by
   contract and interval, and whether the full selected universe/window can be confirmed. Give
   the supported range even when narrower than the selection, as information for the user, not a
   chosen new scope. If only a gap is known, the periods outside it are only free of that specific
   gap, conditional on other coverage; label that limitation. If funding dates, receipts or other
   inputs are missing, say which part of the runnable range cannot yet be established and what
   evidence would establish it. Do not invent a verified range, turn zero volume into missing
   bars, or silently exclude a whole month because particular settlement times are unknown.
3. **Resumption state.** State the line, candidate, pinned inputs and existing registrations or
   runs retained for resuming; do not consume a registration, overwrite a run or write a new line
   while presenting options. Missing coverage does not make the candidate failed or the line invalid.
4. **User choice.** Ask only about an anomaly that would stop or distort the replay: a gap the
   replay's treatment above fails the run on (a MARK gap beyond the carry where a position may be
   open), missing funding after the trading start, a missing month or unreadable receipt, or a gap
   on an input value the strategy reads (for example a warm-up close an indicator uses, or a whole
   bar of its decision timeframe). For any other, say where it lies, report parts 1–3 and continue.
   When asking, end with a direct question choosing how to resolve the data/scope block. List
   first each range that runs now under the pinned inputs with no anomaly left that calls for this
   question (a later trading start can put a MARK gap in warm-up), then keeping the selection
   while obtaining or verifying the missing source evidence (only under a pinned commit the market
   database holds), or another supported range through the existing line-change rules; keep the options
   already offered unless new evidence rules one out. Follow a market refusal's `next_actions`;
   replacing stored history or the product's quote rule (quotes from another source) needs the
   user's authority. Quotes missing for a month whose bars the market holds come in through
   `market import-quotes` (`--help`; its refusals are the conversion's acceptance): list it beside
   the runnable ranges. Each month is one public market write and publish, the user's decision;
   replays on the imported quotes pin the new market commit, which is a new line record.
   Make unknown ranges conditional on first obtaining coverage. Never choose a coin removal,
   shorter window, replacement input or changed commit yourself, or recommend one because an
   anomaly coincides with losses. A question about writing records, permission to inspect,
   approving a product change, or which investigation to start does not replace this data/scope
   choice. Do not present filling with zero, interpolation or other invented data as an option to
   fix the gap.

Before sending, check that the runnable-range statement (with explicit unknowns where needed)
is present, and the final data/scope question when part 4 calls for one. Keep the facts
and their unproven causes separate; none is an economic failure or a reason to alter the
research universe.

## Before replay and on new data

- Before a replay, check four things: `research state` lists no `RUNTIME_UNSUPPORTED` gate
  (SKILL.md); the runtime reference resolves to exactly one image; the market database has every
  month of the development window; every contract's coverage can be read. Report any missing item
  through the coverage disposition above. Never fill data, drop coins, shorten the window or
  change the pinned commit yourself.
- Before the first replay of a line or of a session, also check the checkout: `HEAD` is a commit
  on `origin/main` (after `git fetch origin main`, `git merge-base --is-ancestor HEAD origin/main`
  succeeds) and the working tree is clean (`git status --porcelain` prints nothing). Sealing
  records the checkout's commit as the revision of its readings. Otherwise do not register or
  replay; tell the user the commit and any uncommitted paths.
- When a new month arrives, read the latest complete month and compare it with the line's window
  and pinned commit. Report how far the window could extend and the exact blocks, with coverage
  and unknowns separated as above. End by asking the user to choose the market commit and the
  development window. Do not change the window, register or replay meanwhile. The user's choice
  is one new line record; the old record stays.

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
  coverage and gaps, quote discrepancies and their distribution over the relevant intervals. In
  matched native replays, change only the quote input and compare liquidation occurrence, timing,
  price and account results under the same strategy, configuration and runtime. No liquidation in
  the compared sample does not validate liquidation behavior outside it.
- Keep originals, reports and derived comparisons in /tmp. Record the readings with their source
  identity (URL, checksum, coverage, alignment rule, market commit and quote rule) in an evidence
  bundle (`evidence add`) so a later session can reuse them within their scope. Do not store an
  original a public archive serves by checksum or one whose terms forbid redistribution. Do not
  change stored runs or canonical inputs.
- Trade-gap p99/max, activity and stale-side-adjustment counts are diagnostics, not an acceptance
  threshold or per-side quote age. State the scope of each reading (including daily aggregation);
  do not invent a fixed freshness cutoff, classify a contract as safe from an uncalibrated number,
  expire quotes or synthesize replacements to make the comparison pass.
- Missing suitability evidence limits liquidation claims; it does not block the replay. Report the
  exact contract/interval/use that is unverified, what was actually checked and which liquidation
  claims it prevents, and continue with the claims the evidence supports. Keep technically
  runnable coverage separate from demonstrated suitability; do not label a data evidence gap as
  candidate failure or silently mark existing product measures ineligible. Do not automatically
  drop coins, shorten windows or change the pinned inputs.
