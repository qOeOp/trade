# Native replay

Every native replay goes through `research.records.artifacts run`: `--explore` runs a draft into a
new `/tmp` directory, and a published revision that a freeze or confirmation cites is sealed and
stored in the research ledger ([runs
reference](../.agents/skills/research-round/references/runs.md)). Both execute `python -m
engine.run` and the native auditor in the same CI-built image and write one trial row. Never start a
replay or a probe with `docker run` or `python -m engine.run` directly.

| Path | Role |
|---|---|
| `config.py` | The runtime contract, the fixed account, arguments, window parsing, the effective configuration and `--describe` |
| `load.py` | The hash-checked strategy source, the exported market Catalogs, pool membership and daily warm-up |
| `run.py` | The `BacktestNode` run, the capital observer and the execution binding check |
| `report.py` | Native reports, `order_events.jsonl.gz`, `exposures.csv.gz` and `summary.json` |
| `audit.py` | Independent audit of every run's native reports and stop protection |
| `compare.py` | The semantic fingerprint of one run's native reports (`python -m engine.compare`) |
| `compare_reports.py` | Engineering parity between two runs |
| `runtime/` | Image build inputs |

## Four inputs

The runner takes the strategy reference, the inputs, the window and the account, nothing else.

- **Strategy.** One complete source file, its entry class and SHA-256 (and, when sealed, its Dolt
  binding). The `r1-native-v5` contract is in the [strategy-authoring
  reference](../.agents/skills/research-round/references/strategy-authoring.md). The file holds every
  rule and constant, sizing included; a variant is a new revision. There are no signal, exit,
  warmup or sizing options: a source that needs daily warmup declares `DAILY_WARMUP = True`.
- **Inputs.** One commit of the market database ([`market`](../market/README.md))
  and the contracts: `--symbols SYMBOL ...` (Binance symbols such as `BTCUSDT`) or `--universe pool`
  (every contract the pool holds in some month of the trade window). `artifacts run` exports the
  commit (`--market`, default `main`) into one Catalog per contract and passes the runner
  `--market-root`, `--market-commit`, `--pool` and the symbols; the runner checks each Catalog's
  `export.json` against the commit and window. Every strategy instance receives its contract's pool
  membership as `pool_membership` ([UTC start, end) nanosecond intervals); the pool rule's "after
  leaving the pool, only close" is the source's to apply, and no audit judges it.
- **Window.** `--start`, `--trade-start` and `--end` need an explicit `Z` or UTC offset, at most six
  fractional digits and no fractional offset, and fall on five-minute boundaries with
  `start <= trade-start < end`; the host timezone is never consulted.
- **Account.** Fixed in `config.py` (`ACCOUNT_CONTRACT`): one 100,000 USDT Nautilus `BacktestNode`
  margin account shared by every instrument, leverage 1, five-minute bar execution, the exported
  instruments' assumed fees (maker 0.0002, taker 0.0005) and the stored funding. The published `nautilus_trader==2.0.0rc3` owns data replay, orders,
  fills, funding settlement, risk, portfolio accounting and reports. No exchange trading credential
  is needed.

The export holds 5-minute LAST bars, MARK price updates (each 5-minute MARK close), funding updates
and the daily LAST bars before `--start`, all derived from the stored one-minute bars;
`BacktestNode` loads them directly and the runner checks that it loaded exactly the exported
counts. A source declaring `DAILY_WARMUP = True` receives the unbroken run of daily bars that ends
1 ms before `--start` (at least 200). There is no second matching or account engine.

## Explore a source

```bash
uv sync --frozen
STRATEGY_WORKDIR=$(mktemp -d /tmp/trade-draft.XXXXXX)
uv run --frozen python -m research.records.cli strategy export STRATEGY-ID@N \
  --destination "$STRATEGY_WORKDIR/strategy.py"
uv run --frozen python -m research.records.artifacts run --explore \
  --strategy-file "$STRATEGY_WORKDIR/strategy.py" --strategy-class ENTRY-CLASS \
  --output "$STRATEGY_WORKDIR/pool" -- \
  --universe pool \
  --start 2020-02-01T00:00:00Z --trade-start 2020-09-01T00:00:00Z \
  --end 2026-10-01T00:00:00Z
```

A draft file needs no export. Exploration hashes the file it runs; a sealed run binds the source
to the ledger's revision, its commit and exact source hash. `replay_diagnostics`
supplies source counters and `replay_integrity_findings` source failure findings; any finding or
denied/rejected order fails the run.

## Runtime image

The image holds Python, Nautilus, the locked dependencies and `engine` (runner, auditor and fingerprint); strategy
bodies, Dolt configuration and research records are excluded. The
[`runtime-image`](../.github/workflows/runtime-image.yml) workflow builds it on a native arm64
runner for `linux/arm64` only and pushes it to `ghcr.io/qoeop/trade-runtime`, labelled with the
commit it was built from (`org.opencontainers.image.revision`), when a runtime input changes
(`engine/**/*.py`, the Dockerfile, `pyproject.toml`, `uv.lock`). A main build moves the `main`
tag, the current runtime; a pull request build is tagged `pr-N`; every build is tagged
`sha-COMMIT`. Images are not built on a workstation, and there is no local registry or
hand-written runtime identity.

`artifacts run` without `--runtime` pulls `main` and records the manifest digest it resolved;
`--runtime` takes another CI tag or digest reference. The identity (`image_ref` with its
`@sha256:` digest, `image_digest`, `platform`, `runtime_contract`) is read from the image, and
`python -m engine.run --describe` inside it reports its code hashes and the resolved
configuration. Replay and audit run with no network, a read-only root, read-only source and input
mounts and one writable report mount. A freeze or confirmation accepts only a run on an image
whose revision is on origin/main and whose observed code equals that commit's bytes.

The project is an installable package: `uv run --frozen --project REPO python SCRIPT` imports
`engine`, `market` and `research` from a script anywhere, and the image imports `engine` from any
directory. A Nautilus probe is such a host script; it needs no `PYTHONPATH` and no `docker run`.

## Reports

Besides the native orders, fills, positions, account and returns reports, the runner writes
`order_events.jsonl.gz` and `exposures.csv.gz`.

`order_events.jsonl.gz` holds the unchanged `to_dict()` of every native event of every cached order,
read after the replay: initialization, submission, acceptance, updates, fills, cancellation and
expiry, which the terminal order rows lack. Orders are grouped by client order ID and keep their own
event order; line order across orders is not the engine's processing order. The gzip header time
is zero, so equal histories give equal bytes; event IDs are fresh UUIDs in every run.

In `exposures.csv.gz`, a row labelled with bar timestamp T holds a position open after every event
before the next bar timestamp, including fills stamped between bars, valued with the native
`Position.notional_value` and `Position.unrealized_pnl` at T's MARK. An observer values the
positions once the first MARK of the next timestamp shows that point reached, and the runner values
the last timestamp after every component stopped. It adds no timer: in rc3 probes a five-minute
timer made a run with many resting orders more than ten times slower. Balances and margins are not
repeated: use the latest account state before the next bar timestamp. A run fails integrity if a
timestamp or an open position goes unvalued.

The auditor checks report identities, links, stop protection throughout the replay and reported
account economics, the same way for every strategy. It first
reconciles the order event history with the orders and fills reports, then applies each timestamp's
events together and reads, per strategy and instrument, the position and the unfilled quantity of
accepted reduce-only stop orders on the closing side (stop-market, stop-limit, trailing). A
position larger than that for longer than one five-minute bar fails the run; `audit.json` lists each
such interval in `uncovered_intervals` with its start, end, quantities, the orders filled into the
position and the stops whose end uncovered it. A source declaring `USES_STOP_LOSS = False` (recorded
as `strategy_uses_stop_loss` in `summary.json`) gets the same list without the refusal.

The auditor (`python -m engine.audit --run REPORTS --output FILE`) exits 0 when the run passes, 1
with findings (the result is written) and 2 without auditing when a report or the event history is
missing or the summary is unreadable. It reads the coverage receipt `input-coverage.json` from the
report directory's parent: a summary that counts native lifecycle events without that receipt is a
finding.

A strategy constructor or callback (and `replay_diagnostics` or `replay_integrity_findings`) that
raises leaves a structured receipt in `runtime_failures.jsonl` (stage, exception type, message,
traceback, instrument) before the exception goes on; the runner then exits nonzero even when the
engine caught the exception and finished. Without a failure the file is not written.

The auditor does not prove a source's signal clock, order geometry, staged-exit races or other source-specific invariants: the strategy checks those in
`replay_integrity_findings`, or a native probe does before the property is claimed. Seals from
images before 2026-10-10 also ran budgeted-tier geometry gates for a fixed list of legacy signal
variants; their sealed `audit.json` keeps those results.

The fingerprint stage (`python -m engine.compare`) reads the reports and writes only
`fingerprint.json`: per table (orders, fills, positions, account, returns, order events, exposures)
the row count, a whole-table hash and one hash per UTC day, after renumbering the random event, trade
and snapshot IDs by first appearance and sorting every table by all its columns; the account,
returns and exposures files also carry their byte hash. Two replays of one run give equal
fingerprints; a sealed run is reproduced only when they match.

## Paired acceptance

A change that should preserve behavior (runner, data adaptation, dependency or Nautilus) is
accepted by paired native replays of the same source, inputs, window and account: the reference in
the current main image, the candidate in the pull request's image. Run a BTC/ETH pilot of each
affected source, then the full instrument set:

```bash
uv run --frozen python -m research.records.artifacts run --explore --runtime ghcr.io/qoeop/trade-runtime:main \
  --strategy-file "$STRATEGY_WORKDIR/strategy.py" --strategy-class ENTRY-CLASS \
  --output "$STRATEGY_WORKDIR/reference" -- RUNNER-ARGS
uv run --frozen python -m research.records.artifacts run --explore --runtime ghcr.io/qoeop/trade-runtime:pr-N \
  --strategy-file "$STRATEGY_WORKDIR/strategy.py" --strategy-class ENTRY-CLASS \
  --output "$STRATEGY_WORKDIR/candidate" -- RUNNER-ARGS
uv run --frozen python -m engine.compare_reports \
  "$STRATEGY_WORKDIR/reference/reports" "$STRATEGY_WORKDIR/candidate/reports"
```

When the contract changes, the source must accept both constructors, and the reference runs from a
checkout of the reference commit, whose `artifacts run` passes that runner its own arguments. Inspect orders, fills, positions, fees, funding
adjustments, account rows, returns and per-coin diagnostics, plus each run's audit. A clean exit is
not parity. The pinned rc3 Strategy activates its native take-profit child before the stop child to
avoid a synchronous sibling rejection; recheck this before changing Nautilus.

## History

Seals from the `backtest/r1` layout (`r1-native-v1` to `v3`) are no longer read by current code;
`research.records.runtime.LAYOUTS` knows only `r1-native-v5`. Their directories and locally built
images remain until WS7; the v1 and v2 constructors received sizing arguments and the v1 to v3
runners took signal, exit and warmup options that later contracts refuse. `r1-native-v4` read
prepared minute and daily Catalog directories, identified by their file-tree hashes, and a per-coin
quantity CSV whose quantity reached the constructor as `trade_size`; `r1-native-v5` reads an
exported market commit, identified by that commit, and passes no quantity. `r1-native-v5` has two image
layouts (`research.records.runtime.LAYOUTS`): images built before the package moved from `backtest/`
to `engine/` keep the same strategy contract under the old module paths, with no fingerprint stage
and the earlier key names (`native_account`, `strategy_source_sha256`), and stay runnable. Each
image's layout is read from the image itself: a probe for the module it holds, then the source paths
its `--describe` reports.

The parity receipts of the earlier migrations (Node transition, H18a/H19a funding loader, single
file, Dolt/OCI) are kept at
[`5700ceb`](https://github.com/qOeOp/trade/tree/5700ceb80e502084a9798f63871fa508cb6e6b95/backtest/r1/receipts);
they accept their own historical implementations, not later execution paths. The H23a–H27a paired
reports are [fixed historical
evidence](https://github.com/qOeOp/trade/tree/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/results).
Exposed-year implementation acceptance is not independent strategy qualification.

## Recovery boundaries

A stored run holds the revision's source, resolved configuration, observed runtime identity, input
identity (market database, commit, pool rule and contracts) and the native reports, in the research
ledger and its `dolt_backup` copy. It does not hold the image or the exported Catalogs: full replay
recovery needs the image (pull its digest from GHCR) and the market commit, which a new export
turns into the same Catalogs. The first migration's custody locations and
contract are recorded in the [migration record](../docs/plans/dolt-strategy-oci-migration.zh.md);
historical local addresses are not product dependency paths.
