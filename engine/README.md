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
| `report.py` | Native reports, `order_events.jsonl.gz`, `fill_volumes.csv`, the `exposures.csv.gz` writer and `summary.json` with its statistics |
| `audit.py` | Independent audit of every run's native reports, submission timing, entry membership, stop protection and lifecycle terminations; its finding codes |
| `compare.py` | The semantic fingerprint of one run's native reports (`python -m engine.compare`) |
| `compare_reports.py` | Engineering parity between two runs |
| `runtime/` | Image build inputs |

## Four inputs

The runner takes the strategy reference, the inputs, the window and the account, nothing else.

- **Strategy.** One complete source file, its entry class and SHA-256, and the execution binding
  every replay (exploration, precheck, sealed run, reproduction) passes the same way: the runtime
  identity and effective configuration the probe reported, refused as `EXECUTION_BINDING_MISMATCH`
  when they differ from what the runner resolves itself. The `replay-contract@v7` contract is in the [strategy-authoring
  reference](../.agents/skills/research-round/references/strategy-authoring.md). The file holds every
  rule and constant, sizing included; a variant is a new revision. There are no signal, exit,
  warmup or sizing options: a source that needs daily warmup declares `DAILY_WARMUP = True`.
- **Inputs.** One commit of the market ([`market`](../market/README.md))
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
  the venue's maker and taker rates from the export receipts' assumed fees (maker 0.0002, taker 0.0005;
  a native `MakerTakerFeeModel`) and the stored funding. Fills
  use the native `DefaultFillModel` with both probabilities 0, so it draws no random numbers: a
  resting limit fills at its price only when a bar trades through it (a touch alone never fills),
  and the model adds no slippage (a market order still takes a quarter of the bar's volume at the
  close and the rest one tick worse). Each bar visits the extreme nearer its open first
  (`bar_adaptive_high_low_ordering`), which decides a bracket whose stop and target fall in one bar;
  consumed-liquidity and queue tracking stay off. The
  published `nautilus_trader==2.0.0rc7` owns data replay, orders, fills, funding settlement, risk,
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

The runner argument `--execution` chooses the execution environment, and the choice is part of the
account contract in the effective configuration (so of every run's identity and of the comparability of
runs); a source never chooses it (`ENVIRONMENT_DECLARED` if it declares `QUOTE_EXECUTION` or a margin
rate). `bars` (the default) is the bar environment above. `quotes` needs `--initial-margin` and
`--maintenance-margin` (decimal strings, 0 < maintenance <= initial < 1: the Binance bracket of the
strategy's largest position; `MARGIN_RATES_INVALID` otherwise, also when bars is given a rate): the
export's best bid/ask quotes (`market import-quotes`, inferred from Binance aggTrades under a declared
rule, both sizes the instrument's max quantity) are streamed to the venue and drive matching on an L1
book, bar execution is off (bars only feed signals), the venue's native liquidation is on
(`liquidation_enabled`, trigger ratio 1.0, open orders cancelled first) with the standard margin model
(maintenance = notional x the rate, not divided by leverage), and the instruments carry the two rates.
An active contract whose export holds no quote in some UTC month of its trading window (from its trade start to the
window end or its termination) is `QUOTES_MISSING`, naming each such month: there bar execution is off, so a month
without quotes would replay without matching. The quotes count in the consumed
events. The summary names the environment (`execution`) and its limitations state the model, which is
declared, not the exchange's: equity is valued at the cached best bid/ask, not the mark price; the
maintenance margin is fixed at the position's average entry price; fills take the best price with no
depth; the quotes themselves are an inference from trades (see `market/README.md`).

Trade ticks are signal input for the quote environment. The entry's `--trade-ticks` (a host flag, never
passed to the runner; `TRADE_TICKS_NEED_QUOTES` without `--execution quotes`, where a market order fills
at once at the previous bar's close, so one a trade prompts mid-minute would fill at a price up to 59 seconds
older than the trade) exports every stored aggregate trade
(`market import-trades`) as one native `TradeTick` and counts it in the receipt (`counts.trade`, present
only then, so an export without trades keeps its bytes). The runner streams the trades of every contract
whose receipt counts them, each wrapped as `CustomData(DataType("TradeTick", metadata={"instrument_id":
<id>}), tick)`: a strategy subscribes with `subscribe_data` on that data type and gets the tick as
`data.data` in `on_data`. The venue never sees custom data, so trades match no order and move no book; a
native `TradeTick` would overwrite the venue's L1 book whatever `trade_execution` says (probed on
2.0.0rc7: a market order after a trade below the bid filled at the trade's price, not the quoted ask).
A month of the trading window without exported trades is `TRADES_MISSING`. A source subscribing to trades
the run does not stream (no `--trade-ticks`, or native `subscribe_trades`, which is never served) would see
none: the runner stops after the chunk it subscribed in and refuses `TRADES_NOT_SERVED`. Paper trading
streams no trades (its orders match bars, as in the bar environment), so a trade subscription stops a paper
run with the same code.

Open interest and long/short ratios (`market import-metrics`) are signal input in either environment. The
entry's `--metrics` exports every stored row the window shows by the rule `binance-metrics-visible-v1`
(the receipt's `metrics_rule`): a row stamped `create_time` gets `ts_event = create_time + 5 min`, the
instant its open interest describes, and `ts_init = create_time + 10 min`, past the public REST
publication. Both are whole minutes, so in the bar environment an order the row prompts fills at the close
of the bar that ends there, never at a price older than the decision. The receipt counts the rows
(`counts.metrics`, present only then). The runner streams them as `CustomData(metrics_data_type(<id>),
Metrics(...))`: `engine.run.Metrics` holds `instrument_id`, `sum_open_interest` (base asset), the three
ratios `count_toptrader_long_short_ratio`, `sum_toptrader_long_short_ratio` and `count_long_short_ratio`
as exact `Decimal` (`None` where the archive left one empty), `ts_event` and `ts_init`. A strategy
subscribes with `subscribe_data(DataType("Metrics", metadata={"instrument_id": <id>}))` and reads
`data.data` in `on_data`. Unlike `--trade-ticks`, `--metrics` is also passed to the runner, which then
refuses `METRICS_MISSING` for a month of an active contract's trading window without exported metrics; an
image older than the option refuses it as `UNKNOWN_OPTION` at the probe. It stays out of the effective
configuration: the exported metrics files already carry it into the input identity. A subscription to metrics
the run does not stream, and any in paper trading, is `METRICS_NOT_SERVED`.

The effective configuration (`--describe`) holds `runtime_contract`, `execution_bar_minutes`,
`market_root`, `market_commit`, `universe_path`, `universe_sha256` (the membership file's bytes),
`symbols`, `start`, `trade_start`, `end` and `account`; its digest leaves out the two host paths, so
the registration's probe and the replay compare the same digest. A runner refusal starts with a
code of `config.REFUSALS`.

## Native strategy allocation

Replay, Paper and Live call the source allocator with the same converted inputs passed to its
initializer, including inherited source allocators. Sources using only `__init__` retain the native
default allocation. In rc7, passing `StrategyConfig` only to `super().__init__` changes the Python
configuration object but does not configure the native order factory or management features.
A source needing those features uses a synchronous, undecorated module-level class method:

```python
def __new__(cls, instrument_id, bar_type, **kwargs):
    return Strategy.__new__(cls, StrategyConfig(
        strategy_id=kwargs["strategy_id"], use_uuid_client_order_ids=True))
```

`Strategy` must be the unaliased, unshadowed import from `nautilus_trader.trading`. Apart from an
optional docstring this method contains only that direct return; `cls` is used only as its first
argument. Other allocator spellings, aliases and reflection remain `SOURCE_REACH`. The initializer
calls `super().__init__()` to retain the native allocation configuration. The runner neither copies
configuration fields nor retries a failed allocator. This is a narrow source-reach exception, not
hostile-code isolation.

## Streaming and memory

`BacktestNode` with one data configuration per contract and type loads every configuration whole
and merge-sorts them before it streams to its engine, so its memory grows with the window: on
one-minute bars, 40 contracts took 2.8 GiB for three months and 5.3 GiB for six, about 0.26 GiB per
million events. The runner therefore drives the pinned `BacktestEngine` itself. Bars and MARK
updates (and quotes and trades) come from the exported Catalogs through `ParquetDataCatalog.query`, one
query per data type and UTC day over only the files that hold rows of that day (found from each file's
row group statistics), merged by `ts_init`; funding and lifecycle events are read whole. Events of one
`ts_init` keep the node's order (contract by contract: MARK, quotes, trades, funding, bars, status,
close; one millisecond's trades in aggregate trade ID order, after its quotes, so a market order a trade
prompts fills at the quote that millisecond ends with) and the engine gets the node's chunks (50,000
events, extended to the last event's `ts_init`). On the same inputs this gives the node's reports,
event history, exposures and fingerprint; the runner adds each instrument once where the node added
it once per configuration, which renumbers the venue order and trade IDs only. Six months of 23
contracts on one-minute bars peak at 0.7 GiB (0.9 GiB with the earlier seven-day reader). The
capital observer writes exposure rows as it values them and prints one JSON progress line to
standard error every minute of wall time (simulation time, MARK updates, valued timestamps, RSS).

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
[`runtime-image`](../.github/workflows/runtime-image.yml) workflow builds it on separate native arm64
and amd64 runners for `linux/arm64` and `linux/amd64`, and pushes it to `ghcr.io/qoeop/trade-runtime`, labelled with the
commit it was built from (`org.opencontainers.image.revision`), when a runtime input changes
(`engine/**/*.py`, the Dockerfile, `uv.lock`, the workflow or its publish script). A main build
moves the `main` tag, the current runtime; a pull request build is tagged `pr-N`, and also runs for
changes to `pyproject.toml` or the path and image check scripts, which do not rebuild main; every
build is tagged `sha-COMMIT`. Images are not built on a workstation, and there is no local registry or
hand-written runtime identity.

The shared tags are published after both native image checks pass and their small bracket reports
compare successfully. Per-platform tags append `-arm64` or `-amd64`. These packaging checks exercise
the pinned Redis snapshot/reload, engine tests, partial fills, protection and fees. They do not replace
the paired CLI acceptance below, including nonzero funding and the intended strategy and market inputs.

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
`order_events.jsonl.gz`, `exposures.csv.gz` and `fill_volumes.csv`.

`fill_volumes.csv` gives every native fill (by event ID) the LAST volume of the one-minute execution bar of its
minute: the fill time floored to the minute is the bar's open, and the bar is stamped at its close. A minute
without a bar has an empty volume. The ledger seals the fills' share of their minute's volume from it
(`capital.participation@1`); a run on an older image has no such file and no reading.

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
rejoining the pool restores entry permission. A canceled partial bracket keeps its stop and target,
resized to its filled quantity. The pinned PRE_CLOSE does not itself reject entry
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
returns and exposures files also carry their byte hash. The execution capture keeps the hash of the
whole file; the run row keeps each table's count and hashes without the per-day hashes, and
comparisons drop them from both sides, so rows stored earlier with them still match. A formal replay executes once and seals its
fingerprint after the independent audit; sealing alone does not verify repeatability. Native detail
is regenerated on demand by `replay reproduce`, restoring the sealed execution environment and, for
quotes, both margin rates. A run without a fingerprint is stored invalid (`FINGERPRINT_MISSING`), and a sealed run is
reproduced only when they match. `engine/compare.py` is part of the runtime identity
(`fingerprint_source_sha256`), so a freeze or confirmation checks its bytes against the image's revision.
There is no automatic second execution on the first use of an order mechanism. Repeated execution
under one identity checks repeatability for the scenarios exercised; changes to execution mechanisms
need relevant engineering scenarios, and behavior-preserving changes use the paired acceptance below.
Neither result establishes consistency for untested sources, windows or hosts.

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
not parity. Before 2.0.0rc7, Nautilus rejected a bracket's target when the entry's fill bar reached its
stop and canceled a partially filled entry's stop and target when the entry ended, and before
2.0.0rc5 an OTO child kept a quantity smaller than its entry's fill (rc7 resizes it to the fill);
`tests/engine/test_partial_entry_protection.py` replays these paths natively and fails if one returns.
Across rc3 and rc7 the comparator also reports two representation changes that carry no economics:
the orders report writes an absent contingency or emulation trigger as empty (rc3:
`NO_CONTINGENCY`, `NO_TRIGGER`), and the account report no longer repeats each funding
settlement's state as a second `reported=False` row.

## Paper trading

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
`STOP` in the output directory, SIGTERM, SIGINT or `--duration-seconds` cancels the working orders,
waits for the cancels and stops the node; positions stay open and are valued at their latest MARK in
`summary.json`.

`python -m cli.main paper start|resume|stop|seal|list` runs it as the product does
(`paper/runs.py`): the run is declared in the ledger (`paper_run`), then the runner container starts on a
Docker network of its own with no route out, beside an egress proxy (`python -m engine.egress`) that is the
only container also on the outbound bridge and tunnels to `fapi.binance.com` and `fstream.binance.com` on
443 alone. Docker gets an allowlisted environment and passes no host variable into either container.
`paper stop` writes the run's `STOP` file and seals; SIGTERM comes only after a timeout, since on SIGTERM
the node also shuts down by itself and the strategy misses its cancels. `paper seal` captures a run that
ended by itself. The capture is the bundle `paper-<id>-capture`: the journal by UTC day, the summary, the
egress and runner logs and `seal.json`, whose readings add the funding the Sandbox does not settle
(`docs/plans/paper-run-storage-decision.zh.md`). At most four runs per ledger run at once, one per source.

Paper recovery keeps the same unsealed run, pinned image and inputs. Each runner owns a loopback-only
native Redis cache; immutable RDB originals and their exact journal cuts are retained. The daemon invokes
`paper resume`, never a replacement `paper start`, after an interruption. Missing/dirty checkpoints,
changed inputs, unhandled journal tails, unsupported strategy state or a missing original container refuse
recovery and retain the account records. Explicit STOP/duration still seals. The original per-source limit
is three actual recovery launches per hour, including failures before the runtime can journal.

`PAPER_RECOVERY = 1` is an explicit source protocol: reviewed `on_save/on_load` hooks own all private state;
`on_start` re-establishes fixed minute and (for DAILY_WARMUP) daily-from-minute subscriptions without custom
routing or dynamic changes. User timers and nonterminal orders are outside this protocol. A source must
not rely on native account event-count/history representation or unsaved cache history. The current daily
subset resumes only within the same UTC aggregation bucket and before an unobserved funding settlement;
an unobserved first skipped boundary also refuses. No downtime trades or settlements are invented.
Actual native daily publications and minute `ts_init` are retained in their original order. A temporary
Catalog replays the unfinished bucket through Nautilus before live callbacks start. Native Redis readback
checks orders, positions, balances, margins and account events before the atomic cut is published.

A new-protocol seal stores the exact journal bytes as `events/native.jsonl.gz` (instead of per-day
re-encoding), including any interrupted final line, plus current and actually-used recovery originals.
Verification hashes the decompressed byte prefix; parsed UI events are not recovery originals. Details,
storage review and bounded native evidence are in `docs/plans/paper-native-recovery.zh.md`.

## Live execution

`python -m engine.live` is a separate, credential-bearing Binance USD-M entry point. It does not use
the Paper Sandbox account, delayed callbacks, fee model, funding adjustments or checkpoint protocol.
The operator CLI is `python -m cli.main live preflight|start|status|logs|stop|reconcile`; it uses a private
execution directory and never writes an execution into the research ledger or Paper database.

`preflight` captures immutable source inputs from an explicit research reader and commit, pins a main-CI
runtime digest, queries the account and applies the account and source checks `start` will repeat, so `status`
says `preflight_failed` and `logs` gives the refusal before any account slot is taken. A reviewed adaptation has its own source hash, separate from its
origin candidate. The result shows the origin candidate, whether this source or class differs from it, and the
candidate's out-of-sample registrations at that commit. They inform the operator and no validation is required.
`start` takes the prepared run ID, the same private credential file and `--confirm-real-orders` with the run's
`source_sha256`, then repeats
account admission. The initial trial admits one symbol and requires a flat account, Hedge/Multi-assets
mode, CROSS margin and no automatic margin addition. The venue's leverage is observed, never changed or
copied into a simulated account. A complete v2 account response must show finite nonnegative wallets
and eligible USDT wallet cash and available balance each covering the budget (at most 100 USDT).
Other collateral is not converted into an entry allowance. CROSS does not isolate this budget from
the rest of the account. Credentials are mounted only into the Live runner, not placed in argv or Docker environment.

The execution client uses native `HEDGING` with `use_position_ids=False`; each reviewed source
uses explicit native `NETTING` and UUID client order IDs. Allocation, initialization and registration must
preserve the assigned v1 strategy identity and those settings. Native managed stop is disabled and
native market exit must use reduce-only orders. The strategy OMS describes local
ownership; it is separate from the account's ability to hold both LONG and SHORT legs.

Order commands remain closed until a fresh account observation after native startup passes admission.
Account reads run in one read-only background task; the existing Observer consumes the result while
native socket and timer events continue. The worker never touches the node, source, order or cache.
Late results after STOP, disconnect or the 30-second deadline cannot re-arm or dispatch an entry.
The observer subscribes to native socket-state events. A disconnect synchronously stops the native source
before requesting node shutdown, preventing managed GTD and market-exit timers from issuing new commands.
It ends this run unresolved, preserving
venue protection, cache and account custody; a later CONNECTED event does not resume trading. New order,
modify, cancel and exit commands from the source are refused while connectivity is unverified. Already
dispatched venue commands cannot be recalled by this gate. No custom reconciliation engine or second trading
client is used. Residual fills still update the native cache and logs; stopped source callbacks no longer journal them.

Before the source stops, a disconnect or observer failure sends one native cancel for each working entry and
leaves reduce-only protection in place, because no process would protect a later fill. Orders travel over REST,
so a lost socket does not block the request, but nothing confirms the result: the run stays unresolved and the
next read of the venue decides. An entry can still fill if the cancel is lost or loses the race, and that fill
has no stop until an operator acts on the venue. A source that leaves the running state by itself (`stop`,
`fault`, `degrade`) enters the normal STOP path, marked failed.

Only reviewed independent native orders are accepted. Binance Futures in the pinned release refuses
linked OCO/OTO order lists, so a published backtest source using a bracket cannot be silently converted.
Each run permits one base-quantity LIMIT entry attempt, with another fresh account check before dispatch.
A GTD order goes to Binance with its expiry, which Binance
[keeps to the second](https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order)
and refuses when less than 600 seconds ahead; the order can end up to a second early, or late in extreme markets,
and in the 2026-11-06 trial such an end came back `CANCELED`, not `EXPIRED`. An expiry is no precise end time, and
a stop placed GTD stops protecting when it ends.
The Observer temporarily holds only that unsubmitted native order, then checks its expiry, current native
cache, connection, STOP, persistence, native source Running state and cash budget before calling native submit.
The order's strategy/trader identity must match the registered native source, so a foreign OrderFactory
cannot bypass the source's history or recovery identity. It never retries,
fabricates an order event or persists a dispatch queue. An entry rejected before native submission ends
the run. Native order history prevents a second entry after a submitted attempt.
`max_notional_per_order` is the entry's native instrument valuation at its limit price, bounded by the
cash budget. It is not a realized execution amount or loss guarantee, including for a SELL filled higher
than its limit. The native global notional cap is omitted because it also rejects necessary reductions;
all other native risk checks remain enabled. Reductions require a current native position owned by the
strategy, account and instrument, and native side/quantity validation. Order modifications are unsupported
in this trial. A declared source review flag does not establish hostile-code isolation.

Before a `preflight` or `start` takes the account, the operator's process reads the key's own permissions once from
`api.binance.com`, which the runner's egress deliberately cannot reach: a key that can withdraw is refused
(`LIVE_KEY_WITHDRAWAL`), an unclear answer or failed read is refused (`LIVE_KEY_UNVERIFIED`), and a key with no IP
restriction is a warning in the result. The runner then bounds its own clock against the venue's time, because native
requests may sign with it while signed reads here carry the venue's time: at most 1000 ms ahead (the venue's limit) and
2500 ms behind (half the 5000 ms `recvWindow`), or `LIVE_CLOCK`. The reading is kept in the private preflight snapshot.

A source must declare a stop loss: `USES_STOP_LOSS = False` is refused at preflight. How to adapt a candidate for
Live: `.agents/skills/research-round/references/strategy-authoring.md`, Live adaptation. On every one-second
observation of a `run`, each open position needs resting reduce-only stop orders on its closing side whose
remaining quantity covers it. This follows the research audit's coverage rule and reads the native cache, because
Binance Hedge orders carry no `reduceOnly` on the wire; unlike the audit, a triggered stop stops counting, since a
stop limit the market left behind protects nothing. After 90 seconds without cover from when the gap opened (the
audit's one bar plus the native open-order check; fills do not extend it), or when the check itself cannot run, the
run is marked failed and takes the STOP path. A stop the native cache holds but the venue lost is found only by
native reconciliation. A failed flat run keeps the account slot until `reconcile`. If the close is rejected or
fails, it is not retried: the node stops with the position open and possibly no stop on the venue, and `status` says
`unresolved` (see [Unresolved Live runs](#unresolved-live-runs)).

`--max-loss-usdt`, required and at most the budget, limits one run. Each second during a `run` the runner adds the
native result of every position at the venue's mark price, from a native mark subscription: fees in USDT and earlier
closed cycles count; funding and commissions in another asset do not. Reaching the limit takes the STOP path with
`stop_reason` `max_loss`, also when already flat (a working entry is withdrawn), and is not a failure, so a flat
outcome stops cleanly and releases the slot. `stop_reason` keeps the run's first cause through a later `reconcile`. A
position with no mark for 60 seconds, or a check that cannot run, counts as reaching it and also marks the run failed;
an older mark never prices a position. The limit
does not bound a gap, a lost connection or a rejected close; a trigger makes one close attempt. Do not transfer or
trade by hand during a run. Set the limit beyond the stop's loss plus slippage, or the close can collide with the stop.

STOP disables opening decisions, cancels owned opening orders, repeating the cancel every 5 seconds while one
stays open (after a request with an unknown outcome, as a native cancel-all scoped to the order's side, because
native `cancel_order` sends nothing for a PENDING_CANCEL order), waits for their final states and closes owned
positions through Nautilus. Protective orders are
retained until flat. A clean stop requires the
completed native state and a fresh exchange observation to agree. Unknown outcomes retain the account
slot and private originals. `reconcile` reopens the same native cache and queries the venue without
constructing the trading source; it registers an inert native Strategy with the original identity
and NETTING override before cache load, so an entry missing its first fill retains its original OMS.
It does not resume arbitrary strategy callbacks or issue trading commands. A verified flat
reconciliation can release custody for a new, explicitly started run. Native reconciliation never matches a close
made at Binance, which has no order this process knows: on a Hedge account the unmatched quantity becomes a separate
EXTERNAL position, and a cancelled stop stays accepted in the cache. So `reconcile` first reads the whole account, and
again when it ends: with no position on any symbol and no open or conditional order, it records `venue_flat` and
releases the slot without a native match. The next run starts from a fresh native identity, so the stale cache is
never reused; this run's native records may lack the close, and the account snapshot in its directory is the record.
A run whose runners are all proven exited without `armed.json` or a `connecting` event never constructed its
source, so it placed no order: `status` says `not_armed` and releases the slot. Its run-id cannot start again; use
a new one. A runner that is still alive, a missing container or an unknown launch keeps the slot.
A manifest's format (`live-run-v5`) binds the checks to the runner: an older image refuses it before arming,
and a run prepared under an earlier format can only `reconcile` (`LIVE_RUN_FORMAT`).
An ended run (`clean_stopped`, `reconciled_flat`, `venue_flat`, `not_armed`, or a finished preflight) gives up its containers and
network the next time `status` reads it or another run starts: their logs go to `containers/` in the run directory,
where `logs` then reads them, and `lifecycle.jsonl` records the result for `status`. An unresolved run, or any runner
that has not exited, keeps everything `reconcile` needs. After a removal `reconcile` is refused; a run that only
preflighted may still `start` and gets a new network and egress.
Reconciliation accepts the retained account modes without requiring positive funds or an empty account.
Native Multi-assets cached balances can differ from reported balances after zero updates or margin
initialization. They are not the authority for entry cash or a claim of full collateral accounting.

### Unresolved Live runs

`status` says `unresolved` when a run ended without proof that the account is flat: a disconnect, a failed check, a
rejected or failed close, a crashed runner, or a `reconcile` stopped before flat. A position may remain at Binance,
with or without its stop, and nothing will close it. Nothing notifies the operator either: someone must watch
`status` for the whole of a real run and act at once. `stop_reason` and `live logs` say what happened.

1. If `status` says `running`, run `live stop` and wait until it no longer does.
2. At Binance, on the same account, close the position and cancel every open and conditional order, including the
   run's stops. Release needs the whole account flat: any other position or order keeps the slot.
3. Run `live reconcile` with the run's credential file. On a flat account it ends at once and `status` says
   `venue_flat`, with the slot released. If it finds anything open it observes without trading until the run's
   duration or a `live stop` (after any `live stop` of this run, at once), checks the account again and ends
   `unresolved`: act at Binance and run it again.

A run that is flat but failed (exit code 1) takes step 3 alone. This needs a run prepared at `live-run-v5` or
later: `reconcile` runs the image the run pinned, and an earlier image has no `venue_flat`, so such a run is
released only by native reconciliation.

Use one fixed private root for the configured account. The local lock cannot exclude manual trading or
another host. Keep its inputs, native cache, logs and lifecycle originals together; a dead container is
not evidence of a flat account. See [the implementation and storage decision](../docs/plans/binance-live.zh.md).

## History

`runtime.image.LAYOUTS` knows only `replay-contract@v7`; no image or seal of an earlier contract is read
or executed. The parity receipts of the earlier migrations (Node transition, H18a/H19a funding loader, single
file, Dolt/OCI) are kept at
[`5700ceb`](https://github.com/qOeOp/trade/tree/5700ceb80e502084a9798f63871fa508cb6e6b95/backtest/r1/receipts);
they accept their own historical implementations, not later execution paths. The H23a–H27a paired
reports are [fixed historical
evidence](https://github.com/qOeOp/trade/tree/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/results).
Exposed-year implementation acceptance is not independent strategy qualification.

## Recovery boundaries

A stored run holds the revision's source, resolved configuration, observed runtime identity, input
identity (market, commit, pool rule and contracts) and the hashes and semantic fingerprint
of the native reports, in the research ledger and its `dolt_backup` copy. It does not hold the image or the exported Catalogs: full replay
recovery needs the image (pull its digest from GHCR) and the market commit, which a new export
turns into the same Catalogs. Historical local custody addresses are not product dependency paths.

Upgrading Nautilus starts with the paired acceptance above. The exported Catalogs follow the pinned
Catalog format (decimal128 prices and sizes, UTC timestamp columns); the pinned release has no Python
writer for funding updates, so the exporter writes those in the Catalog's own layout
(`data/funding_rates/`). `uv.lock` is part of the export cache key, so a new pin never reuses an old
export.
