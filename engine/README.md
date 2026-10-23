# Native replay

Every native replay goes through the one replay entry (`replay.entry`, reached through the command
line: `replay explore`, `replay precheck`, `replay run`, `replay reproduce`): it exports the market
inputs, probes the CI-built image, writes the trial and its start receipt, then runs `python -m
engine.run`, the native auditor and the fingerprint in that image. Never start a replay or a probe
with `docker run` or `python -m engine.run` directly.

| Path | Role |
|---|---|
| `config.py` | The runtime contract, the fixed account, arguments, window parsing, the effective configuration, the runtime source identity, `--describe` and the runner's refusal codes |
| `load.py` | The hash-checked strategy source and its run identity, the exported market Catalogs, universe membership, daily warm-up, the source's diagnostics, shared membership intersection, entry scopes and the lifecycle events rebuilt from the coverage receipt |
| `run.py` | The streamed `BacktestEngine` run, strategy construction and guarded callbacks, lifecycle episodes, the capital observer, its expected MARK count and findings, and the execution binding check |
| `report.py` | Native reports, `order_events.jsonl.gz`, the `exposures.csv.gz` writer and `summary.json` with its statistics |
| `audit.py` | Independent audit of every run's native reports, submission timing, entry membership, stop protection and lifecycle terminations; its finding codes |
| `compare.py` | The semantic fingerprint of one run's native reports (`python -m engine.compare`) |
| `compare_reports.py` | Engineering parity between two runs |
| `runtime/` | Image build inputs |

## Four inputs

The runner takes the strategy reference, the inputs, the window and the account, nothing else.

- **Strategy.** One complete source file, its entry class and SHA-256, and the execution binding
  every replay (exploration, precheck, sealed run, reproduction) passes the same way: the runtime
  identity and effective configuration the probe reported, refused as `EXECUTION_BINDING_MISMATCH`
  when they differ from what the runner resolves itself. The `replay-contract@v6` contract is in the [strategy-authoring
  reference](../.agents/skills/research-round/references/strategy-authoring.md). The file holds every
  rule and constant, sizing included; a variant is a new revision. There are no signal, exit,
  warmup or sizing options: a source that needs daily warmup declares `DAILY_WARMUP = True`.
- **Inputs.** One commit of the market database ([`market`](../market/README.md))
  and the contracts: `--symbols SYMBOL ...` (Binance symbols such as `BTCUSDT`) or `--universe pool`
  (every contract the universe holds in some month of the trade window), and optionally the
  commit's lifecycle bundle (`--lifecycle-bundle lifecycle-<commit>`). The replay entry exports the
  commit into one Catalog per contract and passes the runner `--market-root`, `--market-commit`,
  `--universe` (the membership file it wrote) and the symbols; the runner checks each Catalog's
  `export.json` against the commit, the window and the one-minute timeframe. Every strategy instance
  receives its contract's membership as `universe_membership` ([UTC start, end) nanosecond
  intervals, cut at the listing and at the first PRE_CLOSE or termination of its lifecycle
  episode); the source manages exits, and the independent audit requires only-reduce orders
  outside those intervals and checks that old entry residuals have ended. A contract whose episode does not intersect the window gets no instance.
- **Window.** `--start`, `--trade-start` and `--end` need an explicit `Z` or UTC offset (whole
  minutes, at most six fractional digits) and fall on the one-minute grid with
  `start <= trade-start < end`; the host timezone is never consulted, and the effective
  configuration holds them as `...Z` text.
- **Account.** Fixed in `config.py` (`ACCOUNT_CONTRACT`): one 100,000 USDT Nautilus margin account
  shared by every instrument, leverage 1, one-minute bar execution (`execution_bar_minutes = 1`),
  the exported instruments' assumed fees (maker 0.0002, taker 0.0005) and the stored funding. Fills
  use the native `DefaultFillModel` with both probabilities 0, so it draws no random numbers: a
  resting limit fills at its price only when a bar trades through it (a touch alone never fills),
  and the model adds no slippage (a market order still takes a quarter of the bar's volume at the
  close and the rest one tick worse). Each bar visits the extreme nearer its open first
  (`bar_adaptive_high_low_ordering`), which decides a bracket whose stop and target fall in one bar;
  consumed-liquidity and queue tracking stay off. The
  published `nautilus_trader==2.0.0rc3` owns data replay, orders, fills, funding settlement, risk,
  portfolio accounting and reports. No exchange trading credential is needed.

The export holds the stored one-minute LAST bars, one MARK price update per one-minute MARK bar,
funding updates, every complete daily LAST bar before `--end` and, with a lifecycle bundle, the window's
native `InstrumentStatus` (PRE_CLOSE, CLOSE) and `InstrumentClose` events. The runner checks that
the engine consumed exactly the exported counts. A source declaring `DAILY_WARMUP = True` receives
the unbroken run of daily bars that ends 1 ms before its instance's input start (at least 200). An
instance starts at the replay's start, its contract's listing, or, when the warm-up does not hold
yet, the first instant it does; it gets no data stamped earlier and trades from there, and a
contract where it never holds in the window gets no instance. Both are summary limitations; a run in
which no contract can start is `WARMUP_INSUFFICIENT`. There is no second matching or account engine.

The effective configuration (`--describe`) holds `runtime_contract`, `execution_bar_minutes`,
`market_root`, `market_commit`, `universe_path`, `universe_sha256` (the membership file's bytes),
`symbols`, `start`, `trade_start`, `end` and `account`; its digest leaves out the two host paths, so
the registration's probe and the replay compare the same digest. A runner refusal starts with a
code of `config.REFUSALS`.

## Streaming and memory

`BacktestNode` with one data configuration per contract and type loads every configuration whole
and merge-sorts them before it streams to its engine, so its memory grows with the window: on
one-minute bars, 40 contracts took 2.8 GiB for three months and 5.3 GiB for six, about 0.26 GiB per
million events. The runner therefore drives the pinned `BacktestEngine` itself. Bars and MARK
updates come from the exported Parquet files through Nautilus's `DataBackendSession`, one session per
seven days holding only that window's files and rows (a session reads ahead in every file it holds);
funding and lifecycle events are read whole. Events of one `ts_init` keep the node's order (contract
by contract: MARK, funding, bars, status, close) and the engine gets the node's chunks (50,000
events, extended to the last event's `ts_init`). On the same inputs this gives the node's reports,
event history, exposures and fingerprint; the runner adds each instrument once where the node added
it once per configuration, which renumbers the venue order and trade IDs only. Six months of 40
contracts take 1.3 GiB. The capital observer writes exposure rows as it values them and prints one
JSON progress line to standard error every minute of wall time (simulation time, MARK updates,
valued timestamps, RSS).

## Explore a source

```bash
uv sync --frozen
STRATEGY_WORKDIR=$(mktemp -d /tmp/trade-draft.XXXXXX)
uv run --frozen python -m cli.main candidate export --candidate STRATEGY-ID@N \
  --output "$STRATEGY_WORKDIR/strategy.py"
uv run --frozen python -m cli.main replay explore \
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

A replay command without `--runtime` pulls `main` and records the manifest digest it resolved;
`--runtime` takes another CI tag or digest reference. The identity (`image_ref` with its
`@sha256:` digest, `image_digest`, `platform`, `runtime_contract`, `build_revision`) is read from the
image (`runtime.image.resolve`), and
`python -m engine.run --describe` inside it reports its code hashes and the resolved
configuration. Replay and audit run with no network, a read-only root, read-only source and input
mounts and one writable report mount. A freeze or confirmation accepts only a run on an image
whose revision is on origin/main and whose observed code equals that commit's bytes.

The project is an installable package: `uv run --frozen --project REPO python SCRIPT` imports
the product packages (`engine`, `market`, `ledger`, `report` and the rest) from a script anywhere, and the image imports `engine` from any
directory. A Nautilus probe is such a host script; it needs no `PYTHONPATH` and no `docker run`.

## Reports

Besides the native orders, fills, positions, account and returns reports, the runner writes
`order_events.jsonl.gz` and `exposures.csv.gz`.

`order_events.jsonl.gz` holds the unchanged `to_dict()` of every native event of every cached order,
read after the replay: initialization, submission, acceptance, updates, fills, cancellation and
expiry, which the terminal order rows lack. Orders are grouped by client order ID and keep their own
event order; line order across orders is not the engine's processing order. The gzip header time
is zero, so equal histories give equal bytes; event IDs are fresh UUIDs in every run.

In `exposures.csv.gz`, a row labelled with one-minute bar timestamp T holds a position open after every event
before the next bar timestamp, including fills stamped between bars, valued with the native
`Position.notional_value` and `Position.unrealized_pnl` at T's MARK. An observer values the
positions once the first MARK of the next timestamp shows that point reached, and the runner values
the last timestamp after every component stopped. It adds no timer: in rc3 probes a five-minute
timer made a run with many resting orders more than ten times slower. Balances and margins are not
repeated: use the latest account state before the next bar timestamp. A held contract without a
MARK at a bar (a hole in its one-minute data) is valued at its latest MARK while that is at most 60
minutes old (`MARK_CARRY_MAX_MINUTES`, an uncalibrated example value); each such hole is one
interval in the summary's `mark_carry` and a limitation. A run fails integrity if a timestamp or an
open position goes unvalued: one `CAPITAL_VALUATION_GAP` finding per unvalued interval.

Warm-up permits reading data, updating indicators and preparing unsubmitted order objects. The
independent auditor checks native `OrderSubmitted` and `OrderEmulated.ts_event` against
`summary.trade_start_by_strategy`, captured from the runner's plan before source construction. Each
submitting strategy instance uses the later of the global trading start and its own input readiness
(listing and daily warm-up included), even when its order targets another contract. A submission
before that instant is `ORDER_BEFORE_TRADE_START` and makes the entire run invalid, including an
unfilled order; exactly at it is allowed by this check. Missing or invalid starts or unplanned
submitters are `TRADE_START_INVALID`; with the input coverage receipt the auditor also checks the
window, exported instance identities and listing floors. It never uses source diagnostics or a
mutable strategy attribute as the start. There is no runner-side order interception or timestamp
repair. Causal input clocks remain a separate source-review obligation. Old summaries lacking this
metadata cannot pass the new audit; old pinned images and sealed verdicts are unchanged. New code
requires a CI-built image digest before research replays can use this boundary.

Outside an instrument's entry membership (including PRE_CLOSE and monthly universe gaps), every
exit and protective order must carry native `reduce_only=True`; an unmarked intended exit also fails.
`load.entry_windows` rebuilds intervals from the trusted coverage receipt with the same
`episode_membership` intersection used by the runner. `audit.entry_findings` checks the actual target
instrument, native submissions/emulation/releases/updates/fills and each old entry's remaining quantity.
A resting entry or partially filled entry must have its remainder ended by native cancellation/expiry
at the cutoff, even if it never fills. Cancellation/expiry at the cutoff is allowed; an entry fill
there still fails. There is no one-bar tolerance, forced exit at pool removal or automatic cancellation;
rejoining the pool restores entry permission. A canceled partial bracket still needs its filled part
re-protected because Nautilus cancels its children. The pinned PRE_CLOSE does not itself reject entry
orders; CLOSE rejects even exits. A GTD requested expiry between matching events can produce its
native OrderExpired only at the next matching event: ensure the native cancellation/expiry is complete
by the cutoff, do not substitute the requested deadline. Violations are
`ENTRY_ORDER_OUTSIDE_MEMBERSHIP`; absent/invalid receipts, scope or native flags are
`ENTRY_SCOPE_INVALID`. No new ledger field or net-position execution model is added. Native settlement
orders already carry `reduce_only=True` and need no name-based exemption from this check.

The auditor checks report identities, links, submission timing, entry membership, stop protection throughout the replay and reported
account economics, the same way for every strategy. It first
reconciles the order event history with the orders and fills reports, then applies each timestamp's
events together and reads, per strategy and instrument, the position and the unfilled quantity of
accepted reduce-only stop orders on the closing side (stop-market, stop-limit, trailing). A
position larger than that for longer than one one-minute bar fails the run; `audit.json` lists each
such interval in `uncovered_intervals` with its start, end, quantities, the orders filled into the
position and the stops whose end uncovered it. A source declaring `USES_STOP_LOSS = False` (recorded
as `strategy_uses_stop_loss` in `summary.json`) gets the same list without the refusal.
Shortfalls lasting at most one minute are neither refused nor listed; passing this audit does not
prove continuous protection. This stop-coverage threshold is separate from the entry cutoff, which
has no one-bar tolerance. Partial-fill quantities already reconcile through native events and
reports; the source restores protection from the actual native position minus working stop coverage.

The auditor (`python -m engine.audit --run REPORTS --output FILE`) exits 0 when the run passes, 1
with findings (the result is written) and 2 without auditing when a report or the event history is
missing or the summary is unreadable. It reads the coverage receipt `input-coverage.json` from the
report directory's parent: the entry-membership audit requires it even without lifecycle events;
missing membership must not become unrestricted permission. With the receipt, `load.lifecycle_events` rebuilds the window's terminations from the
exported episodes and checks them against the native counts; before each termination without a
settlement price (a CLOSE status with no `InstrumentClose`) every native position of the contract
must be flat and every order filled or ended (`POSITION_OPEN_AT_TERMINATION`,
`ORDER_OPEN_AT_TERMINATION`, one finding per order); an order created at or after any termination is
`LATE_ORDER_EVENT` (the engine's own `EXPIRATION-` orders at a settlement excepted). A settlement price
is the engine's own settlement and reconciles like any fill; a CLOSE status at or before it closes
the market. A contract whose bars stop more than 60 minutes before the window's end and before its
termination (or without one) is `DATA_ENDS_WITHOUT_TERMINATION`. Every finding starts with a code of
`audit.FINDINGS` followed by its locating detail; the ledger rebuilds the same events with the same
function at ingest.

A strategy constructor, callback, callback registered on the clock (`set_timer`, `set_timer_ns`,
`set_time_alert`, `set_time_alert_ns`, `register_default_handler`), `replay_diagnostics` or
`replay_integrity_findings` that raises leaves a structured receipt in `runtime_failures.jsonl` before
the exception goes on; the runner then exits nonzero even when the engine caught the exception and
finished. So does any exception that ends the runner before its verdict, with its stage
(`execution_binding`, `load`, `inputs`, `replay`, `reports`) and, for a refusal, its code. Each line
(`runtime-failure-v2`) is one distinct (exception type, stage, instrument, message) with `count` and
the first `traceback`; message and traceback are clipped, and after 100 distinct records further new
ones are counted in one `receipt_overflow` record, so a callback failing on every bar stays one line.
The file is rewritten when a record is new or its count reaches a power of two, and once more when
the runner ends. Without a failure the file is not written.

The auditor does not prove a source's signal clock, order geometry, staged-exit races or other
source-specific invariants. Native order events prove submission and fill times, but cannot
independently prove when an arbitrary strategy decided; a self-reported decision timestamp is not
an independent audit. Source contracts, native precheck evidence and independent source review
continue to cover causal clocks. Source-specific integrity checks and native probes provide evidence
for their stated properties before those properties are claimed.

The fingerprint stage (`python -m engine.compare`) reads the reports and writes only
`fingerprint.json`: per table (orders, fills, positions, account, returns, order events, exposures)
the row count, a whole-table hash and one hash per UTC day, after renumbering the random event and
snapshot UUIDs by first appearance (trade IDs are derived, and kept) and sorting every table by all its columns; the account,
returns and exposures files also carry their byte hash. Two replays of one run give equal
fingerprints; a run without one is stored invalid (`FINGERPRINT_MISSING`), and a sealed run is
reproduced only when they match. `engine/compare.py` is part of the runtime identity
(`fingerprint_source_sha256`), so a freeze or confirmation checks its bytes against the image's revision.

## Paired acceptance

A change that should preserve behavior (runner, data adaptation, dependency or Nautilus) is
accepted by paired native replays of the same source, inputs, window and account: the reference in
the current main image, the candidate in the pull request's image. Run a BTC/ETH pilot of each
affected source, then the full instrument set:

```bash
uv run --frozen python -m cli.main replay explore --runtime ghcr.io/qoeop/trade-runtime:main \
  --strategy-file "$STRATEGY_WORKDIR/strategy.py" --strategy-class ENTRY-CLASS \
  --output "$STRATEGY_WORKDIR/reference" -- RUNNER-ARGS
uv run --frozen python -m cli.main replay explore --runtime ghcr.io/qoeop/trade-runtime:pr-N \
  --strategy-file "$STRATEGY_WORKDIR/strategy.py" --strategy-class ENTRY-CLASS \
  --output "$STRATEGY_WORKDIR/candidate" -- RUNNER-ARGS
uv run --frozen python -m engine.compare_reports \
  "$STRATEGY_WORKDIR/reference/reports" "$STRATEGY_WORKDIR/candidate/reports"
```

When the contract changes, the source must accept both constructors, and the reference runs from a
checkout of the reference commit, whose `replay explore` passes that runner its own arguments. Inspect orders, fills, positions, fees, funding
adjustments, account rows, returns and per-coin diagnostics, plus each run's audit. A clean exit is
not parity. The pinned rc3 Strategy activates its native take-profit child before the stop child to
avoid a synchronous sibling rejection; recheck this before changing Nautilus.

## History

`runtime.image.LAYOUTS` knows only `replay-contract@v6`; no image or seal of an earlier contract is read
or executed. The parity receipts of the earlier migrations (Node transition, H18a/H19a funding loader, single
file, Dolt/OCI) are kept at
[`5700ceb`](https://github.com/qOeOp/trade/tree/5700ceb80e502084a9798f63871fa508cb6e6b95/backtest/r1/receipts);
they accept their own historical implementations, not later execution paths. The H23a–H27a paired
reports are [fixed historical
evidence](https://github.com/qOeOp/trade/tree/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/results).
Exposed-year implementation acceptance is not independent strategy qualification.

## Recovery boundaries

A stored run holds the revision's source, resolved configuration, observed runtime identity, input
identity (market database, commit, pool rule and contracts) and the hashes and semantic fingerprint
of the native reports, in the research ledger and its `dolt_backup` copy. It does not hold the image or the exported Catalogs: full replay
recovery needs the image (pull its digest from GHCR) and the market commit, which a new export
turns into the same Catalogs. Historical local custody addresses are not product dependency paths.

Upgrading Nautilus starts with the paired acceptance above: rc6 already changed the Catalog format
and moved fees into the venue's fee model, and the funding and lifecycle files are written in the
engine's internal Arrow layout (rc3 has no Python writer for them).
