# R1 native replay

`python -m backtest.r1.run_portfolio` is the R1 runner; every replay starts it
through `research.records.artifacts run` in the CI-built image. It loads
one complete external Strategy file after checking its exact SHA-256. Dolt owns
published source revisions; working files can live in a temporary directory.
The current `r1-native-v3` contract uses ordinary Python definitions in that one
file. Source owns sizing, configuration validation, replay diagnostics and
integrity hooks; the shared runner transports signal and exit labels and
explicit daily warmup, with no sizing parameter and no strategy identity
allowlist.
The migration demonstration used 26 strategy identities and 27 source revisions,
including the original H19a v1 revision. Those trial records were locally backed
up and the active ledger reset on 2026-10-09. New research first publishes its
complete source into the active ledger; historical publication commits belong
to the archived database and require an explicit recovery environment.

R1's 37 instruments share one 100,000 USDT Nautilus `BacktestNode` margin
account. The published `nautilus_trader==2.0.0rc3` package owns data replay,
orders, fills, funding settlement, risk, portfolio accounting and reports.
No exchange trading credential is needed.

For a registered experiment, follow the [`research-round`
skill](../../.agents/skills/research-round/SKILL.md) and its
[seal reference](../../.agents/skills/research-round/references/seal.md). Its
custody command exports a fixed Dolt source revision, executes this runner and
the auditor in the same digest-pinned OCI image, and seals the result outside
Git and `/tmp`. A draft runs with `artifacts run --explore`: the same image,
runner and audit, reports in a new `/tmp` directory, nothing sealed. Each run,
explored or sealed, reports one trial.

`--start`, `--end` and `--trade-start` require an explicit `Z` or UTC offset.
They must resolve to five-minute boundaries, with start < end and trade-start
inside that interval. Time precision is limited to six fractional digits;
fractional UTC offsets are rejected. The runner validates these values before
loading inputs and never uses the host timezone to interpret them.

## Export and run a source

Use the exact Dolt commit returned by source publication as `SOURCE_AT`.
Export refuses to overwrite an existing source or binding destination.
The example names the H19a demo identity; it runs only once an `r1-native-v3`
revision of it has been published into the selected ledger (the archived H19a
revisions are `r1-native-v1`/`v2` and their source sizing came from the removed
runner flags). Set the returned revision and hash; do not reuse an archived
commit or assume the old demo's revision number exists in a fresh database.

```bash
uv sync --frozen
SOURCE_AT=YOUR_SOURCE_PUBLICATION_COMMIT
STRATEGY_REVISION=YOUR_SOURCE_REVISION
STRATEGY_WORKDIR=$(mktemp -d /tmp/trade-h19a.XXXXXX)
uv run --frozen python -m research.records.cli --at "$SOURCE_AT" \
  strategy export r1.broad-two-tier --revision "$STRATEGY_REVISION" \
  --destination "$STRATEGY_WORKDIR/strategy.py" \
  --binding-output "$STRATEGY_WORKDIR/binding.json"
R1_COINS=(BTC ETH BNB ADA XRP SOL DOGE LTC TRX LINK DOT AVAX BCH ETC XLM ATOM FIL NEAR UNI AAVE ICP APT ARB SUI OP INJ TIA SEI PEPE SHIB HBAR ALGO FET WLD IMX STX LDO)
uv run --frozen python -m research.records.artifacts run --explore \
  --strategy-file "$STRATEGY_WORKDIR/strategy.py" \
  --strategy-class PublishedR1Strategy \
  --output "$STRATEGY_WORKDIR/r1-37" -- \
  --catalog-root /path/to/r1-minute-catalog \
  --daily-root /path/to/r1-daily-catalog \
  --quantity-csv /path/to/r1-minute-catalog/per_coin_stop_fix.csv \
  --coins "${R1_COINS[@]}" \
  --start 2025-10-07T00:00:00Z --trade-start 2025-10-17T00:00:00Z \
  --end 2026-10-07T08:30:00Z \
  --signal-variant support-broad-two-tier-4h --exit-variant tier-target-b
```

Exploration hashes the file it runs; a sealed run binds the source to the
selected ledger's returned publication revision, fixed commit and exact source
hash. For another source or revision, export it and use its entry class. `validate_replay_configuration` checks the source's signal, exit and warmup
contract; sizing is constants in the source. `replay_diagnostics` supplies source-specific counters,
while `replay_integrity_findings` supplies source-specific failure findings;
the runner also rejects native denied/rejected orders. The full source
contract is in the
[strategy-authoring reference](../../.agents/skills/research-round/references/strategy-authoring.md).
Use `--daily-warmup` only for a source requiring historical daily bars.
Current runtime code imports no product strategy or historical variant module.

The archived ledger retains the initial H19a `r1.broad-two-tier@1` source, with entry class
`R1Strategy`, `r1-native-v1` and SHA-256
`8b708592a27732311071b0b00d237001b6e6bb96725bcc3a842cf35ae2184b4a`.
Execute that revision with its retained accepted v1 image, and an
`r1-native-v2` revision with a retained v2 image: the v2 constructor receives
`risk_budget_fraction` and `max_coin_notional_fraction`, which the v3 runner no
longer passes. Recover the archive into a separate ledger
to read that historical revision; the fresh active ledger starts without it.

`--mark-root` optionally selects the derived MARK Catalog cache. The default
cache is keyed by input Catalog path and interval under the temporary directory.
The downloaded source Catalog stays read-only. `BacktestNode` loads funding
directly from it. `native_node.py` turns MARK bar closes into native
`MarkPriceUpdate` data, validates LAST/MARK alignment, and verifies cached mark
events before reuse. `replay_inputs.py` checks input receipts and funding
coverage. There is no second matching or account engine.

## Fixed runtime image

The maintained build inputs live in `runtime/`; the image contains Python,
Nautilus, locked dependencies, shared replay and the native auditor. Strategy
bodies, Dolt configuration and research records are excluded from the image.
The [`runtime-image`](../../.github/workflows/runtime-image.yml) workflow builds
it on a native arm64 runner for `linux/arm64` only and pushes it to
`ghcr.io/qoeop/trade-runtime`, labelled with the commit it was built from
(`org.opencontainers.image.revision`). It runs only when a runtime input changes
(`backtest/**/*.py`, the Dockerfile, `pyproject.toml`, `uv.lock`). A build on
main also moves the `main` tag, the current runtime; a pull request build is
tagged `pr-N`. Every build is tagged `sha-COMMIT`. Retain the pushed manifest
digest from the job summary, not a tag or Docker configuration ID. Images are not
built on a workstation, and there is no local registry or hand-written runtime
identity.

`artifacts run` without `--runtime` pulls `main` and records the manifest
digest it resolved; `--runtime` takes another CI tag or digest reference. The
identity (`image_ref` with `@sha256:` digest, `image_digest`, `platform`,
`runtime_contract`) is read from the image itself.
Custody verifies the locally available manifest and
platform, observes the image's actual runtime and resolved configuration, and
runs with no network, a read-only root, read-only source/input mounts and one
writable report mount. The same image performs the audit. A sandbox supplies
isolation; the retained image bytes supply a reproducible environment.
`artifacts register` accepts only an image whose revision label is on
origin/main and whose observed runtime code equals that commit's bytes.

The project is an installable package: `uv run --frozen --project REPO python
SCRIPT` imports `backtest` and `research` from a script anywhere, and the image
imports `backtest` from any directory. Probes need no `PYTHONPATH` and no
`docker run`.

## Paired acceptance and history

After changing a strategy, data adaptation, dependency or Nautilus, first run a
BTC/ETH pilot (`--coins BTC ETH`) of each affected source, then the full
37-instrument replay of each source still under research. Compare each run with
a frozen native control of the same instruments, window and configuration:

```bash
uv run --frozen python -m backtest.r1.checks.compare_node \
  /path/to/frozen/native-control /tmp/r1-external-h19a-37
uv run --frozen python -m backtest.r1.checks.audit_tiered_native \
  --run /tmp/r1-external-h19a-37 --output /tmp/r1-external-h19a-audit.json
```

Check orders, fills, positions, fees, funding adjustments, account rows, returns
and per-coin diagnostics, then inspect native order integrity and audit findings.
A successful process exit does not establish parity. The pinned rc3 Strategy
activates its native take-profit child before the stop child to avoid a
synchronous sibling rejection; recheck this behavior before changing Nautilus.

The native auditor checks report identities, links, final open-position
protection and reported account economics for every v2 run, the same way for
every strategy. It does not prove a candidate's particular signal clock, order
geometry, staged-exit races or other source-specific invariants: the strategy
checks those itself in `replay_integrity_findings`, or a native probe does before
the property is claimed. Images before 2026-10-10's report-traps rebuild also
ran budgeted-tier geometry gates for a fixed list of legacy signal variants; their
sealed `audit.json` keeps those results. The `--catalog-root` argument is still
accepted for older custody commands and is not read.

Besides the native reports, the runner seals `exposures.csv.gz`. A row labelled
with bar timestamp T holds a position open after every event before the next bar
timestamp, including fills stamped between bars, valued with the native
`Position.notional_value` and `Position.unrealized_pnl` at T's MARK. A
runner-side observer values the positions once the first MARK of the next
timestamp shows that point reached, and the runner values the last timestamp
after every component stopped.
It adds no timer: in rc3 probes a five-minute timer made a run with many resting
orders more than ten times slower. Balances and margins are not repeated: use
the latest account state before the next bar timestamp. A run fails integrity if a timestamp or an open
position goes unvalued. Seals from images before this report have none.

D105 sealed the migration checks for five representative native pairs: H19a,
H18a, R-1u, H04 staged exits and H29a. The full 37-instrument H19a pair also
passed. This accepts those sampled implementation paths, not native parity for
all 26 demo identities. At `537b74cbc` (#1488) the framework suite passed
199 tests, including real isolated Dolt integration. Strategy economics and qualification are unchanged.

Receipts in `receipts/` retain their original bytes and source identities.
The `parity_receipts` paths in `receipts/evidence.json` are historical locators;
their [fixed Git archive](https://github.com/qOeOp/trade/tree/44e229331fdc7d9b78e234079673b8df71faefc4/strategies/r1) contains the original three receipts.
Their same-named current copies under `receipts/` are byte-identical.
`parity-node-migration.json` describes the historical 16-combination Node
transition, including two pre-existing order-integrity failures. The H18a/H19a
funding-loader receipts and `parity-single-file-h19a.json` describe their own
historical implementations and acceptance. Those receipts do not automatically
accept the new Dolt/OCI execution path. The earlier H23a–H27a paired reports are
[fixed historical evidence](https://github.com/qOeOp/trade/tree/44e229331fdc7d9b78e234079673b8df71faefc4/research/r1_native/results).
Exposed-year implementation acceptance is not independent strategy qualification.

## Recovery boundaries

Seals capture exported source, exact bindings, resolved configuration, observed
runtime identity, native reports and logs. `artifacts restore` restores the
native reports; it does not provision the image or reconstruct the source Catalog.
Full replay recovery also needs native Dolt history, accessible image bytes and
canonical inputs. Retain images and database/artifact backups outside Git and
`/tmp`. A second directory on the same machine proves local copy recovery only.
The first migration's custody locations and contract are recorded in the
[migration record](../../docs/plans/dolt-strategy-oci-migration.zh.md); historical
local addresses are not product dependency paths.
