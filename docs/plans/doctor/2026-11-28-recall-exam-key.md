# Answer key: product-doctor recall exam (tree 3f10104a1, 2026-11-24 18:18 UTC)

Legend: core=true counts toward recall; core=false is adjacent (credit if found, no miss, never a false positive). needs: static / local-probe / runtime-host. Unconfirmed items are neutral.

## A: report/ package

### Positive

- **#3679** (core; wrong result; local-probe; fix PR: 3747)
  - Defect: dev_quarters builds its 2-year cutoff as start.replace(year+2, day=min(start.day, 28)), so a window starting on day 29-31 (e.g. 2024-01-30..2026-01-29, <2 whole years, 8 valid quarters) is judged >=2 years and gets no quarterly split (None).
  - Where: `report/splits.py:dev_quarters (line 116)`
  - Verified by: Claude triage 11-25 verified (run); merged fix
- **#3681** (core; wrong result; local-probe; fix PR: 3749)
  - Defect: research_graph's comparison job tests research[-1]['status']=='passed' instead of the last trial with a run, so a passed research run followed by an open/killed retry trial (status None) drops the version's comparison and tested predictions from the graph (and gives the open trial's registration).
  - Where: `report/graph.py:research_graph (job selection, lines 504-505; contrast ran at 510)`
  - Verified by: Claude triage 11-25 verified (run, throwaway ledger); merged fix
  - Note: Issue's other half (/api/view wipes reading) lives in ide/research_graph/layout.py; credit either half only if it names the open-retry trigger.
- **#3761** (core; wrong result; local-probe; fix PR: 3792)
  - Defect: _control_reproduces treats a control history trial with status None (interrupted, no run row) as a fingerprint mismatch, so line_history reports control_reproduces=False and summary=None instead of None with 'control' in summary['missing'].
  - Where: `report/history.py:_control_reproduces / line_history`
  - Verified by: Gemini recheck+refuter 11-26 confirmed; merged fix; Claude triage 11-28 closed
- **#3790** (core; wrong result; local-probe; fix PR: 3796)
  - Defect: unchanged_since/_changed treats an added research_registration only as read through a trial, so a new retry registration (retry_of set) on the line - which lifts INTERPRETATION_REQUIRED in the line's gates - is answered 'unchanged' and the cached graph keeps the stale gate.
  - Where: `report/graph.py:_changed / unchanged_since`
  - Verified by: merged fix with Dolt test failing before; Claude triage 11-28
- **#3760** (core; wrong result; local-probe; fix PR: none merged)
  - Defect: _whole_year requires trade_start == veto-year start exactly, so any non-zero warm-up makes the sole reserved veto year (VETO_RESERVE, coverage 16..24 quarters) a non-whole year; _veto/_summary then judge on holdout alone and a candidate that blew up in its veto year passes require_unfalsified.
  - Where: `report/history.py:_whole_year (line 89) -> _veto/_summary; with ledger/lines.py history_plan`
  - Verified by: Gemini recheck+independent refuter 11-26 confirmed (no Claude triage); fix only on unmerged branch exp/fix-line-coverage-veto
- **#3759** (adjacent; wrong result; local-probe; fix PR: none merged)
  - Defect: line history/line select plan veto segments from the market's first_day instead of the line's effective coverage (--metrics, --execution quotes, late-listed symbols, pool first month), so veto runs before the data exists fail (e.g. METRICS_MISSING) and candidates stay HISTORY_UNDECIDED.
  - Where: `ledger/lines.py:history_plan/development_period/select_line; reached via report/history.py:market_days/line_history (uses source.days first_day)`
  - Verified by: Gemini recheck+refuter 11-26 confirmed; cost observed on line 3; fix only on unmerged branch
  - Note: Mostly in ledger/lines.py; report/history passes the global first_day.
- **#3680** (adjacent; wrong result; local-probe; fix PR: 3748)
  - Defect: IDE /api/view filters recommendation judgments on e['recommends'] in row, so a later retraction (recommendation with no recommended subject) is dropped and the retracted version still shows as recommended.
  - Where: `ide/research_graph/layout.py:build_view (input from report/graph.py:_document)`
  - Verified by: Claude triage 11-25 verified (run); merged fix in ide only
- **#3708-1** (adjacent; refusal gap; local-probe; fix PR: 3755)
  - Defect: replay report --directory always resolves the research ledger profile (_research(args)) and refuses LEDGER_UNKNOWN with no profile, contradicting its help 'reads no ledger'.
  - Where: `cli/replay_commands.py:_replay_report`
  - Verified by: Claude triage 11-25 verified in part (run); merged fix in cli only

### Negative (reporting these as defects counts against)

- **#3677**: deflated_sharpe raises ZeroDivisionError on a constant nonzero return series (float mean residual bypasses spread==0). Rejected: Arithmetic reproduces but triage: no real case reaches it (native USDT daily returns are never float-identical nonzero every day; a non-trading run gives zeros, already None). Not worth its code; closed not planned.
- **#3678**: derive_measures crashes (log1p domain error) on a -1.0 wipeout daily return. Rejected: Not reproduced, guarded upstream: ledger.metrics.daily_returns rejects a <= -1 return (RETURN_SERIES_INVALID), so economic evidence is absent and every caller asking a log measure requires it first; the probe called derive_measures directly. Closed not planned.
- **#3708-2**: research history eagerly resolves the market profile on an empty ledger, contradicting its help. Rejected: By design (triage): the help speaks of reading the market's days, which are not read; resolving the named/active profile is what every --market command does. (Lives in cli/research_commands.py.)

### Unconfirmed (neutral)

- none

## B: paper/ package (serve, runs, compare, recovery, release)

### Positive

- **#3689** (core; runtime-recovery; local-probe; fix PR: 3741)
  - Defect: Daemon.compare marks comparing[paper_id]='comparing' before root.mkdir with no rollback, so an OSError (ENOSPC/permission) there leaves the run answering 'comparing' until paper serve restarts; the worker likewise lets an OSError from the command skip 'failed'.
  - Where: `paper/serve.py:Daemon.compare / compared (lines 446-493)`
  - Verified by: Claude triage 11-25 verified (run); merged fix
- **#3690** (core; runtime-recovery; local-probe; fix PR: 3741)
  - Defect: seal_ended loops with no outer handler and seal_found catches only Refusal/Failure, so one subprocess.TimeoutExpired or OSError from cli kills the sealing/recovery thread for good while /api/paper/health still answers 200.
  - Where: `paper/serve.py:Daemon.seal_ended / seal_found (lines 495-555)`
  - Verified by: Claude triage 11-25 verified (run); merged fix
- **#3697** (core; refusal gap; static; fix PR: 3803)
  - Defect: The Paper POST handler parses int(Content-Length or 0) without refusing a negative value, so Content-Length: -1 passes length > limit and rfile.read(-1) reads to EOF, bypassing the 64 KiB body cap (non-numeric is already 400 in Paper).
  - Where: `paper/serve.py:Handler do_POST body read (line ~708)`
  - Verified by: Claude triage 11-25 verified by code chain; merged fix
  - Note: Same defect in ide/research_graph/serve.py and ledger/first_run.py (those also crash on non-numeric).
- **#3789** (core; runtime-recovery; local-probe; fix PR: 3795)
  - Defect: runs.resume reads inputs/universe.json and inputs/strategy.py with no guard, so a missing/unreadable input raises a bare FileNotFoundError/OSError traceback instead of the PAPER_RECOVERY_UNAVAILABLE refusal every other missing input gets.
  - Where: `paper/runs.py:resume (lines 428-429)`
  - Verified by: merged fix with failing test before; Claude triage 11-28
- **#3717** (adjacent; wrong result; local-probe; fix PR: none merged)
  - Defect: Paper's Sandbox account books no funding (only a funding_settlement journal row), so after a settlement with a position held usdt_equity differs from the replay's and equity-sized entries differ by contract steps, which paper compare flags as orders_differ.
  - Where: `engine/paper.py:Recorder.on_funding_rate (journal only, line 756); reached through paper/compare.py`
  - Verified by: Claude triage 11-25 premise verified by code chain (authority, needs evidence); off-node arithmetic later showed 4 steps; open, no fix (Nautilus Sandbox has no funding hook)
- **#3660** (adjacent; wrong result; static; fix PR: none merged)
  - Defect: live compare's parts() gives no 'taken', so replay.rerun loads no archived_marks and Live's price-precision mark rounding equity deltas are labelled 'unexplained' where paper compare attributes them as 'mark_rounding'.
  - Where: `live/compare.py:parts (paper/compare.py is the correct counterpart)`
  - Verified by: Claude triage 11-25 verified by code chain; open (authority); fix branch unmerged
- **#3666** (adjacent; runtime-recovery; local-probe; fix PR: 3724)
  - Defect: live reconcile's compare_one returns retry for every Refusal from paper.compare, including the permanent PAPER_COMPARE_EMPTY of a sealed run, so it relaunches a comparison container hourly forever.
  - Where: `live/reconcile.py:compare_one / Reconciliation.answer`
  - Verified by: merged fix

### Negative (reporting these as defects counts against)

- **#3667**: Reusing a --op-id from a --symbols run with --universe pool replays instead of refusing OP_ID_CONFLICT. Rejected: Triage verified the behaviour but declined: the proposed remedy is wrong (a pool start stores resolved members, so it would refuse every legitimate pool retry); a correct check needs a new stored scope field for a client error the product's own IDE never makes (one UUID per candidate+scope); the reply names the run and contracts. Not worth its code. Borderline: an unmerged exp branch later 'fixed' it; issue still open.
- **#3668**: Daemon.start accepts both symbols and universe='pool' and silently drops symbols. Rejected: Triage verified the behaviour but recommended decline: the only client cannot send both (PaperDialogs sends one), route is loopback same-origin, the CLI has the exclusive group. Not worth its code (bundle at most). Fix only on an unmerged exp branch; issue open.

### Unconfirmed (neutral)

- **#3782**: Paper runner OOM-killed at 384 MiB on a 6-contract production run; paper/runs.py RUNNER_BASE_MIB=256/PER_CONTRACT=16 under-sized (calibrated on arm64 macOS only). Where: `paper/runs.py:runner_memory constants; engine/paper.py CacheConfig`. Needs runtime-host. Status: open, production evidence only, no triage; fix on unmerged branch exp/fix-3782-paper-oom

## C: engine/paper.py, engine/paper_terms.py, engine/paper_session.py and what they share with Live

### Positive

- **#3657** (core; wrong result; local-probe; fix PR: 3737)
  - Defect: Paper (and Live) attach one Cadence per strategy instance instead of per contract, so in a multi-contract instance subscribing to another contract's MARK/funding, only the first MARK of a minute of any contract passes and the second contract's funding after a shared settlement is dropped, unlike the replay.
  - Where: `engine/paper.py:_PaperConfigured.__init__ (_paper_cadence = Cadence(), line 329) + Cadence.wrap (line 541); engine/live_source.py _live_cadence; engine/cadence.py`
  - Verified by: Claude triage 11-25 verified; merged fix
- **#3658** (core; wrong result; local-probe; fix PR: 3801)
  - Defect: Paper runs the order rules when a waiting entry is released after its terms read, while the GTD lead rule counts 605 s from submit; an entry with expire_time at the lead boundary (cancelled while waiting or not) fails expire_time - now < GTD_LEAD_NS at release, raising ORDER_RULE and stopping the run instead of CANCELED/sent as in replay.
  - Where: `engine/paper_terms.py:Waiting._send_waiting/_end_waiting + engine/order_rules.py:violation (line 133)`
  - Verified by: Claude triage 11-25 verified by running; Gemini recheck confirmed; fix PR 3801 open (not merged at key time)
- **#3659** (core; wrong result; local-probe; fix PR: 3738)
  - Defect: Waiting does not override OrderRules._foreign, so cancel_order/cancel_orders of another instance's entry still waiting in paper_terms.QUEUE falls through to Strategy.cancel_order and raises RuntimeError ('order not found in cache') instead of ORDER_RULE as in replay and Live.
  - Where: `engine/paper_terms.py:Waiting (no _foreign); engine/order_rules.py:_foreign`
  - Verified by: Claude triage 11-25 verified by running; merged fix
- **#3674** (core; refusal gap; local-probe; fix PR: 3807)
  - Defect: Paper's per-entry terms check (paper_terms.entry over klines.terms) compares only filter numbers and never status/contractType/marginAsset, so entries on SETTLING or PENDING_TRADING perpetuals are sent (filled at a frozen price) where Live's require_admission refuses LIVE_INSTRUMENT.
  - Where: `engine/paper_terms.py:entry + engine/klines.py:terms`
  - Verified by: Claude triage 11-25 verified by running against public exchangeInfo; merged fix
  - Note: Probe needs Binance public exchangeInfo (network), no credential.
- **#3640** (core; runtime-recovery; local-probe; fix PR: 3651)
  - Defect: A recovering source's market_exit() before the back-fill/admission ends passes Session.commanded(close=True) (refused/handing still None); if the recovery is then refused, Nautilus's native exit timer keeps sending MARKET closes past the Paper overrides until the node stops, contrary to 'once the recovery is refused, nothing more is sent'.
  - Where: `engine/paper.py:_PaperConfigured.market_exit (line 371) + engine/paper_session.py:Session.commanded/submitted`
  - Verified by: owner-authorized; reproduced on Paper LiveNode loopback (17 orders after refusal); fix 3651 merged 18:32, after the tree
  - Note: #3650 is the same mechanism via restore_source/history callbacks with Session.since empty (open, verified by code chain + Gemini probe); a finding naming either trigger matches this entry.
- **#3717** (core; wrong result; local-probe; fix PR: none merged)
  - Defect: Paper's Sandbox account books no funding (only the recorder's funding_settlement journal row), so after a settlement with a position held usdt_equity (and equity-sized entries) differ from the replay's by contract steps.
  - Where: `engine/paper.py:Recorder.on_funding_rate (line 756); engine/order_rules.py:usdt_equity`
  - Verified by: Claude triage 11-25 premise verified by code chain (authority; cost unmeasured on node); open; no native fix in rc7 Sandbox
- **#3793** (adjacent; refusal gap; static; fix PR: none merged)
  - Defect: engine.load.source_findings admits a source calling super().submit_order or Strategy.submit_order(self, ...); since the composed classes put OrderRules (and Paper's membership/session/terms overrides) before the source in the MRO, such a call reaches Strategy.submit_order past every order rule.
  - Where: `engine/load.py:source_findings; composition in engine/paper.py (_PaperConfigured, source), engine/run.py, engine/live_source.py`
  - Verified by: Claude triage 11-28 verified (MRO probe); open
- **#3661** (adjacent; wrong result; static; fix PR: 3735)
  - Defect: Live's market_exit cancels unsent entries unconditionally, so a market_exit on a strategy already exiting or not running (ignored by Nautilus) still cancels its waiting MARKET_EXIT-tagged entry; Paper's Waiting.market_exit guards with is_running and not is_exiting.
  - Where: `engine/live_source.py:_LiveConfigured.market_exit (lines 190-193)`
  - Verified by: Claude triage 11-25 verified; merged fix

### Negative (reporting these as defects counts against)

- none

### Unconfirmed (neutral)

- **#3783**: A Paper strategy subscribing to Metrics sets _paper_subscription_changes in _metrics_follow from on_start, so Session.cut defers every checkpoint and a crash cannot auto-resume (PAPER_RECOVERY_UNAVAILABLE). Where: `engine/paper.py:_metrics_follow (line 383, commented as deliberate: 'a recovery restores no metrics subscription'); engine/paper_session.py:cut`. Needs runtime-host (observed in production logs). Status: open; no triage; fix only on an unmerged branch; the code comment shows the deferral was intended, so whether it is a defect or an unsupported case is undecided
- **#3782**: Paper runner OOM at 384 MiB (Nautilus default tick_capacity per instrument plus under-sized memory formula). Where: `engine/paper.py CacheConfig; paper/runs.py runner_memory`. Needs runtime-host. Status: open; production evidence only; no triage

## Excluded candidates

- #3652: CapitalObserver exposure timing lives in engine/run.py (replay/quotes execution), not in report/, paper/ or the Paper runner.
- #3687: dolt_backup wedge lives in ledger/admin.py; Paper's _back_up_paper in ledger/service.py only calls it.
- #3672: generation.json phase lives in deploy/release.py, not paper/release.py.
- #3650: folded into C/3640 (same mechanism at 3f10104a1, residual after #3651).
- #[3587, 3617, 3621, 3622, 3625, 3626]: fixed by PRs merged before 3f10104a1 (3632, 3636, 3643, 3645, 3648, 3644 are ancestors of the tree).

## D: market/ package (sources, follow, lifecycle, quotes, files)

### Positive

- **#3688** (core; wrong result; local-probe; fix PR: 3728)
  - Defect: market/follow.py _republished returns True at the first uncached daily archive of a hole month, so sources.republished/forget never runs for the later cached days; when Binance publishes the missing day and republishes a later cached day (e.g. the month's last day cached as the next month's eve) together, the stale copy of that later day stays and is imported.
  - Where: `market/follow.py:_republished (line 233, early return on found is None); market/sources.py republished/forget`
  - Verified by: Claude triage 11-25 verified (file:line chain; failing test with the PR); merged fix
- **#3701** (core; refusal gap; local-probe; fix PR: 3730)
  - Defect: validate_lifecycle sorts episodes by (symbol, start_ns) before checking that start_ns is an int, so two episodes of one symbol mixing str and int start_ns raise an uncaught TypeError instead of the LIFECYCLE_INPUT refusal a single bad episode gets.
  - Where: `market/lifecycle.py:validate_lifecycle (sort before the type check, lines 89-97)`
  - Verified by: Claude triage 11-25 verified by running; merged fix
- **#3705** (core; design-entropy; local-probe; fix PR: 3731)
  - Defect: Four refusals in validate_lifecycle ('..' in a bundle source path, reuse of a terminated instrument_id, decreasing ts_event, events after termination) have no test: deleting all four still passes tests/market/test_store.py.
  - Where: `market/lifecycle.py:validate_lifecycle (lines 100, 102, 113, 115); tests/market/test_store.py`
  - Verified by: Claude triage 11-25 verified; merged tests-only fix
  - Note: Missing-test item; triage treated it as a defect.
- **#3692** (adjacent; wrong result; local-probe; fix PR: 3729)
  - Defect: IDE /api/market-import judges staleness by now - status['at'] only, ignoring running_since, so during a long daily round (from about 02:30 UTC until it ends) the page says 'no round for N h' / stale while market.follow.check() (the healthcheck) counts the running round fresh.
  - Where: `ide/research_graph/serve.py:market_import (line 703); contrast market/follow.py:check (line 572)`
  - Verified by: Claude triage 11-25 verified (chain; failing test with PR); merged fix in ide only
  - Note: Defect lies in the IDE; reached through the market import status. The issue's other half (a stuck running_since reported fresh) was judged unreachable.

### Negative (reporting these as defects counts against)

- **#3673**: Binance -1122 on a PENDING_TRADING symbol becomes SOURCE_SHAPE and stops market import / market.follow. Rejected: Not reproduced: stitch_series asks REST klines only for a trading or resumed contract or an edge of held minutes; a PENDING_TRADING contract with no LAST archive imports LAST 0 rows with no refusal. Only a hand-set resumed=True refuses, a state such a contract cannot be in. Closed not planned.
- **#3696**: market.follow check() reports healthy on the initial status before any import round completes (masking a crash loop). Rejected: By design: a round in progress is fresh for 26 h by an owner-delegated decision (2026-11-21); the first round is such a round; OOM kills and restart counts are separate notices (deploy/notices.py). Closed not planned.
- **#3700**: market/quotes.py can emit a zero or negative bid when a buyer-taker trade is at a price <= one tick. Rejected: Arithmetic reproduces but nothing wrong can be stored: files.write_file checks bid > 0 and ask > bid and refuses the month CHECK_FAILED; no listed contract is near one tick (lowest 504 ticks). Not worth its code (borderline); closed not planned.
- **#3702**: validate_lifecycle lets two different symbols claim the same active instrument_id, producing conflicting Catalog events. Rejected: The manifest is accepted (reproduced) but no conflicting Catalog events are possible: market.export.split_episodes requires each episode's id to be the symbol's own native id and refuses EPISODE_SHAPE before anything is written. Recommendation: do not add the check. Closed not planned (borderline: acceptance reproduced, harm not).
- **#3506**: A contract cannot be added to market months already imported (MONTH_EXISTS / UNIVERSE_CHANGED). Rejected: Refusal reproduced but intended: no backfill design is both small and safe for sealed runs without a stored field or a write to the active directory; an isolated market directory covers the need. Closed not planned on the owner's word (by design / not worth its code).

### Unconfirmed (neutral)

- none

## E: Live engine runner engine/live*.py and the live/ package (launch, entry gate, stop, reconcile, recovery), offline

### Positive

- **#3653** (core; wrong result; local-probe; fix PR: 3732)
  - Defect: close_held marks a position a phantom as soon as Binance holds less than the native quantity, even when it has just submitted a reduce-only close for what Binance still holds; Observer.observe then sees every position as phantom and in the same tick ends the STOP venue_flat (no pending order) while Binance holds the remainder, or on the next tick cancels its own just-sent close.
  - Where: `engine/live_lifecycle.py:close_held (line 314) + Observer.observe (lines 248-261); engine/live_connection.py venue_flat_exit`
  - Verified by: Claude triage 11-25 verified; merged fix
- **#3727** (core; refusal gap; local-probe; fix PR: 3800)
  - Defect: A STOP that ends with only phantom quantities journals venue_flat with venue_flat_exit(session, session.stop_read), i.e. the account read taken before the closes, and engine.live.start returns on session.venue_flat without a final read or require_flat; with a close rejected/expired and a late fill, the run is released venue_flat (account slot freed) while Binance still holds a position.
  - Where: `engine/live_lifecycle.py:Observer.observe (line 257) + engine/live.py:start (venue_flat return, ~348-351)`
  - Verified by: Found in the review of #3653's fix (Claude, 11-25); Gemini recheck+refuter 11-26 confirmed; merged fix; Claude triage 11-28 closed
  - Note: Present at the tree (same on main before #3653's fix).
- **#3654** (core; runtime-recovery; local-probe; fix PR: 3733)
  - Defect: engine.live.start's failure epilogue checks session.mode in ('run','finish') only, so a resumed run in held mode that fails (lose_connection, check_storage, observer failure) falls through to the reconcile epilogue: another account read, reconcile_stopped journalled after unresolved, exit 0 instead of 1.
  - Where: `engine/live.py:start (line 358)`
  - Verified by: Claude triage 11-25 verified (remedy corrected: an operator STOP of a held start must still end as reconcile does); merged fix
- **#3655** (core; wrong result; local-probe; fix PR: 3734)
  - Defect: live.runs.stop_reason skips only 'rewarming' among stopping events, while 'interrupted' and 'held_flat' are passing stops the control restarts too, so a run interrupted once and later stopped for drawdown/requested reports stop_reason 'interrupted' for ever.
  - Where: `live/runs.py:stop_reason (lines 710-718); engine/live_stop.py PASSING`
  - Verified by: Claude triage 11-25 verified (reproduced on the status test's journal); merged fix
- **#3671** (core; runtime-recovery; local-probe; fix PR: 3739)
  - Defect: _network creates the egress in two non-atomic Docker steps (docker run on the private network, then network connect bridge, then journal egress_created); interrupted between them, every later launch's container_identity requires 'bridge' and raises LIVE_IDENTITY_CHANGED for ever.
  - Where: `live/runs.py:_network (lines 590-603) + live/host.py:container_identity`
  - Verified by: Claude triage 11-25 verified by running (fake Docker; Docker 29.1.3 probe); merged fix
- **#3666** (core; runtime-recovery; local-probe; fix PR: 3724)
  - Defect: live reconcile's compare_one returns retry for every Refusal from paper.compare, including the permanent PAPER_COMPARE_EMPTY of a sealed run, so it relaunches a comparison container hourly forever.
  - Where: `live/reconcile.py:compare_one (line 95) / Reconciliation.answer`
  - Verified by: merged fix (also B adjacent)
- **#3660** (core; wrong result; static; fix PR: none merged)
  - Defect: live compare's parts() gives no 'taken', so replay.rerun loads no archived_marks and Live's price-precision mark-rounding equity deltas are labelled 'unexplained' where paper compare attributes them as 'mark_rounding'.
  - Where: `live/compare.py:parts (line 228); paper/compare.py is the correct counterpart`
  - Verified by: Claude triage 11-25 verified by code chain; open (authority); fix branch unmerged
- **#3661** (core; wrong result; static; fix PR: 3735)
  - Defect: Live's market_exit cancels unsent (waiting) entries unconditionally, so a market_exit on a strategy already exiting or not running (ignored by Nautilus) still cancels its waiting MARKET_EXIT-tagged entry; Paper's Waiting.market_exit guards with is_running and not is_exiting.
  - Where: `engine/live_source.py:_LiveConfigured.market_exit (lines 190-193)`
  - Verified by: Claude triage 11-25 verified; merged fix
- **#3657** (core; wrong result; local-probe; fix PR: 3737)
  - Defect: Live (like Paper) attaches one Cadence per strategy instance (_live_cadence) instead of per contract, so in a multi-contract instance only the first MARK of a minute of any contract passes and another contract's funding after a shared settlement is dropped, unlike the replay.
  - Where: `engine/live_source.py:_LiveConfigured.__init__ (_live_cadence = Cadence(), line 68) + Cadence.wrap (line 356); engine/cadence.py`
  - Verified by: Claude triage 11-25 verified; merged fix (Paper and Live)
  - Note: Same entry as C/3657; credit the Live half here.
- **#3788** (core; wrong result; static; fix PR: 3794)
  - Defect: live/notify.py _active compares minute_results' minute_ns with type(ns) is int, but live/views.py _minute_results emits minute_ns as a string (_integer returns str), so a day on which a run only produced minute results (no fill, restart or end) gets no daily summary.
  - Where: `live/notify.py:_active (line 518-528); live/views.py:_minute_results/_integer`
  - Verified by: Fix-session finding 11-27 (test fails with the view's real shape); merged fix; Claude triage 11-28 closed
- **#3703-1** (core; design-entropy; static; fix PR: 3745)
  - Defect: live.control and live.notify import each other (notify.collect imports control only for run_view(..., review=False)), a circular import outside the kept-cycles table.
  - Where: `live/notify.py (line 189) <-> live/control.py (line 16)`
  - Verified by: Claude triage 11-25 verified, fixed 2 of 3 cycles; merged fix
  - Note: The engine.live_* cycle part was declined (see negatives); format.ts<->time.ts is under H.
- **#3793** (adjacent; refusal gap; static; fix PR: none merged)
  - Defect: engine.load.source_findings admits a source calling super().submit_order or Strategy.submit_order(self, ...); since the composed Live class puts OrderRules (and the Live gate overrides) before the source in the MRO, such a call reaches Strategy.submit_order past every order rule.
  - Where: `engine/load.py:source_findings; composition in engine/live_source.py (and engine/paper.py, engine/run.py)`
  - Verified by: Claude triage 11-28 verified (MRO probe); open
  - Note: Same as C/3793 adjacent.
- **#3542** (adjacent; wrong result; local-probe; fix PR: 3718)
  - Defect: Entries sized from portfolio equity read the latest cached MARK and same-minute fills at a different instant in Paper than in the replay, so with positions open the sizes differ by contract steps; replay/comparison compares quantity exactly with no cause for this, and live/reconcile raises LIVE_PAPER_UNRECONCILED for a faithful Paper run (measured: 119 of 155 entries differ).
  - Where: `live/reconcile.py unreconciled + replay/comparison.py _row/CAUSES; remedy in the strategy scaffold equity helper (cli scaffold)`
  - Verified by: Claude triage 11-24 verified; measured on isolated Paper runs; fix merged 11-24 22:12 (after the tree)
  - Note: Adjacent: the refusal is Live's gate; the remedy was a deterministic equity in the scaffold, not a gate change.
- **#3704** (adjacent; design-entropy; static; fix PR: 3746)
  - Defect: All 7 Redis-restart Live loopback tests skip in CI (quality.yml has no /opt/trade/redis; check-native-runtime.py in the runtime image discovers only tests/engine), and runtime-image.yml's path filter omits tests/engine/**, so the Live restart recovery tests never run.
  - Where: `tests/live_loopback/*, .github/scripts/check-native-runtime.py, .github/workflows/runtime-image.yml`
  - Verified by: Claude triage 11-25 verified the gap (proposed remedy did not work as written); merged CI fix
  - Note: CI coverage of Live tests; adjacent.

### Negative (reporting these as defects counts against)

- **#3703-3**: engine.live_brake/commands/connection/session form a 4-module import cycle (7 function-local imports) that should be broken. Rejected: Declined in triage: no trigger or wrong result (cost none); all edges are frozen in CYCLE_EDGES so none can be added unseen; splitting moves shared state of a real-money runner and fixes no defect. Not worth its code.
- **#3698**: runtime/container.py live_command checks the credential mount target before normalization, so /run/secrets/./binance.json mounts the Binance credential into the egress container. Rejected: Reproduced by running but unreachable: the only callers (live/host.py egress_command, runner_command) pass constant targets and the egress mounts only /reports; container_identity re-verifies mounts. Closed not planned (borderline: not worth its code).
- **#3699**: runtime/container.py lets a symlink to a comma-containing path inject --mount options and accepts --cpus 0.0 (unlimited). Rejected: Reproduced, no cost: Docker refuses the injected mount before starting anything; the only --cpus value passed is the constant RUNNER_CPUS '0.5'. Closed not planned (borderline). Lives in runtime/, shared by replay, Paper and Live.

### Unconfirmed (neutral)

- **#3508**: Fills rc7 does not merge leave a phantom position in the cache during a Live run (stop fired while the user stream is silent, or a filtered external close). Where: `engine/live_lifecycle.py / Nautilus rc7 position cache`. Needs runtime-host. Status: open; needs the owner's controlled real-account trial (checklist items 12-13); defences #3058/#3374 merged; confirmed only on the fake exchange loopback
- **#3509**: An unknown Live cancel outcome is decided locally by rc7 after about 30 s while the order may still be open; request weight and 429s on the real account unobserved. Where: `engine/live_connection.py / Nautilus rc7 execution client`. Needs runtime-host. Status: open; needs the owner's real-account trial; no triage verdict

## F: research commands' admission: registration/, ledger/judgments.py, cli/ research and replay handlers

### Positive

- **#3676** (core; refusal gap; local-probe; fix PR: 3799)
  - Defect: require_precheck only checks reviews of the cited precheck trial, so a source whose causal (or api/readiness) review failed on precheck trial 1 is admitted by citing a passed review of a second precheck trial, though those failures are source properties that never resolve (select_line refuses START_REVIEW_REQUIRED for the same source).
  - Where: `registration/precheck.py:require_precheck (line 141, same-trial filter ~168-173); contrast ledger/review_activity.py:resolved`
  - Verified by: Claude triage 11-25 verified (throwaway ledger); merged fix; Claude triage 11-28 closed
- **#3663** (core; refusal gap; local-probe; fix PR: 3797)
  - Defect: add_judgment never checks that the body is non-blank, so an empty or whitespace-only interpretation/recommendation/priority (e.g. an empty --body file) is accepted for ever in the append-only ledger and satisfies INTERPRETATION_REQUIRED / resets REVIEW_DUE; every sibling writer refuses blank prose.
  - Where: `ledger/judgments.py:add_judgment (line 98); cli/research_commands.py judgment add`
  - Verified by: Claude triage 11-25 verified (throwaway ledger); merged fix; triage 11-28 closed
- **#3669** (core; refusal gap; local-probe; fix PR: 3798)
  - Defect: runner_inputs never parses --universe while container_runner_args strips it, so --universe bogus silently becomes the full pool ({'universe': True}) and is locked into the registration, and --symbols A --universe pool silently drops the pool.
  - Where: `registration/runner.py:runner_inputs (lines 71-92) + container_runner_args (ENTRY_OPTIONS, line 24)`
  - Verified by: Claude triage 11-25 verified; merged fix; triage 11-28 closed
- **#3791** (core; refusal gap; local-probe; fix PR: none merged)
  - Defect: _RunnerParser keeps argparse prefix matching, so runner_inputs reads an abbreviated option (--sym A as --symbols, --lifecycle as --lifecycle-bundle) while container_runner_args strips only exact ENTRY_OPTIONS and the engine parser has allow_abbrev=False: the registration is accepted and fixed, and its replay always fails UNKNOWN_OPTION.
  - Where: `registration/runner.py:runner_inputs (_RunnerParser(add_help=False), line 73) + container_runner_args; engine/config.py build_parser allow_abbrev=False`
  - Verified by: Claude triage 11-28 verified on 651c8767d; open, fix planned
  - Note: At the tree --universe is not parsed at all (#3669), so the trigger there is --sym / --lifecycle abbreviations.
- **#3714** (core; refusal gap; local-probe; fix PR: 3726)
  - Defect: runner_inputs calls clock.utc on --start/--trade-start/--end without catching ValueError, so a malformed date crashes cli.main with a raw traceback instead of WINDOW_INVALID; and _RunnerParser.error blames missing=('--start','--end') with no expected on every runner parse error.
  - Where: `registration/runner.py:runner_inputs (lines 87-88) + _RunnerParser.error (lines 66-68)`
  - Verified by: Claude triage 11-25 verified (reproduced); merged fix
- **#3715** (core; design-entropy; local-probe; fix PR: 3726)
  - Defect: Ten manual refuse('USAGE_ERROR', ...) calls in the CLI handlers (replay, ledger, market, paper, research commands) leave expected null, contrary to the catalogue's promise that usage and options are under expected.
  - Where: `cli/replay_commands.py, cli/ledger_commands.py, cli/market_commands.py, cli/paper_commands.py, cli/research_commands.py (manual refuse calls); shared/refusals.py CATALOGUE`
  - Verified by: Claude triage 11-25 verified (wording only, treated as a defect); merged fix
- **#3664** (core; design-entropy; local-probe; fix PR: 3722)
  - Defect: When retry_of names a research trial with neither capture nor run, _check_retry refuses RETRY_NOT_ALLOWED with the fixed text '...was neither interrupted nor invalid and has economic evidence', though no run exists.
  - Where: `registration/register.py:_check_retry (line 409) / retryable`
  - Verified by: Claude triage 11-25 verified (refusal kept, message wrong); merged fix
  - Note: Wording-only; triage treated it as a defect.
- **#3665** (core; design-entropy; local-probe; fix PR: 3723)
  - Defect: validation registration emits the pre-window witness advice (witness before the window starts or face REGISTRATION_TOO_LATE) for every failed TSA stamp, including a --retry-of retry, whose binding reads the original registration's stamp and which is normally registered after the window ended: the advice is impossible and its threat false.
  - Where: `cli/research_commands.py:validation_registration (lines 415-431); registration/validation.py validation_bind`
  - Verified by: Claude triage 11-25 verified (chain + test); merged fix
  - Note: Wrong advice text; triage treated it as a defect.
- **#3708-1** (core; refusal gap; local-probe; fix PR: 3755)
  - Defect: replay report --directory always resolves the research ledger profile (_research(args)) and refuses LEDGER_UNKNOWN with no profile, contradicting its help 'reads no ledger'.
  - Where: `cli/replay_commands.py:_replay_report`
  - Verified by: Claude triage 11-25 verified in part (run); merged fix
  - Note: Same as A/3708-1 (adjacent there, core here).
- **#3670** (adjacent; wrong result; local-probe; fix PR: 3725)
  - Defect: close_line returns early on an already-closed line without ledger_commit, so replaying line close with the same summary omits ledger_commit from its JSON, contrary to line close --help and every other replayed write.
  - Where: `ledger/lines.py:close_line (early return, lines 447-450); reached via cli/research_commands.py:line_close`
  - Verified by: Claude triage 11-25 verified (chain + test); merged fix
- **#3656** (adjacent; wrong result; local-probe; fix PR: 3736)
  - Defect: replay/entry.py _stage catches every OSError around seams.current.run as a Docker client that cannot start (exit 127), so a host StageLog.write failure (ENOSPC) after a container exit 0 is sealed as a stage exit 127 instead of a host_failure.
  - Where: `replay/entry.py:_stage (lines 261-282, except OSError); replay/seams.py _run`
  - Verified by: Claude triage 11-25 verified by chain; merged fix
  - Note: Reached through replay run; the replay host execution, not the CLI handler.
- **#3759** (adjacent; wrong result; local-probe; fix PR: none merged)
  - Defect: line history/line select plan veto segments from the market's first_day instead of the line's effective coverage (--metrics, --execution quotes, late-listed symbols, pool first month), so veto runs before the data exists fail (e.g. METRICS_MISSING) and candidates stay HISTORY_UNDECIDED.
  - Where: `ledger/lines.py:history_plan/development_period/select_line; reached via cli research line select / line history`
  - Verified by: Gemini recheck+refuter 11-26 confirmed; fix only on unmerged branch
  - Note: Same as A/3759 adjacent.

### Negative (reporting these as defects counts against)

- **#3662**: Registering an unrelated candidate with retry_of=r1 bypasses INTERPRETATION_REQUIRED for r1's uninterpreted invalid run and _check_retry. Rejected: Behaviour verified (throwaway ledger) but triage recommends keeping it: a repaired source is by design a new candidate with another source_sha256 naming the old one in retry_of; the exemption only skips the written interpretation of an invalid run (masked metrics, no economic evidence) and the retry_of link stays visible. Not a defect / not worth its code (borderline); open, fix only on an unmerged exp branch.
- **#3708-2**: research history eagerly resolves the market profile on an empty ledger, contradicting its help. Rejected: By design (triage): the help speaks of reading the market's days, which are not read; resolving the named/active profile is what every --market command does. (cli/research_commands.py.)

### Unconfirmed (neutral)

- none

## G: deploy/ package (release, update, line cutover, interruption and recovery)

### Positive

- **#3672** (core; release-ops; local-probe; fix PR: 3740)
  - Defect: Release.apply commits the Web release (clear) and Paper (paper.commit) before generation().finish(); interrupted between them, recovery rolls Paper forward without finishing the generation and settled ticks never re-enter apply, so generation.json stays at phase 'done' for ever and a later release's rollback is lenient (skips warm/health checks).
  - Where: `deploy/release.py:Release.apply (lines 398-415) / Release.tick (line 545); deploy/paper_release.py`
  - Verified by: Claude triage 11-25 verified by running (real Release over the fake host); merged fix
- **#3693** (core; release-ops; local-probe; fix PR: 3743)
  - Defect: The line-bump cutover's archiver runs as root (--user 0:0) and archive() makes 0700 directories, so a non-root Cutover.run's kept.is_file() is False (PermissionError swallowed) on a Linux Docker Engine; the cutover drops ledgers/market.json, removes its journal and reports success.
  - Where: `deploy/generation.py:archiver/archive (lines 229-255, 0o700) + deploy/update.py:Cutover.run (line 483)`
  - Verified by: Claude triage 11-25 verified the premise by running (Python 3.14 is_file) + code chain; no Linux cutover run; merged fix
  - Note: Docker Desktop on macOS does not show it.
- **#3710** (core; design-entropy; static; fix PR: 3804)
  - Defect: mypy.ini omits the deploy package (declared a product package in pyproject/ruff/package layers), hiding 15 type errors in 4 deploy files, one a real None (release_host.py:441, container gone between two inspects) that fails as TypeError instead of RuntimeError.
  - Where: `mypy.ini files; deploy/release_host.py, deploy/paper_host.py, deploy/notices.py, deploy/update.py`
  - Verified by: Claude triage 11-25 verified (mypy run); merged fix; triage 11-28 closed
  - Note: Configuration omission; the errors live in deploy/.
- **#3709** (adjacent; design-entropy; static; fix PR: 3719)
  - Defect: docs/operator/README.md says Image versions goes back to an earlier version and that the default bars of three contracts suffice, contradicting deploy/README.md (a 0.x deployment never goes back; --bars-from 2020-01 imports every eligible contract) and compose.yaml (an unset TRADE_MARKET_ARGS is refused).
  - Where: `docs/operator/README.md (lines 14-19, 105-106) vs deploy/README.md, deploy/compose.yaml`
  - Verified by: Claude triage 11-25 verified (file:line); merged docs fix
  - Note: Doc contradiction, treated as a defect.

### Negative (reporting these as defects counts against)

- **#3695**: ledger/service.py _check_service silently skips schema validation when a compose deployment's TRADE_DATA is moved (profiles name the old service_root). Rejected: Verified by code chain only and narrower: the skip reaches only a mirror (kind=None); a writable service refuses a moved root SERVICE_CHECK_FAILED, and every reader refuses another schema itself (SCHEMA_MISMATCH), so no wrong data is read; moving TRADE_DATA is not a documented operation. Recommendation: reject (borderline); open, fix only on an unmerged exp branch. Lives in ledger/service.py, reached through deploy compose.
- **#3696**: market-import's healthcheck reports healthy before any import round completes, masking a crash loop. Rejected: By design (see D/3696): a running round is fresh for 26 h by owner decision; OOM kills and restart counts are separate deploy notices (deploy/notices.py).

### Unconfirmed (neutral)

- **#3523**: The line-bump cutover has not run on a real host since its fixes. Where: `deploy/update.py Cutover / deploy/generation.py`. Needs runtime-host. Status: open; triage 11-24: needs evidence (no cutover since); a verification gap, not a reproduced defect

## H: IDE: ide/ servers and the ide/web page

### Positive

- **#3680** (core; wrong result; local-probe; fix PR: 3748)
  - Defect: IDE /api/view filters recommendation judgments on e['recommends'] in row, so a later retraction (recommendation with no recommended subject) is dropped and the retracted version still shows as recommended in summary.recommended/reading.
  - Where: `ide/research_graph/layout.py:build_view (line 179)`
  - Verified by: Claude triage 11-25 verified (run); merged fix
  - Note: Same as A/3680 (adjacent there).
- **#3681-ide** (core; wrong result; local-probe; fix PR: 3749)
  - Defect: build_view reads research_runs[-1], so a passed research run followed by an open/killed retry trial (status None) is shown 'unrun' with annual_return/max_drawdown/sharpe wiped in /api/view (and the web asks a comparison of the open trial).
  - Where: `ide/research_graph/layout.py:build_view (research_runs[-1]); ide/web/src/state/comparison.ts`
  - Verified by: Claude triage 11-25 verified (run, both halves); merged fix
  - Note: Other half (report/graph.py) is A/3681; credit only if the open-retry trigger is named.
- **#3682** (core; frontend; local-probe; fix PR: 3750)
  - Defect: listen()'s EventSource onerror returns early unless readyState is CLOSED, but when ide.py serve stops Chromium keeps the stream CONNECTING while retrying, so the page never shows an unavailable/offline notice and keeps stale data.
  - Where: `ide/web/src/live.ts:listen (events.onerror, line 170)`
  - Verified by: Claude triage 11-25 verified (headless Chromium, server killed under an open page); merged fix
- **#3683** (core; frontend; local-probe; fix PR: 3751)
  - Defect: backtest.ts read() caches an 'absent' answer per commit and re-asks only after OUT_OF_MEMORY, so a transient fetch failure (502/network while the backend restarts) keeps the Backtest panel failed until a new ledger commit or hard reload (backtestBars.ts already re-asks).
  - Where: `ide/web/src/state/backtest.ts:read (lines 21-29)`
  - Verified by: Claude triage 11-25 verified (run); merged fix
- **#3685** (core; frontend; local-probe; fix PR: 3752)
  - Defect: Lineage.tsx imports @xyflow/react's unlayered style.css, whose .react-flow__node.selectable:focus-visible { outline: none } overrides the layered base :focus-visible ring, so a keyboard-focused lineage version shows no focus indicator, contrary to ACCESSIBILITY.md.
  - Where: `ide/web/src/widgets/lineage/Lineage.tsx + ide/web/src/theme/base.css (line 30)`
  - Verified by: Claude triage 11-25 verified (headless Chromium, light and dark); merged fix
- **#3686-1/2** (core; frontend; local-probe; fix PR: 3753)
  - Defect: HeatTile applies opacity-85/60 to tile text, dropping it below tokens.css's 4.5:1 promise (about 3.75-4.48), and --code-comment-changed is not adjusted in dark mode, giving 2.1:1 on diff-inserted text.
  - Where: `ide/web/src/ui/HeatTile.tsx (text opacities); ide/web/src/theme/tokens.css (--code-comment-changed dark)`
  - Verified by: Claude triage 11-25 verified in part (tokens composited in Chromium); merged fix
  - Note: Part 3 (links) rejected, see negatives.
- **#3691** (core; runtime-recovery; local-probe; fix PR: 3754)
  - Defect: Handler.forward (and show_dev_page) catch only OSError around the sidecar request, so a sidecar answering non-HTTP (BadStatusLine, an http.client.HTTPException) or a chunked answer cut short raises out of the handler and drops the client connection instead of answering 502.
  - Where: `ide/research_graph/serve.py:Handler.forward / show_dev_page; contrast ide/research_graph/live_proxy.py`
  - Verified by: Claude triage 11-25 verified (run); merged fix
- **#3692** (core; wrong result; local-probe; fix PR: 3729)
  - Defect: IDE /api/market-import judges staleness by now - status['at'] only, ignoring running_since, so during a long daily round the page reports the import stale ('no round for N h') while market.follow.check() counts the running round fresh.
  - Where: `ide/research_graph/serve.py:market_import (line 703); ide/web/src/model/marketImport.ts`
  - Verified by: Claude triage 11-25 verified; merged fix
  - Note: The stuck-round half was judged unreachable.
- **#3697-ide** (core; refusal gap; static; fix PR: 3803)
  - Defect: The IDE forward handler parses int(Content-Length or 0) with no check for a negative value or ValueError, so Content-Length: -1 passes length > limit and rfile.read(-1) reads to EOF (bypassing the body cap, including limit 0 routes), and a non-numeric length drops the connection with an uncaught ValueError.
  - Where: `ide/research_graph/serve.py (POST forward body read, lines ~905-909)`
  - Verified by: Claude triage 11-25 verified by code chain; merged fix
  - Note: Same defect in paper/serve.py (B/3697) and ledger/first_run.py.
- **#3703-2** (core; design-entropy; static; fix PR: 3745)
  - Defect: ide/web src/lib/format.ts and src/lib/time.ts import each other at runtime (an ESM cycle only for MISSING = '-').
  - Where: `ide/web/src/lib/format.ts (line 3) <-> ide/web/src/lib/time.ts (line 1)`
  - Verified by: Claude triage 11-25 verified; merged fix
- **#3675** (adjacent; design-entropy; static; fix PR: 3721)
  - Defect: THIRD_PARTY_NOTICES.md says ide/web bundles 313 packages with MIT 273, whose counts sum to 312; package-lock.json has 274 non-dev MIT packages.
  - Where: `THIRD_PARTY_NOTICES.md (lines 47-49) vs ide/web/package-lock.json`
  - Verified by: Claude triage 11-25 verified; merged docs fix
  - Note: Wording/count item, treated as a defect.

### Negative (reporting these as defects counts against)

- **#3684**: ide serve --dev-assets forwards unknown non-/api GETs to Vite, drawing an SPA page without the trade-paper-token meta. Rejected: By design / not planned: ide/README.md documents that --dev-assets forwards every GET outside /api/ to Vite and that its page carries no token; loopback only; writes from such a page are refused 403 (fail-safe); an allowlist of Vite prefixes would cost more than the defect.
- **#3686-3**: --link falls below 4.5:1 on --island-alt, --frame and active pill fills. Rejected: By design: the token claims 4.5:1 on the island only, which holds (4.71/5.32); other surfaces carry no claim and the blue is IntelliJ's value.

### Unconfirmed (neutral)

- none

## Excluded candidates (D-H)

- #3505: D: pool history of reused symbols (NU, ANT, MDT): code fix #3606 merged 11-24 09:25, before the tree; what remains is rebuilding the market directory in the next line (data, not code).
- #3507: D: delisted contracts' lifecycle packages are a ledger-data/evidence question (no free settlement price), not a code defect; closed not planned.
- #[3513, 3514]: D: market fixes (#3615, #3584) merged before the tree.
- #[3659, 3674]: E: Paper-only defects; Live is the correct counterpart (ORDER_RULE / require_admission). Keyed under C.
- #3690: G: candidate list named it, but it lives in paper/serve.py (seal thread), keyed under B; not deploy/.
- #3694: G: ledger/server.py start_service on a copied local service directory; not deploy/ (and closed not worth its code).
- #3524: G: GHCR retention deletion switch is a pending ops decision in a workflow, not a defect.
- #[3515, 3516, 3517, 3544, 3596, 3627, 3628]: G: deploy/ledger cutover fixes merged before the tree (#3484, #3512, #3480, #3595, #3634, #3642, #3646).
- #[3575, 3611, 3618, 3553, 3554, 3555]: H: IDE fixes merged before the tree.
- #[3552, 3504, 3652, 3687, 3711, 3712, 3762, 3786, 3785]: D-H: outside the five objects (replay order rules, Nautilus, engine/run.py, ledger/admin.py, CI hygiene, doctor/eval, feature requests).
