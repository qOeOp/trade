# Live execution

`python -m engine.live` is a separate, credential-bearing Binance USD-M entry point. It does not use
the Paper Sandbox account, delayed callbacks, fee model, funding adjustments or checkpoint protocol.
A run is prepared, started and reconciled only from the Live page, through the paired control
([Live on this host](../deploy/remote/README.md#live-on-this-host)), with a credential saved there. It uses a private
execution directory and never writes an execution into the research ledger or Paper database. Every effect requires
the release's own control snapshot and current release authority. All installed keys share one durable run/reconcile
slot.
Missing installation metadata does not enable standalone execution. `python -m cli.main live status|logs|stop` takes
the canonical `--root` and a run ID: `status` and `logs` only observe, `stop` only requests STOP; the paired
controller performs host cleanup. Native account/order/position ownership is unchanged.

As for Paper, the Live page chooses the run: the candidate is the version selected in the research graph, and the
contracts (default: its last research replay's) and leverage are typed there. Preparation reads the candidate at the
research ledger's head, which becomes the run's `research_at` (kept in its manifest); a candidate absent there or whose
source does not load is refused (`LIVE_SOURCE_MISSING`). The contracts' membership comes from the market directory
(`LIVE_UNIVERSE` when it cannot) and is frozen in the run's inputs. Preparation writes everything under
`staging/<run_id>` and renames it into `runs/` whole, so a run is either prepared completely or not at all.

Every page action carries a request ID, and the effect's own rows carry it: the `prepared` and `launch_requested`
lifecycle rows, and a saved credential's version reference, which is derived from it. When the page gets no reply, it
shows the run's or key's state as Live reads it and offers **Send again**, which sends the same request: a published
preparation is returned as it is (never read again at a new head), a launch whose `launch_requested` row exists is
not made again and reads no key, and a save cut short finishes. The same ID naming another operation is refused
(`LIVE_REQUEST_CONFLICT`). `launch_requested` is fsynced before `docker run` under a deterministic container name;
while that container cannot be found and nothing recycled the run since, no new launch of it is made, the control's
own restart included (`LIVE_DOCKER_UNAVAILABLE`), and STOP stays available.
`preflight` captures immutable source inputs from the research reader at that commit, pins a main-CI
runtime digest, queries the account and applies the account and source checks `start` will repeat, so `status`
says `preflight_failed` and `logs` gives the refusal before any account slot is taken. Live runs only the
candidate's own source, read from the ledger at that commit; there is no adapted file, and a source hash that is no
longer the prepared one is refused (`LIVE_IDENTITY_CHANGED`). The result shows the candidate and its
out-of-sample registrations at that commit. They inform the operator and no validation is required.
Preparation first needs the candidate's closing history test, read at research_at, to have decided that it meets
its line's targets, the check `validation registration` makes (`report.history.require_unfalsified`): it refuses
`LIVE_CANDIDATE_FALSIFIED` for a candidate the test judged short of them and `LIVE_HISTORY_UNDECIDED` for one it has
not decided (no history test, or a verdict missing a reading). It also needs replay evidence at research_at: a passed sealed run, or a completed `replay explore` whose
audit passed and whose trading window lies inside a research trial's window of the same source (a window it already
saw, so no new exposure and no holdout spent), of that exact source on exactly the run's symbols in `bars`, on a
replay image whose `--describe`
reports the execution image's `source_files_sha256`, `audit_source_sha256` and `dependency_lock_sha256` (the same
replay code). A sealed run on other replay code counts through an explore that reproduces it on matching code
(`replay reproduce`). Without one it refuses `LIVE_EVIDENCE_MISSING`; the manifest lists each (`evidence`) and the
review shows them. In `preflight` and `run` the runner then needs one that started within 10% of the USDT wallet it
observes, or refuses `LIVE_EVIDENCE_BALANCE`. To back a run, replay the candidate at the wallet: `candidate export`,
then `replay explore` of that file with `--starting-balance` the wallet and the run's `--symbols`, inside the
window of one of its research trials.
Last, preparation needs a reconciled Paper run of the source (`live/reconcile.py`): a sealed run whose status is
`complete`, of the same `source_sha256` on the same contract set, whose image reports Live's replay code, not held after
an interruption, whose `paper compare` on the archive (never the preliminary REST minutes) has at least one order
group, no group of cause `unexplained`, no look-ahead suspect and no unexplained equity minute. Leverage need not match
and no duration is required. Nothing is stored: the serving control lists the runs through the Paper reader profile
each release writes beside the research reader (`profiles/paper.json`) and compares each in a child container of its
own image (`live paper-compare`), keeping the answer in memory, so a restart derives it again. Preparation runs in
`live web-command` and asks the serving control over its socket
(`GET /api/live/candidates/<strategy>/<revision>/paper/<SYMBOLS>`); until the answer is reconciled it refuses
`LIVE_PAPER_UNRECONCILED` with the reason: no matching run, the comparison not done yet (the first ask starts it; a
run the market does not cover yet is compared again an hour later), or the check that failed.
`start` takes the prepared run ID, the same saved credential version and the run's `source_sha256` as the
confirmation, then repeats
account admission. A run trades each of its contracts with its own instance of the source, as a replay does: each
instance has its own strategy ID (`LIVE-<run>-<coin>`) and orders only on its own contract (`ORDER_RULE`, as in replay and Paper),
and instances coordinate legs through state the source shares between them (decision
`docs/plans/cross-line-fusion-20261111.zh.md` §5–§7). Admission requires a flat account, Hedge/Multi-assets mode, and
on every contract CROSS margin, the declared leverage, no automatic margin addition and Binance status `TRADING`. The
venue's leverage is observed, never changed or copied into a simulated account. A complete v2 account response must show finite nonnegative wallets
and eligible USDT wallet cash and available balance each covering the cash floor (85% of the USDT wallet, at most 100 USDT).
Other collateral is not converted into an entry allowance. CROSS does not isolate this budget from
the rest of the account. Credentials are mounted only into the Live runner, not placed in argv or Docker environment.

The execution client uses native `HEDGING` with `use_position_ids=False`; the source runs native `HEDGING`
(virtual positions, one per entry order, on the account's LONG and SHORT sides) with UUID client order IDs. Allocation, initialization and registration must
preserve each instance's assigned strategy identity and those settings. Native managed stop is disabled and
native market exit must use reduce-only orders. The strategy OMS describes local
ownership; it is separate from the account's ability to hold both LONG and SHORT legs.

Order commands remain closed until a fresh account observation after native startup passes admission.
Account reads run in one read-only background task; the existing Observer consumes the result while
native socket and timer events continue. The worker never touches the node, source, order or cache.
Late results after STOP or the 30-second deadline cannot dispatch an entry.

A lost connection closes entries; it does not end the run (`engine/live_connection.py`, design
`docs/plans/live-continuous-operation-design-20261110.zh.md` §3.2). A disconnect before the connected start is
verified still ends the run, since nothing was admitted. After it, any Binance socket that goes down closes the entry
gate: working entries get one native cancel each (REST, so a lost socket does not block it; an entry can still fill
if the cancel is lost or loses the race, and its source protects it as usual). An entry the source submits, or one
still waiting for its account check, passes every other entry check and is held unsent (`entry_held`; not in the
native cache, so nothing counts, cancels or fills it). When the gate reopens it takes its account check as any entry
and is sent once, unchanged (`entry_released`), if that happens within 60 seconds of its decision (for GTD, early
enough that it leaves with at least 605 seconds before it expires; every GTD entry is sent with that much left) and
before the source receives another bar of the type it decided on. Otherwise the run ends with
`LIVE_CONNECTION_UNVERIFIED` before that bar reaches the source (`entry_refused`, detail `entry_hold_expired` or
`entry_hold_bar`): the source cannot see a product refusal, and the pinned Python `Strategy` has no native
`deny_order`. A gate closed for a reason no check clears (below) refuses entries at once, held ones included, except a
missing bar or a contract not trading. After a missing bar alone, an entry staged when it closed, and a new one that
passes every entry check while the run holds a position, are denied natively and the run goes on (`entry_denied`).
When a comparison, or an entry's own account read, finds a contract's Binance status other than `TRADING`, entries on
that contract alone close (`contract_status`, with its `symbol`): its staged and held entries and every new one on it
that passes the entry checks are denied natively, flat or not, and the run goes on; working entries and positions with
their exchange stops stay, and the other contracts trade on. Its status is then read every minute; back at `TRADING`,
the run's entries reopen after the same two agreeing comparisons as after a reconnect. A start again (to warm up, or
on a new image) waits while a contract is not trading. The run node registers an
`ExecutionAlgorithm` (`LIVE-GATE`) whose `deny_order` puts the source's order in the native cache as DENIED and gives
the source `OrderDenied`; nothing is sent. Its denials, read back from the journal in later starts whose reloaded cache
still holds them, are no native failure. Nor does the source's own report of one fail the start (finding 20261114-28,
the user 2026-11-15): authored sources report every denied order from `replay_integrity_findings`, so Live reads an
instance's findings before and after it handles an `OrderDenied` of an order the gate denied (known by its client
order ID), and what the instance added in between is the gate's doing. `source_findings` still journals every finding
as reported and counts those in `entry_gate_findings`; any other finding, and the report of a denial the gate did not
make, fails the start as before. Replay and Paper judge findings as they did. An order the cache already holds, an entry submitted from within a denial's
callbacks, or a denial that fails is refused, and the run ends. `live compare` attributes a fill the gate delayed, withdrew or denied, and a
decision Live refused after a hold, to the cause `entry_gate` (decisions `docs/plans/live-entry-hold-20261113.zh.md`,
`docs/plans/live-bars-missing-rewarm-20261113.zh.md`).
Reductions, cancels and closes from the source and the Observer go on (REST); exchange stops stay at Binance.
When every socket is back, entries reopen only after two comparisons of a REST read with the native cache, at least 30
seconds apart (one native position and open-order reconciliation cycle), both agree, contract by contract, on its
instance's positions per side and open orders by venue ID, on the account modes, nothing on a symbol outside the run,
and a live bar received since the reconnect. A disagreement restarts the check. Orders at Binance the cache does not
know are canceled with every order on their contract (native cancel-all, regular and conditional), and entries then
stay closed for the run, as they do after changed account modes. An external bar stamped no later than the last of its type (a closed kline pushed again, revised or not) is journalled
as `bar_repeated` and never reaches the source. A missing external bar on any contract (Binance's
stream does not resend a close it missed) is not patched: entries on every contract close and working ones are
withdrawn; a position keeps its instance and exits. Once no instance holds a position, order or held entry, no
instance sees a further bar, and after two agreeing comparisons this start ends
without closing anything (`rewarming`, exit status 3). The control starts the run again, whose warm-up reads Binance's
complete bars (decision `docs/plans/live-bars-missing-rewarm-20261113.zh.md`). If that warm-up fails, the start ends the
same way once more (`rewarming` with `retry`; it counts toward the control's four run launches an hour); a second failure ends
the run. Flat with only reduce-only orders left at Binance, the run waits with entries closed and cancels nothing. Once
agreeing comparisons (every five minutes) have seen them at Binance for ten minutes, the user is told
(`orphan_orders`): 10 to 20 minutes after the account went flat. The comparison also
runs every five minutes while entries are open; two disagreeing reads in a row close them.
While nothing is open, a connection older than 23 hours is renewed natively (`reconnect_socket`) between seconds 20 and
40 of a minute, moving Binance's 24-hour cut away from positions and the bar boundary. With a position open, the
existing 60-second rule for a missing mark price still stops the run. A socket down for a minute, a check not passed
in ten minutes, entries closed for the run, for a missing bar or for a contract not trading, a start again to warm up
(and its one retry),
reduce-only orders left after a missing bar, and the reopening after such a notice are Telegram notices. No custom
reconciliation engine or second trading client is used.

A run never ends by itself, so its native cache must not grow without bound (design §3.9). Redis rewrites its AOF once
it has doubled past 64 MB, dropping the expired health probes and replaced values; Nautilus's own lists (orders,
positions, account states) stay whole, since every start reloads them and its reports read the whole run. The
Observer refreshes the native account every 60 seconds, and each entry's own account read refreshes it too: Nautilus's
risk engine checks an entry's margin against the native free balance, which a canceled or expired order leaves reduced
until a REST refresh (Binance's stream sends no account update for it). rc7 appends each state, about 0.85 KB, to a
Redis list it never trims and reads whole at each start: about 0.45 GB a year, against 2.6 GB at the earlier 10
seconds. In memory, Nautilus purges account states older than a day each hour, starting an hour after the start, so a
start still loads the whole list first.

A close Binance made that the native cache never received leaves a position in the cache that Binance no longer
holds: a stop that triggered while no process heard it (the runner down, the user stream down), a liquidation, an
ADL, a close by hand. Native reconciliation does not match it (finding 20261114-25; confirmed only against a local
fake exchange, not on Binance). Two rules bound what the run does on such a cache (the user 2026-11-15):

- An entry is not sent while Binance's positions differ from the native cache's. Each entry's own account read is
  compared, contract by contract and side by side, with its instance's positions in the cache. A fill between the
  read and the comparison disagrees for a moment, so the entry reads once more (`entry_reread`); a second
  disagreeing read refuses it (`LIVE_CONNECTION_UNVERIFIED`) and the run ends as for any refused entry, on the STOP
  path. The periodic comparison (every five minutes) finds the same difference later, as before.
- When Binance holds nothing at all (no position on any symbol, no open or conditional order) and the cache still
  holds a position of the run, there is nothing to close and a close could only be rejected: the run records
  `venue_flat` with that read, sends nothing and ends (exit 0 unless it had failed otherwise), as a reconciliation
  that finds the account flat does. The control releases the slot (`venue_flat`); the next run starts from a fresh
  native identity. This is judged at three points: when a start again on a flat account has connected and its
  reloaded cache still holds a position (nothing of that start is in flight); at an entry's second disagreeing read;
  and when two comparisons at least 30 seconds apart (one native position check) both find it.

Where Binance still holds something (a stop left behind, part of the position), only the first rule applies: no new
entry is sent, and the STOP path still closes by the cache, where a close of a position Binance no longer holds is
rejected and the run ends `unresolved`. A position whose close is found by the 90-second stop-coverage rule before
any comparison (a liquidation that also removed its stop) takes that path too. The run does not go on trading by
itself after either ending.

Any other failure of the Observer sends the same one cancel per working entry and ends the run unresolved, closing
nothing. A source that leaves
the running state by itself (`stop`, `fault`, `degrade`) enters the normal STOP path, marked failed.

Orders follow the [shared order rules](../engine/README.md#subscriptions-orders-and-stop-coverage); Binance Futures in the pinned release refuses linked OCO/OTO order
lists, which the rules exclude everywhere. Live adds custody on top: the account is flat when the run starts; each
entry then waits, in order, for its own fresh account check (cash of at least the budget, the 3-times exposure limit
against that check's equity) before dispatch, and may join the run's open positions and orders. The drawdown brake counts the whole run.
A GTD order goes to Binance with its expiry, which Binance
[keeps to the second](https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order)
and refuses when less than 600 seconds ahead. The order rules hold all three paths to the same two terms: a whole
second (Nautilus's client denies a fraction of one before sending) and at least 605 seconds after the strategy
submits it. A Live entry waits for its account check and is sent only with at least 605 seconds left (the client
denies an expiry not strictly more than 600 seconds past its own clock; `LIVE_ORDER_UNSUPPORTED`), so one bound for
Live expires more than 605 seconds ahead by as long as it is to survive that wait. The order can end up to a second early, or late in extreme markets,
and in the 2026-11-06 trial such an end came back `CANCELED`, not `EXPIRED`. An expiry is no precise end time, and
a stop placed GTD (a STOP_LIMIT; the order rules refuse a GTD STOP_MARKET) stops protecting when it ends.
The Observer temporarily holds only that unsubmitted native order, then checks its expiry, current native
cache, connection, STOP, persistence, native source Running state and cash budget before calling native submit.
The order's strategy/trader identity must match the registered native source, so a foreign OrderFactory
cannot bypass the source's history or recovery identity. It never retries,
fabricates an order event or persists a dispatch queue. An entry refused at any of these steps (a failed or late
account read included) ends the run one way: each entry not yet sent is journaled (`entry_refused`), the run is
marked failed and takes the STOP path with `stop_reason` `entry_admission_failed`, which withdraws working entries
and closes the run's positions. A run may enter any number of times; each entry passes its own admission.
Besides the native portfolio equity of the order rules, Live also measures the 3-times limit
(`engine.order_rules.ENTRY_EQUITY_MULTIPLE`, user 2026-11-09 and 2026-11-10) against the lower of USDT wallet and
available balance in the account observation the entry's own admission read, which may hold the run's own positions
and orders on its contracts (no other symbol's), and checks the status, terms and minimum size of the entry's own
contract. That admission still
requires USDT wallet and available cash of at least the budget, so the budget is a cash floor, not a size limit:
a source sizing from equity at up to 3 times stays admitted however its equity grows. The venue leverage is observed, never set; an entry above the
cash needs it set high enough on the venue. It is not a realized execution amount or loss guarantee, including for a SELL filled higher
than its limit. The native global notional cap is omitted because it also rejects necessary reductions;
all other native risk checks remain enabled. Reductions also require the position to be the instance's own, on
the run's account and the instance's contract. Live does not claim hostile-code isolation for the source.

Before a `preflight` or `start` takes the account, the control's process reads the key's own permissions once from
`api.binance.com`, which the runner's egress deliberately cannot reach: a key that can withdraw is refused
(`LIVE_KEY_WITHDRAWAL`), an unclear answer or failed read is refused (`LIVE_KEY_UNVERIFIED`), and so is a key with
no IP restriction (`LIVE_KEY_IP_UNRESTRICTED`), for every run, timed or not. The runner then bounds its own clock against the venue's time, because native
requests may sign with it while signed reads here carry the venue's time: at most 1000 ms ahead (the venue's limit) and
2500 ms behind (half the 5000 ms `recvWindow`), or `LIVE_CLOCK`. The reading is kept in the private preflight snapshot.

How to write a candidate that
runs in Live: `.agents/skills/research-round/references/strategy-authoring.md`, section Live. On every one-second
observation of a `run`, each open position needs stop coverage (`engine.protection`, the audit's rule), read from
the native cache because Binance Hedge orders carry no `reduceOnly` on the wire. Once a gap outlasts 90 seconds from when it opened (the
audit's one bar plus the native open-order check, timed by the same `protection.Gaps` as Paper; fills do not extend it), or when the check itself cannot run, the
run is marked failed and takes the STOP path. A stop the native cache holds but the venue lost is found only by
native reconciliation. A failed flat run keeps the account slot until `reconcile`. The STOP path submits at most five
closes on each one-second tick, half the native submit rate of 10 orders a second, and the next ones once those are
done, so a stop with many positions open stays under the rate. A close that rate still denies (the instances' own
orders count toward it) was never sent: it marks the run failed like any denied order and is submitted again on a
later tick. If the close is rejected or
fails, it is not retried: the node stops with the position open and possibly no stop on the venue, and `status` says
`unresolved` (see [Unresolved Live runs](#unresolved-live-runs)).

The drawdown brake (`engine/live_brake.py`, design §3.5, user 2026-11-10) replaces the per-run loss limit. Every
15 seconds during a `run` the runner reads the account over REST; equity is the USDT wallet plus its unrealized result,
so fees and funding count. The run's highest equity starts at the equity it armed with and is journalled whenever it
rises (`equity_peak`), so a start again carries it on. Once equity is the brake's share below it (`drawdown_brake`,
the user's 15% maximum-drawdown target, or a tighter share the run was prepared with), the run takes the STOP path
with `stop_reason` `drawdown`, writes the account read beside it, is not a failure, and is not started again. With a
position open and no equity read for 60 seconds the brake cannot be applied: the run stops, failed
(`drawdown_unverified`); so does a position with no mark price of its contract for 60 seconds (`mark_missing`). The cash floor is 85% of
the USDT wallet at the first arming (the first trial admits at most 100 USDT, `LIVE_BUDGET`): each entry still needs
that much USDT wallet and available cash, a last line should the brake fail. The brake does not bound a gap or a
rejected close; a trigger makes one close attempt. Do not transfer or trade by hand during a run.

Each entry's account read and the connection's comparisons also bound the clock (`LIVE_CLOCK`): an entry that passes
every other entry check but the clock is denied natively through the gate (`entry_denied`, `entry_clock_skew`) and the
run goes on, the next entry taking its own read; a read with no usable server time, or no gate to deny with, still
refuses it and ends the run, and so does an entry submitted from within a denial's callbacks. A
comparison that fails the clock closes entries until it agrees. While a run trades the paired control reads its key's
permissions every hour: a failure (withdrawals on, IP restriction gone, unreadable) is journalled once
(`key_check_failed`) and a Telegram notice; the run goes on.

A run has an optional duration (none: it runs until stopped), counted from its first arming. SIGTERM or SIGINT (a
host restart, a release, `docker stop`) interrupts it instead of stopping it (design
`docs/plans/live-continuous-operation-design-20261110.zh.md` §3.4): working entries get their cancels, positions and
their exchange stops stay, and the runner records `interrupted` and exits 3. An armed run whose latest start ended
with no ending event (`clean_stop`, `reconciled_flat`, `venue_flat`, `reconcile_stopped`, `unresolved`) and no
`STOP` file, so also a killed runner, is started again as itself by the paired control, with the credential it was
started with, from the same native cache; at most four run launches an hour (the first start and three restarts),
then the control records `restart_limited` once and the user decides. A runner that ends by its own refusal or
failure is not interrupted, and its run is over: once armed, every such exit of a `run` records `unresolved` (with
the refusal's `code`), whether the final account read after a completed native exit failed or was not flat, a start
again found no native cache or changed account modes, or anything else raised; and the control never starts again a
runner that exited with status 1 or 2, even where it could write no event. Two refusals give the start back
instead, before anything is built or written: a start again whose first account read fails
(`LIVE_ACCOUNT_UNAVAILABLE`, after the bounded retries of `engine.live_venue.READ_ATTEMPTS`), or whose read shows this clock outside the limits (`LIVE_CLOCK`; the limits are
unchanged), exits 3 with no event, and the control starts the run again within the same hourly limit (finding
20261114-23, the user 2026-11-15). Both pass by themselves, a host clock that steps aside included, and the account
may hold a position. While the clock stays outside the limits the run stays `interrupted`: nothing checks its
positions and stops, the control records `restart_limited` each time the hourly limit keeps it from starting the
run, and starts it again once the hour allows; `live logs` shows the refused start. A read with no usable server
time (`LIVE_ACCOUNT_RESPONSE`) ends the run. Every other start of an armed run is refused `LIVE_COLD_RESTART`. A
start again checks the clock and account modes: on a flat account it builds the source, warms up and trades (event
`resuming`); with anything open it holds (`resuming` with `held`): no source, no entries, the account read every 30
seconds, until the account is flat (its stops, or a close at Binance), when `venue_flat_while_held` ends that start
with exit 3 and the next one trades. A source cannot yet rebuild its state around an open position, so a held run
waits for that. STOP during a held start ends it as `reconcile` does. Each step is a Telegram notice.

A held start checks what protects the positions it inherited, and says so (`engine/live_connection.py`, finding
20261114-24, the user 2026-11-15). When the hold begins, when the node has connected and at each 30-second read, the
same account read is judged: on each side of each contract, the stops at Binance that close it (`STOP_MARKET`, `STOP`,
`TRAILING_STOP_MARKET`, conditional or regular; a take-profit is none) must hold at least the position's quantity,
`engine.protection`'s judgment on the venue's own rows. A change of the verdict is journalled with the read beside
it: `held_covered` (every position has its stops and no entry order is working; `holding` 0 when only orders keep
the account from flat), or `held_uncovered` with the `positions` short of stops, the `entries` (orders at Binance that
would open or add to a position) and `entries_kept`; an answer whose rows cannot be judged is `held_uncovered` with
`unreadable`, and a read that failed is read again. The held start also withdraws the entry orders it inherited: one
native cancel each through the run's registered identity (`entry_cancel_requested`, reason `held`; a request that
raises is `entry_cancel_failed`), repeated every 5 seconds while the order stays open. An entry order still at
Binance in a read begun after that (the cancel was lost or refused, or the native cache does not hold the order, so
nothing could be sent) is reported with `entries_kept`. The check tells; it does not act: a held start places no stop
and closes nothing, and the drawdown brake does not run while it holds. The Live page and Telegram say what the
latest check found, a position with no stop in its own words.

An order whose submission Binance's answer did not settle (the answer, its user-stream events and the queries for it
all lost) stays SUBMITTED: rc7 retains it (`SubmissionRecoveryPolicy.RETAIN_UNRESOLVED`) instead of judging it
rejected after its in-flight check of about 30 s, since Binance may hold or have filled it. From 10 s on the run asks
Binance for it natively every 10 s and closes entries as `unverified` until it is settled and two venue comparisons
agree; an order Binance holds or filled settles at its own state and fill as soon as a query is answered. One still
SUBMITTED after 120 s fails the run through the STOP path (`submission_unresolved`); Nautilus then ends the start
with the order unresolved, and the run is `unresolved`. While such an order is unsettled, rc7's position check may book
Binance's position as an EXTERNAL one; the run's own comparison then keeps entries closed and its stop ends
`unresolved` with the venue flat.

STOP disables opening decisions, cancels owned opening orders, repeating the cancel every 5 seconds while one
stays open (after a request with an unknown outcome, as a native cancel-all scoped to the order's side, because
native `cancel_order` sends nothing for a PENDING_CANCEL order; withheld while that side holds a reduce-only order
and a position is open, leaving the order unresolved), waits for their final states and closes owned
positions through Nautilus. Protective orders are
retained until flat. A clean stop requires the
completed native state and a fresh exchange observation to agree. Unknown outcomes retain the account
slot and private originals. `reconcile` reopens the same native cache and queries the venue without
constructing the trading source; it registers an inert native Strategy with the original identity
and HEDGING override before cache load, so an entry missing its first fill retains its original OMS.
It does not resume arbitrary strategy callbacks or issue trading commands. A verified flat
reconciliation can release custody for a new, explicitly started run. Native reconciliation never matches a close
made at Binance, which has no order this process knows: on a Hedge account the unmatched quantity becomes a separate
EXTERNAL position, and a cancelled stop stays accepted in the cache. So `reconcile` first reads the whole account, and
again when it ends: with no position on any symbol and no open or conditional order, it records `venue_flat` and
releases the slot without a native match. The next run starts from a fresh native identity, so the stale cache is
never reused; this run's native records may lack the close, and the account snapshot in its directory is the record.
A run whose runners are all proven exited without `armed.json` or a `connecting` event never constructed its
source, so it placed no order: the paired controller releases the slot and `status` reports `not_armed`. Its run-id cannot start again; use
a new one. A runner that is still alive, a missing container or an unknown launch keeps the slot.
A manifest's format (`live-run-5`) binds the checks to the runner: an older image refuses it before arming. 0.x
keeps no compatibility between versions: a run an earlier version prepared stays on disk under `runs/`, and no
listing, release check or operation reads it; only its runner container, while still running, keeps the account
(`live/inventory.py`). A run without a credential version is unknown ownership and blocks credential changes
(`LIVE_CREDENTIAL_BUSY`).
An ended run (`clean_stopped`, `reconciled_flat`, `venue_flat`, `not_armed`, or a finished preflight) gives up its containers and
network when the paired controller maintains it or another run starts: their logs go to `containers/` in the run directory,
where `logs` then reads them, and `lifecycle.jsonl` records the result for `status`. An unresolved run, or any runner
that has not exited, keeps everything `reconcile` needs. After a removal `reconcile` is refused; a run that only
preflighted may still `start` and gets a new network and egress.
Reconciliation accepts the retained account modes without requiring positive funds or an empty account.
Native Multi-assets cached balances can differ from reported balances after zero updates or margin
initialization. They are not the authority for entry cash or a claim of full collateral accounting.

## Evidence pack

Each Live run keeps what a replay of its source needs for comparison in `evidence/` of its private output
(`engine/live_evidence.py`), never the ledger:

- `market.jsonl`, the market rows Paper journals (`engine.realtime.MarketRows`): every one-minute bar the source
  received (`bar`; an aggregation is built from them and not kept), per contract and period the digest of each
  history its warm-up delivered (`warmup`: `bars`, `first_ts_event`, `last_ts_event`, `sha256`; period `FUNDING` for
  the funding settlements), Binance's time for each closed kline and its side connection's state (`kline_event`,
  `kline_socket`), each metrics row it received (`metrics`: `ts_event` and the four values, a missing ratio null; it
  reached the source at `ts_event + 5 min`), and each unsubscribe from a contract's metrics it followed
  (`metrics_unsubscribed`: `instrument_id`). What arrives after a stop request reaches neither the source nor the
  file. Quotes, trades, MARKs and funding rates are not kept: `live compare` settles funding at Binance's published
  rates, and compares the metrics rows with the archive's as a replay streams them, expecting none from an
  unsubscribe's `wall_ns` until the source receives one again. Values must be equal, except a position ratio the
  archive holds exactly at the midpoint of the 4th decimal, which may also be 0.0001 below the replay's.
- `reports-<ns>/`, written when the node stops in `run` and `reconcile`: `orders.csv`, `fills.csv`,
  `positions.csv`, `account.csv` and `order_events.jsonl.gz` from the native cache, through the same writers a
  replay uses (`engine.write_reports`).
  A reconciliation resumes the run's cache, so its reports cover the whole run; `account.csv` does too for a node that
  ran under an hour, and otherwise holds the last day of account states (the native purge above).

The account, its settings, the wallet and Binance's instrument terms and commission at start are the
`preflight-*.json` and `connected-account-*.json` observations beside it. Recording never changes the run: a failed
write journals `evidence_unavailable` once per part and the run goes on.

## Unresolved Live runs

`status` says `unresolved` when a run ended without proof that the account is flat: a failed check, a
rejected or failed close, a runner that failed or refused (exit status 1 or 2, with or without an `unresolved`
event), or a `reconcile` stopped before flat. A killed or interrupted
runner is not unresolved: the control starts it again. A position may remain at Binance,
with or without its stop, and nothing will close it. When Telegram notifications are set up on the Live page,
the paired control sends a message within about ten seconds of seeing the run unresolved, but only from its
retained records and with no delivery guarantee: someone must still watch `status` for the whole of a real run and
act at once. `stop_reason` and `live logs` say what happened.

1. If `status` says `running`, stop it (Stop on the Live page, or `live stop`) and wait until it no longer does.
2. At Binance, on the same account, close the position and cancel every open and conditional order, including the
   run's stops. Release needs the whole account flat: any other position or order keeps the slot.
3. Reconcile the account on the Live page (Reconcile account…). On a flat account it ends at once and `status` says
   `venue_flat`, with the slot released. If it finds anything open it observes without trading until the run's
   duration or a `live stop` (after any `live stop` of this run, at once), checks the account again and ends
   `unresolved`: act at Binance and reconcile again.

A run that is flat but failed (exit code 1) takes step 3 alone.

Use one fixed private root for the configured account. The local lock cannot exclude manual trading or
another host. Keep its inputs, native cache, logs and lifecycle originals together; a dead container is
not evidence of a flat account. See [the implementation and storage decision](../docs/plans/binance-live.zh.md).
