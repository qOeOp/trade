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
- Paper (breaking): a Paper controller release no longer checks that the candidate can read the checkpoint format
  and journal of unsealed runs an earlier version left; such runs are no longer read and stay on disk, and the
  checkpoint's own format check still refuses to recover them. `paper reconcile` and a replayed `paper start` read
  a run's declared leverage as required: a run declared before leverage was recorded is no longer reconciled at
  the default.
- Paper (breaking): the run listing (`GET /api/paper/runs`) names a run's readings so far `readings` instead of
  `live`, the name its stream's `readings` event already has. The release gate's probe reads the new name, so
  reinstall the host's control code with the release (`sh deploy/remote/install-release.sh`), as every release does.
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
