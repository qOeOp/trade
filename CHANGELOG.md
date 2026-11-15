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

The tag push wakes `release-ready`, which admits the version once every check of its commit has passed and records
a GitHub deployment to `production`; the host switches on its next release tick. A version on a commit behind the
one the host runs is ignored. Its images are the digests `deploy-ready` records for it: the IDE, the service and the
execution runtime `trade-runtime:exec-sha-<commit>` ([Image versions](deploy/README.md#image-versions)); going back to
one is [Rolling back](deploy/remote/README.md#rolling-back).

## Unreleased

- Breaking (order rules): a GTD order whose expiry is not a whole second is refused as `ORDER_RULE` in replay,
  Paper and Live. Nautilus's Binance USD-M client denies such an order before sending it, so a source that passed a
  replay and Paper failed at its first GTD order in Live. A replay's bars are stamped 1 ms before the minute, so
  `self.clock.timestamp_ns() + lifetime` is never a whole second there: every candidate that writes its expiry that
  way is refused on the new replay image and needs a new version that rounds the expiry, for example up with
  `(self.clock.timestamp_ns() + 661 * 10**9 - 1) // 10**9 * 10**9` for 660 s. Runs sealed on earlier images are
  unaffected and still reproduce on their own image. The 600-second minimum and Live's 605 seconds at send time are
  unchanged (doctor 20261114-26).
- Live, held start (finding 20261114-24): a start that holds around an inherited position now checks, when the hold
  begins and at each 30-second account read, that the stops at Binance cover each side of each contract, and cancels
  the entry orders it inherited. New journal events `held_covered` and `held_uncovered` (positions short of stops,
  entry orders still working, an answer that cannot be judged). The Telegram and Live-page texts no longer say an
  inherited position is protected by its stop before the check; they say what the latest check found, and a position
  with no stop gets its own message. The interruption and restart-limit notices say what the run did (closed nothing,
  cancelled no stop) instead of "open positions keep their exchange stops". A held start still places no stop,
  closes nothing and runs no drawdown brake.
- Breaking (order rules): a GTD order of a type other than LIMIT, STOP_LIMIT or LIMIT_IF_TOUCHED is refused as
  `ORDER_RULE` in replay, Paper and Live: Nautilus's Binance USD-M client sends only those three GTD and denies any
  other. Before, rule 5 raised `AttributeError` on every GTD order but a LIMIT (a source failure, not a refusal), so
  no run with such an order passed. A GTD STOP_LIMIT or LIMIT_IF_TOUCHED exit now goes through rule 5's 600-second
  check and is sent. The change gives a new replay image; runs of sources that send no such order are unchanged
  (doctor 20261114-27).
- Breaking (Live restart rule, finding 20261114-23): a Live runner that ends by its own refusal or failure is no
  longer taken for an interruption and started again. Once armed, every such exit of a run records `unresolved`
  (the final account read after a completed native exit failing or not flat, a start again without its native cache
  or with changed account modes, a clock outside the limits), and the control never restarts a runner that exited
  with status 1 or 2. A killed runner and SIGTERM start again as before. Only a start again whose first account read
  fails (`LIVE_ACCOUNT_UNAVAILABLE`) is retried, within the existing four run launches an hour.
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
- Live: an entry refused when the Observer dispatches it (a failed or late account read, changed contract terms, the
  cash floor, the 3-times limit) ends the run on the STOP path, which closes the run's positions, as every other
  refused entry does (`stop_reason` `entry_admission_failed`, a failed run). It used to stop the node at once and
  leave the positions at Binance with their stops (`unresolved`, `observer_failure`).
- Live: a stop with more than ten positions open closes them all. The STOP path sent every close on one tick, the
  native submit rate (10 orders a second) denied those past it, and nothing sent them again: the run ended
  `unresolved` with those positions open. It now submits five closes a tick, and a close the rate denied is submitted
  again; such a denial still marks the run failed.

## 0.4.0 (2026-11-14)

A breaking release: Live works from the web IDE on every host after a release, as Paper does
(`docs/plans/doctor/2026-11-14-live-not-installed.zh.md`). The research ledger keeps schema generation 1. To upgrade
a host, nothing is done by hand: the next release tick hands control to this version, which installs Live. An
operator declaration from an earlier version is not read and can be deleted.

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
