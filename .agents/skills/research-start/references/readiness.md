# Readiness

Read before the first replay of a line or of a session, whenever coverage or lifecycle receipts show a gap,
zero-volume minutes or missing funding (including after a completed replay), when a new month
arrives, and before inferred quotes are used for a new contract, period or liquidation scenario.
Read coverage facts, imported quotes included, with `market coverage` at the line's pinned commit
(`--help` for its output).
A completed replay does not discharge the coverage-reporting duties below.

## Coverage disposition

When reporting any coverage anomaly, include the parts below in the final answer, even when the
user asks only how to record it or what to do next. A diagnosis or a plan to inspect positions is
not a substitute for the disposition.

1. **Facts and block.** Separate LAST gaps, MARK gaps, zero-volume minutes and missing funding
   (`funding.missing_settlements`, against the contract's own `funding.spacing`).
   Identify the market commit, contracts, UTC intervals and counts the evidence gives; say the
   causes are unproven, and give the replay's treatment below instead of calling the effect
   unknown. Distinguish a known missing input from an unreadable receipt or missing verification.
   Do not infer a new product refusal or change a sealed run's eligibility. The treatment is one
   fixed rule for every run, not a strategy switch; the market never holds synthetic rows, so a
   minute no source holds stays a gap, and the strategy decides only how it reacts:
   - **Zero-volume minute:** an observation, not an anomaly. Every stored bar is Binance's official
     record (checksummed archives, then REST; sources holding the same minute must agree), so do
     not export bars or download archives to re-verify or locate these minutes. The strategy
     receives the bar; bar execution moves the last price through it but fills nothing, so an
     order it crosses waits for the next traded bar.
   - **LAST gap:** no bar for those minutes and nothing is matched; a derived bar is built from the
     minutes present, and a bucket with none does not exist.
   - **MARK gap:** an open position is valued at its latest MARK for up to 60 minutes (the
     summary's `mark_carry`, a limitation). A longer gap while a position is open fails the run's
     integrity (`CAPITAL_VALUATION_GAP`); with no position open it changes nothing.
   - **Missing funding:** nothing settles at that time, so a held position's account result lacks
     that payment.
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
4. **User choice.** Ask only about an anomaly that would stop or distort the replay: a MARK gap
   longer than 60 minutes at or after the trading start (a position may be open there), missing
   funding after the trading start, a missing month or unreadable receipt, or a gap on an input
   value the strategy reads (for example a warm-up close an indicator uses, or a whole bar of its
   decision timeframe). For any other (zero-volume minutes, MARK gaps up to 60 minutes, LAST gaps
   that remove no value the strategy reads) say where it lies, report parts 1–3 and continue.
   When asking, end with a direct question choosing how to resolve the data/scope block. List
   first each range that runs now under the pinned inputs with no anomaly left that calls for this
   question (a later trading start can put a MARK gap in warm-up), then keeping the selection
   while obtaining or verifying the missing source evidence (only under a pinned commit the market
   database holds; a missing commit is SKILL.md's `MARKET_COMMIT_UNRESOLVED` gate, never a research
   option), or another supported range through
   the existing line-change rules; keep the options already offered unless new evidence rules one
   out. `market import` refuses a month the
   database already holds through its end (`MONTH_EXISTS`), so a source missing inside a stored
   month comes in only through a product fix to the import and the user's authority to replace
   that stored history: say so, and call it a defect fix, not a new entry point. Quotes missing for
   a month whose bars the market holds come in through `market import-quotes` (read its `--help`;
   any earlier month is accepted): list it in this question beside the runnable ranges. Its
   checksum, sequence-gap and time-order refusals are the acceptance of the conversion, so add no
   acceptance step or licence condition of your own. Each month is one public market write and
   publish, the user's decision; replays on the imported quotes pin the new market commit, which
   is a new line record.
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

- Validate the actual contract, UTC period and intended use (including leverage/exposure and the
  liquidation scenarios), with the pinned market commit, quote rule and runtime identified. Do not
  extend BTC evidence, a sampled day or an earlier period to other contracts, unsampled periods or
  a different use. Reuse evidence only within its demonstrated scope; low activity alone is not a
  blanket ban or a reason to repeat a completed, applicable comparison.
- Use independent observed bid/ask evidence where available: report its source, time semantics,
  coverage and gaps, quote discrepancies and their distribution over the relevant intervals. In
  matched native replays, change only the quote input and compare liquidation occurrence, timing,
  price and account results under the same strategy, configuration and runtime. No liquidation in
  the compared sample does not validate liquidation behavior outside it. Keep reports and derived
  comparisons in /tmp and identify their inputs; do not change stored runs or canonical inputs.
- Trade-gap p99/max, activity and stale-side-adjustment counts are diagnostics, not an acceptance
  threshold or per-side quote age. State the scope of each reading (including daily aggregation);
  do not invent a fixed freshness cutoff, classify a contract as safe from an uncalibrated number,
  expire quotes or synthesize replacements to make the comparison pass.
- When evidence is insufficient, report the exact contract/interval/use that is unverified, what
  was actually checked, the missing evidence and which liquidation claims it prevents. Keep
  technically runnable coverage separate from demonstrated suitability; do not label a data
  evidence gap as candidate failure or silently mark existing product measures ineligible. Continue
  only claims supported by the evidence. Do not automatically drop coins, shorten windows or
  change the pinned inputs. If the gap blocks the intended research, ask the user to choose obtaining
  the missing evidence or changing the research scope, under the existing line-change rules.
