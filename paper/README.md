# Paper trading

`python -m engine.paper` runs one complete strategy source, constructed as a replay constructs it, in a
Nautilus `LiveNode` on live Binance USD-M public data (no key) with the Sandbox's simulated fills: the
user's authorization of 2026-10-25 covers exactly this, and nothing else live
(`docs/plans/paper-trading-design.zh.md`). It refuses to start while any exchange credential variable is
in its environment, so start it with an allowlisted one:

```bash
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" uv run --frozen python -m engine.paper \
  --strategy-file S.py --strategy-class C --strategy-sha256 H --symbols BTCUSDT \
  --universe membership.json --maker-fee 0.0002 --taker-fee 0.0005 --output /tmp/paper-run
```

The Sandbox takes the replay's account, fill model, book type and bar ordering, and the given maker and
taker rates (the market's assumption, which a replay reads from its export receipts). The strategy sees
the replay's cadence: the first MARK update of each minute and one funding update per settlement. The
Sandbox settles no funding; `events.jsonl` records each settlement with the positions it applies to.
`STOP` in the output directory or `--duration-seconds` cancels the working orders, waits for the cancels and stops
the node; positions stay open and are valued at their latest MARK in `summary.json`. SIGTERM or SIGINT does the
same, except for a source that declares `PAPER_RECOVERY = 1` (below), or any other source while it holds a position
whose working orders a checkpoint can hold (held, below): that run pauses without cancelling anything (it first waits,
up to the same ten seconds, for the orders in flight to be answered) and the daemon resumes it with its positions and
working orders (a held one withdraws its entries then).

`python -m cli.main paper start|resume|stop|seal|list` runs it as the product does
(`paper/runs.py`): the candidate's source is copied from the research ledger into the separate Paper database
(`ledger/paper.sql`) and the run declared there (`paper_run`), then the runner container starts on a
Docker network of its own with no route out, beside an egress proxy (`python -m engine.egress`) that is the
only container also on the outbound bridge and tunnels to `fapi.binance.com` and `fstream.binance.com` on
443 alone. Docker gets an allowlisted environment and passes no host variable into either container.
`paper stop` writes the run's `STOP` file and seals; SIGTERM comes only after a timeout, since on SIGTERM
the node also shuts down by itself and the strategy misses its cancels. `paper seal` captures a run that
ended by itself. How a run ended is a reason in `seal.json` (`RUNNER_EXIT_NONZERO`, `SUMMARY_MISSING`,
`OUT_OF_MEMORY` for a kill at the memory limit, `REFUSED:<code>` and `STOPPED:<code>` for a refusal the runner journaled such as
`PAPER_CACHE_UNAVAILABLE`, below, and `PAPER_JOURNAL_WRITE_FAILED`) and leaves the status `complete`; only evidence that cannot be trusted
(`SOURCE_MISMATCH`, `LEVERAGE_MISMATCH`, `EGRESS_DENIED`, or a runner that started and left no journal) seals `invalid`
(`ledger.run_journal.verdict`). The daemon resumes a run that paused (SIGTERM or SIGINT and a clean checkpoint, which only the pause of a
`PAPER_RECOVERY` source or of a held one leaves) or was interrupted before its summary, and seals every other end: a
signal that ended a flat source without the recovery protocol is an ordinary end, and so is `HELD_FLAT`. The seal stores the run's files (`paper_file`): the journal by UTC day, the summary, the
egress and runner logs and `seal.json`, whose readings add the funding the Sandbox does not settle
(`docs/plans/stored-fields.zh.md`). Runs are admitted by memory, not by count (`TRADE_PAPER_MEMORY`,
`docs/plans/paper-admission-by-memory.zh.md`), one per source at a time.

A write the disk refuses (a full disk) stops the run the same way instead of leaving it trading unrecorded. The first
failed write of the journal, `state.json`, the recovery marker or the failure receipts is latched and the run stops
(`PAPER_JOURNAL_WRITE_FAILED`): nothing is written after the gap, and nothing raises into a callback, so the source still
receives the order or position event whose journal line could not be written. The runner then ends with exit status 3,
which the seal reads (`PAPER_JOURNAL_WRITE_FAILED`, `RUNNER_EXIT_NONZERO`, and `STOPPED:PAPER_JOURNAL_WRITE_FAILED` when
the summary could still be written), since a full disk may take the summary too; the daemon seals a run that has a
summary and tries to resume one that has none, which a dirty checkpoint refuses, so that run waits for `paper seal`.
The journal ends at the gap; what the run did after it is not recorded.

Paper recovery keeps the same unsealed run, pinned image and inputs. Each runner owns a loopback-only
native Redis cache, whichever the source declares, and watches it every second: a child that exited, or one whose
PING has gone unanswered (2 s each) at least 5 times in a row over at least 30 seconds, ends the run with
`PAPER_CACHE_UNAVAILABLE` (a `refusal` in the journal, then the stop of a refused run: working orders canceled,
positions left open, summary written), since a run without its cache could not be recovered and would not say so. A
shorter miss, as a host stall makes, goes to the runner's log and an answered PING clears it; a write lost meanwhile
is the checkpoint readback's to find. The cache's connections fail fast (one-second timeouts, no retries, as Live's), so a
dead one cannot hold `paper stop` in `node.dispose()`. Immutable RDB originals and their exact journal cuts are
retained. The daemon invokes `paper resume`, never a replacement `paper start`, after an interruption. Missing/dirty checkpoints,
changed inputs, unhandled journal tails, unsupported strategy state or a missing original container refuse
recovery and retain the account records. Explicit STOP/duration still seals. The original per-source limit
is three actual recovery launches per hour, including failures before the runtime can journal.

The Sandbox does not generate position IDs (`use_position_ids=False`, as Live's execution client): the execution
engine gives each entry's position its `P-…` ID, which the native cache keeps across a recovery. The matching
engine's own `BINANCE-<contract>-<n>` IDs, which a resting limit entry would otherwise get, restart from zero in every
process and number the contracts in the order their data first arrives, so after a recovery they collide with a
cached position of the same or of another contract. A replay's venue keeps the default; the two differ only in the
IDs, which the paired comparison masks.

`PAPER_RECOVERY = 1` is an explicit source protocol: reviewed `on_save/on_load` hooks own all private state;
`on_start` re-establishes the minute subscription and the aggregations `WARMUP` declares, and may subscribe to those
aggregations of the run's other contracts, without custom routing or dynamic changes. User timers are outside this protocol. A checkpoint holds the positions and the working
orders the Sandbox restores into its matching engines as they were and a recovery can check: accepted (a STOP_LIMIT
also triggered), not in flight, emulated, contingent or linked, not partly filled, a LIMIT, STOP_MARKET, STOP_LIMIT,
LIMIT_IF_TOUCHED or MARKET_IF_TOUCHED triggered by the last or the mark price (the Sandbox takes no mark price and
matches bars with bid = ask = last, so a MARK trigger fires on the bars' last prices), or a trailing stop not yet
activated that has an activation price (user decision 2026-11-18). Any other unfinished order defers the checkpoint, so
a source holding one cannot be resumed: an activated trailing stop among them (also one placed without an activation
price, which activates at once), since rc7 keeps a trailing stop's activation outside the order's events and restores
every trailing stop inactive. A recovery checks a restored trailing stop by its activation price: a sell is touched by
a minute whose high reached it, a buy by one whose low did. A source must
not rely on native account event-count/history representation or unsaved cache history. A recovery warms the
source again at its own T as a start does (history, then the unfinished buckets from their minutes), then
calls `on_load` with the saved state and then `on_start`. A recovery that crossed a funding settlement the source
would not see is held instead (below).
A recovery that crossed a bucket boundary of a declared aggregation back-fills the aggregation: its warm-up starts at
the bucket the checkpoint was cut in (and its declared history ends just before that bucket), the native aggregator
builds the buckets completed since, which rc7 puts only into the native cache, and after `on_start` and before any
live data each of those bars goes to the source's `on_bar` in time order, as a live bar goes (held, then released);
a source subscribed to another contract's declared aggregation (one of the run's contracts and periods; user
2026-11-17) gets that contract's back-filled bars too.
No OHLCV is computed outside Nautilus. T moves on by a minute while it would end a crossed bucket, since a request's
aggregator builds a bucket only once a later minute arrives. An order the source submits on a back-filled bar must be
proven untouched by the minutes of its own contract from that bar's bucket end up to T, by the same rules as a
restored order, and must not be marketable at the close of its contract's minute ending that bucket (a buy limit at or above it, a sell limit at or below it, a stop, LIMIT_IF_TOUCHED or MARKET_IF_TOUCHED the close has
reached, a trailing stop whose activation price the close has reached, which in the uninterrupted run activated it at
once (user decision 2026-11-18), an activated trailing stop or one without an activation price, any MARKET order, a position close among them, an order on another contract than the source's own);
otherwise it is not sent and the recovery is refused as
below. After that no order, cancel or close of the source is sent; those sent earlier, also earlier in the same
callback, stand.
While back-filled bars are handed over, the source's clock reads T, the native cache already holds every back-filled
bar (also those after the one in hand), and an order sent on an earlier back-filled bar may still be in flight; bars
ending at the same instant go by the run's order of contracts, each to its subscribers in that order, while the live
node gives them no fixed order (rc7 fires each aggregator's timer as its own task and breaks ties between subscribers
by a random handler id), so an uninterrupted run is not reproducible for a source whose decisions depend on it either.
A source that relies on
none of these makes the decisions the uninterrupted run made, which then differ only in their submit and accept times.
So that the checkpoint's cut time tells the bars a source has had from those a recovery back-fills, a cut waits while
a declared aggregation's bucket has ended and its bar is not yet in the native cache, and a pause waits for that bar
(up to the same ten seconds); a pause's final cut is the instant the node stopped. No downtime trades or settlements are
invented: on the warm-up's reader at T (T + 15 s, when the Binance kline closing at T is final), the recovery reads
the one-minute klines of each contract holding a restored order from the journal's last bar up to the minute closing
at T, and before any source starts it requires every restored order to be untouched by them (a stop's trigger, a
limit's price, a LIMIT_IF_TOUCHED's trigger not reached by the minutes' high or low) and a trigger on the last price.
A GTD that expired while the run was down needs only the minutes up to its expiry and the last one: rc7's matching
engine matches a bar before it expires what it holds, so the uninterrupted run matched it up to the minute its expiry
fell in and then expired it unfilled, and the recovery's Sandbox matches it once more, on the first live bar's open
(which follows the last minute's close), before it expires it there. Its `OrderExpired` then comes at that bar, not
at the expiry. Any other order type or state, or a minute missing, fails too. A
failed check journals a `refusal` (`PAPER_RECOVERY_UNAVAILABLE`, naming the order and the minute) and stops the run as
a pause stops, leaving the restored orders as they were, without a new checkpoint; the daemon seals it. So does a
refused back-fill (orders it already sent stay as they are) and any other stop of a recovery before it is ready, but
STOP and the duration, which cancel. The interruption shows
in the journal as the `resumed` line and the first live bar's `data_gap`. An external bar stamped no later than the last of its type
the source had (a closed kline pushed again) is journalled as `bar_repeated` and never reaches the source, as in Live. Native Redis readback checks orders,
positions and account events (the last carrying balances and margins) before the atomic cut is published; margins
Nautilus sets only in memory are recomputed from the positions on restore and are not compared.

A resumed run's `reports/` (`engine.paper.write_native_reports`, written at each end from the whole run's cache) are
written as an uninterrupted run's. rc7 adds to a restored cache what no trading made: its Redis cache appends the
account's last state on every cache update, so the restored account repeats states under one event ID; the Sandbox,
connecting again, restates the checkpoint's balance with nothing locked and no margins while the restored positions
hold theirs; and its matching engine marks every order it restores MAKER. So `account.csv` keeps each state once and
leaves out that restatement (the first state after a `resumed` line, when it restates the one before it so; any other
state stays), and `orders.csv` writes every order without a fill as NO_LIQUIDITY_SIDE (a fill sets the side; without
one rc7 sets MAKER on a resting limit order and nothing on a stop). Fills, positions and order events are unchanged.
Replays and Live write their reports as before.

A source without the protocol is held after an interruption, as Live holds (user 2026-11-17,
`docs/plans/paper-recovery-open-orders-20261117.zh.md`): its source is never restored, only the positions and their
stops and targets. While a position is open, the runner checkpoints the native cache and its recorder alone (`sources`
empty, which is a held checkpoint exactly when the source is not recovery-capable), under the same order, callback and
readback conditions; flat, it publishes none, so an interruption ends the run as before. Its recovery starts no
source: a holder per contract takes the source's strategy ID and native configuration (the restored orders' events
route to it), reads the interruption's minutes at T + 15 s and checks the restored orders as above (a failed check
stops as a pause, no cancels), then withdraws the working orders it inherited that are not reduce-only (the entries)
and leaves the rest to the Sandbox on live bars. No funding settlement is refused there; the seal settles every one
for the journal's positions. Once no position is open the run cancels what is left and stops with `HELD_FLAT`, an
ordinary end the daemon seals (the page says "Held until flat"). STOP and the duration end a held run as any run;
another SIGTERM pauses it again and it resumes held. Held, the run is still running, so its source starts no other
run until it is flat (`paper/runs.py`). `paper compare` attributes a difference reaching past the first `resumed` of
such a run to `held` when nothing earlier in its cause order explains it, rather than `unexplained`. Every resume
misses at least one bar (the one closing at the warm-up's T is never received live), so for such a difference the
bars missing from each held interruption's pause (the first `stop_requested` since the run last started or resumed,
else its last line before `resumed`) up to the held recovery's first live bar on the contract are the hold's, not
`missing_bar` evidence; a live gap before the pause or after that bar still is (`paper/compare.py` interruptions). Its
equity differences (`equity.differences`) name `held` for a minute the run was down in, one that ends after a held
interruption's pause and starts by its `resumed` (user 2026-11-18, 「加」), when no order difference or fill timing
explains it: a minute is valued at the last mark the run received in it, and it received none from the pause until
its held recovery went live, so the minute it paused in is valued at a mark from before then (runs 3 and 4: 01:29 at
-0.13 and 02:18 at -0.59 USDT). Later minutes keep their causes: in those runs the live mark a minute was valued at lies on
the 0.01 grid and differs exactly where the archive's MARK close is finer, by a few 1e-5 USDT, which is not the hold's.

Whether a source declares the protocol is the runner's own verdict on the class it loaded
(`engine.paper_session.declares_recovery`: `PAPER_RECOVERY` as Python resolves it, and `on_save` and `on_load` in its
MRO above `Strategy`). A new run journals it on its `started` line as `recovery_declared` (user 2026-11-18); the
page's mark, the listing's `held_since` and `unprotected`, and `paper compare`'s `held` cause read it from there and
never read or run the source. A run whose `started` line has no such key (started before this change) has no verdict:
it is never marked or taken as held. `paper start` cannot load the class (only the runtime image runs a source), so
before any write it refuses a source whose text never names one of `PAPER_RECOVERY`, `on_save` and `on_load`, as an
identifier or a string (`PAPER_RECOVERY_UNDECLARED`, user delegation 2026-11-21): the source check refuses `getattr`,
`setattr`, `vars`, `exec` and dunders, so such a source fails the runner's check unless it builds the name from
pieces. One that names all three starts and gets the runner's verdict.

A recovery of a `PAPER_RECOVERY` source whose interruption crossed a funding settlement its source or recorder was
following is held the same way instead of refused (user 2026-11-17): the source would never see that settlement as it
happened. Its runner journals a `refusal` (`PAPER_RECOVERY_UNAVAILABLE`, the reason naming the settlement and the hold)
right after `resumed`, so the seal says the source's recovery was refused, and from then on the run is a held one: its
checkpoints have the account and no source state, which a source with the protocol has only after such a fall-back, so
every later recovery of the run is held too. `paper compare` takes the held start from that `resumed`, followed at once
by the refusal and later by a bar (a refused recovery stops without one). A settlement that falls due after the runner
started, once its node already runs the source, still refuses.

A held position with no working stop stays held (user 2026-11-17). The held recovery forgets which gaps the checkpoint
had already reported, so the recorder journals a `protection_gap` again after `resumed` for every position its stops
still do not cover. The Paper listing derives `held_since` and `unprotected` from the journal: each position with
such a line after the held start and no later close (`paper/serve.py`). The page marks the run "Unprotected
position" in the fail tone, and the release tick sends one Telegram notice per position
(`paper:{id}:unprotected:{position}`, `deploy/notices.py` Notices). The holder places no order, so coverage cannot
come back while the run is held. A position whose quantity later falls within its remaining stops stays named until
it closes.

`paper compare --preliminary` (the page offers it when the market does not hold the run's minutes yet; user
2026-11-17) compares a run before Binance archives its day: `replay.preliminary` makes a market directory under the
comparison's `--output` whose files link to the market's, and rewrites there only the months the window reaches past
it, adding after each contract's last stored minute, settlement and (for a source that read metrics) metrics row what
Binance's public REST gives (klines, markPriceKlines, fundingRate, futures/data), paced and stopping at the first rate
limit (HTTP 403, 418, 429 or 451) instead of waiting it out. Nothing reaches the market directory. The result says
`data_source: rest` and what REST added (`preliminary`), and the page labels it preliminary; the comparison on the
archive stays the one that counts, so replay again once the market covers the run.

A seal stores the exact journal bytes as `events/native.jsonl.gz`, including any interrupted final line, plus
current and actually-used recovery originals. Verification hashes the decompressed byte prefix; parsed UI
events are not recovery originals. Details, storage review and bounded native evidence are in
`docs/plans/paper-native-recovery.zh.md`.
