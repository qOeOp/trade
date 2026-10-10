# R1 native replay

`python -m backtest.r1.run_portfolio` is the single R1 backtest entry. It loads
one complete external Strategy file after checking its exact SHA-256. Dolt owns
published source revisions; working files can live in a temporary directory.
The current `r1-native-v2` contract uses `PublishedR1Strategy` and ordinary
Python definitions in that one file. Source owns configuration validation,
replay diagnostics and integrity hooks; the shared runner transports scalar
configuration and explicit daily warmup, without a strategy identity allowlist.
The migration demonstration used 26 strategy identities and 27 source revisions,
including the original H19a v1 revision. Those trial records were locally backed
up and the active ledger reset on 2026-10-09. New research first publishes its
complete source into the active ledger; historical publication commits belong
to the archived database and require an explicit recovery environment.

R1's 37 instruments share one 100,000 USDT Nautilus `BacktestNode` margin
account. The published `nautilus_trader==2.0.0rc3` package owns data replay,
orders, fills, funding settlement, risk, portfolio accounting and reports.
No exchange trading credential is needed.

For a registered experiment, follow the [source, preregistration and artifact
guide](../../research/records/README.md). Its existing custody command exports
a fixed Dolt source revision, executes this runner and the auditor in the same
digest-pinned OCI image, and seals the result outside Git and `/tmp`.
A direct host run below is a temporary diagnostic and uses the host environment.

`--start`, `--end` and `--trade-start` require an explicit `Z` or UTC offset.
They must resolve to five-minute boundaries, with start < end and trade-start
inside that interval. Time precision is limited to six fractional digits;
fractional UTC offsets are rejected. The runner validates these values before
loading inputs and never uses the host timezone to interpret them.

## Export and run H19a

Use the exact Dolt commit returned by source publication as `SOURCE_AT`.
Export refuses to overwrite an existing source or binding destination.
This H19a example requires its source to have been published into the selected
ledger. Set the returned revision too; do not reuse an archived commit or assume
the old demo's revision number exists in a fresh database.

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
uv run --frozen python -m backtest.r1.run_portfolio \
  --strategy-file "$STRATEGY_WORKDIR/strategy.py" \
  --strategy-class PublishedR1Strategy \
  --strategy-sha256 782c9af84c9d060144a76bf3ff8eb2cae260b7114f1b9cc375518f47bf3de33e \
  --strategy-binding "$STRATEGY_WORKDIR/binding.json" \
  --catalog-root /path/to/r1-minute-catalog \
  --daily-root /path/to/r1-daily-catalog \
  --quantity-csv /path/to/r1-minute-catalog/per_coin_stop_fix.csv \
  --coins "${R1_COINS[@]}" \
  --start 2025-10-07T00:00:00Z --trade-start 2025-10-17T00:00:00Z \
  --end 2026-10-07T08:30:00Z \
  --signal-variant support-broad-two-tier-4h --exit-variant tier-target-b \
  --risk-budget-bps 25 --coin-notional-cap-pct 5 \
  --output /tmp/r1-external-h19a-37
```

The example binds the H19a native-v2 source to the selected ledger's returned
publication revision, fixed commit and exact source hash.
For another source or revision, export its binding and use its entry class and
hash. `validate_replay_configuration` checks the source's signal, exit, warmup
and sizing contract. `replay_diagnostics` supplies source-specific counters,
while `replay_integrity_findings` supplies source-specific failure findings;
the runner also rejects native denied/rejected orders. Use `--daily-warmup`
only for a source requiring historical daily bars. H19a's source requires 25-bp
total stop risk, a 5% coin notional cap and no daily warmup. Current runtime code
imports no product strategy or historical variant module.

The archived ledger retains the initial H19a `r1.broad-two-tier@1` source, with entry class
`R1Strategy`, `r1-native-v1` and SHA-256
`8b708592a27732311071b0b00d237001b6e6bb96725bcc3a842cf35ae2184b4a`.
Execute that revision with its retained accepted v1 image; the current v2
runner requires the new source hooks. Recover the archive into a separate ledger
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
Build and publish a single-platform image, then retain its actual manifest
digest rather than its tag or Docker configuration ID:

```bash
docker build --platform linux/arm64 --provenance=false \
  --file backtest/r1/runtime/Dockerfile \
  --tag REGISTRY/trade-r1-runtime:BUILD-TAG .
docker push REGISTRY/trade-r1-runtime:BUILD-TAG
```

A runtime identity JSON contains exactly `image_ref` (registry path plus
`@sha256:` manifest digest), matching `image_digest`, `platform` (`linux/arm64`
or `linux/amd64`) and `runtime_contract: r1-native-v2`. Pull the digest reference
before custody execution. Custody verifies the locally available manifest and
platform, observes the image's actual runtime and resolved configuration, and
runs with no network, a read-only root, read-only source/input mounts and one
writable report mount. The same image performs the audit. A sandbox supplies
isolation; the retained image bytes supply a reproducible environment.

## Paired acceptance and history

```bash
uv run --frozen python -m backtest.r1.checks.compare_node \
  /path/to/frozen/native-control /tmp/r1-external-h19a-37
uv run --frozen python -m backtest.r1.checks.audit_tiered_native \
  --run /tmp/r1-external-h19a-37 --catalog-root /path/to/r1-minute-catalog \
  --output /tmp/r1-external-h19a-audit.json
```

Check orders, fills, positions, fees, funding adjustments, account rows, returns
and per-coin diagnostics, then inspect native order integrity and audit findings.
A successful process exit does not establish parity. The pinned rc3 Strategy
activates its native take-profit child before the stop child to avoid a
synchronous sibling rejection; recheck this behavior before changing Nautilus.

The native auditor checks report identities, links, final open-position
protection and reported account economics for every v2 run. Recognized budgeted
tier shapes receive additional geometry, quantity and risk checks. A generic
audit does not prove a candidate's particular signal clock, staged-exit races
or every source-specific risk invariant; add the relevant native probes before
claiming those properties.

D105 sealed the migration checks for five representative native pairs: H19a,
H18a, R-1u, H04 staged exits and H29a. The full 37-instrument H19a pair also
passed. This accepts those sampled implementation paths, not native parity for
all 26 demo identities. The framework suite passed 199 tests, including real
isolated Dolt integration. Strategy economics and qualification are unchanged.

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
