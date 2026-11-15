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

- Release (doctor 20261115-06): the release host's ledger mirror and market import now follow each version. On the
  first tick after a version commits, while no Paper operation is in progress (running Paper runs are allowed) and
  Live is idle, the release recreates the compose
  services `ledger` and `market-import` (when it runs) on that version's admitted service digest, from the host's own
  compose files, passing the digest in the environment; `/etc/trade/remote.env` is not written. A failed move puts
  both back on their previous image and waits for the next version. Until now they stayed on the image of the host's
  install, so the mirror's per-minute DoltHub sync never ran there. The first tick after this version moves them.
  Before a whole-project `compose up`, name the routed version's images in the env file
  (`deploy/remote/README.md`, Ledger mirror and market import), or compose puts the older image back.

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
