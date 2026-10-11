# Native replay

Every native replay goes through `research.records.artifacts run`: `--explore` runs a draft into a
new `/tmp` directory, and a run that a decision cites is sealed ([seal
reference](../.agents/skills/research-round/references/seal.md)). Both execute `python -m
backtest.run` and the native auditor in the same CI-built image and report one trial. Never start a
replay or a probe with `docker run` or `python -m backtest.run` directly.

| Path | Role |
|---|---|
| `load.py` | Window parsing, the hash-checked strategy source, prepared inputs and the derived MARK Catalog |
| `run.py` | Arguments, the fixed account, the `BacktestNode` run and `--describe` |
| `report.py` | Native reports, `exposures.csv.gz` and `summary.json` |
| `checks/audit.py` | Independent audit of every run's native reports |
| `checks/compare.py` | Engineering parity between two runs |
| `runtime/` | Image build inputs |

## Four inputs

The runner takes the strategy reference, the inputs, the window and the account, nothing else.

- **Strategy.** One complete source file, its entry class and SHA-256 (and, when sealed, its Dolt
  binding). The `r1-native-v4` contract is in the [strategy-authoring
  reference](../.agents/skills/research-round/references/strategy-authoring.md). The file holds every
  rule and constant, sizing included; a variant is a new revision. There are no signal, exit,
  warmup or sizing options: a source that needs daily warmup declares `DAILY_WARMUP = True`.
- **Inputs.** The minute and daily Catalogs, the per-coin quantity CSV and `--coins`
  (`--mark-root` optionally places the derived MARK cache). WS8 replaces them with a market-data
  commit.
- **Window.** `--start`, `--trade-start` and `--end` need an explicit `Z` or UTC offset, at most six
  fractional digits and no fractional offset, and fall on five-minute boundaries with
  `start <= trade-start < end`; the host timezone is never consulted.
- **Account.** Fixed in `run.py` (`ACCOUNT_CONTRACT`): one 100,000 USDT Nautilus `BacktestNode`
  margin account shared by every instrument, leverage 1, five-minute bar execution and the
  Catalog's fees and funding. The published `nautilus_trader==2.0.0rc3` owns data replay, orders,
  fills, funding settlement, risk, portfolio accounting and reports. No exchange trading credential
  is needed.

`load.py` turns MARK bar closes into native `MarkPriceUpdate` data, validates LAST/MARK alignment
and verifies cached MARK events before reuse; `BacktestNode` loads funding directly from the
read-only source Catalog, after a coverage check. There is no second matching or account engine.

## Explore a source

```bash
uv sync --frozen
STRATEGY_WORKDIR=$(mktemp -d /tmp/trade-draft.XXXXXX)
uv run --frozen python -m research.records.cli --at "$SOURCE_AT" \
  strategy export STRATEGY-ID --revision "$STRATEGY_REVISION" \
  --destination "$STRATEGY_WORKDIR/strategy.py" \
  --binding-output "$STRATEGY_WORKDIR/binding.json"
R1_COINS=(BTC ETH BNB ADA XRP SOL DOGE LTC TRX LINK DOT AVAX BCH ETC XLM ATOM FIL NEAR UNI AAVE ICP APT ARB SUI OP INJ TIA SEI PEPE SHIB HBAR ALGO FET WLD IMX STX LDO)
uv run --frozen python -m research.records.artifacts run --explore \
  --strategy-file "$STRATEGY_WORKDIR/strategy.py" --strategy-class ENTRY-CLASS \
  --output "$STRATEGY_WORKDIR/r1-37" -- \
  --catalog-root /path/to/r1-minute-catalog \
  --daily-root /path/to/r1-daily-catalog \
  --quantity-csv /path/to/r1-minute-catalog/per_coin_stop_fix.csv \
  --coins "${R1_COINS[@]}" \
  --start 2025-10-07T00:00:00Z --trade-start 2025-10-17T00:00:00Z \
  --end 2026-10-07T08:30:00Z
```

A draft file needs no export. Exploration hashes the file it runs; a sealed run binds the source
to the ledger's publication revision, fixed commit and exact source hash. `replay_diagnostics`
supplies source counters and `replay_integrity_findings` source failure findings; any finding or
denied/rejected order fails the run.

## Runtime image

The image holds Python, Nautilus, the locked dependencies, `backtest` and the auditor; strategy
bodies, Dolt configuration and research records are excluded. The
[`runtime-image`](../.github/workflows/runtime-image.yml) workflow builds it on a native arm64
runner for `linux/arm64` only and pushes it to `ghcr.io/qoeop/trade-runtime`, labelled with the
commit it was built from (`org.opencontainers.image.revision`), when a runtime input changes
(`backtest/**/*.py`, the Dockerfile, `pyproject.toml`, `uv.lock`). A main build moves the `main`
tag, the current runtime; a pull request build is tagged `pr-N`; every build is tagged
`sha-COMMIT`. Images are not built on a workstation, and there is no local registry or
hand-written runtime identity.

`artifacts run` without `--runtime` pulls `main` and records the manifest digest it resolved;
`--runtime` takes another CI tag or digest reference. The identity (`image_ref` with its
`@sha256:` digest, `image_digest`, `platform`, `runtime_contract`) is read from the image, and
`python -m backtest.run --describe` inside it reports its code hashes and the resolved
configuration. Replay and audit run with no network, a read-only root, read-only source and input
mounts and one writable report mount. `artifacts register` accepts only an image whose revision is
on origin/main and whose observed code equals that commit's bytes.

The project is an installable package: `uv run --frozen --project REPO python SCRIPT` imports
`backtest` and `research` from a script anywhere, and the image imports `backtest` from any
directory. A Nautilus probe is such a host script; it needs no `PYTHONPATH` and no `docker run`.

## Reports

Besides the native orders, fills, positions, account and returns reports, the runner writes
`exposures.csv.gz`. A row labelled with bar timestamp T holds a position open after every event
before the next bar timestamp, including fills stamped between bars, valued with the native
`Position.notional_value` and `Position.unrealized_pnl` at T's MARK. An observer values the
positions once the first MARK of the next timestamp shows that point reached, and the runner values
the last timestamp after every component stopped. It adds no timer: in rc3 probes a five-minute
timer made a run with many resting orders more than ten times slower. Balances and margins are not
repeated: use the latest account state before the next bar timestamp. A run fails integrity if a
timestamp or an open position goes unvalued.

The auditor checks report identities, links, final open-position protection and reported account
economics, the same way for every strategy. It does not prove a source's signal clock, order
geometry, staged-exit races or other source-specific invariants: the strategy checks those in
`replay_integrity_findings`, or a native probe does before the property is claimed. Seals from
images before 2026-10-10 also ran budgeted-tier geometry gates for a fixed list of legacy signal
variants; their sealed `audit.json` keeps those results.

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
uv run --frozen python -m backtest.checks.compare \
  "$STRATEGY_WORKDIR/reference/reports" "$STRATEGY_WORKDIR/candidate/reports"
```

When the contract changes, the source must accept both constructors and the reference image's
runner arguments are passed after `--`. Inspect orders, fills, positions, fees, funding
adjustments, account rows, returns and per-coin diagnostics, plus each run's audit. A clean exit is
not parity. The pinned rc3 Strategy activates its native take-profit child before the stop child to
avoid a synchronous sibling rejection; recheck this before changing Nautilus.

## History

Seals from the `backtest/r1` layout (`r1-native-v1` to `v3`) keep their recorded contract names and
still verify and report; `research.records.runtime.LAYOUTS` maps each contract to the runner,
auditor and source paths its image used. Their images were built locally and remain in the local
Docker image store until WS7; the v1 and v2 constructors received sizing arguments and the v1 to v3
runners took signal, exit and warmup options that `r1-native-v4` refuses.

The parity receipts of the earlier migrations (Node transition, H18a/H19a funding loader, single
file, Dolt/OCI) are kept at
[`5700ceb`](https://github.com/qOeOp/trade/tree/5700ceb80e502084a9798f63871fa508cb6e6b95/backtest/r1/receipts);
they accept their own historical implementations, not later execution paths. The H23a–H27a paired
reports are [fixed historical
evidence](https://github.com/qOeOp/trade/tree/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/results).
Exposed-year implementation acceptance is not independent strategy qualification.

## Recovery boundaries

Seals capture exported source, exact bindings, resolved configuration, observed runtime identity,
native reports and logs. `artifacts restore` restores the native reports; it does not provision the
image or reconstruct the source Catalog. Full replay recovery also needs native Dolt history, the
image (pull its digest from GHCR) and canonical inputs. The first migration's custody locations and
contract are recorded in the [migration record](../docs/plans/dolt-strategy-oci-migration.zh.md);
historical local addresses are not product dependency paths.
