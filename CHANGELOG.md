# Changelog

The version is `pyproject.toml`'s; `python -m cli.main --version` and the IDE's About name it beside the commit.
A version is what releases to the author's host ([`deploy/remote/README.md`](deploy/remote/README.md)): CI admits
the commit of the highest version tag on `main` to the `deploy-ready` channel the host reads.
A merge only reaches `main-ready`, the staging channel every checked `main` build goes to. Shipping a version is the
user's call each time.

To release a version: in one pull request, raise the version in `pyproject.toml` and move the Unreleased entries
under it with the date. After it merges, write that entry to a file and create the release, which tags the merge
commit:

```bash
gh release create vX.Y.Z --target <merge-commit> --title vX.Y.Z --notes-file <entry.md>
```

A commit that changes only documentation builds no image and is never admitted, so its tag never reaches the host:
when the version was raised in an earlier pull request and this one changes only this file, target the newest
commit `main-ready` admitted instead (the `revision` in its `release.json`), which carries the same product.

The tag push wakes `release-ready`, which admits the version once every check of its commit has passed and records
a GitHub deployment to `production`; the host switches on its next release tick. A version on a commit behind the
one the host runs is ignored. Its images are the digests `deploy-ready` records for it: the IDE, the service and the
execution runtime `trade-runtime:exec-sha-<commit>` ([Image versions](deploy/README.md#image-versions)); going back to
one is [Rolling back](deploy/remote/README.md#rolling-back).

## Unreleased

- IDE ⌘K: the separate `Run paper: <version>` entry for every version not running paper is replaced by one
  `Run paper…` entry that opens a version picker, the selected version first (doctor 20261121-12). Backspace on an
  empty query goes back.
- IDE, Line-close history: clicking a cell shows that replay (a veto year, the development period, its replay, the
  holdout or the forward part) in Details with its version selected, with Source and Runs links in the page header; a
  row of another line opens that line's page with the replay picked (`trial=`). Trades can open at the bottom of the
  page. Each closed line's closing summary sits folded under its header. New orders: the holdout's annual return,
  Sharpe and max drawdown (lowest first). A Cause filter splits rows into sign flip (the development period made
  money, the veto years' median or the holdout lost it), positive outside development (the holdout and the veto years'
  median both made money) and other; it is derived on the page from the readings shown, nothing is stored. While a
  Cause is chosen, rows with no edge show too; the header's Hidden count names each reason.

- Paper: a host stall no longer ends a run with `PAPER_CACHE_UNAVAILABLE` (user 2026-11-21). The run ends when the
  native cache process has exited, or when PING has gone unanswered at least 5 times in a row over at least 30
  seconds; a shorter miss is written to the runner's log and an answered PING clears it. Before, one PING not
  answered within 2 seconds ended the run: release host runs 3 and 4 ended together on 2026-11-20 while the VM stalled.

- The research graph service, the paper daemon and the research mirror's sync now read a failed command's refusal
  as the last JSON object on its stderr, past any lines printed before it (doctor 20261121-09): with a `uv` warning
  first (such as a `VIRTUAL_ENV` that does not match the project), the page showed `PRODUCT_FAILED` and the raw text
  instead of the refusal's code and message. A failure whose stderr does not end in a refusal is still
  `PRODUCT_FAILED`, `PAPER_FAILED` or `REPLICA_SYNC_FAILED`.

||||||| parent of fc70e6457 (feat(ide): one Run paper entry in the palette opens a version picker)
- `line history` now replays again a segment whose latest history run is invalid (doctor 20261120-03, user
  2026-11-21): once per call, after every segment without a run, so an environment or transient failure no longer
  leaves a candidate missing that segment for good; a failure of the strategy's own fails again. The new trial
  supersedes the invalid one, which stays in the ledger. The output's `ran` items carry `replaces` (the invalid
  trial a rerun supersedes) and `invalid_left` counts the invalid segments `--limit` left; `left` counts only
  segments without a run. `research history` gives one cell per segment, its latest trial with a run, and names the
  earlier ones in `superseded` (before, the IDE showed the first). Trial counts take such a rerun as a reproduction
  (same source, image, windows, instruments, export and configuration as an earlier counted history trial), so it
  is not counted twice.

- Replay report `dev_years`: a development period of any length over one year is cut into its whole years from
  the trade start and, when it ends between two anniversaries, a last part year (`partial`), shown in the IDE's
  development-year table. Whole years alone are read against the annual target and give `years_at_target` and
  `worst_year_return`; `return_without_best_year` annualizes the window's days without the best whole year, the
  part year's included. It was null for every window but three whole years, so lines with a 5–11 quarter
  development period had no per-year reading.
- Line close: a part veto year (the first year, cut by the market's first day plus warm-up, or the year cut by the
  development period's start) without a passed run, such as one sealed invalid by an audit failure
  (UNPROTECTED_POSITION), is now named in the closing history test's `missing` (`veto YEAR`), as a whole veto year
  without readings is, so `research history` and the IDE's Line-close history leave the candidate's verdict
  undecided instead of judging it on the other years or the holdout alone (doctor 20261120-01, user 2026-11-21). A
  passed part year is still read in no summary. Breaking: a line whose part veto year sealed invalid now reads
  undecided where it read a verdict before; `line close` is unchanged.

- Reports and IDE: a sealed `history` run (a `line history` segment) now carries economic evidence under the same
  criterion as a research or validation run (doctor 20261120-04, user 2026-11-21, 「我都授权」): `replay report` no
  longer masks its readings with `PURPOSE_NOT_COMPARABLE`, `replay report --tables` reads it, and the IDE's Runs and
  Details pages draw its equity, calendar and trades when picked. It still enters no comparison, ranking, research
  run count or line candidate selection; a precheck or explore trial keeps the reason.

- Breaking (registrations): the registration body no longer takes `prediction.interaction`, and the comparison
  report no longer reads a declared two-by-two (`attribution.interaction`, its four-corner shape check and
  contributions, the `INTERACTION_UNATTESTED` refusal). A body that still declares one is refused with
  `REGISTRATION_INVALID`; none of the active ledger's 81 registrations declared one (user 2026-11-21).

- Breaking (research lines): a line's development period now grows with its start's coverage instead of stepping
  from 12 to 4 quarters below 24 quarters (user 2026-11-21, doctor 20261120-07). With C complete quarters of the
  start's precheck instruments before Q, the period is C - 12 quarters (the 8-quarter holdout and 4 quarters of veto
  history taken out), at least 4 and at most 12: unchanged for C >= 24 and C <= 16, and 5 to 11 quarters for C 17 to
  23 (23 quarters of coverage, such as a set with SOLUSDT, now gets 11 instead of 4). The holdout and the
  `LINE_HISTORY_SHORT` refusal under 12 quarters are unchanged. Open lines keep their stored period; a line opened
  after the upgrade on the same instruments in the same quarter may get a longer one, so a precheck without a line
  may now trade in those earlier quarters.

- Market overview: the snapshot no longer carries each coin's `oiByVenue` (open interest per exchange), which the
  Market page stopped drawing on 2026-11-18.

- `market import`: a contract's month that no source holds is no longer stitched. Before its onboard time, or after
  it stopped trading once the month's archives are out, a month with no stored minutes and none of the contract's
  monthly kline, mark-price or funding archives asks neither REST nor the daily archives (a relisted contract's
  earlier months keep their archives and are imported as before). The files a month writes are unchanged; a
  full-scope import from 2020 no longer waits hours on throttled REST requests for contracts not yet listed.

- `market follow --metrics-pool`: keeps the open interest and long/short ratios of the newest month's universe
  members, each from that month's first day, so a contract entering the monthly pool is followed from the month it
  enters without a backfill of earlier days. Off by default; the deployment's `TRADE_MARKET_ARGS` is unchanged
  (`deploy/README.md`).

- Breaking (market scope, doctor 20261118-01): the deployment imports the bars of every eligible contract instead of
  a `--bar-symbols` list chosen today (`deploy/README.md` example `.env`, `README.md`). The cutover is a new market
  directory imported whole from 2020-01 with an empty bar list (about 26 GB, about 45 GB of archive cache, 10 to 15
  hours), then made the active one. After it, the monthly universe and so `--universe pool` runs and the report's
  basket (`beta_basket`, `alpha_basket`, regimes, up and down months) are computed over the full eligible set,
  delisted contracts included; earlier pool runs no longer replay on the new `market` (their universe input
  differs), and single-contract runs replay unchanged. The basket's definition note says so.

## 0.4.4 (2026-11-21)

- Replay identity: `dependency_lock_sha256` now hashes `uv.lock` parsed, without the project's own version (its
  editable package), instead of the file's bytes (user decision 2026-11-21). A release, which bumps only that
  version, no longer rebuilds the replay image or leaves Live without replay evidence (`LIVE_EVIDENCE_MISSING`); a
  dependency pin still changes the value. Breaking, once: every image built before this change reports the old
  value, so its replays no longer back a Live run on a new execution image, and a main-build check of an old image
  against its revision (a reproduction on another image, a validation) refuses; replay again on the new `main`
  image.
- Paper: a resumed run's `account.csv` and `orders.csv` now equal an uninterrupted run's. `account.csv` keeps each
  account state once (rc7's Redis cache repeats the account's last state on every cache update) and leaves out the
  state the Sandbox restates when it connects again after a resume (the checkpoint's balance with nothing locked and
  no margins while positions are open); `orders.csv` writes an order without a fill as NO_LIQUIDITY_SIDE (rc7 marked
  every restored order MAKER, so a stop canceled unfilled read MAKER only after a resume, and marks a resting limit
  order MAKER in any run). Fills, positions, order events and replay and Live reports are unchanged.
- Paper: a MARKET_IF_TOUCHED, an order triggered by the mark price and a trailing stop not yet activated that has an
  activation price, submitted by a source on a back-filled aggregated bar, are now checked as restored ones are (user
  decision 2026-11-18) instead of refusing the recovery: the minutes from that bar's bucket end up to T must not have
  touched the order (a trailing stop: reached its activation price), and the close of the minute ending the bucket
  must not make it marketable (a trailing stop: a sell's close at or above its activation price, a buy's at or below,
  which in the uninterrupted run activated it at once). A trailing stop without an activation price still refuses.
- Paper: `paper compare`'s equity differences name a new cause `held` (user 2026-11-18, 「加」) for a minute a held run
  was down in (ending after a held interruption's pause, starting by its `resumed`) that no order difference or fill
  timing explains: the run values it at a mark from before its recovery went live. Such a minute no longer counts in
  `summary.equity_unexplained_minutes`; every other minute keeps its cause. Derived from the journal; nothing new is
  stored.
- Paper: `paper compare` no longer counts the bars a held run missed during its own interruption (from the pause to
  the held recovery's first live bar on the contract) as `missing_bar` evidence for a difference reaching past the
  held start, so such a difference can now be attributed to `held`; every resume misses at least one bar, so before
  `held` could never win. A live gap before the pause or after that first bar is still `missing_bar`, and the inputs
  still list every missing bar. Derived from the journal; nothing new is stored.
- Paper: a recovery now also restores a working MARKET_IF_TOUCHED, an order triggered by the mark price and a trailing
  stop not yet activated that has an activation price (user decision 2026-11-18), where each used to defer the
  checkpoint so that an interruption ended the run. A MARK trigger is checked on the same LAST one-minute klines (the
  Sandbox fires it on the bars' last prices), a MARKET_IF_TOUCHED as a LIMIT_IF_TOUCHED, and a trailing stop by its
  activation price: a downtime minute that reached it (a sell's high, a buy's low) refuses the recovery
  (`PAPER_RECOVERY_UNAVAILABLE`, stopped as a pause, without cancelling). An activated trailing stop, also one placed
  without an activation price, still defers the checkpoint: rc7 restores every trailing stop inactive.
  (`docs/plans/paper-recovery-open-orders-20261117.zh.md`.)
- Paper: whether a run's source declares recovery (the page's `recovery_declared`, and the held start `paper
  compare` and the runs listing derive) is now the runner's own verdict, journalled on a new run's `started` line as
  `recovery_declared` (user 2026-11-18, 「授权，走评审」; `docs/plans/paper-recovery-open-orders-20261117.zh.md`), not
  read from the source text, which a reassigned `PAPER_RECOVERY`, a computed value, hooks bound by assignment or an
  aliased base could misread. The upgrade drops this for runs started before it: their `started` line has no key, so
  for their whole life the page shows no mark, `held_since` is null, `unprotected` is empty, no Telegram notice is
  sent, and `paper compare` never names `held`.
- Paper: a recovery of a `PAPER_RECOVERY` source whose interruption crossed a funding settlement is now held instead
  of refused (user 2026-11-17, 「资金费结算被错过时转托管」): no source starts, the holder keeps the stops and targets
  working until flat. The runner journals `refusal` `PAPER_RECOVERY_UNAVAILABLE` right after `resumed`, so the seal
  carries `REFUSED:PAPER_RECOVERY_UNAVAILABLE`; later recoveries of the run are held too (a protocol checkpoint with
  the account and no source state, formerly refused as inconsistent, now means held). `paper compare` takes the held
  start from that `resumed`. Nothing new is stored.
- Paper: a `PAPER_RECOVERY` source may subscribe to the declared aggregations of the run's other contracts (user
  2026-11-17, 「允许」); a cut no longer defers for it, and a recovery's back-fill hands those contracts' missed bars
  to every subscriber, at one instant by the run's order of contracts (the live node has no fixed order there). An
  order sent on a back-filled bar is checked against its own contract's minutes and its minute closing the bucket; one
  on another contract than the source's refuses the recovery.
- Paper: a run held after an interruption with a position that no working stop protects stays held and is now flagged
  (user 2026-11-17). Its recovery journals that position's `protection_gap` again after `resumed`, which a restored
  gap state used to suppress. The runs listing derives `held_since` and `unprotected` from the journal, so nothing new
  is stored. The Paper page marks the run "Unprotected position" in red on desktop and phone, and the release tick
  sends a Telegram notice once per unprotected position.
- Late bars on Binance's own time (user 2026-11-18, 「按 Binance 发出时间算」; the field authorized after review,
  `docs/plans/late-bar-exchange-time-20261118.zh.md`): a bar is late when the run received it (`ts_init`) more than
  2 s after Binance sent it, so Binance's own delay after the close no longer counts as the run's. Nautilus drops
  the kline message's event time, so Paper and Live keep a second public websocket to the same kline streams
  (`engine.kline_events`, through the run's proxy; the egress allow-list is unchanged) and write a `kline_event`
  line per contract and minute (`instrument_id`, `ts_event`, `event_ns`) to Paper's `events.jsonl` and Live's
  `market.jsonl`. Paper no longer writes `late_bar` lines: the sealed and live `late_bars` reading is derived from
  `bar` and `kline_event` lines. `paper compare` and `live compare` add `unknown_bars` (bars with no
  `kline_event`, neither late nor on time) and `published_late_bars` (Binance sent them more than 2 s after the
  close; with each first difference's longest such delay, `publication_delay_ms`), both evidence, never a cause.
  Runs sealed before have no `kline_event`: their bars compare as unknown.
- Paper: a minute's snapshot now values the open positions at that minute's last mark. It is taken at the next
  minute's first mark, which it used for that contract, so the equity path stood one mark late against the replay's
  MARK close (audit runs 52 and 54: 0.02 USDT on 0.004 BTC). Runs sealed before keep their journals.
- `paper compare` explains each minute whose equity differs from the replay's (`equity.differences`, with
  `summary.equity_unexplained_minutes`): `orders_differ` when a differing group has filled by then, `fill_timing`
  when a fill both sides made counts in the minute on one side only (the replay fills at its bar's close, Paper once
  that bar reached it, after its snapshot: the 0.10 to 0.12 USDT of audit runs 52 to 54), else `unexplained`. Which
  groups differ and why is unchanged.
- `paper compare --preliminary` (user 2026-11-17, 「加初步对账」): a same-day comparison before Binance archives the
  run's day. The minutes, funding and metrics the market lacks are read from Binance's public REST into a working
  copy of the market under `--output` (files linked, only the extended months rewritten; nothing enters the market
  directory), paced, stopping at the first rate limit. The result carries `data_source: rest` and what REST added;
  the Paper page offers it when the market does not cover the run yet and labels its result preliminary. The archive
  comparison stays authoritative.
- Live: a minute's result (`minute_result`) is now stamped with the minute that ended, valued at the marks it ended
  with. It was stamped with the minute just begun, so `live compare` set the end of minute m against the replay's
  end of m+1, a minute out of step. Earlier evidence packs keep their stamps.
- Paper (doctor 20261117-01): the Run paper dialog named the account as "1× leverage"; a page start runs with the
  replay default, leverage 3. The dialog now shows the margin and leverage the Paper controller names
  (`/api/paper/defaults`, from `ACCOUNT_CONTRACT`).
- Deployment (doctor 20261117-03): a workstation follows released versions. `deploy/update.sh` names the newest
  admitted version's images in `.env`, takes that version's own `compose.yaml` (`deploy/images.py --compose`), pulls
  and runs `docker compose up -d`, which recreates what changed, docker-api included; the release host refuses it.
  `/api/about` names the newest released version (the latest GitHub release, read at most hourly), and the IDE's
  status bar and About panel say "Behind vX.Y.Z" while the deployment runs an older one. The README no longer
  updates services one by one by name.

## 0.4.3 (2026-11-17)

- Release (doctor 20261117-02): moving the ledger mirror, market-import and docker-api with a version no longer
  fails and undoes itself on a host that requires Live. The move holds the Live account lock, and its readers check
  asked the routed Web for `/api/live`, whose listing waits on that lock, so every probe timed out (0.4.1 and 0.4.2).
  The readers check after a move now leaves `/api/live` out; Paper, overview and Agent readers stay.

## 0.4.2 (2026-11-17)

- Paper: a run whose source does not declare `PAPER_RECOVERY` is now held after an interruption while it holds a
  position, as Live holds (user 2026-11-17). SIGTERM pauses it without cancelling, and it checkpoints the native cache
  alone while a position is open; its resume starts no source but a holder under the source's strategy ID, which checks
  the interruption's minutes as any resume does, withdraws the inherited entries and leaves the stops and targets
  working on live bars. Once flat it cancels the rest and ends with the new stop reason `HELD_FLAT`, a clean end for
  the seal (`CLEAN_STOPS`) that the page reads "Held until flat"; STOP ends it as any run, another SIGTERM pauses it
  again. A flat run of such a source still cancels and ends on SIGTERM. The source cannot start another run while one
  is held. `paper compare` attributes a difference reaching past such a run's first `resumed` to the new cause `held`
  where it was `unexplained` (and a look-ahead suspect when only the replay had it). The page's "Ends on restart" mark
  now reads "Held on restart". Nothing new is stored: a held checkpoint has empty `sources`, and held is derived from
  the source.

- Paper: a recovery that crossed a bucket boundary of a declared aggregation is no longer refused. It warms the
  aggregation from the bucket the checkpoint was cut in, its declared history ends just before that bucket, and the
  aggregated bars the native aggregator completed go to the source's `on_bar` after `on_start` and before any live
  data; T moves on by a minute while it would end a crossed bucket. An order the source submits on one of them must be
  untouched by the minutes from that bar up to T and not marketable at its close (no MARKET, no position close), or it
  is not sent, no later order, cancel or close of the source is, and the recovery is refused
  (`PAPER_RECOVERY_UNAVAILABLE`) and stops without cancelling. A checkpoint waits while a declared
  aggregation's bucket has ended and its bar has not reached the source, and a pause waits for that bar. A recovery
  across an unobserved funding settlement is still refused. (`docs/plans/paper-recovery-open-orders-20261117.zh.md`.)
- Paper (doctor 20261117-05): an ended run whose resume was refused now reads "Cannot resume" (red) or, when a retry
  can pass, "Recovery paused" (amber), with the refusal's code and message beside the charts. When it cannot pass
  (`PAPER_RECOVERY_UNAVAILABLE` for a missing, dirty or changed checkpoint or a changed input), Resume is greyed out
  with the reason as its tooltip and leaves the right-click menu; Stop and seal stays. A running run whose source
  does not declare Paper recovery (`PAPER_RECOVERY = 1` with `on_save` and `on_load`) is marked "Ends on restart"
  in amber: an interruption ends it. The run listing gains `recovery_declared`, read from
  the run's strategy input on each listing and never stored.
- Paper: a run of a `PAPER_RECOVERY` source now survives an interruption while it holds positions with working stops
  and targets. Its checkpoint holds the working orders the Sandbox restores as they were and a resume can check
  (accepted, a STOP_LIMIT also triggered; a LIMIT, STOP_MARKET, STOP_LIMIT or LIMIT_IF_TOUCHED on the last price; not
  in flight, emulated, contingent, linked or partly filled), where any unfinished order used to defer it; a pause waits
  up to ten seconds for the orders in flight to be answered. At the resume, before any source starts, the one-minute
  klines of each contract holding a restored order, from the journal's last bar up to T, must show that no restored
  order was touched and that no GTD expired; otherwise the recovery is refused
  (`PAPER_RECOVERY_UNAVAILABLE`, naming the order and the minute) and the run stops without cancelling the restored
  orders and is sealed. A recovery stopped before its sources started for any other reason but STOP and the duration
  also no longer cancels them. A source holding a trailing stop, a MARKET_IF_TOUCHED or a MARK trigger still ends at
  an interruption.
  (`docs/plans/paper-recovery-open-orders-20261117.zh.md`.)
- Paper and Live: a position's working stops and targets are found by the order's own link to its position
  (`Cache.position_id`) as well as `Cache.orders_for_position`. A cache loaded from its database (a Paper recovery,
  a Live restart) lists only a position's filled orders in `orders_for_position` (Nautilus 2.0.0rc7
  `Cache.build_index`, still so upstream; no upstream issue found), so after one the protection check reported a
  covered position as uncovered and order rule 3 did not see the stops already working. An uninterrupted run is
  unchanged: both lookups agree there.
- Paper (doctor 20261117-04): the daemon seals a run that SIGTERM or SIGINT ended without a clean recovery checkpoint
  (a source without `PAPER_RECOVERY`, which cancels its orders and cuts none) instead of trying `resume` every 15 s
  forever while it stayed ended and unsealed. A pause that published its checkpoint still resumes.
- Release (doctor 20261117-02): a release that cannot read the Web or the Paper controller now says which reader,
  which path and what it answered: an HTTP status, or the class of the error that stopped the read (`TimeoutError`,
  `URLError`, ...), never a response body. After a compose service move is undone, the journal names the reader
  that failed (`Compose service move failed: Paper controller unhealthy at /api/paper/runs: HTTP 500`); until now it
  said only `unclassified runtime failure (RuntimeError at deploy/release_host.py:239)`. A failed `docker` command
  is named by its subcommand, exit status and the product line that ran it, still without what it printed, and a
  service that did not start on its image is named. No refusal or admission changed.
- Release (doctor 20261117-02): a compose service move that was undone is tried again. The undo recreates the ledger
  mirror, market import or docker-api after the routed Web, which until now read as the operator's own recreation, so
  no later tick moved it (0.4.1 stayed on the 11-11 service image). A service created after the routed Web is now moved
  again under the same conditions once it is an hour old, while it was created within two hours of the routed Web: at
  most three moves per version, an hour apart. After the last, the tick's drift notice names each service left on
  another image, which stays until the next version. No state is stored; the containers' creation times are the
  count. An operator's own recreation within those two hours is moved again the same way.

## 0.4.1 (2026-11-17)

A fix release for the release path and the production runtime after 0.4.0: the Web and Agent bound their product
processes, the Market overview and chat service restart inside the Web container, each release tick watches the routed
Web and the compose services, the ledger mirror, market import and docker-api follow each version, Paper admission
keeps the memory a release needs, and a newer release control takes over before recovering (doctor 20261115-05,
20261115-06, 20261116-01 to -07, -09). No ledger, run or profile format changes. The memory limit for market import
and the docker-api image variable take effect on the host only once `/opt/trade-app` is updated to this version; until
then each tick sends a drift notice and docker-api stays where it is.

- Release (fix): a release stops the previous Web once the candidate commits, after its observation window. Until
  now it kept running beside the routed one until the next release's admission stopped it (388 MiB on the host
  2026-11-16), memory Paper admission counted as used. Nothing reads a Web the router left; a rollback, automatic
  or by hand, starts it again, as it already does the previous Paper controller and Agent. A failed stop is reported
  and leaves the next release's admission to stop it, as before.
- Paper (doctor 20261116-05): a Paper start now leaves the host 2 GiB available after the new run's limit, where
  it left 1 GiB. A release needs that much available before it starts a candidate, and both now read one constant
  (`deploy.release_host.RELEASE_MEMORY_MIB`), so starting Paper runs can no longer take the host below what a release
  needs and hold every release back. A start the host cannot fit is refused as before with `PAPER_MEMORY_FULL`,
  naming the 2 GiB it keeps; the Paper listing reports it as `memory.headroom`, which the page's "memory full"
  explanation now names instead of a fixed 1 GiB. On the 7.2 GiB host this admits about 1 GiB less of runs while the budget is not the
  limit. The user authorized changing the refusal (2026-11-16).
- Release (doctor 20261116-06, the user 2026-11-16): a release tick hands control to a newer admitted version first,
  before it prepares the host or recovers a pending transaction, so a control whose own preparation or recovery fails
  no longer keeps out the version that fixes it. The newer control then recovers the pending Web or Paper
  transaction an older one wrote; until now only the control that wrote a transaction recovered it, and the bootstrap
  copy refused one. A control reads a journal only in exactly its own format: one it did not write fails the tick as
  `pending journal not in this control's format` and stays for the operator, unread. The operator's way out
  ([deploy/remote/README.md](deploy/remote/README.md), When the running control fails before it hands over) is now
  needed only for a control that fails before or inside the handoff.
- Release (doctor 20261116-03): every release tick now watches what runs after a version commits, and sends what
  fails through the same Telegram chat as its other notices, once while it lasts. It probes `/api/overview/health`,
  `/api/agent/health` and `/api/paper/health` through the router; a routed Web that answers none of them is one
  notice of its own, where before a failed probe was dropped. It reads the `ledger` and `market-import` containers'
  health status, last-exit out-of-memory flag and restart count (a restart notice at 1, 2, 4, ... restarts). No
  release refusal or admission changed.
- Release (doctor 20261116-04): every release tick compares the host checkout `/opt/trade-app` with the routed
  version for `deploy/compose.yaml` and `deploy/remote/` (documentation aside), and the running docker-api with the
  digest that version's `deploy/compose.yaml` pins, and sends a Telegram notice while either differs, once per
  version or pin. The release does not change the checkout; the operator updates it.
- Release and deployment (doctor 20261116-05): a release tick refused for host memory (less than 2 GiB available
  for a standby Paper controller or a candidate Web) now says so in its journal line and Telegram notice instead of
  "unclassified runtime failure"; the threshold and Paper's admission headroom are unchanged. `market-import` gets a
  memory cap without swap, `TRADE_MARKET_IMPORT_MEMORY` (default `3g`, sized from the code, not measured at its
  peak). On the release host it takes effect once `/opt/trade-app` is updated and the service is recreated from it.
- Release (doctor 20261116-04, the user 2026-11-16): the release host's release now moves the Docker API proxy with
  each version, on the same settled tick and under the same conditions as the ledger mirror and market import (no
  Paper operation in progress, Paper writes paused, Live idle, undone with them on failure). It pulls the digest the
  routed version's `deploy/compose.yaml` pins and recreates `docker-api` with it in `TRADE_DOCKER_API_IMAGE`; the
  compose file now reads `${TRADE_DOCKER_API_IMAGE:-<pin>}`, so anything that does not set the variable still runs
  the pin. Until now the proxy moved only when the operator recreated it, so a version whose Paper controller used
  container options its proxy did not admit had its Paper starts refused. While the proxy is recreated the Paper
  page's list, starts, stops and seals fail for those seconds; running runs go on. The checkout must be at a version
  with the variable (this one or later) before the release moves the proxy; with an older one it keeps the proxy and
  says why. The docker-api drift notice now names only a proxy the release will not move until the next version.
- Agent (doctor 20261116-09): the IDE's chat Agent runs at most two product commands at once; further tool calls
  wait in order and start when one finishes. Each command is a Python process of its own and the Agent container has
  1 GiB, so a reply that called many tools together could run out of memory. A command's 180-second timeout counts
  from its own start, and answers are unchanged.
- IDE (fix, doctor 20261116-02): the IDE image's entrypoint keeps the Market overview and the chat service running.
  Each runs in a restart loop that logs its exit status and starts it again after a pause (1 s, doubling while it
  keeps dying within a minute, up to 60 s). Before, when the kernel killed the overview on the container's memory
  limit, nothing restarted it and `/api/overview/*` answered 502 until the container was restarted. `serve` stays
  the container's main process, so stopping the container is unchanged and the loops end with it.
- IDE (fix): the research graph service runs at most 3 product processes at once (`ide.py serve --reads=N` to
  change it); further reads wait their turn and get the same answer. A research line page's burst of reads used to
  start one process each (220-390 MB apiece), which pushed the Web container past its 1.5 GiB limit and also killed
  the Market page's overview service (doctor 20261116-01). A read's 600 s limit starts when its process starts.
- Release (doctor 20261115-06): the release host's ledger mirror and market import now follow each version. On the
  first tick after a version commits, while no Paper operation is in progress (running Paper runs are allowed) and
  Live is idle, the release recreates the compose
  services `ledger` and `market-import` (when it runs) on that version's admitted service digest, from the host's own
  compose files, passing the digest in the environment; `/etc/trade/remote.env` is not written. A failed move puts
  both back on their previous image and waits for the next version. Until now they stayed on the image of the host's
  install, so the mirror's per-minute DoltHub sync never ran there. The first tick after this version moves them.
  Before a whole-project `compose up`, name the routed version's images in the env file
  (`deploy/remote/README.md`, Ledger mirror and market import), or compose puts the older image back.
- IDE (fix): when the research ledger's history is replaced (a new ledger whose head does not descend from the old
  head), the research graph service drops the graphs, failures and reads it kept for the old ledger's commits, and a
  page drops the graph its browser kept for a line the ledger no longer has (`LINE_UNKNOWN`), instead of showing the
  old ledger's graph until the service restarts and the site data is cleared (doctor 20261115-05).

## 0.4.0 (2026-11-15)

A breaking release: Live works from the web IDE on every host after a release, as Paper does
(`docs/plans/doctor/2026-11-14-live-not-installed.zh.md`). The research ledger keeps schema generation 1. To upgrade
a host, nothing is done by hand: the next release tick hands control to this version, which installs Live. An
operator declaration from an earlier version is not read and can be deleted.
It was not tagged on 2026-11-14 and now also carries the changes merged since, the fixes of the pre-production
audit among them (`docs/plans/doctor/2026-11-14-pre-production-audit.zh.md`); each breaking entry below says what an
upgrade changes or drops. Candidates whose GTD expiry is not a whole second are refused on this version's replay
image until their line publishes a rounded revision; sealed runs still reproduce on their own image.

- Paper and Live (fix): the replay of `paper compare`, `live compare` and Live's daily comparison gives the source
  its contracts' membership to the end of the window's last month, as the run had, instead of cutting it at the
  window's end. A source that checks an entry's expiry against its membership skipped, in the replay only, every entry
  of the run's last order lifetime, and those groups read `unexplained`. The replay's audit is unchanged; the
  runtime image is unchanged.
- Refusals (breaking): a market day that does not resolve is `MARKET_DAY_UNRESOLVED` wherever it is read (doctor
  20261113-126). `MARKET_DAY_UNKNOWN` is gone: the market directory's reads (`market coverage`, `market bars`,
  exports) and the market measures of reports now name the same code `line select`, registration and `research
  state` already used.
- Paper and Live (fix): the metrics Feed reads each row from 60 s before it is due and hands it over on its first
  one-second tick at or after the due time, never before. It used to start the REST reads only at the due time and
  hand the row over a tick later, 1.0 to 2.0 s late (a 2026-11-15 Paper trial), so any stall of the node pushed rows
  past the 2 s late limit. A row REST has not published yet is read again 30 s later and at the due time, then as
  before. The change gives a new runtime image; the replay is unchanged.
- Paper (fix): a metrics row the Feed hands a source no longer runs the data callbacks Paper holds for their fills.
  The Feed hands a row over from its timer, which rc7's live runner takes before execution events, so a held
  `on_bar` could run before its own bar's fills reached the cache (a 2026-11-15 trial: an entry seen `ACCEPTED` with
  0 filled, then `release_late`). The row now only joins the held callbacks and runs with them, in the order they
  came, at the next data dispatch. Live holds no data callback and is unchanged; the replay is unchanged. The change
  gives a new runtime image.
- Paper seal (finding 20261114-38): `seal.json` no longer carries `positions_open_at_stop` (readings version
  `paper-readings@2026-11-15`). It counted the summary's open positions, so a run killed before it wrote a summary
  always read 0 whatever it held, while the final equity came from the journal's last snapshot. Nothing in the product
  read it; the open positions of a run that wrote a summary stay in `summary.json` (`positions_at_stop`), and a run
  killed with a position open still ends with the journal's last equity. Seals already stored keep their readings.
- Paper (journal): each metrics row the Feed hands a source is recorded in `events.jsonl` as `metrics`, whether or
  not the source defines `on_data`, and each unsubscribe from metrics it followed as `metrics_unsubscribed`, the
  same rows Live's evidence pack keeps. `paper compare` now checks them against the archive as `live compare` does
  (missing, late, differing rows and the cause `metrics`). A run sealed before this has no such rows and compares as
  before. The rows stay in the run's journal and the private Paper database. The change gives a new runtime image;
  the replay is unchanged.
- Breaking (replay inputs): an instance's `on_start` now runs after the data that arrives at its start T in every
  replay. An instance whose T is the window's start (`--trade-start` equal to `--start`, and no declared history
  moving T later) used to start before that data and receive through its subscriptions whatever arrived exactly at
  T, such as a funding settlement stamped on the hour (twice for a source declaring `FUNDING`: in its history and
  again as an update). It now receives none of it, as an instance starting later already did, so each settlement
  reaches a source once: in its history when stamped at or before T, otherwise after `on_start`. A replay whose
  window starts at T can therefore give a source different inputs and different orders than before; replays whose T
  lies after the window's start are unchanged. Paper and Live follow: at a start on a settlement hour they give a
  source only a settlement Binance stamped after the hour, no longer one stamped on it to a source without a funding
  or intraday bar history (the user 2026-11-15).
- Breaking (Paper end reason): a Paper run whose journal cannot be written (a full disk) now stops with
  `PAPER_JOURNAL_WRITE_FAILED` and the runner exits with status 3; the seal's reasons say
  `PAPER_JOURNAL_WRITE_FAILED` and `RUNNER_EXIT_NONZERO`, and `STOPPED:PAPER_JOURNAL_WRITE_FAILED` when the summary
  could be written. The journal ends at the first refused write, and the source still receives every order and
  position event, which a refused journal line used to skip (the run went on, its general `on_order_event` and
  `on_position_event` callbacks missed events, and the seal read `complete` with no reason). A script that matches
  seal reasons exactly sees a reason it did not know. Paper image only; the replay image is unchanged (doctor
  20261114-43, the user 2026-11-15).
- Paper and Live: after Binance changes a contract's funding interval, the next settlement is the one Binance makes,
  as a replay streams it. A start's warm-up waits for the settlement the contract's interval now
  (`fapi/v1/fundingInfo`) makes due at or before T; it used to predict it from the spacing of the last two, so a start
  after a shortening (8 to 1 hours) could miss that settlement and a start after a lengthening (1 to 4 hours) waited
  for one that never came, `WARMUP_TIMEOUT`. The live stream's estimate that moves the next funding time later before
  the named time has come is no longer taken for a settlement at the named time. The change gives a new replay image;
  replays are unchanged.
- `live compare` (metrics): a top-trader position ratio the archive holds exactly at the midpoint of the 4th
  decimal, about 1 row in 100, now also agrees when Live received its half-down rounding. REST rounds such a value
  either way (350 up, 300 down on 650 rows of 8 contracts over 29 days) and no rule from the archive reproduced it,
  so these rows were reported as `metrics` differences that were not real. Any other difference is reported as
  before; the replay's values and the comparison format are unchanged.
- Breaking (Paper end reason): a Paper run whose native cache process (the runner's Redis child) exits or stops
  answering now ends with `PAPER_CACHE_UNAVAILABLE`: its working orders are canceled, positions stay open, and the
  seal's reasons say `REFUSED:PAPER_CACHE_UNAVAILABLE` and `STOPPED:PAPER_CACHE_UNAVAILABLE`. Before, a run whose
  source declared the recovery protocol stopped processing data without a word (its journal and checkpoint stopped,
  STOP was ignored, `paper stop` ended in SIGKILL after 93 seconds and the seal had no reason), and any other run
  traded on without its cache and took 92 seconds to stop. The cache's connections also fail fast now, and a
  checkpoint that raises anything but a refusal is deferred instead of escaping its timer. A shell or script that
  matches seal reasons exactly sees a reason it did not know. Paper image only; the replay image is unchanged
  (doctor 20261114-34, the user 2026-11-15).
- Live (evidence pack): when a source unsubscribes from a contract's metrics, Live records `metrics_unsubscribed`
  in `evidence/market.jsonl`. `live compare` no longer counts the archive rows after it as missing; it expects rows
  again from the first one the source receives after resubscribing. Paper and Live hand no metrics row to a source
  after it unsubscribed, including one already read in the same tick. The change gives a new runtime image.
- Breaking (`research history`): a closing history test's combined verdict needs every reading it is defined on.
  A whole veto year whose run is invalid or missing, or lacks a reading, used to drop out of the veto's count, so
  the other years, or the holdout alone when every year was invalid, could read `meets_targets` true; a row without
  a control run was judged too. Now `meets_targets` and `judged_on` are null in those cases and the summary's new
  `missing` names what is lacking (`veto YEAR`, `control`, `holdout`, `targets`). `whole_years` counts every whole
  veto year replayed, invalid ones included. Nothing is stored and no history run changes; the History page shows
  such a row's verdict as a dash (doctor 20261114-12).
- Breaking (`line history`, `line close`, `research history`): the candidates of a line's closing history test are
  its sources whose latest passed research run carries economic evidence, the read-time judgment `research status`
  already applies. A source whose review failed, or whose run shows no real activity, used to be replayed, shown
  with its development readings and judged like any other. It is now left out: not replayed, not a row, not counted
  in `participants` or in the deflated Sharpe's trials, and `line close` no longer requires its segments. Both
  commands name it in the new `without_economic_evidence` with its reasons and no reading; a source that loses its
  evidence after its history runs moves there too. Nothing is stored and no history run changes (doctor
  20261114-13).
- Live (finding 20261114-29, the part about answers of the wrong shape): an answer from Binance with HTTP 200 that
  lacks what Live's own read-only client reads from it (the server time, the instrument list) is now the refusal
  `LIVE_ACCOUNT_RESPONSE`, where the client raised `KeyError` or `TypeError`. A periodic comparison or a held start's
  read that gets such an answer is read again, where the run ended `unresolved` (`observer_failure`) with the node
  stopped and its positions left open. An entry's read is refused under that code and ends the run on the STOP path
  (before: under the code `KeyError`); the brake's read is lost as before. The client still makes each request once.
- Breaking (precheck output): `replay precheck` returns `technical` (populations, the activity and plan checks, the
  order funnel) where it returned `metrics`, which carried annual return, drawdown, Sharpe, win rate and the cost
  slices to the author before the registration. Nothing stored changes; `replay report` and the run reports after
  registration are as before (doctor 20261114-14).
- Breaking (clock callbacks): a callback a source registers with `clock.set_timer_zoned` is guarded like those of
  `set_timer` and `set_time_alert`. When it raises, the failure is recorded (`runtime_failures.jsonl`) and the run
  fails, where the engine used to log one error line and the run passed. In Paper such a timer now counts as a user
  timer, outside the recovery protocol, and in Live its callback no longer runs once the run is stopping, as with
  the other timers. The change gives a new replay image; sources that do not use `set_timer_zoned` are unchanged
  (doctor 20261114-35).
- Live (finding 20261114-25, the part that needs no real-account reading): an entry is no longer sent while
  Binance's positions differ from the native cache's. Each entry's own account read is compared with its instance's
  positions; a first difference reads once more (`entry_reread`), a second refuses the entry
  (`LIVE_CONNECTION_UNVERIFIED`) and the run ends on the STOP path. When Binance holds nothing at all while the cache
  still holds a position of the run (a stop that triggered while the runner was down, a liquidation), the run now
  records `venue_flat`, sends nothing and ends with its slot released, instead of sending closes that can only be
  rejected and ending `unresolved`: at a start again on a flat account, at an entry's second disagreeing read, and
  after two comparisons 30 seconds apart. Confirmed against a local fake exchange only.
- Breaking (order rules): a GTD order whose expiry is not a whole second is refused as `ORDER_RULE` in replay,
  Paper and Live. Nautilus's Binance USD-M client denies such an order before sending it, so a source that passed a
  replay and Paper failed at its first GTD order in Live. A replay's bars are stamped 1 ms before the minute, so
  `self.clock.timestamp_ns() + lifetime` is never a whole second there: every candidate that writes its expiry that
  way is refused on the new replay image and needs a new version that rounds the expiry, for example up with
  `(self.clock.timestamp_ns() + 661 * 10**9 - 1) // 10**9 * 10**9` for 660 s. Runs sealed on earlier images are
  unaffected and still reproduce on their own image. The 600-second minimum and Live's 605 seconds at send time are
  unchanged (doctor 20261114-26).
- Live (finding 20261114-28): a source's own report of an entry the entry gate denied no longer ends the start
  `unresolved`. Authored sources report every denied order from `replay_integrity_findings`; Live now sets aside what
  an instance adds to its findings while it handles the gate's own `OrderDenied` (missing bar, contract not trading,
  clock, membership), so a start after such a denial ends `interrupted`, `rewarming` or `held_flat` and is started
  again as designed. `source_findings` journals every finding as before and counts the set-aside ones in
  `entry_gate_findings`. Other findings and other denials fail the start as before; replay and Paper are unchanged.
- Live, held start (finding 20261114-24): a start that holds around an inherited position now checks, when the hold
  begins and at each 30-second account read, that the stops at Binance cover each side of each contract, and cancels
  the entry orders it inherited. New journal events `held_covered` and `held_uncovered` (positions short of stops,
  entry orders still working, an answer that cannot be judged). The Telegram and Live-page texts no longer say an
  inherited position is protected by its stop before the check; they say what the latest check found, and a position
  with no stop gets its own message. The interruption and restart-limit notices say what the run did (closed nothing,
  cancelled no stop) instead of "open positions keep their exchange stops". A held start still places no stop,
  closes nothing and runs no drawdown brake.
- Live page, held start (finding 20261114-24, the page half): a held run whose latest check found a position without
  its stop, an inherited entry order Binance still holds, or an answer it could not read says so in its status word
  (`Holding, no stop`, `Holding, entry not cancelled`, `Holding, unverified`) in the red of an unresolved run, and a
  missing stop is marked on its own contract: the contract's capsule, a level at the position's entry on its chart,
  the position's line on the phone, and a `Stop check` fact (`BTCUSDT LONG 0.002 · stops 0`). The Runs button and
  tab dot turn red with it. While the run is still cancelling inherited entry orders it reads `Holding, cancelling
  entries` in amber. A hold whose stops are all in place looks as before. The page's long notes (the hold's
  explanation, the stop check's sentence, the events tables' reading notes) are the tooltip of an info icon instead
  of a block of text above the chart or table.
- Breaking (order rules): a GTD order of a type other than LIMIT, STOP_LIMIT or LIMIT_IF_TOUCHED is refused as
  `ORDER_RULE` in replay, Paper and Live: Nautilus's Binance USD-M client sends only those three GTD and denies any
  other. Before, rule 5 raised `AttributeError` on every GTD order but a LIMIT (a source failure, not a refusal), so
  no run with such an order passed. A GTD STOP_LIMIT or LIMIT_IF_TOUCHED exit now goes through rule 5's 600-second
  check and is sent. The change gives a new replay image; runs of sources that send no such order are unchanged
  (doctor 20261114-27).
- Breaking (Live restart rule, finding 20261114-23): a Live runner that ends by its own refusal or failure is no
  longer taken for an interruption and started again. Once armed, every such exit of a run records `unresolved`
  (the final account read after a completed native exit failing or not flat, a start again without its native cache
  or with changed account modes), and the control never restarts a runner that exited with status 1 or 2. A killed
  runner and SIGTERM start again as before. Only a start again whose first account read fails
  (`LIVE_ACCOUNT_UNAVAILABLE`), or shows this clock outside the limits (`LIVE_CLOCK`, the user 2026-11-15: a host
  clock that steps aside comes back by itself), is retried, within the existing four run launches an hour; the
  clock's limits are unchanged, and a first start over them is refused as before.
- Paper: a recovery no longer drops or reuses the position IDs of resting limit entries. The Sandbox now leaves
  position IDs to the execution engine (`use_position_ids=False`, as Live), so a recovered run's new fills cannot
  collide with a cached position of another contract (entry stuck at ACCEPTED, no stop, no re-entry) or of the same
  contract (an earlier position's record overwritten). Paper's position IDs are now `P-…` for every entry; replays are
  unchanged. Takes effect with the next execution image.
- Live's evidence pack records each metrics row its source receives (`metrics`), and `live compare` checks them
  against the archive's rows as a replay streams them: missing, late, differing and Live-only rows per contract, and
  a new difference cause `metrics` after the bar causes. `historical_funding` rows drop `ts_init`, always their
  `ts_event`. Comparison results are `run-comparison@2026-11-15`.
- Breaking (metrics replays): `--metrics` exports by the rule `binance-metrics-visible-v2`, which gives the values
  Binance's public REST shows: the long/short ratios at 4 decimals, each account ratio the quotient of its long and
  short shares rounded to 4 decimals first; open interest and the stamps are unchanged. Every replay that reads
  metrics gets other inputs than under v1, so earlier metrics research does not compare with new runs. Paper and Live
  now serve metrics of the run's contracts, read from that REST at the replay's stamps, where a subscription used to
  stop the run (`METRICS_NOT_SERVED`). A position ratio the archive holds at a tie of the 4th decimal (about 1 row in
  90) may differ from REST by 0.0001.
- Engine: a source may declare `"FUNDING": n` in `WARMUP`. Before `on_start`, `on_historical_funding_rates` receives
  the last n funding settlements at or before its start, the updates a replay streams for them: from the export in a
  replay, from Binance's public funding-rate history in Paper and Live. A source that reads funding no longer waits
  for n settlements (72 hours for nine) at every replay, Paper or Live start. Paper and Live comparisons check the
  received settlements against the market's.
- Paper and Live: a source that reads funding (`on_funding_rate`) and starts on a settlement hour receives that
  hour's settlement after `on_start` when a replay streams it then: one Binance stamped after the hour (some
  milliseconds later, about half of the settlements sampled), and one stamped on the hour unless the source declares
  a funding history or a bar history other than daily bars. A source with a warm-up used to miss it (the live stream
  passed it before the source subscribed); one without got the stream's update, stamped on the hour, whatever it
  declared. Such a start on a whole hour now reads Binance's funding-rate history in its warm-up, declared or not, so
  its `on_start` runs from T + 15 s and a due settlement not published by T + 45 s is `WARMUP_TIMEOUT`.
- Live: an entry refused when the Observer dispatches it (a failed or late account read, changed contract terms, the
  cash floor, the 3-times limit) ends the run on the STOP path, which closes the run's positions, as every other
  refused entry does (`stop_reason` `entry_admission_failed`, a failed run). It used to stop the node at once and
  leave the positions at Binance with their stops (`unresolved`, `observer_failure`).
- Live: a stop with more than ten positions open closes them all. The STOP path sent every close on one tick, the
  native submit rate (10 orders a second) denied those past it, and nothing sent them again: the run ended
  `unresolved` with those positions open. It now submits five closes a tick, and a close the rate denied is submitted
  again; such a denial still marks the run failed.

- Live: the daily comparison container starts only while some run has a day to compare; a host that never traded
  starts none (doctor 20261114-20).
- Live (breaking): the Live page chooses the run as Paper does. The candidate is the version selected in the
  research graph, read at the research ledger's head with Paper's check that its source loads; the contracts
  (default: its last research replay's) and the leverage (default 3) are typed on the page, and their membership is
  derived from the market directory. The upgrade drops the operator source catalog and its `purpose` label:
  `/api/live` no longer returns `sources`, a prepare request takes `candidate` and `symbols` instead of `source_id`,
  and a run's view has no `purpose`. Two read-only reads are new, `/api/live/candidates/<id>/<rev>` and
  `.../evidence/<SYM,SYM>`. Live's real-money checks are unchanged (finding 20261114-20,
  `docs/plans/live-run-choices-20261114.zh.md`).
- Paper: the default contracts of a version (its last research replay's) are read again; the query named a column
  the ledger does not have.
- Host release (breaking): every release installs Live on every host, with no operator step (doctor 20261114-20).
  Each release pairs a Live control with its Web; the first release on a host whose Web has none creates the custody
  root `/var/lib/trade-release/live-root` (0700) and its `account.lock` (0600), both owned by root, and pairs the
  first control once Live is idle. Controls run as root with every capability dropped but `DAC_READ_SEARCH`: they
  read the root-only release state, and Docker gives a non-root user none of the capabilities it adds. A root or
  lock that exists is only checked: another owner or mode, a symbolic link or a missing lock is refused and never
  repaired. Every release now waits for an idle Live on every host (a host with no runs answers idle). The upgrade
  drops the operator declaration `/var/lib/trade-release/live/configuration.json` (`live-deployment-v1`), which is
  no longer read: delete it; the `live-control-v1` snapshots; operator-chosen custody roots (a root kept elsewhere is
  not read: settle and back up its runs first); and the declaration's `sources` catalog, `purpose`, `research_at`
  pin, `universe_file`, `defaults` and `memory`. The run manifest `live-run-4` is unchanged.

## 0.3.1 (2026-11-14)

Fixes the release process that failed the 0.3.0 host upgrade (`docs/plans/doctor/2026-11-14-release-control-skew.zh.md`).
No product or data format changes; only the host's release control.

- Host release: a version moves Web (with its Agent and paired Live control) and the Paper controller together, or
  neither. The Paper controller switches inside the Web release, before the Web candidate warms, so the Web is
  warmed and observed against the Paper controller of its own version; a failure on either side before the Web
  commit rolls back both and marks the version failed, and a crash between the Web and the Paper commit finishes
  the Paper commit on recovery. Before, Web committed first and Paper followed, so a failed Paper switch left Web N
  with Paper N-1 (doctor 20261114-19). The upgrade drops the separate `paper-failed/` marker directory: one
  `failed/<revision>` now covers the version, and a `paper-failed/` entry left on a host is no longer read.
- Deployment (breaking): each version is released by its own control code. The host's tick runs through a fixed
  launcher, `/opt/trade-release/trade-release-tick`, in `/var/lib/trade-release/control/current`; when the admitted
  version differs from the running control's, the tick copies that version's `deploy/*.py` out of its digest-pinned
  service image without running it, checks it imports, switches `current` and ticks once more under it, before
  any release. Before, the control installed by hand released the next version, which failed whenever a version
  changed an interface the control calls (doctor 20261114-16). The upgrade drops the hand-installed control: on a
  host installed earlier, stop `trade-release.timer` before this version is tagged, then once it is admitted check
  out the tag in `/opt/trade-app` and run `sudo sh deploy/remote/install-release.sh control`; the next tick hands
  over ([Release control code](deploy/remote/README.md#release-control-code)).
- Host release: deleting a version's `failed/<revision>` marker retries it; the next tick removes the stopped
  candidate containers of that revision before creating them again. Before, the retained candidate refused the retry
  (doctor 20261114-17).
- Host release: a failed tick is logged as `Release tick failed` and its notice no longer claims Web stayed when Web
  had moved (doctor 20261114-18).

## 0.3.0 (2026-11-14)

A breaking release with no compatibility with 0.2.0: during 0.x a version reads no earlier format (AGENTS.md). The
research ledger keeps schema generation 1, so research continues on it. Live runs 0.2.0 made (manifest `live-run`)
are skipped and stay on disk; Paper runs and their comparison carry over. To upgrade: stop Live (a release switches
only while Live is idle). The hand-installed 0.2.0 control code cannot release this version, and `install-release.sh`
refuses an installed host: stop `trade-release.timer` before the version is admitted, replace
`/opt/trade-release/deploy/*.py` with this version's files as one complete set, then start the timer. If the 0.2.0
control already failed it, first remove its marker under `/var/lib/trade-release/failed/` or `paper-failed/` and
rename the retained failed candidate container (doctor 20261114-16 and -17). It lands the
whole-product slimming audit (`docs/plans/doctor/2026-11-13-whole-product-slimming-audit.zh.md`) and Live trading
several contracts per run.

- Live: an exit (reduce-only order) submitted with order parameters is now refused as `ORDER_RULE` and not sent,
  as in replay and Paper; before, Live sent it without the parameters. The run goes on and the position's stops
  stay (doctor 20261114-09).
- Replay: an export's content hash (`export_content_sha256`, a trial's `export_sha256`) covers only the selected
  contracts' directories, the lifecycle evidence and the membership file. A `replay explore` reads a shared cache
  directory that other selections also fill, so its hash no longer depends on which other contracts were cached
  there, and a repeated identical explore counts as a reproduction. Fresh exports hash as before.
- Paper (breaking): a sealed run's replay comparison is `paper compare` (was `paper reconcile`), the verb Live's
  `live compare` has; its HTTP path is `/api/paper/runs/<id>/compare`, its refusals `PAPER_COMPARE_EMPTY` and
  `PAPER_COMPARE_UNCOVERED`, and Paper's and Live's result file `comparison.json`. "Reconcile" now names only Live's
  account reconciliation. A comparison made before the release is replayed again when asked for.
- Deploy (breaking): during 0.x a version keeps no compatibility with earlier ones. `deploy.images` no longer
  names a runtime built before the replay/execution image split (its combined `sha-<commit>` index); an admitted
  runtime is always read at `exec-sha-<commit>`. Going back to an earlier version's images is no longer supported:
  `--revision` stays only to name the admitted revision the host routes, as Live on the host does.
- Research state (breaking): no `RUNTIME_UNSUPPORTED` gate for a line whose candidates were published under a
  runtime contract this product no longer has a layout for, and `replay report --tables` no longer names a run on such a
  contract. During 0.x a runtime contract change starts a new ledger generation instead of moving old lines
  across contracts (user decision 2026-11-14: no compatibility with earlier versions); records of an earlier
  generation stay where they are. Image moves within the current contract (`runs_behind_image`, `replay reproduce
  --image`) are unchanged, and an image or layout of an unknown contract is still refused `RUNTIME_UNSUPPORTED`.
- Ledger (breaking): no compatibility with services or runs of earlier ledger generations (0.x keeps none). A
  service start no longer checks for a commit verification group left by a pre-gen-1 product, and `ledger init`
  no longer clears one; a service that still has one fails its first commit. The single-run report reads
  `fill_volumes.csv` as a required report: a run without it gets a `FILL_VOLUME_MISSING` limitation instead of an
  empty participation reading. Nothing on disk is deleted or moved.
- Release (breaking): 0.x keeps no compatibility between versions (the user's decision of 2026-11-14). With Live
  installed every release pairs a new control and waits until Live is idle, Web-only ones included; a new control
  no longer takes over running runners, and no Web is served ahead of its control. Live runs under
  `LIVE_ROOT/runs` and Paper runs in an earlier format are no longer read; they stay on disk.
- IDE (breaking): the Live page reads only the control released with it. A source's replay evidence, a gate
  event's contract status and the notification status are required in its answers; the page no longer shows a
  start without evidence as allowed or a missing notification status as unreported. The Paper page takes a running
  run's warm-up end only from its readings' `input_start_ns`, no longer from its journal.
- Paper (breaking): a Paper controller release no longer checks that the candidate can read the checkpoint format
  and journal of unsealed runs an earlier version left; such runs are no longer read and stay on disk, and the
  checkpoint's own format check still refuses to recover them. `paper reconcile` and a replayed `paper start` read
  a run's declared leverage as required: a run declared before leverage was recorded is no longer reconciled at
  the default.
- Paper (breaking): the run listing (`GET /api/paper/runs`) names a run's readings so far `readings` instead of
  `live`, the name its stream's `readings` event already has. The release gate's probe reads the new name, so
  the host's control code must be this version's when it releases this version (see the upgrade note above).
- Command line (breaking): a market day is `--market-day` on every command (was `--at` on `replay explore`,
  `precheck` and `run`, `market`, `paper` and `live compare`, and `--market-at` on `line select`, `line history` and
  `validation registration`); `--at` is only a ledger commit. `source review` takes `--trial-id` (was `--precheck-trial`) and `validation report`
  `--validation` (was `--registration-id`). `ledger export --trial-id`, `paper start --memory` and `paper stop
  --wait-seconds` are gone: an export lists every run, and Paper sizes its runner and waits 60 s on stop.
- Refusals (breaking): one code per condition. A market reference is `head` or a day (`main` is refused); a
  bad or late market day is `MARKET_DAY_UNKNOWN` (was `UNKNOWN_REF` or `MARKET_DAY_INVALID`), a contract the market day
  lacks `UNKNOWN_SYMBOL` (was `NO_TERMS`), a bad contract list `EMPTY_SYMBOLS` (was `IMPORT_SCOPE`), and Paper with
  no current-month member `UNIVERSE_EMPTY`. A profile file without `holds` is no longer read as a research ledger.
- Live: each contract's membership grows month by month as Paper's. The control writes
  `inputs/membership/<YYYY-MM>.json` once a month after the run's market day has begun and the market holds it, and
  the runner denies an entry on a contract outside its membership natively (`entry_outside_membership`; the run goes
  on and the contract only reduces). Until a month's file is there, entries on the run's contracts are denied and
  `membership_stale` (`LIVE_MEMBERSHIP_STALE`) is journalled once.
- Live (breaking): each source in the Live declaration names its own contracts (`symbols`, those of its replay
  evidence, one strategy instance each) instead of one top-level `symbols`; the launch page shows the chosen source's,
  and the comparison replays and reconciles every contract of a run, each against its own commission.
  Before releasing, with no run holding the account, move the declaration's `symbols` into each `sources` row
  (`deploy/remote/README.md`).
- Live (breaking): a 15% drawdown-from-highest-equity brake (wallet plus unrealized, fees and funding counted, read
  over REST every 15 s; a run may set it tighter) replaces the per-run loss limit, and the cash floor is 85% of the
  wallet at the run's first start instead of a declared budget. Before releasing, with no run holding the account, replace
  the Live declaration's `defaults` with `{"duration_seconds": …, "leverage": …}` (`deploy/remote/README.md`).
- Live (breaking): every run needs an API key restricted to the host's IP (`LIVE_KEY_IP_UNRESTRICTED`), timed or
  not, and a run may have no duration. Each entry and comparison bounds the clock: an entry over the limit is denied
  natively and the run goes on. A contract Binance lists as not `TRADING` closes entries (new ones denied natively,
  positions keep their exchange stops) until it trades again. The control reads a running run's key permissions
  hourly and tells the user when they fail.
- Live (breaking): the runner trades several contracts, one instance of the source per contract as in a replay, each
  with its own strategy ID (`LIVE-<run>-<coin>`) and ordering only on its own contract; instances coordinate legs
  through state the source shares between them. Margin settings, terms, status, the 3-times limit, the comparison and
  mark prices are per contract; the brake, cash floor, account modes and entry queue per account. A contract not
  `TRADING` denies entries on it alone; a missing bar on any contract closes entries on all, and the run warms up
  again once flat. `LIVE_SYMBOL_SCOPE` is gone.

## 0.2.0 (2026-11-11)

A breaking release: a new research ledger (schema generation 1) that starts research from zero. The previous ledger
is not upgraded; read it with its matching old checkout (README.md). Everything below lands on a fresh host.

- Ledger: schema generation 1 (fewer tables and fields, `market_day` a `DATE`, readings computed at sealing), its
  public DoltHub copy started anew. `line close` syncs the backup, and `ledger review` reports one that is behind.
- Research windows follow a three-segment rule: a development period by quarters before the line's start, an
  8-quarter holdout run once as one segment, and earlier calendar years as veto years; a line with fewer than 12
  complete quarters is refused (`LINE_HISTORY_SHORT`). The line-close history test and its IDE heatmap report veto,
  holdout and their joint verdict, with the deflated Sharpe ratio.
- Replays run only on images this repository's CI built (any branch; validation still needs a `main` build), each
  stage capped at 16 GiB (`STAGE_MEMORY_LIMIT`). The audit is indexed per strategy, contract and side, and the
  fingerprint streams reports: a busy 3-year pool replay went from about 98 minutes with a 17.5 GiB peak to
  about 20 minutes with a 6.2 GiB peak.
- The market version is a day throughout: refusal codes `MARKET_DAY_*`, `UNIVERSE_EMPTY_AT_DAY`, and `market_day`
  in every JSON output and receipt. `replay report` adds slippage stress; `research status` adds the deflated Sharpe.
- Paper writes to its own `paper` database, never published; `paper resume` re-exports terms at the run's market day.
  `TRADE_PAPER_MEMORY` reaches the Paper controller on the host and the workstation.
- Only a version releases to the author's host: `deploy-ready` admits the commit of the highest version tag from
  `v0.2.0` on, and a merge reaches only the new `main-ready` staging channel (`deploy.images --channel main`).
- Profile files name `holds` and `kind` (`{"name", "holds": "market", "kind": "active", "root"}`); rewrite an old
  `market.json` by hand.

## 0.1.0 (2026-11-11)

The first named version: `main` as of this tag. Native Nautilus replays of single-file strategies in a digest-pinned
runtime image, the Dolt research ledger with its public DoltHub copy, the market directory of Binance public data,
the research IDE with its chat Agent, Paper trading on public data with Sandbox fills, the operator's Live trial,
and automatic release to the author's host.

- `python -m cli.main --version` and the IDE's About show the version.
